"""Transcript draft persistence, normalization, chunk management, and finalization."""

import glob
import logging
import os
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from src.api import models, schemas
from src.api.core.meetings_support import estimate_segment_end, normalize_speaker_label

logger = logging.getLogger(__name__)

SUPPORTED_MEETING_LANGUAGES = ("vi", "en", "zh", "ja", "ko")
CANONICAL_ACTION_ITEM_LANGUAGE = "vi"


def normalize_meeting_language(language: Optional[str], default: str = "vi") -> str:
    normalized = (language or default or "vi").lower().strip()
    return normalized if normalized in SUPPORTED_MEETING_LANGUAGES else default


def next_transcript_chunk_index(db: Session, meeting_id: str, user_id: str) -> int:
    current = db.query(func.max(models.MeetingTranscriptDraft.chunk_index)).filter(
        models.MeetingTranscriptDraft.meeting_id == meeting_id,
        models.MeetingTranscriptDraft.user_id == user_id,
    ).scalar()
    return int(current if current is not None else -1) + 1


def upsert_transcript_draft(
    db: Session,
    *,
    meeting_id: str,
    user_id: str,
    chunk_index: int,
    text: str,
    segments: List[Dict[str, Any]],
    language: str,
    provider: str,
    model: str,
    start_ms: int = 0,
) -> models.MeetingTranscriptDraft:
    existing = db.query(models.MeetingTranscriptDraft).filter(
        models.MeetingTranscriptDraft.meeting_id == meeting_id,
        models.MeetingTranscriptDraft.user_id == user_id,
        models.MeetingTranscriptDraft.chunk_index == chunk_index,
    ).first()
    if existing:
        existing.text = text
        existing.segments = segments
        existing.language = language
        existing.provider = provider
        existing.model = model
        existing.start_ms = start_ms
        draft = existing
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


def build_transcript_from_drafts(db: Session, meeting_id: str) -> Dict[str, Any]:
    drafts = db.query(models.MeetingTranscriptDraft).filter(
        models.MeetingTranscriptDraft.meeting_id == meeting_id,
    ).order_by(models.MeetingTranscriptDraft.chunk_index.asc(), models.MeetingTranscriptDraft.created_at.asc()).all()
    texts: List[str] = []
    segments: List[Dict[str, Any]] = []
    languages: List[str] = []
    for draft in drafts:
        if draft.text:
            texts.append(draft.text)
        if draft.language:
            languages.append(draft.language)
        raw_segments = draft.segments or []
        draft_segments = raw_segments
        if not raw_segments and draft.text:
            offset_seconds = (draft.start_ms or 0) / 1000
            draft_segments = [{
                "speaker": "Speaker_01",
                "start": offset_seconds,
                "end": estimate_segment_end(offset_seconds, draft.text),
                "text": draft.text,
                "language": draft.language or "auto",
            }]
        for segment in draft_segments:
            normalized = normalize_segment_payload(segment, draft.language or "auto")
            if normalized["text"]:
                if raw_segments:
                    offset_seconds = (draft.start_ms or 0) / 1000
                    normalized["start_time"] = normalized["start_time"] + offset_seconds
                    normalized["end_time"] = normalized["end_time"] + offset_seconds
                segments.append(normalized)
                languages.append(normalized["language"])
    language = next((lang for lang in languages if lang and lang != "auto"), "auto")
    return {"transcript": "\n".join(texts), "segments": segments, "language": language, "chunks": drafts}


def serialize_transcript_draft_chunks(chunks: List[models.MeetingTranscriptDraft]) -> List[Dict[str, Any]]:
    serialized: List[Dict[str, Any]] = []
    for item in chunks:
        offset_seconds = (item.start_ms or 0) / 1000
        raw_segments = item.segments or []
        segments = [
            {
                **segment,
                "start": float(segment.get("start", segment.get("start_time", 0)) or 0) + offset_seconds,
                "end": float(segment.get("end", segment.get("end_time", 0)) or 0) + offset_seconds,
            }
            for segment in raw_segments
        ] or [{
            "speaker": "Speaker_01",
            "start": offset_seconds,
            "end": estimate_segment_end(offset_seconds, item.text),
            "text": item.text,
            "language": item.language or "auto",
        }]
        serialized.append({
            "id": item.id,
            "userId": item.user_id,
            "user_id": item.user_id,
            "chunkIndex": item.chunk_index,
            "chunk_index": item.chunk_index,
            "text": item.text,
            "segments": segments,
            "language": item.language,
            "startMs": item.start_ms,
            "start_ms": item.start_ms,
            "timestamp": (item.updated_at or item.created_at or datetime.now(timezone.utc)).isoformat(),
        })
    return serialized


def normalize_segment_payload(segment: Dict[str, Any], default_language: str = "auto") -> Dict[str, Any]:
    speaker_label = normalize_speaker_label(segment.get("speaker_label") or segment.get("speaker") or "Speaker_01")
    return {
        "speaker_label": speaker_label,
        "start_time": float(segment.get("start_time", segment.get("start", 0)) or 0),
        "end_time": float(segment.get("end_time", segment.get("end", 0)) or 0),
        "text": segment.get("text", "") or "",
        "original_text": segment.get("original_text"),
        "language": segment.get("language") or segment.get("detected_language") or default_language or "auto",
        "confidence_score": segment.get("confidence_score") or segment.get("confidence"),
        "nlp_metadata": segment.get("nlp_metadata"),
        "word_count": len((segment.get("text", "") or "").split()),
    }


# ─── Transcript Finalization ────────────────────────────────────────────────


def _is_wav_16k_mono(path: str) -> bool:
    """Check if a WAV file is already 16kHz mono PCM."""
    if not path.lower().endswith(".wav"):
        return False
    try:
        import wave
        with wave.open(path, "rb") as w:
            return w.getframerate() == 16000 and w.getnchannels() == 1
    except Exception:
        return False


def _normalize_chunks_for_concat(chunk_files: list[str], temp_dir: str) -> list[str]:
    """Normalize each chunk to WAV 16kHz mono for safe concatenation."""
    normalized = []
    for cf in chunk_files:
        if _is_wav_16k_mono(cf):
            normalized.append(cf)
        else:
            base = os.path.splitext(os.path.basename(cf))[0]
            out_path = os.path.join(temp_dir, f"{base}_norm.wav")
            try:
                subprocess.run(
                    ["ffmpeg", "-y", "-i", cf, "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le", out_path],
                    capture_output=True, timeout=60, check=True,
                )
                normalized.append(out_path)
            except Exception as e:
                logger.warning("Failed to normalize chunk %s: %s", cf, e)
    return normalized


async def finalize_meeting_transcript(
    meeting_id: str,
    db: Session,
    current_user: models.User,
    body: Optional[Dict[str, Any]] = None,
):
    """Save transcript from request or drafts, then summarize and persist stable meeting artifacts."""
    from src.api.core.admin_runtime import ADMIN_PROMPTS
    from src.api.core.meeting_operations import (
        format_summary_payload,
        get_speaker_mapping_dict,
        meeting_room_manager,
        require_meeting_room_access,
    )
    from src.api.core.nlp_support import (
        _extract_json_object,
        _normalize_analysis_payload,
        _split_ai_owner_text,
        _try_parse_date,
        build_speaker_aware_transcript,
        build_structured_summary_prompts,
        get_phobert_processor,
        phobert_enabled_for,
    )
    from src.api.crud import (
        create_action_item,
        create_audio_file,
        create_meeting_summary,
        create_transcript,
        create_transcript_segments_bulk,
        update_meeting,
    )
    from src.providers.router_llm import RouterLLMAdapter

    body = body or {}
    full_text = body.get("transcript", "")
    segments = body.get("segments", [])
    req_language = body.get("language", "")
    regenerate = bool(body.get("regenerate", False))
    generate_summary = bool(body.get("generate_summary", True))
    generate_action_items = bool(body.get("generate_action_items", True))
    errors: List[str] = []

    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    language = normalize_meeting_language(req_language or getattr(current_user, "language", None) or "vi")
    persist_transcript = bool(body.get("persist_transcript", True))
    complete_meeting = bool(body.get("complete_meeting", True))

    require_meeting_room_access(db, current_user, meeting)
    original_meeting_status = meeting.status

    db_transcript = db.query(models.Transcript).filter(
        models.Transcript.meeting_id == meeting_id,
    ).order_by(models.Transcript.created_at.desc()).first()
    draft_payload = build_transcript_from_drafts(db, meeting_id)
    has_transcript_draft = bool(
        str(draft_payload.get("transcript") or "").strip()
        or bool(draft_payload.get("segments"))
    )
    if not isinstance(full_text, str) or not full_text.strip():
        full_text = draft_payload["transcript"]
    if (not isinstance(full_text, str) or not full_text.strip()) and db_transcript:
        full_text = db_transcript.content or ""
    if not segments:
        segments = draft_payload["segments"]
    if not segments and db_transcript and db_transcript.segments:
        segments = [
            {
                "speaker": segment.speaker_label,
                "start": float(segment.start_time or 0),
                "end": float(segment.end_time or 0),
                "text": segment.text,
                "language": getattr(segment, "language", None) or language,
                "confidence": float(segment.confidence_score) if segment.confidence_score is not None else None,
            }
            for segment in db_transcript.segments
            if (segment.text or "").strip()
        ]
    if (not req_language or req_language == "auto") and draft_payload["language"] != "auto":
        language = normalize_meeting_language(draft_payload["language"])

    if not isinstance(full_text, str) or not full_text.strip():
        return {
            "meeting_id": meeting_id,
            "transcript_status": "EMPTY",
            "summary_status": "EMPTY",
            "has_transcript_draft": has_transcript_draft,
            "summary": schemas.MeetingAnalysisOutput(
                meeting_summary="",
                key_points=[],
                decisions=[],
                action_items=[],
            ),
            "nlp_metadata": None,
            "errors": errors,
        }

    nlp_metadata = None
    post_processed = False
    if persist_transcript and phobert_enabled_for(language):
        try:
            processor = get_phobert_processor()
            processed = processor.process_finalize(full_text, segments if isinstance(segments, list) else [])
            full_text = str(processed.get("text") or full_text)
            segments = processed.get("segments") or segments
            nlp_metadata = processed.get("nlp_metadata")
            post_processed = bool(processed.get("post_processed"))
        except Exception as nlp_error:
            logger.warning("PhoBERT finalize post-processing skipped: %s", nlp_error, exc_info=True)
            errors.append(f"PhoBERT post-processing skipped: {nlp_error}")

    try:
        if meeting.status == "upcoming":
            meeting = update_meeting(
                db,
                meeting_id,
                {
                    "status": "live",
                    "actual_start": meeting.actual_start or datetime.now(timezone.utc),
                    "scheduled_start": meeting.scheduled_start or datetime.now(timezone.utc),
                    "scheduled_end": meeting.scheduled_end or (datetime.now(timezone.utc) + timedelta(hours=1)),
                },
            )
        if meeting.status in {"live", "queued", "failed"}:
            meeting = update_meeting(db, meeting_id, {"status": "processing"})
        elif meeting.status == "canceled":
            raise HTTPException(status_code=400, detail="Cannot finalize a canceled meeting")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    segments_to_save = segments if isinstance(segments, list) else []
    if db_transcript and not segments_to_save and db_transcript.segments:
        segments_to_save = [
            {
                "speaker": segment.speaker_label,
                "start": float(segment.start_time or 0),
                "end": float(segment.end_time or 0),
                "text": segment.text,
                "language": getattr(segment, "language", None) or language,
                "confidence": float(segment.confidence_score) if segment.confidence_score is not None else None,
            }
            for segment in db_transcript.segments
            if (segment.text or "").strip()
        ]
    if persist_transcript:
        if db_transcript:
            db_transcript.content = full_text
            db_transcript.language = language
            db_transcript.word_count = len(full_text.split())
            db_transcript.processing_status = "COMPLETED"
            db_transcript.stt_provider = os.getenv("STT_PROVIDER", "deepgram")
            db_transcript.post_processed = post_processed
            db_transcript.nlp_metadata = nlp_metadata
            if segments_to_save:
                db.query(models.TranscriptSegment).filter(
                    models.TranscriptSegment.transcript_id == db_transcript.id,
                ).delete(synchronize_session=False)
                db.flush()
        else:
            db_transcript = create_transcript(db, {
                "meeting_id": meeting_id,
                "content": full_text,
                "language": language,
                "word_count": len(full_text.split()),
                "processing_status": "COMPLETED",
                "stt_provider": os.getenv("STT_PROVIDER", "deepgram"),
                "post_processed": post_processed,
                "nlp_metadata": nlp_metadata,
            })

        if segments_to_save:
            segments_data = []
            for seg in segments_to_save:
                normalized = normalize_segment_payload(seg, language)
                if not normalized["text"]:
                    continue
                segments_data.append({
                    "transcript_id": db_transcript.id,
                    **normalized,
                })
            if segments_data:
                create_transcript_segments_bulk(db, segments_data)

        db.commit()

    audio_file_id = None
    if persist_transcript:
        try:
            from src.api.core.meeting_operations import AUDIO_UPLOAD_DIR, LEGACY_AUDIO_UPLOAD_DIR

            canonical_dir = os.path.join(AUDIO_UPLOAD_DIR, meeting_id)
            legacy_dir = os.path.join(LEGACY_AUDIO_UPLOAD_DIR, meeting_id)
            perm_dir = canonical_dir
            if not os.path.isdir(perm_dir) and os.path.isdir(legacy_dir):
                logger.info(f"Using legacy audio directory for meeting {meeting_id}: {legacy_dir}")
                perm_dir = legacy_dir
            if os.path.isdir(perm_dir):
                chunk_files = sorted(glob.glob(os.path.join(perm_dir, "chunk_*")) + glob.glob(os.path.join(perm_dir, "stream_*.wav")))
                if chunk_files:
                    logger.info(f"Concatenating {len(chunk_files)} audio chunks for meeting {meeting_id}")
                    normalized_files = _normalize_chunks_for_concat(chunk_files, perm_dir)
                    files_to_concat = normalized_files if normalized_files else chunk_files
                    try:
                        concat_list_path = os.path.join(perm_dir, "concat.txt")
                        with open(concat_list_path, "w") as f:
                            for cf in files_to_concat:
                                f.write(f"file '{cf}'\n")

                        output_filename = f"recording_{meeting_id}.wav"
                        output_path = os.path.join(perm_dir, output_filename)
                        subprocess.run(
                            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list_path,
                             "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", output_path],
                            capture_output=True, timeout=120, check=True,
                        )
                        if os.path.exists(output_path) and os.path.getsize(output_path) > 0:
                            file_size = os.path.getsize(output_path)
                            audio_record = create_audio_file(db, {
                                "meeting_id": meeting_id,
                                "filename": output_filename,
                                "original_filename": "meeting_recording.wav",
                                "file_path": output_path,
                                "file_size": file_size,
                                "format": "WAV",
                                "sample_rate": 16000,
                                "channels": 1,
                                "upload_status": "PROCESSED",
                            })
                            audio_file_id = audio_record.id
                            audio_stream_url = f"/api/audio-files/{audio_file_id}/stream"
                            update_meeting(db, meeting_id, {
                                "audio_url": audio_stream_url,
                                "recording_url": audio_stream_url,
                            })
                            db.commit()
                            logger.info(f"Audio recording saved: {output_path} ({file_size} bytes)")

                            for cf in chunk_files:
                                try:
                                    os.unlink(cf)
                                except OSError:
                                    pass
                            try:
                                os.unlink(concat_list_path)
                            except OSError:
                                pass
                        else:
                            logger.warning(f"ffmpeg concat produced empty output for meeting {meeting_id}")
                    finally:
                        norm_set = set(normalized_files)
                        for nf in norm_set:
                            if nf not in chunk_files:
                                try:
                                    os.unlink(nf)
                                except OSError:
                                    pass
                else:
                    logger.info(f"No audio chunks found for meeting {meeting_id}")
            else:
                logger.info(f"No audio directory found for meeting {meeting_id}")
        except subprocess.CalledProcessError as e:
            logger.error(f"ffmpeg concat failed for meeting {meeting_id}: {e.stderr}")
        except Exception as e:
            logger.error(f"Audio concatenation failed for meeting {meeting_id}: {e}")

    summary_status = "FAILED"
    summary_payload = schemas.MeetingAnalysisOutput(
        meeting_summary="",
        key_points=[],
        decisions=[],
        action_items=[],
    )
    summary_error_message = ""
    ai_provider_name = "router"
    router = RouterLLMAdapter()

    if not generate_summary:
        if complete_meeting:
            try:
                update_meeting(db, meeting_id, {"status": "completed"})
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            db.commit()
        return {
            "meeting_id": meeting_id,
            "transcript_status": "COMPLETED",
            "summary_status": "SKIPPED",
            "has_transcript_draft": has_transcript_draft,
            "summary": None,
            "nlp_metadata": nlp_metadata,
            "errors": errors,
        }

    prompt_key = f"summary_{language}"
    custom_instruction = ADMIN_PROMPTS.get(prompt_key, ADMIN_PROMPTS.get("summary_vi", {})).get(
        "content",
        "Create a concise executive meeting brief. Focus on outcomes, explicit decisions, and next steps only.",
    )
    speaker_map = get_speaker_mapping_dict(db, meeting_id)
    speaker_aware_transcript = build_speaker_aware_transcript(full_text, segments_to_save, speaker_map)
    system_prompt, user_prompt = build_structured_summary_prompts(
        speaker_aware_transcript,
        custom_instruction,
        language,
        nlp_metadata,
        source_language=normalize_meeting_language(req_language or language),
        include_action_items=generate_action_items,
    )

    raw_response = None
    await meeting_room_manager.broadcast(
        meeting_id,
        {
            "type": "ai.notes.started",
            "meeting_id": meeting_id,
            "summary_status": "PROCESSING",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )

    if router.enabled:
        try:
            raw_response = router.structured_completion(system_prompt, user_prompt)
            if not raw_response:
                raise ValueError(router.last_error or "Router LLM returned empty response")
            if router.last_usage:
                try:
                    from src.api.crud.crud_system import create_cost_tracking
                    usage = router.last_usage
                    create_cost_tracking(db, {
                        "meeting_id": meeting_id,
                        "service": "llm",
                        "api_endpoint": "groq",
                        "model_name": usage.get("model", "unknown"),
                        "input_tokens": usage.get("prompt_tokens", 0),
                        "output_tokens": usage.get("completion_tokens", 0),
                        "cost_usd": 0.0,
                    })
                except Exception as cost_err:
                    logger.warning(f"Failed to log Groq LLM cost: {cost_err}")
        except Exception as e:
            error_message = f"Router LLM summarization failed: {e}"
            logger.error(error_message, exc_info=True)
            errors.append(error_message)
            summary_error_message = error_message
            raw_response = None
    else:
        summary_error_message = router.last_error or "Router LLM is not configured"
        errors.append(summary_error_message)

    if not raw_response:
        google_key = os.getenv("GOOGLE_API_KEY")
        if google_key:
            logger.info("Router LLM failed, falling back to Google Gemini for summarization")
            try:
                from src.providers.google_llm import GoogleLLMAdapter
                google = GoogleLLMAdapter(api_key=google_key)
                if google.client:
                    raw_response = google.chat_completion(system_prompt, user_prompt)
                    if raw_response:
                        ai_provider_name = "google-gemini"
                        if errors:
                            errors.pop()
                        logger.info("Google Gemini fallback succeeded")
            except Exception as ge:
                fallback_error = f"Google Gemini fallback also failed: {ge}"
                logger.error(fallback_error, exc_info=True)
                errors.append(fallback_error)

    if raw_response:
        try:
            structured_payload = _extract_json_object(raw_response)
            summary_payload = _normalize_analysis_payload(structured_payload)
            summary_status = "COMPLETED"
        except Exception as parse_error:
            error_message = f"Failed to parse LLM response: {parse_error}"
            logger.error(error_message, exc_info=True)
            errors.append(error_message)
            summary_error_message = error_message

    summary_db = db.query(models.MeetingSummary).filter(
        models.MeetingSummary.meeting_id == meeting_id,
        models.MeetingSummary.language == language,
    ).order_by(models.MeetingSummary.created_at.desc()).first()
    summary_action_items = [item.model_dump() for item in summary_payload.action_items] if generate_action_items else []
    summary_data = {
        "language": language,
        "key_points": summary_payload.key_points,
        "decisions": summary_payload.decisions,
        "action_items": summary_action_items,
        "risks": summary_payload.risks,
        "open_questions": summary_payload.open_questions,
        "timeline_highlights": summary_payload.timeline_highlights,
        "speaker_summaries": summary_payload.speaker_summaries,
        "meeting_summary": summary_payload.meeting_summary if summary_status == "COMPLETED" else summary_error_message,
        "ai_provider": ai_provider_name,
        "model_name": router.model if ai_provider_name == "router" else ai_provider_name,
        "processing_status": summary_status,
    }
    if summary_db:
        for key, value in summary_data.items():
            setattr(summary_db, key, value)
        if generate_action_items:
            db.query(models.ActionItem).filter(models.ActionItem.summary_id == summary_db.id).delete(synchronize_session=False)
        db.flush()
    else:
        summary_db = create_meeting_summary(db, {"meeting_id": meeting_id, **summary_data})

    if summary_status == "COMPLETED" and generate_action_items:
        for ai in summary_payload.action_items:
            owner = (ai.owner or "").strip() or None
            deadline = (ai.deadline or "").strip() or None

            resolved_assignees = []
            for owner_part in _split_ai_owner_text(owner or ""):
                participant = db.query(models.MeetingParticipant).filter(
                    models.MeetingParticipant.meeting_id == meeting_id,
                    or_(
                        models.MeetingParticipant.name.ilike(f"%{owner_part}%"),
                        models.MeetingParticipant.email.ilike(f"%{owner_part}%"),
                    )
                ).first()
                if participant and (participant.email or (participant.user and participant.user.email)):
                    resolved_assignees.append({
                        "user_id": participant.user_id,
                        "email": participant.email or participant.user.email,
                        "display_name": participant.name or owner_part,
                    })

            create_action_item(db, {
                "meeting_id": meeting_id,
                "summary_id": summary_db.id,
                "title": ai.task,
                "description": None,
                "assignees": resolved_assignees,
                "assigned_email": resolved_assignees[0]["email"] if resolved_assignees else None,
                "due_date": _try_parse_date(deadline),
                "status": "PENDING",
                "priority": "MEDIUM",
            }, created_by=current_user.id)

    if complete_meeting:
        final_meeting_status = "completed" if summary_status == "COMPLETED" else "failed" if regenerate else "completed"
        if regenerate and original_meeting_status == "completed" and summary_status != "COMPLETED":
            final_meeting_status = "completed"
        try:
            update_meeting(db, meeting_id, {"status": final_meeting_status})
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        db.commit()
    summary_broadcast_payload = format_summary_payload(summary_db) or {
        "meeting_summary": summary_payload.meeting_summary,
        "key_points": summary_payload.key_points,
        "decisions": summary_payload.decisions,
        "action_items": [item.model_dump() for item in summary_payload.action_items],
        "risks": summary_payload.risks,
        "open_questions": summary_payload.open_questions,
        "timeline_highlights": summary_payload.timeline_highlights,
        "speaker_summaries": summary_payload.speaker_summaries,
        "processing_status": summary_status,
        "language": language,
    }
    ai_event_type = "ai.notes.completed" if summary_status == "COMPLETED" else "ai.notes.failed"
    await meeting_room_manager.broadcast(
        meeting_id,
        {
            "type": ai_event_type,
            "meeting_id": meeting_id,
            "summary_status": summary_status,
            "summary": summary_broadcast_payload,
            "error": summary_error_message if summary_status != "COMPLETED" else "",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )

    return {
        "meeting_id": meeting_id,
        "transcript_status": "COMPLETED",
        "summary_status": summary_status,
        "has_transcript_draft": has_transcript_draft,
        "summary": summary_payload,
        "nlp_metadata": nlp_metadata,
        "errors": errors,
        "language": language,
    }


async def generate_meeting_ai_notes_all_languages(
    meeting_id: str,
    db: Session,
    current_user: models.User,
    body: Optional[Dict[str, Any]] = None,
):
    body = dict(body or {})
    requested = body.get("languages") or SUPPORTED_MEETING_LANGUAGES
    languages = []
    for language in requested:
        normalized = normalize_meeting_language(str(language))
        if normalized not in languages:
            languages.append(normalized)
    if not languages:
        languages = list(SUPPORTED_MEETING_LANGUAGES)

    canonical_language = CANONICAL_ACTION_ITEM_LANGUAGE if CANONICAL_ACTION_ITEM_LANGUAGE in languages else languages[0]
    base_body = dict(body)
    base_body.pop("languages", None)
    base_body["language"] = canonical_language
    base_body["generate_action_items"] = bool(body.get("generate_action_items", True))
    base_body["persist_transcript"] = True
    base_body["complete_meeting"] = False

    canonical_result = await finalize_meeting_transcript(meeting_id, db, current_user, base_body)
    per_language = {canonical_language: canonical_result}
    errors: List[str] = list(canonical_result.get("errors") or [])

    transcript = body.get("transcript")
    segments = body.get("segments")
    if not transcript or not segments:
        latest_transcript = db.query(models.Transcript).filter(
            models.Transcript.meeting_id == meeting_id,
        ).order_by(models.Transcript.created_at.desc()).first()
        if latest_transcript:
            transcript = transcript or latest_transcript.content
            if not segments:
                segments = [
                    {
                        "speaker": segment.speaker_label,
                        "start": float(segment.start_time or 0),
                        "end": float(segment.end_time or 0),
                        "text": segment.text,
                        "language": segment.language or canonical_language,
                        "confidence": float(segment.confidence_score) if segment.confidence_score is not None else None,
                    }
                    for segment in latest_transcript.segments
                    if (segment.text or "").strip()
                ]

    for language in languages:
        if language == canonical_language:
            continue
        translated_body = dict(base_body)
        translated_body.update({
            "language": language,
            "transcript": transcript or "",
            "segments": segments or [],
            "persist_transcript": False,
            "generate_action_items": False,
            "generate_summary": True,
            "complete_meeting": False,
        })
        result = await finalize_meeting_transcript(meeting_id, db, current_user, translated_body)
        per_language[language] = result
        errors.extend(result.get("errors") or [])

    completed = [language for language, result in per_language.items() if result.get("summary_status") == "COMPLETED"]
    aggregate_status = "COMPLETED" if len(completed) == len(languages) else "PARTIAL" if completed else "FAILED"

    original_status = db.query(models.Meeting.status).filter(models.Meeting.id == meeting_id).scalar()
    final_status = "completed" if completed or original_status == "completed" else "failed"
    try:
        from src.api.crud import update_meeting
        update_meeting(db, meeting_id, {"status": final_status})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    db.commit()

    canonical_payload = per_language.get(canonical_language, canonical_result)
    return {
        "meeting_id": meeting_id,
        "transcript_status": canonical_payload.get("transcript_status", "COMPLETED"),
        "summary_status": aggregate_status,
        "has_transcript_draft": canonical_payload.get("has_transcript_draft", False),
        "summary": canonical_payload.get("summary"),
        "nlp_metadata": canonical_payload.get("nlp_metadata"),
        "errors": errors,
        "languages": languages,
        "per_language": {
            language: {
                "summary_status": result.get("summary_status"),
                "transcript_status": result.get("transcript_status"),
                "errors": result.get("errors", []),
                "summary": result.get("summary"),
            }
            for language, result in per_language.items()
        },
    }
