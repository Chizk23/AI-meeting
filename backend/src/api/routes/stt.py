import asyncio
import json
import logging
import os
import queue
import subprocess
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from starlette.websockets import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from sqlalchemy import func

from src.api import auth, models, schemas
from src.api.core.app_state import config, ensure_audio_upload_dir, resolve_audio_storage_path
from src.api.domains.meetings.support import (
    estimate_segment_end,
    normalize_speaker_label,
)
from src.api.domains.meetings.operations import ensure_speaker_identity_mapping, get_ws_user, meeting_room_manager
from src.api.domains.meetings.upload_jobs import (
    UploadMeetingJob,
    normalize_upload_language,
    register_upload_job,
    sanitize_upload_filename,
    start_upload_job,
    validate_upload_filename,
)
from src.api.domains.meetings.prompts import (
    build_speaker_aware_transcript,
    build_structured_summary_prompts,
    get_phobert_processor,
    phobert_enabled_for,
)
from src.api.domains.meetings.transcripts import build_transcript_from_drafts, serialize_transcript_draft_chunks
from src.api.domains.meetings.tasks import _extract_json_object, _normalize_analysis_payload
from src.api.domains.shared.user_payloads import get_meeting_by_id, require_meeting_room_access
from src.api.crud import add_meeting_participant, create_audio_file, create_meeting, update_meeting
from src.api.database import SessionLocal, get_db
from src.cost.cost_logger import CostLogger
from src.api.domains.admin.operations import ADMIN_PROMPTS
from src.api.domains.admin.runtime import ADMIN_SYSTEM_SETTINGS

logger = logging.getLogger(__name__)
router = APIRouter(tags=["stt"])
MAX_FINAL_BUFFER_SECONDS = 4.5
MAX_FINAL_BUFFER_WORDS = 18
MIN_FINAL_BUFFER_WORDS = 6
FINAL_GAP_SECONDS = 0.8


def parse_bool_form(value: Any, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def parse_optional_form_datetime(raw_value: Optional[str]) -> Optional[datetime]:
    if not raw_value:
        return None
    normalized = raw_value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    parsed = datetime.fromisoformat(normalized)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed
def upsert_transcript_draft(
    db: Session,
    meeting_id: str,
    user_id: str,
    chunk_index: int,
    text: str,
    segments: List[Dict[str, Any]],
    language: str,
    provider: str,
    model: str,
    start_ms: int,
) -> models.MeetingTranscriptDraft:
    draft = db.query(models.MeetingTranscriptDraft).filter(
        models.MeetingTranscriptDraft.meeting_id == meeting_id,
        models.MeetingTranscriptDraft.user_id == user_id,
        models.MeetingTranscriptDraft.chunk_index == chunk_index,
    ).first()

    if draft:
        draft.text = text
        draft.segments = segments
        draft.language = language
        draft.provider = provider
        draft.model = model
        draft.start_ms = start_ms
        draft.updated_at = datetime.now(timezone.utc)
    else:
        draft = models.MeetingTranscriptDraft(
            meeting_id=meeting_id,
            user_id=user_id,
            chunk_index=chunk_index,
            text=text,
            segments=segments,
            language=language,
            provider=provider,
            model=model,
            start_ms=start_ms,
        )
        db.add(draft)
    
    db.commit()
    db.refresh(draft)
    return draft

@router.post("/api/upload")
async def upload_audio(
    file: UploadFile = File(...), 
    organization_id: str = Form(...),
    group_id: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    scheduled_start: Optional[str] = Form(None),
    scheduled_end: Optional[str] = Form(None),
    language: str = Form("auto"),
    stt_provider: str = Form("deepgram"),
    enable_diarization: bool = Form(True),
    enable_summary: bool = Form(True),
    enable_action_items: bool = Form(True),
    enable_noise_cleanup: bool = Form(True),
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    auth.require_org_member(db, current_user, organization_id)
    if group_id:
        group = auth.require_group_member(db, current_user, group_id)
        if group.organization_id != organization_id:
            raise HTTPException(status_code=400, detail="Group does not belong to organization")

    if not file.filename:
        raise HTTPException(status_code=400, detail="Audio file is required")

    try:
        validate_upload_filename(file.filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    max_upload_size = int(config.server.max_upload_size or 0)
    upload_bytes = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        upload_bytes.extend(chunk)
        if max_upload_size and len(upload_bytes) > max_upload_size:
            raise HTTPException(status_code=413, detail=f"File too large. Max size is {max_upload_size // (1024 * 1024)}MB")
    if not upload_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    storage_limit_gb = ADMIN_SYSTEM_SETTINGS.get("storage_limit_gb_per_org") or 0
    try:
        storage_limit_gb = int(storage_limit_gb)
    except (TypeError, ValueError):
        storage_limit_gb = 0
    if storage_limit_gb > 0:
        limit_bytes = storage_limit_gb * 1024 * 1024 * 1024
        current_usage = db.query(func.coalesce(func.sum(models.AudioFile.file_size), 0)).join(
            models.Meeting, models.AudioFile.meeting_id == models.Meeting.id
        ).filter(models.Meeting.organization_id == organization_id).scalar() or 0
        if current_usage + len(upload_bytes) > limit_bytes:
            raise HTTPException(
                status_code=413,
                detail=(
                    f"Organization storage quota exceeded "
                    f"(limit: {storage_limit_gb} GB). "
                    "Please delete old recordings or contact your administrator."
                ),
            )

    try:
        parsed_start = parse_optional_form_datetime(scheduled_start)
        parsed_end = parse_optional_form_datetime(scheduled_end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid meeting date/time") from exc

    meeting_title = (title or "").strip() or os.path.splitext(file.filename)[0]
    meeting_payload = {
        "organization_id": organization_id,
        "group_id": group_id,
        "title": meeting_title,
        "description": description,
        "meeting_type": "MEETING",
        "status": "queued",
        "scheduled_start": parsed_start,
        "scheduled_end": parsed_end,
    }
    meeting = create_meeting(db, meeting_payload, created_by=current_user.id)
    add_meeting_participant(db, meeting.id, user_id=current_user.id, role="HOST", invite_status="accepted")

    meeting_dir = os.path.join(ensure_audio_upload_dir(), meeting.id)
    os.makedirs(meeting_dir, exist_ok=True)
    stored_filename = sanitize_upload_filename(file.filename)
    original_path = os.path.join(meeting_dir, stored_filename)
    with open(original_path, "wb") as output_file:
        output_file.write(upload_bytes)

    audio_record = create_audio_file(db, {
        "meeting_id": meeting.id,
        "filename": stored_filename,
        "original_filename": file.filename,
        "file_path": original_path,
        "file_size": len(upload_bytes),
        "format": os.path.splitext(stored_filename)[1].replace(".", "").upper() or "BIN",
        "upload_status": "UPLOADED",
    })
    audio_stream_url = f"/api/audio-files/{audio_record.id}/stream"
    update_meeting(db, meeting.id, {
        "audio_url": audio_stream_url,
        "recording_url": audio_stream_url,
        "status": "queued",
    })

    normalized_language = normalize_upload_language(language)
    provider_name = (stt_provider or "deepgram").strip().lower() or "deepgram"
    job = register_upload_job(UploadMeetingJob(
        meeting_id=meeting.id,
        created_by=current_user.id,
        audio_file_id=audio_record.id,
        original_audio_path=original_path,
        original_filename=file.filename,
        organization_id=organization_id,
        stt_provider=provider_name,
        language=normalized_language,
        enable_diarization=parse_bool_form(enable_diarization, True),
        enable_summary=parse_bool_form(enable_summary, True),
        enable_action_items=parse_bool_form(enable_action_items, True),
        enable_noise_cleanup=parse_bool_form(enable_noise_cleanup, True),
    ))
    start_upload_job(job)
    return {
        "job_id": job.job_id,
        "meeting_id": meeting.id,
        "status": job.status,
        "progress_percent": job.progress_percent,
        "current_stage": job.current_stage,
    }

# Singleton STT providers - load once, reuse for all chunks
_stt_service = None
_stt_services_by_provider: Dict[str, Any] = {}

def get_stt_provider(provider_name: Optional[str] = None):
    global _stt_service
    normalized_provider = (provider_name or "").strip().lower()
    if normalized_provider:
        if normalized_provider not in _stt_services_by_provider:
            from src.stt.service import STTService
            _stt_services_by_provider[normalized_provider] = STTService(provider=normalized_provider)
        return _stt_services_by_provider[normalized_provider].provider

    if _stt_service is None:
        from src.stt.service import STTService
        _stt_service = STTService()
    return _stt_service.provider


def audio_upload_suffix(filename: Optional[str]) -> str:
    lowered = (filename or "").lower()
    if lowered.endswith(".wav"):
        return ".wav"
    if lowered.endswith(".mp3"):
        return ".mp3"
    if lowered.endswith(".mp4"):
        return ".mp4"
    if lowered.endswith(".webm"):
        return ".webm"
    if lowered.endswith(".m4a"):
        return ".m4a"
    return ".webm"


async def save_upload_to_temp_wav(audio: UploadFile) -> str:
    import tempfile

    suffix = audio_upload_suffix(audio.filename)
    tmp_path = ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await audio.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty audio file")
        tmp.write(content)
        tmp_path = tmp.name

    audio_path = tmp_path
    if suffix != ".wav":
        wav_path = tmp_path.rsplit(".", 1)[0] + ".wav"
        try:
            subprocess.run(
                ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", "-f", "wav", wav_path],
                capture_output=True,
                timeout=30,
                check=True,
            )
            os.unlink(tmp_path)
            audio_path = wav_path
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            logger.warning("ffmpeg conversion failed for temp STT upload, using original: %s", exc)
    return audio_path


def normalize_test_stt_result(result: Dict[str, Any], language: str = "auto") -> Dict[str, Any]:
    detected_language = result.get("language") or result.get("detected_language") or language or "auto"
    text = str(result.get("text") or "")
    segments = []
    for segment in result.get("segments", []) or []:
        segments.append({
            "speaker": segment.get("speaker") or segment.get("speaker_label") or "Test Speaker",
            "speaker_label": normalize_speaker_label(segment.get("speaker_label") or segment.get("speaker") or "Test Speaker"),
            "speaker_display_name": segment.get("speaker_display_name") or segment.get("speaker") or "Test Speaker",
            "start": segment.get("start", segment.get("start_time", 0)),
            "end": segment.get("end", segment.get("end_time", 0)),
            "text": segment.get("text", ""),
            "language": segment.get("language") or segment.get("detected_language") or detected_language,
            "confidence": segment.get("confidence") or segment.get("confidence_score"),
        })
    if text.strip() and not segments:
        segments = [{
            "speaker": "Test Speaker",
            "speaker_label": "Test Speaker",
            "speaker_display_name": "Test Speaker",
            "start": 0,
            "end": estimate_segment_end(0, text),
            "text": text.strip(),
            "language": detected_language,
            "confidence": result.get("confidence") or result.get("confidence_score"),
        }]
    return {"text": text, "segments": segments, "language": detected_language}


def realtime_stt_enabled() -> bool:
    mode = os.getenv("REALTIME_STT_MODE", "deepgram_streaming").lower()
    return mode == "deepgram_streaming" and bool(os.getenv("DEEPGRAM_API_KEY"))


def deepgram_message_to_payload(message: Any) -> Optional[Dict[str, Any]]:
    if isinstance(message, bytes):
        return None
    data = message.model_dump() if hasattr(message, "model_dump") else message
    if not isinstance(data, dict):
        data = getattr(message, "__dict__", {})
    event_type = data.get("type") or getattr(message, "type", None)
    if event_type == "Results":
        channel = data.get("channel") or {}
        alternatives = channel.get("alternatives") or []
        alternative = alternatives[0] if alternatives else {}
        transcript = str(alternative.get("transcript") or "").strip()
        if not transcript:
            return None
        return {
            "kind": "result",
            "text": transcript,
            "is_final": bool(data.get("is_final")),
            "speech_final": bool(data.get("speech_final")),
            "from_finalize": bool(data.get("from_finalize")),
            "start": float(data.get("start") or 0),
            "duration": float(data.get("duration") or 0),
            "confidence": alternative.get("confidence"),
        }
    if event_type == "UtteranceEnd":
        return {"kind": "utterance_end"}
    if event_type == "SpeechStarted":
        return {"kind": "speech_started"}
    return None


class DeepgramLiveBridge:
    def __init__(
        self,
        *,
        loop: asyncio.AbstractEventLoop,
        sample_rate: int = 16000,
        language: str = "vi",
    ) -> None:
        self.loop = loop
        self.sample_rate = int(sample_rate or 16000)
        self.language = language or "vi"
        self.result_queue: asyncio.Queue = asyncio.Queue()
        self.media_queue: "queue.Queue[Any]" = queue.Queue()
        self.stop_event = threading.Event()
        self.thread: Optional[threading.Thread] = None

    def _emit(self, payload: Dict[str, Any]) -> None:
        self.loop.call_soon_threadsafe(self.result_queue.put_nowait, payload)

    def start(self) -> None:
        self.thread = threading.Thread(target=self._run, name="deepgram-live-stt", daemon=True)
        self.thread.start()

    def send_media(self, data: bytes) -> None:
        if data:
            self.media_queue.put(data)

    def finalize(self) -> None:
        self.media_queue.put({"type": "finalize"})

    def close(self) -> None:
        self.stop_event.set()
        self.media_queue.put({"type": "close"})

    def _run(self) -> None:
        try:
            from deepgram import DeepgramClient

            api_key = os.environ.get("DEEPGRAM_API_KEY", "")
            if not api_key:
                self._emit({"kind": "error", "error": "DEEPGRAM_API_KEY not set"})
                return

            client = DeepgramClient(api_key=api_key)
            model = os.getenv("DEEPGRAM_MODEL", "nova-3")
            logger.info(f"DeepgramLiveBridge: connecting to Deepgram streaming (model={model}, lang={self.language}, sr={self.sample_rate})")

            with client.listen.v1.connect(
                model=model,
                language=self.language,
                encoding="linear16",
                sample_rate=self.sample_rate,
                channels=1,
                interim_results="true",
                endpointing=350,
                smart_format="true",
                punctuate="true",
                diarize="false",
                vad_events="true",
            ) as dg_socket:
                logger.info("DeepgramLiveBridge: connected successfully")
                self._emit({"kind": "status", "status": "streaming"})

                def recv_loop() -> None:
                    while not self.stop_event.is_set():
                        try:
                            payload = deepgram_message_to_payload(dg_socket.recv())
                            if payload:
                                self._emit(payload)
                        except Exception as exc:
                            if not self.stop_event.is_set():
                                logger.error(f"DeepgramLiveBridge recv error: {exc}")
                                self._emit({"kind": "error", "error": f"Deepgram recv error: {exc}"})
                            break

                recv_thread = threading.Thread(target=recv_loop, name="deepgram-live-recv", daemon=True)
                recv_thread.start()

                while not self.stop_event.is_set():
                    item = self.media_queue.get()
                    if isinstance(item, (bytes, bytearray)):
                        dg_socket.send_media(bytes(item))
                    elif isinstance(item, dict) and item.get("type") == "finalize":
                        dg_socket.send_finalize()
                    elif isinstance(item, dict) and item.get("type") == "close":
                        try:
                            dg_socket.send_finalize()
                            dg_socket.send_close_stream()
                        except Exception:
                            pass
                        break
        except ImportError as exc:
            logger.error(f"DeepgramLiveBridge: deepgram SDK not installed: {exc}")
            self._emit({"kind": "error", "error": f"Deepgram SDK not installed: {exc}"})
        except Exception as exc:
            logger.error(f"DeepgramLiveBridge: connection failed: {type(exc).__name__}: {exc}")
            self._emit({"kind": "error", "error": f"Deepgram connection failed: {exc}"})
        finally:
            self._emit({"kind": "status", "status": "closed"})


def websocket_token_from_headers(websocket: WebSocket, token: Optional[str]) -> Optional[str]:
    return token or websocket.headers.get("authorization")


async def receive_initial_stt_config(websocket: WebSocket) -> tuple[Dict[str, Any], Optional[bytes]]:
    message = await websocket.receive()
    if message.get("bytes") is not None:
        return {}, message["bytes"]
    raw_text = message.get("text")
    if not raw_text:
        return {}, None
    try:
        payload = json.loads(raw_text)
    except json.JSONDecodeError:
        return {}, None
    if payload.get("type") == "stt.config":
        return payload, None
    return payload, None


def build_stream_segment(
    *,
    text: str,
    user_display_name: str,
    language: str,
    confidence: Optional[float],
    start_seconds: float = 0.0,
    duration_seconds: Optional[float] = None,
) -> Dict[str, Any]:
    speaker_label = normalize_speaker_label(user_display_name)
    start = max(0.0, float(start_seconds or 0.0))
    end = start + max(0.0, float(duration_seconds or 0.0))
    if end <= start:
        end = estimate_segment_end(start, text)
    return {
        "speaker": user_display_name,
        "speaker_label": speaker_label,
        "speaker_display_name": user_display_name,
        "start": start,
        "end": end,
        "text": text,
        "language": language,
        "confidence": confidence,
    }


def should_flush_final_buffer(parts: List[Dict[str, Any]], latest_payload: Dict[str, Any]) -> bool:
    if not parts:
        return False
    if latest_payload.get("speech_final") or latest_payload.get("from_finalize"):
        return True
    total_words = sum(len(str(part.get("text") or "").split()) for part in parts)
    first_start = float(parts[0].get("start") or 0.0)
    latest_start = float(latest_payload.get("start") or 0.0)
    latest_duration = float(latest_payload.get("duration") or 0.0)
    total_duration = max(0.0, latest_start + latest_duration - first_start)
    if total_words >= MAX_FINAL_BUFFER_WORDS or total_duration >= MAX_FINAL_BUFFER_SECONDS:
        return True
    if len(parts) >= 2 and total_words >= MIN_FINAL_BUFFER_WORDS:
        previous = parts[-2]
        previous_end = float(previous.get("start") or 0.0) + float(previous.get("duration") or 0.0)
        if latest_start - previous_end >= FINAL_GAP_SECONDS:
            return True
    return False


def next_transcript_chunk_index(db: Session, meeting_id: str, user_id: str) -> int:
    current = db.query(func.max(models.MeetingTranscriptDraft.chunk_index)).filter(
        models.MeetingTranscriptDraft.meeting_id == meeting_id,
        models.MeetingTranscriptDraft.user_id == user_id,
    ).scalar()
    return int(current if current is not None else -1) + 1


@router.websocket("/api/test-stt/stream")
async def test_stt_stream(websocket: WebSocket, token: Optional[str] = Query(None)):
    db = SessionLocal()
    bridge: Optional[DeepgramLiveBridge] = None
    try:
        await websocket.accept()
        current_user = get_ws_user(db, websocket_token_from_headers(websocket, token))
        if not realtime_stt_enabled():
            await websocket.send_json({
                "type": "stt.status",
                "status": "fallback",
                "reason": "realtime_stt_disabled",
            })
            await websocket.close(code=1013, reason="Realtime STT fallback")
            return

        config_payload, first_bytes = await receive_initial_stt_config(websocket)
        sample_rate = int(config_payload.get("sampleRate") or config_payload.get("sample_rate") or 16000)
        language = str(config_payload.get("language") or "vi")
        bridge = DeepgramLiveBridge(loop=asyncio.get_running_loop(), sample_rate=sample_rate, language=language)
        bridge.start()
        if first_bytes:
            bridge.send_media(first_bytes)

        chunk_index = 0
        final_parts: List[Dict[str, Any]] = []
        final_confidence: Optional[float] = None
        user_display_name = " ".join(part for part in [current_user.first_name, current_user.last_name] if part).strip() or current_user.username

        async def receive_loop() -> None:
            while True:
                message = await websocket.receive()
                if message.get("bytes") is not None:
                    bridge.send_media(message["bytes"])
                    continue
                raw_text = message.get("text")
                if not raw_text:
                    continue
                try:
                    payload = json.loads(raw_text)
                except json.JSONDecodeError:
                    continue
                if payload.get("type") == "stt.finalize":
                    bridge.finalize()
                elif payload.get("type") == "stt.close":
                    bridge.close()
                    break

        async def emit_final(parts: List[Dict[str, Any]], confidence: Optional[float]) -> None:
            nonlocal chunk_index
            normalized_parts = [part for part in parts if str(part.get("text") or "").strip()]
            if not normalized_parts:
                return
            normalized_text = " ".join(str(part.get("text") or "").strip() for part in normalized_parts).strip()
            first_start = float(normalized_parts[0].get("start") or 0.0)
            if not normalized_text:
                return
            segments = [
                build_stream_segment(
                    text=str(part.get("text") or "").strip(),
                    user_display_name=user_display_name,
                    language=language,
                    confidence=part.get("confidence") or confidence,
                    start_seconds=float(part.get("start") or 0.0),
                    duration_seconds=float(part.get("duration") or 0.0),
                )
                for part in normalized_parts
            ]
            nlp_metadata = None
            if phobert_enabled_for(language):
                try:
                    processor = get_phobert_processor()
                    processed = processor.process_chunk(normalized_text, segments)
                    normalized_text = str(processed.get("text") or normalized_text)
                    segments = processed.get("segments") or segments
                    nlp_metadata = processed.get("nlp_metadata")
                except Exception as nlp_error:
                    logger.warning("PhoBERT test stream post-processing skipped: %s", nlp_error)

            await websocket.send_json({
                "type": "test_stt.final",
                "id": f"test:{current_user.id}:{chunk_index}",
                "chunkIndex": chunk_index,
                "text": normalized_text,
                "segments": segments,
                "language": language,
                "provider": "deepgram",
                "model": os.getenv("DEEPGRAM_MODEL", "nova-3"),
                "nlp_metadata": nlp_metadata,
                "startMs": int(round(first_start * 1000)),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            chunk_index += 1

        async def result_loop() -> None:
            nonlocal final_parts, final_confidence
            while True:
                payload = await bridge.result_queue.get()
                kind = payload.get("kind")
                if kind == "status":
                    if payload.get("status") == "closed" and final_parts:
                        await emit_final(final_parts, final_confidence)
                        final_parts = []
                        final_confidence = None
                    await websocket.send_json({"type": "stt.status", "status": payload.get("status")})
                    if payload.get("status") == "closed":
                        break
                elif kind == "error":
                    await websocket.send_json({
                        "type": "stt.status",
                        "status": "error",
                        "error": payload.get("error"),
                    })
                    break
                elif kind == "result":
                    text = str(payload.get("text") or "").strip()
                    if not text:
                        continue
                    if payload.get("is_final"):
                        final_parts.append(payload)
                        final_confidence = payload.get("confidence") or final_confidence
                        if should_flush_final_buffer(final_parts, payload):
                            await emit_final(final_parts, final_confidence)
                            final_parts = []
                            final_confidence = None
                    else:
                        interim_text = " ".join([
                            *(str(part.get("text") or "").strip() for part in final_parts),
                            text,
                        ]).strip()
                        await websocket.send_json({
                            "type": "test_stt.interim",
                            "text": interim_text,
                            "language": language,
                            "provider": "deepgram",
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        })
                elif kind == "utterance_end" and final_parts:
                    await emit_final(final_parts, final_confidence)
                    final_parts = []
                    final_confidence = None

        receive_task = asyncio.create_task(receive_loop())
        result_task = asyncio.create_task(result_loop())
        done, pending = await asyncio.wait({receive_task, result_task}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            if task.exception():
                raise task.exception()
    except WebSocketDisconnect:
        pass
    except HTTPException as exc:
        try:
            await websocket.send_json({"type": "stt.status", "status": "error", "error": str(exc.detail)})
            await websocket.close(code=1008, reason=str(exc.detail))
        except Exception:
            pass
    except Exception as exc:
        logger.error("Test STT stream error: %s", exc, exc_info=True)
        try:
            await websocket.send_json({"type": "stt.status", "status": "error", "error": str(exc)})
            await websocket.close(code=1011, reason="STT stream error")
        except Exception:
            pass
    finally:
        if bridge:
            bridge.close()
        db.close()


@router.websocket("/api/meetings/{meeting_id}/stt-stream")
async def meeting_stt_stream(
    websocket: WebSocket,
    meeting_id: str,
    token: Optional[str] = Query(None),
):
    db = SessionLocal()
    bridge: Optional[DeepgramLiveBridge] = None
    raw_audio_file = None
    raw_audio_path = ""
    sample_rate = 16000
    try:
        await websocket.accept()
        logger.info(f"STT WebSocket accepted: meeting={meeting_id}")

        # Authenticate user
        try:
            auth_token = websocket_token_from_headers(websocket, token)
            logger.info(f"STT WebSocket auth: token={'present' if auth_token else 'missing'}")
            current_user = get_ws_user(db, auth_token)
            logger.info(f"STT WebSocket auth success: user={current_user.username}")
        except HTTPException as auth_err:
            logger.warning(f"STT WebSocket auth failed: {auth_err.detail}")
            await websocket.send_json({"type": "stt.status", "status": "error", "error": f"Auth failed: {auth_err.detail}"})
            await websocket.close(code=1008, reason="Authentication failed")
            return

        meeting = get_meeting_by_id(db, meeting_id)
        if not meeting:
            await websocket.send_json({"type": "stt.status", "status": "error", "error": "Meeting not found"})
            await websocket.close(code=1008, reason="Meeting not found")
            return

        try:
            require_meeting_room_access(db, current_user, meeting)
        except HTTPException as access_err:
            logger.warning(f"STT WebSocket access denied: {access_err.detail}")
            await websocket.send_json({"type": "stt.status", "status": "error", "error": f"Access denied: {access_err.detail}"})
            await websocket.close(code=1008, reason="Access denied")
            return

        if not realtime_stt_enabled():
            await websocket.send_json({
                "type": "stt.status",
                "status": "fallback",
                "reason": "realtime_stt_disabled",
            })
            await websocket.close(code=1013, reason="Realtime STT fallback")
            return

        config_payload, first_bytes = await receive_initial_stt_config(websocket)
        sample_rate = int(config_payload.get("sampleRate") or config_payload.get("sample_rate") or 16000)
        language = str(config_payload.get("language") or "vi")
        bridge = DeepgramLiveBridge(loop=asyncio.get_running_loop(), sample_rate=sample_rate, language=language)
        bridge.start()
        if first_bytes:
            bridge.send_media(first_bytes)

        # Save raw audio for recording persistence
        audio_dir = os.path.join(ensure_audio_upload_dir(), meeting_id)
        os.makedirs(audio_dir, exist_ok=True)
        raw_audio_path = os.path.join(audio_dir, f"stream_{current_user.id}_{int(time.time())}.pcm")
        raw_audio_file = open(raw_audio_path, "ab")
        if first_bytes:
            raw_audio_file.write(first_bytes)

        chunk_index = next_transcript_chunk_index(db, meeting_id, current_user.id)
        final_parts: List[Dict[str, Any]] = []
        final_confidence: Optional[float] = None
        user_display_name = " ".join(part for part in [current_user.first_name, current_user.last_name] if part).strip() or current_user.username
        ensure_speaker_identity_mapping(
            db,
            meeting_id,
            user_display_name,
            display_name=user_display_name,
            user_id=current_user.id,
        )

        async def receive_loop() -> None:
            while True:
                message = await websocket.receive()
                if message.get("bytes") is not None:
                    bridge.send_media(message["bytes"])
                    raw_audio_file.write(message["bytes"])
                    continue
                raw_text = message.get("text")
                if not raw_text:
                    continue
                try:
                    payload = json.loads(raw_text)
                except json.JSONDecodeError:
                    continue
                if payload.get("type") == "stt.finalize":
                    bridge.finalize()
                elif payload.get("type") == "stt.close":
                    bridge.close()
                    break

        async def emit_final(parts: List[Dict[str, Any]], confidence: Optional[float]) -> None:
            nonlocal chunk_index
            normalized_parts = [part for part in parts if str(part.get("text") or "").strip()]
            if not normalized_parts:
                return
            normalized_text = " ".join(str(part.get("text") or "").strip() for part in normalized_parts).strip()
            if not normalized_text:
                return
            segments = [
                build_stream_segment(
                    text=str(part.get("text") or "").strip(),
                    user_display_name=user_display_name,
                    language=language,
                    confidence=part.get("confidence") or confidence,
                    start_seconds=float(part.get("start") or 0.0),
                    duration_seconds=float(part.get("duration") or 0.0),
                )
                for part in normalized_parts
            ]
            nlp_metadata = None
            if phobert_enabled_for(language):
                try:
                    processor = get_phobert_processor()
                    processed = processor.process_chunk(normalized_text, segments)
                    normalized_text = str(processed.get("text") or normalized_text)
                    segments = processed.get("segments") or segments
                    nlp_metadata = processed.get("nlp_metadata")
                except Exception as nlp_error:
                    logger.warning("PhoBERT meeting stream post-processing skipped: %s", nlp_error)

            start_ms = int(round(float(normalized_parts[0].get("start") or 0.0) * 1000))
            upsert_transcript_draft(
                db,
                meeting_id=meeting_id,
                user_id=current_user.id,
                chunk_index=chunk_index,
                text=normalized_text,
                segments=segments,
                language=language,
                provider="deepgram_streaming",
                model=os.getenv("DEEPGRAM_MODEL", "nova-3"),
                start_ms=start_ms,
            )
            event_payload = {
                "type": "transcript.chunk",
                "meeting_id": meeting_id,
                "id": f"{meeting_id}:{current_user.id}:{chunk_index}",
                "user_id": current_user.id,
                "chunkIndex": chunk_index,
                "text": normalized_text,
                "segments": segments,
                "speaker": user_display_name,
                "language": language,
                "nlp_metadata": nlp_metadata,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            await websocket.send_json(event_payload)
            await meeting_room_manager.broadcast(meeting_id, event_payload)
            chunk_index += 1

        async def result_loop() -> None:
            nonlocal final_parts, final_confidence
            while True:
                payload = await bridge.result_queue.get()
                kind = payload.get("kind")
                if kind == "status":
                    if payload.get("status") == "closed" and final_parts:
                        await emit_final(final_parts, final_confidence)
                        final_parts = []
                        final_confidence = None
                    await websocket.send_json({"type": "stt.status", "status": payload.get("status")})
                    if payload.get("status") == "closed":
                        break
                elif kind == "error":
                    await websocket.send_json({
                        "type": "stt.status",
                        "status": "error",
                        "error": payload.get("error"),
                    })
                    break
                elif kind == "result":
                    text = str(payload.get("text") or "").strip()
                    if not text:
                        continue
                    if payload.get("is_final"):
                        final_parts.append(payload)
                        final_confidence = payload.get("confidence") or final_confidence
                        if should_flush_final_buffer(final_parts, payload):
                            await emit_final(final_parts, final_confidence)
                            final_parts = []
                            final_confidence = None
                    else:
                        interim_text = " ".join([
                            *(str(part.get("text") or "").strip() for part in final_parts),
                            text,
                        ]).strip()
                        interim_payload = {
                            "type": "transcript.interim",
                            "meeting_id": meeting_id,
                            "user_id": current_user.id,
                            "speaker": user_display_name,
                            "text": interim_text,
                            "language": language,
                            "timestamp": datetime.now(timezone.utc).isoformat(),
                        }
                        await websocket.send_json(interim_payload)
                        await meeting_room_manager.broadcast(meeting_id, interim_payload)
                elif kind == "utterance_end" and final_parts:
                    await emit_final(final_parts, final_confidence)
                    final_parts = []
                    final_confidence = None

        receive_task = asyncio.create_task(receive_loop())
        result_task = asyncio.create_task(result_loop())
        done, pending = await asyncio.wait({receive_task, result_task}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            if task.exception():
                raise task.exception()
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.error("Meeting STT stream error: %s", exc, exc_info=True)
        try:
            await websocket.send_json({"type": "stt.status", "status": "error", "error": str(exc)})
            await websocket.close(code=1011, reason="STT stream error")
        except Exception:
            pass
    finally:
        if bridge:
            bridge.close()
        # Close raw audio file and convert PCM → WAV
        try:
            if raw_audio_file and not raw_audio_file.closed:
                raw_audio_file.close()
            if os.path.exists(raw_audio_path) and os.path.getsize(raw_audio_path) > 0:
                import wave
                wav_path = raw_audio_path.replace(".pcm", ".wav")
                with wave.open(wav_path, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(sample_rate)
                    with open(raw_audio_path, "rb") as pf:
                        wf.writeframes(pf.read())
                os.remove(raw_audio_path)
                logger.info(f"Saved streaming audio: {wav_path} ({os.path.getsize(wav_path)} bytes)")
        except Exception as audio_err:
            logger.error(f"Failed to save streaming audio: {audio_err}")
        db.close()


@router.post("/api/test-stt/transcribe-chunk")
async def test_stt_transcribe_chunk(
    audio: UploadFile = File(...),
    chunk_index: Optional[int] = Form(None),
    language: str = Form("auto"),
    provider_name: Optional[str] = Form(None),
    current_user=Depends(auth.get_current_user),
):
    """No-DB microphone test endpoint: temp audio -> STT -> optional PhoBERT -> JSON."""
    audio_path = ""
    try:
        audio_path = await save_upload_to_temp_wav(audio)
        provider = get_stt_provider(provider_name)
        result = provider.transcribe(audio_path)
        if not result or "text" not in result:
            raise ValueError("Invalid transcription result")
        if result.get("error"):
            raise ValueError(f"STT provider error: {result['error']}")

        normalized = normalize_test_stt_result(result, language)
        text = normalized["text"]
        segments = normalized["segments"]
        detected_language = normalized["language"]
        nlp_metadata = None
        if phobert_enabled_for(detected_language):
            try:
                processor = get_phobert_processor()
                processed = processor.process_chunk(text, segments)
                text = str(processed.get("text") or text)
                segments = processed.get("segments") or segments
                nlp_metadata = processed.get("nlp_metadata")
            except Exception as nlp_error:
                logger.warning("PhoBERT test chunk post-processing skipped: %s", nlp_error)

        actual_provider = provider_name or os.getenv("STT_PROVIDER", "deepgram").lower()
        return {
            "id": f"test:{current_user.id}:{chunk_index}" if chunk_index is not None else None,
            "chunkIndex": chunk_index,
            "text": text,
            "segments": segments,
            "language": detected_language,
            "detected_language": detected_language,
            "provider": actual_provider,
            "model": os.getenv("DEEPGRAM_MODEL", "nova-3"),
            "nlp_metadata": nlp_metadata,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("No-DB test STT failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Test STT failed: {exc}")
    finally:
        if audio_path and os.path.exists(audio_path):
            try:
                os.unlink(audio_path)
            except OSError:
                pass


@router.post("/api/test-stt/analyze", response_model=schemas.TestSTTAnalyzeResponse)
async def test_stt_analyze(
    payload: schemas.TestSTTAnalyzeRequest,
    current_user=Depends(auth.get_current_user),
):
    """No-DB AI Notes endpoint for upload-page microphone tests."""
    from src.providers.router_llm import RouterLLMAdapter

    full_text = (payload.transcript or "").strip()
    if not full_text:
        raise HTTPException(status_code=400, detail="Transcript is required")

    language = (payload.language or getattr(current_user, "language", None) or "vi").lower().strip()
    if language not in ("vi", "en", "zh", "ja", "ko"):
        language = "vi"

    errors: List[str] = []
    segments = payload.segments or []
    nlp_metadata = None
    if phobert_enabled_for(language):
        try:
            processor = get_phobert_processor()
            processed = processor.process_finalize(full_text, segments)
            full_text = str(processed.get("text") or full_text)
            segments = processed.get("segments") or segments
            nlp_metadata = processed.get("nlp_metadata")
        except Exception as nlp_error:
            logger.warning("PhoBERT test finalize post-processing skipped: %s", nlp_error, exc_info=True)
            errors.append(f"PhoBERT post-processing skipped: {nlp_error}")

    summary_status = "FAILED"
    summary_payload = schemas.MeetingAnalysisOutput(
        meeting_summary="",
        key_points=[],
        decisions=[],
        action_items=[],
    )
    summary_error_message = ""
    prompt_key = f"summary_{language}"
    custom_instruction = ADMIN_PROMPTS.get(prompt_key, ADMIN_PROMPTS.get("summary_vi", {})).get(
        "content",
        "Create a concise meeting brief. Focus on outcomes, explicit decisions, and next steps only.",
    )
    speaker_aware_transcript = build_speaker_aware_transcript(full_text, segments, {})
    system_prompt, user_prompt = build_structured_summary_prompts(
        speaker_aware_transcript,
        custom_instruction,
        language,
        nlp_metadata,
    )

    raw_response = None
    router = RouterLLMAdapter()
    if router.enabled:
        try:
            raw_response = router.structured_completion(system_prompt, user_prompt)
            if not raw_response:
                raise ValueError(router.last_error or "Router LLM returned empty response")
        except Exception as exc:
            summary_error_message = f"Router LLM summarization failed: {exc}"
            errors.append(summary_error_message)
            raw_response = None
    else:
        summary_error_message = router.last_error or "Router LLM is not configured"
        errors.append(summary_error_message)

    if not raw_response:
        google_key = os.getenv("GOOGLE_API_KEY")
        if google_key:
            try:
                from src.providers.google_llm import GoogleLLMAdapter
                google = GoogleLLMAdapter(api_key=google_key)
                if google.client:
                    raw_response = google.chat_completion(system_prompt, user_prompt)
                    if raw_response and errors:
                        errors.pop()
            except Exception as exc:
                errors.append(f"Google Gemini fallback failed: {exc}")

    if raw_response:
        try:
            structured_payload = _extract_json_object(raw_response)
            summary_payload = _normalize_analysis_payload(structured_payload)
            summary_status = "COMPLETED"
        except Exception as parse_error:
            summary_error_message = f"Failed to parse LLM response: {parse_error}"
            errors.append(summary_error_message)

    if summary_status != "COMPLETED" and summary_error_message:
        summary_payload.meeting_summary = summary_error_message

    return {
        "summary_status": summary_status,
        "summary": summary_payload,
        "nlp_metadata": nlp_metadata,
        "errors": errors,
    }

@router.post("/api/meetings/{meeting_id}/transcribe-chunk")
async def transcribe_chunk(
    meeting_id: str,
    audio: UploadFile = File(...),
    chunk_index: Optional[int] = Form(None),
    start_ms: int = Form(0),
    language: str = Form("auto"),
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    """Receive an audio chunk and return STT transcription (Deepgram Nova 3)."""
    import tempfile
    import subprocess

    try:
        # Validate meeting exists
        meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
        if not meeting:
            raise HTTPException(status_code=404, detail="Meeting not found")

        # Validate user has meeting room access.
        require_meeting_room_access(db, current_user, meeting)

        # Validate audio file
        if not audio.filename:
            raise HTTPException(status_code=400, detail="No filename provided")
        
        # Determine audio format
        suffix = ".webm"
        if audio.filename.lower().endswith(".wav"):
            suffix = ".wav"
        elif audio.filename.lower().endswith(".mp3"):
            suffix = ".mp3"
        elif audio.filename.lower().endswith(".mp4"):
            suffix = ".mp4"
        elif audio.filename.lower().endswith(".webm"):
            suffix = ".webm"
        else:
            # Default to webm for unknown formats
            suffix = ".webm"

        # Save chunk to temp file
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            try:
                content = await audio.read()
                if not content:
                    raise ValueError("Empty audio file")
                tmp.write(content)
                tmp_path = tmp.name
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to read audio: {str(e)}")

        audio_path = tmp_path
        stt_provider_name = os.getenv("STT_PROVIDER", "deepgram").lower()

        # Save chunk to permanent storage for later concatenation
        if chunk_index is not None:
            try:
                perm_dir = os.path.join(ensure_audio_upload_dir(), meeting_id)
                os.makedirs(perm_dir, exist_ok=True)
                chunk_filename = f"chunk_{chunk_index:06d}{suffix}"
                permanent_path = os.path.join(perm_dir, chunk_filename)
                with open(permanent_path, "wb") as pf:
                    pf.write(content)
                logger.info(f"Saved audio chunk permanently: {permanent_path}")
            except Exception as perm_err:
                logger.warning(f"Failed to save chunk permanently (non-fatal): {perm_err}")

        # Always convert to WAV (PCM 16kHz mono) for reliable STT processing
        if suffix != ".wav":
            wav_path = tmp_path.rsplit(".", 1)[0] + ".wav"
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", "-f", "wav", wav_path],
                    capture_output=True, timeout=30, check=True
                )
                os.unlink(tmp_path)
                audio_path = wav_path
                logger.info(f"Converted {suffix} to WAV for STT processing")
            except (subprocess.CalledProcessError, FileNotFoundError) as e:
                logger.warning(f"ffmpeg conversion failed, using original: {e}")

        try:
            # Transcribe using configured provider (Deepgram Nova 3)
            provider = get_stt_provider()
            result = provider.transcribe(audio_path)
            
            # Validate result
            if not result or "text" not in result:
                raise ValueError("Invalid transcription result")

            # Check if provider returned an error
            if "error" in result and result["error"]:
                raise ValueError(f"STT provider error: {result['error']}")
            
            logger.info(f"Chunk transcription success: meeting={meeting_id}, text_len={len(result.get('text', ''))}, segments={len(result.get('segments', []))}")

            # Log STT usage to CostTracking
            duration_sec = result.get("duration_seconds", 0)
            if duration_sec > 0:
                try:
                    from src.api.crud.crud_system import create_cost_tracking
                    cost_per_sec = 0.0000717  # Deepgram Nova-3: ~$0.0043/min
                    create_cost_tracking(db, {
                        "meeting_id": meeting_id,
                        "service": "stt",
                        "api_endpoint": "deepgram",
                        "model_name": result.get("model", "nova-3"),
                        "input_tokens": int(duration_sec),
                        "output_tokens": 0,
                        "cost_usd": round(duration_sec * cost_per_sec, 6),
                    })
                except Exception as cost_err:
                    logger.warning(f"Failed to log STT cost: {cost_err}")
            
            detected_language = result.get("language") or result.get("detected_language") or language or "auto"
            # Use authenticated user's name as speaker label (overrides Deepgram diarization)
            user_display_name = " ".join(part for part in [current_user.first_name, current_user.last_name] if part).strip() or current_user.username
            normalized_segments = []
            for segment in result.get("segments", []):
                raw_label = normalize_speaker_label(user_display_name)
                ensure_speaker_identity_mapping(
                    db,
                    meeting_id,
                    raw_label,
                    display_name=user_display_name,
                    user_id=current_user.id,
                )
                normalized_segments.append({
                    "speaker": user_display_name,
                    "speaker_label": raw_label,
                    "speaker_display_name": user_display_name,
                    "start": segment.get("start", segment.get("start_time", 0)),
                    "end": segment.get("end", segment.get("end_time", 0)),
                    "text": segment.get("text", ""),
                    "language": segment.get("language") or segment.get("detected_language") or detected_language,
                    "confidence": segment.get("confidence") or segment.get("confidence_score"),
                })
            text = result.get("text", "")
            if text.strip() and not normalized_segments:
                ensure_speaker_identity_mapping(
                    db,
                    meeting_id,
                    user_display_name,
                    display_name=user_display_name,
                    user_id=current_user.id,
                )
                normalized_segments = [{
                    "speaker": user_display_name,
                    "speaker_label": normalize_speaker_label(user_display_name),
                    "speaker_display_name": user_display_name,
                    "start": 0,
                    "end": estimate_segment_end(0, text),
                    "text": text.strip(),
                    "language": detected_language,
                    "confidence": result.get("confidence") or result.get("confidence_score"),
                }]

            nlp_metadata = None
            if phobert_enabled_for(detected_language):
                try:
                    processor = get_phobert_processor()
                    processed = processor.process_chunk(text, normalized_segments)
                    text = str(processed.get("text") or text)
                    normalized_segments = processed.get("segments") or normalized_segments
                    nlp_metadata = processed.get("nlp_metadata")
                except Exception as nlp_error:
                    logger.warning("PhoBERT chunk post-processing skipped: %s", nlp_error)

            if text.strip() and chunk_index is not None:
                upsert_transcript_draft(
                    db,
                    meeting_id=meeting_id,
                    user_id=current_user.id,
                    chunk_index=chunk_index,
                    text=text.strip(),
                    segments=normalized_segments,
                    language=detected_language,
                    provider=stt_provider_name,
                    model=os.getenv("DEEPGRAM_MODEL", "nova-3"),
                    start_ms=start_ms,
                )
                await meeting_room_manager.broadcast(
                    meeting_id,
                    {
                        "type": "transcript.chunk",
                        "meeting_id": meeting_id,
                        "id": f"{meeting_id}:{current_user.id}:{chunk_index}",
                        "user_id": current_user.id,
                        "chunkIndex": chunk_index,
                        "text": text.strip(),
                        "segments": [
                            {
                                **segment,
                                "start": float(segment.get("start", 0) or 0) + (start_ms or 0) / 1000,
                                "end": float(segment.get("end", 0) or 0) + (start_ms or 0) / 1000,
                            }
                            for segment in normalized_segments
                        ],
                        "speaker": normalized_segments[0].get("speaker") if normalized_segments else user_display_name,
                        "language": detected_language,
                        "nlp_metadata": nlp_metadata,
                        "created_at": datetime.now(timezone.utc).isoformat(),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )

            return {
                "id": f"{meeting_id}:{current_user.id}:{chunk_index}" if chunk_index is not None else None,
                "user_id": current_user.id,
                "chunkIndex": chunk_index,
                "text": text,
                "segments": normalized_segments,
                "language": detected_language,
                "detected_language": detected_language,
                "provider": stt_provider_name,
                "model": os.getenv("DEEPGRAM_MODEL", "nova-3"),
                "nlp_metadata": nlp_metadata,
            }
        except Exception as transcribe_error:
            logger.error(f"Transcription error: {str(transcribe_error)}", exc_info=True)
            raise HTTPException(
                status_code=500, 
                detail=f"Transcription failed: {str(transcribe_error)}"
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chunk upload error: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500, 
            detail=f"Chunk processing failed: {str(e)}"
        )
    finally:
        if 'audio_path' in locals() and os.path.exists(audio_path):
            try:
                os.unlink(audio_path)
            except Exception as e:
                logger.warning(f"Failed to cleanup audio file: {e}")
@router.get("/api/meetings/{meeting_id}/transcript-draft")
def get_transcript_draft(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    require_meeting_room_access(db, current_user, meeting)
    draft = build_transcript_from_drafts(db, meeting_id)
    return {
        "meeting_id": meeting_id,
        "transcript": draft["transcript"],
        "segments": draft["segments"],
        "language": draft["language"],
        "chunks": serialize_transcript_draft_chunks(draft["chunks"]),
    }


@router.get("/api/audio-files/{audio_id}/stream")
def stream_audio_file(
    audio_id: str,
    db: Session = Depends(get_db),
):
    """Stream an audio file by its ID. No auth required for direct playback."""
    audio_file = db.query(models.AudioFile).filter(models.AudioFile.id == audio_id).first()
    if not audio_file:
        raise HTTPException(status_code=404, detail="Audio file record missing")
    resolved_path = resolve_audio_storage_path(audio_file.file_path)
    if not resolved_path:
        raise HTTPException(status_code=404, detail="Audio path could not be resolved")
    if not os.path.exists(resolved_path):
        raise HTTPException(status_code=404, detail="Audio file missing on disk")
    if resolved_path != audio_file.file_path:
        logger.info("Backfilled audio file path for %s from %s to %s", audio_id, audio_file.file_path, resolved_path)
        audio_file.file_path = resolved_path
        db.commit()
        db.refresh(audio_file)

    # Convert WAV to MP3 for better browser compatibility (16kHz WAV plays too fast in some browsers)
    if audio_file.format and audio_file.format.upper() == "WAV":
        mp3_path = os.path.splitext(resolved_path)[0] + ".mp3"
        if not os.path.exists(mp3_path):
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", resolved_path, "-ar", "44100", "-ac", "1", "-b:a", "128k", mp3_path],
                    capture_output=True, timeout=60,
                )
            except Exception as e:
                logger.warning("ffmpeg conversion failed for %s: %s, serving original WAV", audio_id, e)
                return FileResponse(
                    resolved_path,
                    media_type="audio/wav",
                    filename=audio_file.original_filename or "recording.wav",
                )
        serve_path = mp3_path if os.path.exists(mp3_path) else resolved_path
        media_type = "audio/mpeg" if serve_path.endswith(".mp3") else "audio/wav"
        return FileResponse(
            serve_path,
            media_type=media_type,
            filename=os.path.basename(serve_path),
        )

    return FileResponse(
        resolved_path,
        media_type="audio/wav",
        filename=audio_file.original_filename or "recording.wav",
    )
