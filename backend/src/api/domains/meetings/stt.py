"""STT provider management, audio utilities, and Deepgram streaming bridge."""

import os
import json
import asyncio
import logging
import queue
import subprocess
import tempfile
import threading
from typing import Any, Dict, Optional

from fastapi import HTTPException, UploadFile, WebSocket

from src.api.domains.meetings.support import normalize_speaker_label, estimate_segment_end

logger = logging.getLogger(__name__)

# ─── STT Provider Singleton ────────────────────────────────────────────────

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


# ─── Audio Utilities ───────────────────────────────────────────────────────

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


# ─── Deepgram Message Parsing ──────────────────────────────────────────────

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


# ─── Deepgram Live Bridge ──────────────────────────────────────────────────

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
                        except Exception:
                            pass
                        break

                recv_thread.join(timeout=2)

        except Exception as exc:
            logger.error(f"DeepgramLiveBridge error: {exc}", exc_info=True)
            self._emit({"kind": "error", "error": str(exc)})
        finally:
            self._emit({"kind": "status", "status": "closed"})


# ─── WebSocket Helpers ─────────────────────────────────────────────────────

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
) -> Dict[str, Any]:
    speaker_label = normalize_speaker_label(user_display_name)
    return {
        "speaker": user_display_name,
        "speaker_label": speaker_label,
        "speaker_display_name": user_display_name,
        "start": 0,
        "end": estimate_segment_end(0, text),
        "text": text,
        "language": language,
        "confidence": confidence,
    }
