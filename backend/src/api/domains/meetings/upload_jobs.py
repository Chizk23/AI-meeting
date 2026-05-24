import asyncio
import logging
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from src.api import models
from src.api.core.app_state import config
from src.api.domains.meetings.operations import ensure_speaker_mapping
from src.api.domains.meetings.transcripts import finalize_meeting_transcript
from src.api.database import SessionLocal
from src.api.crud import create_transcript, create_transcript_segments_bulk, update_audio_file, update_meeting
from src.api.domains.meetings.prompts import get_phobert_processor, phobert_enabled_for
from src.api.domains.meetings.transcripts import normalize_segment_payload
from src.diarization.service import DiarizationService, Segment as DiarizationSegment
from src.stt.service import STTService

logger = logging.getLogger(__name__)

ALLOWED_UPLOAD_EXTENSIONS = {".wav", ".mp3", ".m4a", ".mp4", ".webm", ".ogg", ".flac"}
SUPPORTED_UPLOAD_LANGUAGES = {"auto", "vi", "en", "zh", "ja", "ko"}
CHUNK_THRESHOLD_SECONDS = 600.0
CHUNK_DURATION_SECONDS = 300.0


def sanitize_upload_filename(filename: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", filename or "").strip("._")
    return cleaned or f"audio_{uuid.uuid4().hex}.bin"


def normalize_upload_language(language: Optional[str]) -> str:
    normalized = (language or "auto").lower().strip()
    return normalized if normalized in SUPPORTED_UPLOAD_LANGUAGES else "auto"


def file_extension(filename: str) -> str:
    return os.path.splitext(filename or "")[1].lower()


def validate_upload_filename(filename: str) -> None:
    extension = file_extension(filename)
    if extension not in ALLOWED_UPLOAD_EXTENSIONS:
        raise ValueError("Invalid file type. Supported types: wav, mp3, m4a, mp4, webm, ogg, flac")


def ffprobe_duration_seconds(audio_path: str) -> Optional[float]:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                audio_path,
            ],
            capture_output=True,
            text=True,
            timeout=20,
            check=True,
        )
        output = (result.stdout or "").strip()
        return float(output) if output else None
    except Exception as exc:
        logger.warning("ffprobe duration failed for %s: %s", audio_path, exc)
        return None


def normalize_audio_to_wav(source_path: str, output_path: str) -> str:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-acodec",
            "pcm_s16le",
            "-f",
            "wav",
            output_path,
        ],
        capture_output=True,
        timeout=180,
        check=True,
    )
    return output_path


def apply_noise_cleanup(source_path: str, output_path: str) -> str:
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            source_path,
            "-af",
            "highpass=f=120,lowpass=f=7000,afftdn,loudnorm",
            "-ar",
            "16000",
            "-ac",
            "1",
            "-acodec",
            "pcm_s16le",
            output_path,
        ],
        capture_output=True,
        timeout=180,
        check=True,
    )
    return output_path


def chunk_audio_for_processing(audio_path: str, meeting_dir: str) -> List[Dict[str, Any]]:
    duration = ffprobe_duration_seconds(audio_path) or 0.0
    if duration <= 0 or duration < CHUNK_THRESHOLD_SECONDS:
        return [{
            "path": audio_path,
            "offset_seconds": 0.0,
            "duration_seconds": duration,
        }]

    chunk_dir = os.path.join(meeting_dir, "chunks")
    os.makedirs(chunk_dir, exist_ok=True)
    output_pattern = os.path.join(chunk_dir, "part_%03d.wav")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            audio_path,
            "-f",
            "segment",
            "-segment_time",
            str(int(CHUNK_DURATION_SECONDS)),
            "-c",
            "copy",
            output_pattern,
        ],
        capture_output=True,
        timeout=300,
        check=True,
    )

    chunks: List[Dict[str, Any]] = []
    offset_seconds = 0.0
    for name in sorted(os.listdir(chunk_dir)):
        path = os.path.join(chunk_dir, name)
        if not os.path.isfile(path):
            continue
        chunk_duration = ffprobe_duration_seconds(path) or CHUNK_DURATION_SECONDS
        chunks.append({
            "path": path,
            "offset_seconds": offset_seconds,
            "duration_seconds": chunk_duration,
        })
        offset_seconds += chunk_duration
    return chunks or [{
        "path": audio_path,
        "offset_seconds": 0.0,
        "duration_seconds": duration,
    }]


def provider_label(provider_name: str) -> str:
    return (provider_name or "deepgram").strip().lower() or "deepgram"


def transcribe_audio_path(
    *,
    provider_name: str,
    audio_path: str,
    language: str,
    enable_diarization: bool,
) -> Dict[str, Any]:
    provider = STTService(provider=provider_name).provider
    kwargs: Dict[str, Any] = {}
    if provider_name == "deepgram":
        kwargs["language"] = language
        kwargs["diarize"] = enable_diarization
    result = provider.transcribe(audio_path, **kwargs) if kwargs else provider.transcribe(audio_path)
    return result if isinstance(result, dict) else {"text": "", "segments": []}


def normalize_transcript_segments(
    segments: List[Dict[str, Any]],
    *,
    offset_seconds: float,
    default_language: str,
) -> List[Dict[str, Any]]:
    normalized_segments: List[Dict[str, Any]] = []
    for index, segment in enumerate(segments or []):
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        start = float(segment.get("start", segment.get("start_time", 0)) or 0) + offset_seconds
        end = float(segment.get("end", segment.get("end_time", 0)) or 0) + offset_seconds
        speaker = segment.get("speaker") or segment.get("speaker_label") or f"Speaker_{index + 1:02d}"
        normalized_segments.append({
            "speaker": speaker,
            "speaker_label": speaker,
            "start": start,
            "end": end if end > start else start + 1.0,
            "text": text,
            "language": segment.get("language") or segment.get("detected_language") or default_language,
            "confidence": segment.get("confidence") or segment.get("confidence_score"),
        })
    return normalized_segments


def segments_have_explicit_speakers(segments: List[Dict[str, Any]]) -> bool:
    if not segments:
        return False
    return any(
        str(segment.get("speaker") or segment.get("speaker_label") or "").strip()
        and not str(segment.get("speaker") or segment.get("speaker_label") or "").startswith("Speaker_")
        for segment in segments
    )


def apply_diarization_fallback(audio_path: str, segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not segments:
        return segments
    try:
        diarization_service = DiarizationService()
        diarized = diarization_service.diarize_audio(audio_path)
        speaker_segments = [
            DiarizationSegment(
                start=float(item.get("start", 0) or 0),
                end=float(item.get("end", 0) or 0),
                speaker=str(item.get("speaker") or "Speaker_Unknown"),
            )
            for item in diarized
        ]
        aligned = diarization_service.align_to_transcript(
            [
                {
                    "start": float(segment.get("start", 0) or 0),
                    "end": float(segment.get("end", 0) or 0),
                    "text": str(segment.get("text") or ""),
                }
                for segment in segments
            ],
            speaker_segments,
        )
        remapped: List[Dict[str, Any]] = []
        for original, updated in zip(segments, aligned):
            remapped.append({
                **original,
                "speaker": updated.get("speaker") or original.get("speaker"),
                "speaker_label": updated.get("speaker") or original.get("speaker_label"),
            })
        return remapped
    except Exception as exc:
        logger.warning("Diarization fallback failed for %s: %s", audio_path, exc, exc_info=True)
        return segments


def persist_transcript_without_summary(
    db: Session,
    *,
    meeting: models.Meeting,
    text: str,
    segments: List[Dict[str, Any]],
    language: str,
    provider_name: str,
) -> None:
    post_processed = False
    nlp_metadata = None
    if phobert_enabled_for(language):
        try:
            processor = get_phobert_processor()
            processed = processor.process_finalize(text, segments)
            text = str(processed.get("text") or text)
            segments = processed.get("segments") or segments
            nlp_metadata = processed.get("nlp_metadata")
            post_processed = bool(processed.get("post_processed"))
        except Exception as exc:
            logger.warning("PhoBERT upload post-processing skipped: %s", exc, exc_info=True)

    transcript = db.query(models.Transcript).filter(
        models.Transcript.meeting_id == meeting.id,
    ).order_by(models.Transcript.created_at.desc()).first()
    if transcript:
        transcript.content = text
        transcript.language = language
        transcript.word_count = len(text.split())
        transcript.processing_status = "COMPLETED"
        transcript.stt_provider = provider_name
        transcript.post_processed = post_processed
        transcript.nlp_metadata = nlp_metadata
        db.query(models.TranscriptSegment).filter(
            models.TranscriptSegment.transcript_id == transcript.id,
        ).delete(synchronize_session=False)
        db.flush()
    else:
        transcript = create_transcript(db, {
            "meeting_id": meeting.id,
            "content": text,
            "language": language,
            "word_count": len(text.split()),
            "processing_status": "COMPLETED",
            "stt_provider": provider_name,
            "post_processed": post_processed,
            "nlp_metadata": nlp_metadata,
        })

    normalized_rows = []
    for segment in segments:
        normalized = normalize_segment_payload(segment, language)
        if normalized["text"]:
            normalized_rows.append({"transcript_id": transcript.id, **normalized})
    if normalized_rows:
        create_transcript_segments_bulk(db, normalized_rows)

    update_meeting(db, meeting.id, {"status": "completed"})
    db.commit()


@dataclass
class UploadMeetingJob:
    meeting_id: str
    created_by: str
    audio_file_id: str
    original_audio_path: str
    original_filename: str
    organization_id: str
    stt_provider: str = "deepgram"
    language: str = "auto"
    enable_diarization: bool = True
    enable_summary: bool = True
    enable_action_items: bool = True
    enable_noise_cleanup: bool = True
    job_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: str = "queued"
    progress_percent: int = 0
    current_stage: str = "queued"
    error_message: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    retry_count: int = 0
    result: Optional[Dict[str, Any]] = None

    def set_stage(self, stage: str, progress: int, *, status: Optional[str] = None, error: str = "") -> None:
        self.current_stage = stage
        self.progress_percent = max(0, min(int(progress), 100))
        if status:
            self.status = status
        self.error_message = error
        self.updated_at = datetime.now(timezone.utc).isoformat()
        logger.info(
            "Upload job %s stage=%s progress=%s meeting=%s provider=%s language=%s",
            self.job_id,
            self.current_stage,
            self.progress_percent,
            self.meeting_id,
            self.stt_provider,
            self.language,
        )

    def snapshot(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "meeting_id": self.meeting_id,
            "status": self.status,
            "progress_percent": self.progress_percent,
            "current_stage": self.current_stage,
            "error_message": self.error_message,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "started_at": self.started_at,
            "completed_at": self.completed_at,
            "retry_count": self.retry_count,
            "result": self.result if self.status == "completed" else None,
        }

    async def run(self) -> Dict[str, Any]:
        db: Session = SessionLocal()
        try:
            meeting = db.query(models.Meeting).filter(models.Meeting.id == self.meeting_id).first()
            user = db.query(models.User).filter(models.User.id == self.created_by).first()
            audio_file = db.query(models.AudioFile).filter(models.AudioFile.id == self.audio_file_id).first()
            if not meeting or not user or not audio_file:
                raise ValueError("Upload job context is no longer valid")

            self.started_at = datetime.now(timezone.utc).isoformat()
            self.set_stage("uploaded", 10, status="processing")
            update_meeting(db, meeting.id, {"status": "processing"})
            update_audio_file(db, audio_file.id, {"upload_status": "PROCESSING"})

            meeting_dir = os.path.dirname(self.original_audio_path)
            working_wav_path = os.path.join(meeting_dir, "working.wav")
            cleaned_wav_path = os.path.join(meeting_dir, "working_clean.wav")

            self.set_stage("normalized", 25)
            normalized_path = normalize_audio_to_wav(self.original_audio_path, working_wav_path)

            processing_audio_path = normalized_path
            if self.enable_noise_cleanup:
                try:
                    self.set_stage("noise_cleanup", 35)
                    processing_audio_path = apply_noise_cleanup(normalized_path, cleaned_wav_path)
                except Exception as exc:
                    logger.warning("Noise cleanup failed for meeting %s: %s", meeting.id, exc)
                    processing_audio_path = normalized_path

            actual_duration_seconds = ffprobe_duration_seconds(processing_audio_path) or ffprobe_duration_seconds(self.original_audio_path) or 0.0
            if actual_duration_seconds > 0:
                audio_file.duration_seconds = int(round(actual_duration_seconds))
                meeting.duration = max(1, int(round(actual_duration_seconds / 60)))
                if meeting.scheduled_start and not meeting.scheduled_end:
                    meeting.scheduled_end = meeting.scheduled_start
                if meeting.scheduled_start:
                    meeting.scheduled_end = meeting.scheduled_start + timedelta(seconds=actual_duration_seconds)
                db.commit()

            self.set_stage("chunking", 45)
            chunk_specs = chunk_audio_for_processing(processing_audio_path, meeting_dir)

            transcript_parts: List[str] = []
            segments: List[Dict[str, Any]] = []
            detected_language = self.language
            self.set_stage("transcribing", 60)
            for chunk_spec in chunk_specs:
                result = transcribe_audio_path(
                    provider_name=self.stt_provider,
                    audio_path=chunk_spec["path"],
                    language=self.language,
                    enable_diarization=self.enable_diarization,
                )
                text = str(result.get("text") or "").strip()
                if text:
                    transcript_parts.append(text)
                chunk_language = result.get("language") or result.get("detected_language")
                if chunk_language and detected_language == "auto":
                    detected_language = str(chunk_language).lower()
                chunk_segments = normalize_transcript_segments(
                    list(result.get("segments") or []),
                    offset_seconds=float(chunk_spec.get("offset_seconds") or 0),
                    default_language=detected_language if detected_language != "auto" else "vi",
                )
                if not chunk_segments and text:
                    duration_hint = float(chunk_spec.get("duration_seconds") or 0) or 5.0
                    chunk_segments = [{
                        "speaker": "Speaker_01",
                        "speaker_label": "Speaker_01",
                        "start": float(chunk_spec.get("offset_seconds") or 0),
                        "end": float(chunk_spec.get("offset_seconds") or 0) + duration_hint,
                        "text": text,
                        "language": detected_language if detected_language != "auto" else "vi",
                    }]
                segments.extend(chunk_segments)

            if not transcript_parts and not segments:
                raise ValueError("Transcription returned no usable content")

            if self.enable_diarization and not segments_have_explicit_speakers(segments):
                self.set_stage("diarizing", 72)
                segments = apply_diarization_fallback(processing_audio_path, segments)

            for segment in segments:
                speaker_label = str(segment.get("speaker_label") or segment.get("speaker") or "Speaker_01")
                display_name = str(segment.get("speaker") or speaker_label)
                ensure_speaker_mapping(db, self.meeting_id, speaker_label, display_name=display_name)
            db.commit()

            full_text = "\n".join(part for part in transcript_parts if part).strip()
            if not full_text:
                full_text = "\n".join(str(segment.get("text") or "") for segment in segments if str(segment.get("text") or "").strip()).strip()
            final_language = normalize_upload_language(detected_language if detected_language != "auto" else self.language)
            if final_language == "auto":
                final_language = "vi"

            self.set_stage("post_processing", 82)
            if self.enable_summary:
                self.set_stage("summarizing", 90)
                result = await finalize_meeting_transcript(
                    self.meeting_id,
                    db,
                    user,
                    body={
                        "transcript": full_text,
                        "segments": segments,
                        "language": final_language,
                        "generate_summary": True,
                        "generate_action_items": self.enable_action_items,
                    },
                )
            else:
                persist_transcript_without_summary(
                    db,
                    meeting=meeting,
                    text=full_text,
                    segments=segments,
                    language=final_language,
                    provider_name=self.stt_provider,
                )
                result = {
                    "meeting_id": self.meeting_id,
                    "transcript_status": "COMPLETED",
                    "summary_status": "SKIPPED",
                    "summary": None,
                    "errors": [],
                }

            update_audio_file(db, audio_file.id, {"upload_status": "PROCESSED"})
            self.result = result
            self.completed_at = datetime.now(timezone.utc).isoformat()
            self.set_stage("completed", 100, status="completed")
            return result
        except Exception as exc:
            logger.error("Upload job %s failed: %s", self.job_id, exc, exc_info=True)
            self.completed_at = datetime.now(timezone.utc).isoformat()
            self.set_stage("failed", self.progress_percent or 100, status="failed", error=str(exc))
            try:
                update_meeting(db, self.meeting_id, {"status": "failed"})
                update_audio_file(db, self.audio_file_id, {"upload_status": "FAILED"})
            except Exception:
                logger.warning("Failed to mark meeting/audio failed for upload job %s", self.job_id, exc_info=True)
            return {"meeting_id": self.meeting_id, "error": str(exc)}
        finally:
            try:
                temp_working = os.path.join(os.path.dirname(self.original_audio_path), "working.wav")
                temp_clean = os.path.join(os.path.dirname(self.original_audio_path), "working_clean.wav")
                for path in (temp_clean, temp_working):
                    if os.path.exists(path):
                        os.unlink(path)
                chunk_dir = os.path.join(os.path.dirname(self.original_audio_path), "chunks")
                if os.path.isdir(chunk_dir):
                    shutil.rmtree(chunk_dir, ignore_errors=True)
            except OSError:
                logger.warning("Failed cleaning upload temp files for job %s", self.job_id, exc_info=True)
            db.close()


UPLOAD_JOBS: Dict[str, UploadMeetingJob] = {}
UPLOAD_JOBS_BY_MEETING: Dict[str, str] = {}
UPLOAD_JOBS_LOCK = threading.Lock()


def register_upload_job(job: UploadMeetingJob) -> UploadMeetingJob:
    with UPLOAD_JOBS_LOCK:
        UPLOAD_JOBS[job.job_id] = job
        UPLOAD_JOBS_BY_MEETING[job.meeting_id] = job.job_id
    return job


def get_upload_job(job_id: str) -> Optional[UploadMeetingJob]:
    with UPLOAD_JOBS_LOCK:
        return UPLOAD_JOBS.get(job_id)


def run_upload_job_async(job: UploadMeetingJob) -> None:
    asyncio.run(job.run())


def start_upload_job(job: UploadMeetingJob) -> None:
    thread = threading.Thread(
        target=run_upload_job_async,
        args=(job,),
        name=f"upload-job-{job.job_id}",
        daemon=True,
    )
    thread.start()


def create_retry_job(job_id: str) -> UploadMeetingJob:
    job = get_upload_job(job_id)
    if not job:
        raise KeyError("Job not found")
    if job.status != "failed":
        raise ValueError("Only failed jobs can be retried")
    retry_job = UploadMeetingJob(
        meeting_id=job.meeting_id,
        created_by=job.created_by,
        audio_file_id=job.audio_file_id,
        original_audio_path=job.original_audio_path,
        original_filename=job.original_filename,
        organization_id=job.organization_id,
        stt_provider=job.stt_provider,
        language=job.language,
        enable_diarization=job.enable_diarization,
        enable_summary=job.enable_summary,
        enable_action_items=job.enable_action_items,
        enable_noise_cleanup=job.enable_noise_cleanup,
        retry_count=job.retry_count + 1,
    )
    return register_upload_job(retry_job)


def feature_flags_for_user(current_user: models.User) -> Dict[str, bool]:
    return {
        "uploadEnabled": True,
        "jobTrackingEnabled": True,
        "systemAdminEnabled": current_user.role == "system-admin",
    }
