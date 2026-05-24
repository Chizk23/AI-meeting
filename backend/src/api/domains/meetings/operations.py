"""Meeting room manager, participant helpers, payload builders, and audio publish."""

import asyncio
import glob
import logging
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, WebSocket
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from src.api import auth, models
from src.api.core.app_state import (
    AUDIO_UPLOAD_DIR,
    LEGACY_AUDIO_UPLOAD_DIR,
    ensure_audio_upload_dir,
    resolve_audio_storage_path,
)
from src.api.crud import get_user_by_username
from src.api.domains.meetings.support import estimate_segment_end, normalize_speaker_label
from src.api.domains.meetings.transcripts import (
    _normalize_chunks_for_concat,
    build_transcript_from_drafts,
    serialize_transcript_draft_chunks,
)
from src.api.core.user_payloads import format_user_payload

logger = logging.getLogger(__name__)


# ─── MeetingRoomConnectionManager ───────────────────────────────────────────


class MeetingRoomConnectionManager:
    def __init__(self) -> None:
        self.active_connections: Dict[str, List[Tuple[WebSocket, Dict[str, Any]]]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, meeting_id: str, websocket: WebSocket, user_info: Dict[str, Any]) -> None:
        await websocket.accept()
        async with self._lock:
            connections = self.active_connections.setdefault(meeting_id, [])
            connections[:] = [(ws, u) for ws, u in connections if ws != websocket]
            connections.append((websocket, {**user_info, "connected_at": datetime.now(timezone.utc).isoformat()}))

    async def disconnect(self, meeting_id: str, websocket: WebSocket) -> Optional[Dict[str, Any]]:
        disconnected_user: Optional[Dict[str, Any]] = None
        should_emit_left = False
        async with self._lock:
            connections = self.active_connections.get(meeting_id, [])
            for ws, user_info in connections:
                if ws == websocket:
                    disconnected_user = user_info
                    break
            self.active_connections[meeting_id] = [(ws, u) for ws, u in connections if ws != websocket]
            if not self.active_connections.get(meeting_id):
                self.active_connections.pop(meeting_id, None)
                should_emit_left = bool(disconnected_user)
            elif disconnected_user:
                user_id = disconnected_user.get("id")
                should_emit_left = not any(
                    user_info.get("id") == user_id
                    for _, user_info in self.active_connections.get(meeting_id, [])
                )
        return disconnected_user if should_emit_left else None

    def get_participants(self, meeting_id: str) -> List[Dict[str, Any]]:
        deduped: Dict[str, Dict[str, Any]] = {}
        for _, user_info in self.active_connections.get(meeting_id, []):
            key = str(user_info.get("id") or user_info.get("email") or len(deduped))
            deduped[key] = user_info
        return list(deduped.values())

    async def broadcast(self, meeting_id: str, payload: Dict[str, Any]) -> None:
        connections = list(self.active_connections.get(meeting_id, []))
        stale: List[WebSocket] = []
        for websocket, _ in connections:
            try:
                await websocket.send_json(payload)
            except Exception:
                stale.append(websocket)
        if stale:
            async with self._lock:
                current = self.active_connections.get(meeting_id, [])
                self.active_connections[meeting_id] = [(ws, u) for ws, u in current if ws not in stale]


meeting_room_manager = MeetingRoomConnectionManager()


# ─── Participant Helpers ────────────────────────────────────────────────────


def get_meeting_participant_for_user(db: Session, meeting_id: str, user: models.User) -> Optional[models.MeetingParticipant]:
    participant = db.query(models.MeetingParticipant).filter(
        models.MeetingParticipant.meeting_id == meeting_id,
        models.MeetingParticipant.user_id == user.id,
    ).first()
    if participant:
        return participant

    email = (user.email or "").lower()
    if not email:
        return None
    participant = db.query(models.MeetingParticipant).filter(
        models.MeetingParticipant.meeting_id == meeting_id,
        func.lower(models.MeetingParticipant.email) == email,
    ).first()
    if participant and not participant.user_id:
        existing_user_participant = db.query(models.MeetingParticipant).filter(
            models.MeetingParticipant.meeting_id == meeting_id,
            models.MeetingParticipant.user_id == user.id,
        ).first()
        if not existing_user_participant:
            participant.user_id = user.id
            participant.name = participant.name or " ".join(
                part for part in [user.first_name, user.last_name] if part
            ).strip() or user.username
            db.flush()
    return participant


def require_meeting_room_access(db: Session, user: models.User, meeting: models.Meeting) -> Optional[models.MeetingParticipant]:
    try:
        auth.require_org_member(db, user, meeting.organization_id)
        return get_meeting_participant_for_user(db, meeting.id, user)
    except HTTPException as org_error:
        participant = get_meeting_participant_for_user(db, meeting.id, user)
        if participant and participant.invite_status != "declined":
            return participant
        raise org_error


def mark_participant_attended(db: Session, participant: Optional[models.MeetingParticipant]) -> None:
    if not participant:
        return
    if participant.attended and participant.joined_at:
        return
    if participant.invite_status == "pending":
        participant.invite_status = "accepted"
    participant.attended = True
    participant.joined_at = participant.joined_at or datetime.now(timezone.utc)
    db.flush()


def mark_participant_left(db: Session, participant: Optional[models.MeetingParticipant]) -> None:
    if not participant or participant.left_at:
        return
    participant.left_at = datetime.now(timezone.utc)
    db.flush()


def participant_display_name(participant: models.MeetingParticipant) -> str:
    user = participant.user
    return (
        participant.name
        or (" ".join(
            part for part in [getattr(user, "first_name", None), getattr(user, "last_name", None)] if part
        ).strip() if user else "")
        or getattr(user, "username", None)
        or participant.email
        or "Thành viên"
    )


def format_meeting_participant_payload(participant: models.MeetingParticipant) -> Dict[str, Any]:
    user = participant.user
    display_name = participant_display_name(participant)
    return {
        "id": participant.user_id or participant.id,
        "participant_id": participant.id,
        "user_id": participant.user_id,
        "email": participant.email or (user.email if user else None),
        "displayName": display_name,
        "name": display_name,
        "role": participant.role,
        "invite_status": participant.invite_status,
        "attended": participant.attended,
        "joined_at": participant.joined_at.isoformat() if participant.joined_at else None,
        "left_at": participant.left_at.isoformat() if participant.left_at else None,
    }


def coerce_utc_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def compute_meeting_duration_minutes(meeting: models.Meeting, now: Optional[datetime] = None) -> int:
    current = coerce_utc_datetime(now) or datetime.now(timezone.utc)
    start = (
        coerce_utc_datetime(meeting.actual_start)
        or coerce_utc_datetime(meeting.scheduled_start)
        or coerce_utc_datetime(meeting.created_at)
    )
    end = coerce_utc_datetime(meeting.actual_end)
    if start is None:
        return int(meeting.duration or 0)
    effective_end = end or (current if meeting.status == "live" else None)
    if effective_end is None:
        return int(meeting.duration or 0)
    return max(0, int((effective_end - start).total_seconds() / 60))


def get_attended_participants(meeting: models.Meeting) -> List[models.MeetingParticipant]:
    participants = list(meeting.participants or [])
    attended = [participant for participant in participants if participant.attended]
    def _sort_value(value: Optional[datetime]) -> float:
        normalized = coerce_utc_datetime(value)
        return normalized.timestamp() if normalized else float("inf")
    attended.sort(
        key=lambda participant: (
            _sort_value(participant.joined_at),
            participant.id,
        )
    )
    return attended


def get_meeting_access_mode(db: Session, user: models.User, meeting: models.Meeting) -> str:
    if auth.get_user_org_role(db, user, meeting.organization_id):
        return "org_member"
    participant = get_meeting_participant_for_user(db, meeting.id, user)
    if participant and participant.invite_status != "declined":
        return "meeting_guest"
    return "none"


# ─── WebSocket User ─────────────────────────────────────────────────────────


def get_ws_user(db: Session, token: Optional[str]) -> models.User:
    from jose import jwt as jose_jwt

    if token and token.lower().startswith("bearer "):
        token = token.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing websocket token")
    try:
        payload = jose_jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise ValueError("Missing subject")
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid websocket token") from exc
    user = get_user_by_username(db, username)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid websocket user")
    return user


# ─── Payload Builders ───────────────────────────────────────────────────────


def summarize_json_items(items: Any) -> List[str]:
    if not items:
        return []
    if isinstance(items, list):
        normalized: List[str] = []
        for item in items:
            if isinstance(item, str):
                normalized.append(item)
            elif isinstance(item, dict):
                normalized.append(
                    item.get("text")
                    or item.get("title")
                    or item.get("summary")
                    or item.get("decision")
                    or item.get("content")
                    or str(item)
                )
            else:
                normalized.append(str(item))
        return [item for item in normalized if item]
    return [str(items)]


def _latest_processed_record(
    items: List[Any],
    success_status: str = "COMPLETED",
    fallback_to_any: bool = True,
) -> Optional[Any]:
    successful = [item for item in items or [] if getattr(item, "processing_status", None) == success_status]
    pool = successful or (list(items or []) if fallback_to_any else [])
    return max(pool, key=lambda item: getattr(item, "updated_at", None) or item.created_at or datetime.min, default=None)


def format_meeting_message_payload(message: models.MeetingMessage) -> Dict[str, Any]:
    return {
        "id": message.id,
        "meeting_id": message.meeting_id,
        "user_id": message.user_id,
        "text": message.text,
        "message_type": message.message_type,
        "reply_to_id": message.reply_to_id,
        "created_at": message.created_at.isoformat() if message.created_at else None,
        "updated_at": message.updated_at.isoformat() if message.updated_at else None,
        "user": format_user_payload(message.user) if message.user else None,
    }


def format_summary_payload(summary: Optional[models.MeetingSummary]) -> Optional[Dict[str, Any]]:
    if not summary:
        return None
    return {
        "id": summary.id,
        "meeting_summary": summary.meeting_summary or "",
        "key_points": summary.key_points or [],
        "decisions": summary.decisions or [],
        "action_items": summary.action_items or [],
        "risks": summary.risks or [],
        "open_questions": summary.open_questions or [],
        "timeline_highlights": summary.timeline_highlights or [],
        "speaker_summaries": summary.speaker_summaries or [],
        "processing_status": summary.processing_status,
        "language": summary.language,
        "ai_provider": summary.ai_provider,
        "model_name": summary.model_name,
        "created_at": summary.created_at.isoformat() if summary.created_at else None,
    }


def serialize_action_item_payload(action_item: models.ActionItem) -> Dict[str, Any]:
    from src.api.domains.action_items.support import serialize_action_item_payload as core_serialize

    return core_serialize(action_item)


def speaker_mapping_payload(mapping: models.MeetingSpeakerMapping) -> Dict[str, Any]:
    return {
        "id": mapping.id,
        "meeting_id": mapping.meeting_id,
        "speaker_label": mapping.speaker_label,
        "display_name": mapping.display_name,
        "user_id": mapping.user_id,
        "user": format_user_payload(mapping.user) if getattr(mapping, "user", None) else None,
        "created_at": mapping.created_at.isoformat() if mapping.created_at else None,
        "updated_at": mapping.updated_at.isoformat() if mapping.updated_at else None,
    }


# ─── Transcript Display ─────────────────────────────────────────────────────


def split_transcript_content_for_display(content: str, max_chars: int = 700) -> List[str]:
    if not content or not content.strip():
        return []

    lines = [line.strip() for line in content.splitlines() if line.strip()]
    if len(lines) > 1:
        return lines

    sentences = [item.strip() for item in re.split(r"(?<=[.!?。！？])\s+", content.strip()) if item.strip()]
    if len(sentences) <= 1:
        text = content.strip()
        return [text[index:index + max_chars].strip() for index in range(0, len(text), max_chars) if text[index:index + max_chars].strip()]

    chunks: List[str] = []
    current = ""
    for sentence in sentences:
        if current and len(current) + len(sentence) + 1 > max_chars:
            chunks.append(current.strip())
            current = sentence
        else:
            current = f"{current} {sentence}".strip()
    if current:
        chunks.append(current.strip())
    return chunks


def transcript_segment_response_payloads(
    transcript: Optional[models.Transcript],
    speaker_map: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    if not transcript:
        return []
    speaker_map = speaker_map or {}

    ordered_segments = sorted(
        transcript.segments or [],
        key=lambda segment: (
            float(segment.start_time or 0),
            segment.created_at or datetime.min,
            segment.id,
        ),
    )

    if ordered_segments:
        payloads: List[Dict[str, Any]] = []
        for segment in ordered_segments:
            if not (segment.text or "").strip():
                continue
            raw_label = normalize_speaker_label(segment.speaker_label or "Speaker_01")
            display_name = speaker_map.get(raw_label, raw_label)
            payloads.append({
                "id": segment.id,
                "transcript_id": segment.transcript_id,
                "speaker_label": display_name,
                "speaker_raw_label": raw_label,
                "speaker_display_name": display_name,
                "start_time": float(segment.start_time or 0),
                "end_time": float(segment.end_time or 0),
                "text": segment.text or "",
                "language": getattr(segment, "language", None) or transcript.language or "auto",
                "confidence_score": float(segment.confidence_score) if segment.confidence_score is not None else None,
                "word_count": segment.word_count,
                "created_at": segment.created_at,
            })
        return payloads

    fallback_chunks = split_transcript_content_for_display(transcript.content or "")
    payloads: List[Dict[str, Any]] = []
    start_time = 0.0
    for index, chunk in enumerate(fallback_chunks):
        end_time = estimate_segment_end(start_time, chunk)
        raw_label = "Speaker_01"
        display_name = speaker_map.get(raw_label, raw_label)
        payloads.append({
            "id": f"{transcript.id[:28]}-{index:03d}",
            "transcript_id": transcript.id,
            "speaker_label": display_name,
            "speaker_raw_label": raw_label,
            "speaker_display_name": display_name,
            "start_time": start_time,
            "end_time": end_time,
            "text": chunk,
            "language": transcript.language or "auto",
            "confidence_score": None,
            "word_count": len(chunk.split()),
            "created_at": transcript.created_at,
        })
        start_time = end_time
    return payloads


def draft_transcript_segment_response_payloads(
    segments: List[Dict[str, Any]],
    speaker_map: Optional[Dict[str, str]] = None,
) -> List[Dict[str, Any]]:
    speaker_map = speaker_map or {}
    payloads: List[Dict[str, Any]] = []
    for index, segment in enumerate(segments or []):
        text = str(segment.get("text") or "").strip()
        if not text:
            continue
        raw_label = normalize_speaker_label(segment.get("speaker_label") or segment.get("speaker") or "Speaker_01")
        display_name = speaker_map.get(raw_label, raw_label)
        payloads.append({
            "id": f"draft-segment-{index:03d}",
            "transcript_id": "draft",
            "speaker_label": display_name,
            "speaker_raw_label": raw_label,
            "speaker_display_name": display_name,
            "start_time": float(segment.get("start_time") or segment.get("start") or 0),
            "end_time": float(segment.get("end_time") or segment.get("end") or 0),
            "text": text,
            "language": str(segment.get("language") or "auto"),
            "confidence_score": (
                float(segment.get("confidence_score"))
                if segment.get("confidence_score") is not None
                else float(segment.get("confidence"))
                if segment.get("confidence") is not None
                else None
            ),
            "word_count": len(text.split()),
            "created_at": datetime.now(timezone.utc),
        })
    return payloads


# ─── Action Item Anchoring ──────────────────────────────────────────────────


def _normalize_match_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (value or "").lower())).strip()


def _anchor_from_segments(
    text: Optional[str],
    segments: List[Dict[str, Any]],
    *,
    preferred_speaker: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    normalized_text = _normalize_match_text(text)
    if not normalized_text:
        return None

    tokens = [token for token in normalized_text.split() if len(token) >= 3][:8]
    if not tokens:
        return None

    best_segment: Optional[Dict[str, Any]] = None
    best_score = 0
    preferred_normalized = _normalize_match_text(preferred_speaker) if preferred_speaker else None

    for segment in segments or []:
        segment_text = _normalize_match_text(segment.get("text"))
        if not segment_text:
            continue
        score = sum(2 for token in tokens if token in segment_text)
        if normalized_text and normalized_text[: min(len(normalized_text), 32)] in segment_text:
            score += 3
        if preferred_normalized and preferred_normalized in _normalize_match_text(segment.get("speaker_label")):
            score += 1
        if score > best_score:
            best_score = score
            best_segment = segment

    if not best_segment or best_score <= 0:
        return None

    return {
        "start_time": float(best_segment.get("start_time") or 0),
        "end_time": float(best_segment.get("end_time") or best_segment.get("start_time") or 0),
        "speaker_label": best_segment.get("speaker_label"),
        "source_segment_ids": [best_segment.get("id")] if best_segment.get("id") else [],
    }


def build_anchored_text_items(
    items: List[str],
    segments: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    anchored_items: List[Dict[str, Any]] = []
    for item in items or []:
        text = str(item or "").strip()
        if not text:
            continue
        anchored_items.append({
            "text": text,
            "anchor": _anchor_from_segments(text, segments),
        })
    return anchored_items


# ─── Activity Payload ───────────────────────────────────────────────────────


def build_meeting_activity_payload(
    meeting: models.Meeting,
    *,
    transcript_status: str,
    has_transcript_draft: bool,
    audio_status: str,
    summary_status: Optional[str],
    summary_error_text: Optional[str],
    action_items: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    def _activity_timestamp_value(value: Any) -> float:
        if value is None:
            return 0.0
        if isinstance(value, datetime):
            return value.timestamp()
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return 0.0
            try:
                return datetime.fromisoformat(normalized.replace("Z", "+00:00")).timestamp()
            except ValueError:
                return 0.0
        return 0.0

    creator = meeting.created_by_user
    creator_label = (
        " ".join(part for part in [getattr(creator, "first_name", None), getattr(creator, "last_name", None)] if part).strip()
        if creator else None
    ) or getattr(creator, "username", None) or getattr(creator, "email", None) or "Hệ thống"

    items: List[Dict[str, Any]] = [{
        "id": f"meeting-created-{meeting.id}",
        "type": "meeting.created",
        "title": "Cuộc họp được tạo",
        "description": f"{creator_label} đã tạo cuộc họp và chia sẻ ngữ cảnh ban đầu.",
        "timestamp": meeting.created_at.isoformat() if meeting.created_at else None,
        "tone": "neutral",
        "actor": {
            "id": getattr(creator, "id", None),
            "displayName": creator_label,
            "email": getattr(creator, "email", None),
        },
        "metadata": {"meeting_id": meeting.id},
    }]

    if meeting.actual_start or meeting.scheduled_start:
        items.append({
            "id": f"meeting-start-{meeting.id}",
            "type": "meeting.started",
            "title": "Cuộc họp bắt đầu",
            "description": "Buổi họp đã bắt đầu và dữ liệu đang được thu thập.",
            "timestamp": (meeting.actual_start or meeting.scheduled_start).isoformat() if (meeting.actual_start or meeting.scheduled_start) else None,
            "tone": "info",
            "metadata": {"meeting_id": meeting.id},
        })

    if meeting.actual_end:
        items.append({
            "id": f"meeting-end-{meeting.id}",
            "type": "meeting.ended",
            "title": "Cuộc họp kết thúc",
            "description": "Bản ghi âm, transcript và AI Notes đã sẵn sàng cho giai đoạn xử lý sau họp.",
            "timestamp": meeting.actual_end.isoformat(),
            "tone": "neutral",
            "metadata": {"meeting_id": meeting.id},
        })

    if transcript_status == "DRAFT" and has_transcript_draft:
        items.append({
            "id": f"transcript-draft-{meeting.id}",
            "type": "transcript.draft_saved",
            "title": "Transcript đang được lưu bản nháp",
            "description": "Hệ thống đã giữ lại transcript gần realtime, kể cả khi AI Notes chưa hoàn tất.",
            "timestamp": (meeting.updated_at or meeting.created_at).isoformat() if (meeting.updated_at or meeting.created_at) else None,
            "tone": "info",
            "metadata": {"meeting_id": meeting.id},
        })
    elif transcript_status == "COMPLETED":
        items.append({
            "id": f"transcript-complete-{meeting.id}",
            "type": "transcript.completed",
            "title": "Transcript đã hoàn tất",
            "description": "Transcript chính thức đã sẵn sàng để tìm kiếm và nghe lại theo timeline.",
            "timestamp": (meeting.updated_at or meeting.created_at).isoformat() if (meeting.updated_at or meeting.created_at) else None,
            "tone": "success",
            "metadata": {"meeting_id": meeting.id},
        })

    if audio_status == "PROCESSING":
        items.append({
            "id": f"audio-processing-{meeting.id}",
            "type": "audio.processing",
            "title": "Bản ghi âm đang được publish",
            "description": "Raw audio đã có và hệ thống đang chuẩn bị player để phát lại trên giao diện.",
            "timestamp": (meeting.updated_at or meeting.created_at).isoformat() if (meeting.updated_at or meeting.created_at) else None,
            "tone": "warning",
            "metadata": {"meeting_id": meeting.id},
        })
    elif audio_status == "READY":
        items.append({
            "id": f"audio-ready-{meeting.id}",
            "type": "audio.ready",
            "title": "Bản ghi âm đã sẵn sàng",
            "description": "Bạn có thể phát lại audio full và nhảy tới từng mốc transcript.",
            "timestamp": (meeting.updated_at or meeting.created_at).isoformat() if (meeting.updated_at or meeting.created_at) else None,
            "tone": "success",
            "metadata": {"meeting_id": meeting.id},
        })

    if summary_status == "COMPLETED":
        items.append({
            "id": f"summary-complete-{meeting.id}",
            "type": "summary.completed",
            "title": "AI Notes đã tạo xong",
            "description": "Tóm tắt, quyết định và việc cần làm đã được tổng hợp.",
            "timestamp": (meeting.updated_at or meeting.created_at).isoformat() if (meeting.updated_at or meeting.created_at) else None,
            "tone": "success",
            "metadata": {"meeting_id": meeting.id},
        })
    elif summary_status == "FAILED":
        items.append({
            "id": f"summary-failed-{meeting.id}",
            "type": "summary.failed",
            "title": "AI Notes cần được tạo lại",
            "description": summary_error_text or "Bản tổng hợp AI chưa hoàn tất. Bạn có thể thử tạo lại từ tab AI Notes.",
            "timestamp": (meeting.updated_at or meeting.created_at).isoformat() if (meeting.updated_at or meeting.created_at) else None,
            "tone": "danger",
            "metadata": {"meeting_id": meeting.id},
        })

    for action_item in action_items:
        assignees = action_item.get("assignees") or []
        completed_count = len([assignee for assignee in assignees if assignee.get("status") == "COMPLETED"])
        assignee_summary = ", ".join(
            item.get("display_name") or item.get("email") or ""
            for item in assignees
            if item.get("display_name") or item.get("email")
        ) or "Chưa giao người phụ trách"
        items.append({
            "id": f"action-{action_item['id']}",
            "type": "action_item.completed" if action_item.get("status") == "COMPLETED" else "action_item.updated",
            "title": (
                f"Hoàn tất việc: {action_item['title']}"
                if action_item.get("status") == "COMPLETED"
                else f"Cập nhật phân công: {action_item['title']}"
                if assignees
                else f"Backlog mới: {action_item['title']}"
            ),
            "description": (
                f"{assignee_summary} · {completed_count}/{len(assignees)} đã xong"
                if assignees
                else "Task đang chờ người phụ trách nhận việc."
            ),
            "timestamp": action_item.get("completed_at") or action_item.get("updated_at") or action_item.get("created_at"),
            "tone": "success" if action_item.get("status") == "COMPLETED" else "warning" if not assignees else "info",
            "metadata": {
                "meeting_id": meeting.id,
                "task_id": action_item["id"],
            },
        })

    return sorted(
        items,
        key=lambda item: _activity_timestamp_value(item.get("timestamp")),
        reverse=True,
    )[:12]


# ─── Audio Publish ──────────────────────────────────────────────────────────


def _valid_meeting_audio_records(meeting: models.Meeting) -> List[models.AudioFile]:
    records = []
    for audio_file in (meeting.audio_files or []):
        resolved_path = resolve_audio_storage_path(audio_file.file_path)
        if (
            resolved_path
            and os.path.exists(resolved_path)
            and os.path.getsize(resolved_path) > 0
            and (audio_file.upload_status or "").upper() == "PROCESSED"
        ):
            if resolved_path != audio_file.file_path:
                logger.info("Resolved legacy audio path for record %s: %s -> %s", audio_file.id, audio_file.file_path, resolved_path)
                audio_file.file_path = resolved_path
            records.append(audio_file)
    return sorted(records, key=lambda item: (item.updated_at or item.created_at or datetime.min, item.id))


def _sync_meeting_audio_urls(db: Session, meeting: models.Meeting, audio_file: models.AudioFile) -> None:
    audio_stream_url = f"/api/audio-files/{audio_file.id}/stream"
    meeting.audio_url = audio_stream_url
    meeting.recording_url = audio_stream_url
    latest_transcript = db.query(models.Transcript).filter(
        models.Transcript.meeting_id == meeting.id,
    ).order_by(models.Transcript.created_at.desc()).first()
    if latest_transcript and not latest_transcript.audio_file_id:
        latest_transcript.audio_file_id = audio_file.id
    db.flush()


def ensure_meeting_audio_published(db: Session, meeting: models.Meeting) -> str:
    valid_records = _valid_meeting_audio_records(meeting)
    if valid_records:
        latest_record = valid_records[-1]
        if any(item in db.dirty for item in valid_records):
            db.commit()
            db.refresh(meeting)
        expected_url = f"/api/audio-files/{latest_record.id}/stream"
        if meeting.audio_url != expected_url or meeting.recording_url != expected_url:
            _sync_meeting_audio_urls(db, meeting, latest_record)
            db.commit()
            db.refresh(meeting)
        return "READY"

    canonical_perm_dir = os.path.join(ensure_audio_upload_dir(), meeting.id)
    legacy_perm_dir = os.path.join(LEGACY_AUDIO_UPLOAD_DIR, meeting.id)
    perm_dir = canonical_perm_dir
    if not os.path.isdir(perm_dir) and os.path.isdir(legacy_perm_dir):
        logger.info("Falling back to legacy audio directory for meeting %s: %s", meeting.id, legacy_perm_dir)
        perm_dir = legacy_perm_dir
    if not os.path.isdir(perm_dir):
        return "NONE"

    all_dir_files = [
        path for path in glob.glob(os.path.join(perm_dir, "*"))
        if os.path.isfile(path)
    ]
    output_filename = f"recording_{meeting.id}.wav"
    output_path = os.path.join(perm_dir, output_filename)

    candidate_files = sorted(
        path for path in (glob.glob(os.path.join(perm_dir, "chunk_*")) + glob.glob(os.path.join(perm_dir, "stream_*.wav")))
        if os.path.isfile(path) and os.path.getsize(path) > 0 and os.path.abspath(path) != os.path.abspath(output_path)
    )
    if not candidate_files:
        return "PROCESSING" if all_dir_files else "NONE"

    if perm_dir != canonical_perm_dir:
        os.makedirs(canonical_perm_dir, exist_ok=True)
        output_path = os.path.join(canonical_perm_dir, output_filename)

    normalized_files = _normalize_chunks_for_concat(candidate_files, perm_dir)
    files_to_concat = normalized_files if normalized_files else candidate_files
    concat_list_path = os.path.join(perm_dir, "concat_publish.txt")
    try:
        if len(files_to_concat) == 1:
            subprocess.run(
                ["ffmpeg", "-y", "-i", files_to_concat[0], "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", output_path],
                capture_output=True,
                timeout=120,
                check=True,
            )
        else:
            with open(concat_list_path, "w") as concat_file:
                for candidate in files_to_concat:
                    concat_file.write(f"file '{candidate}'\n")
            subprocess.run(
                ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list_path, "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", output_path],
                capture_output=True,
                timeout=120,
                check=True,
            )

        if not os.path.exists(output_path) or os.path.getsize(output_path) <= 0:
            logger.warning("Audio publish produced empty output for meeting %s", meeting.id)
            return "PROCESSING"

        audio_record = db.query(models.AudioFile).filter(
            models.AudioFile.meeting_id == meeting.id,
            or_(
                models.AudioFile.file_path == output_path,
                models.AudioFile.filename == output_filename,
            ),
        ).order_by(models.AudioFile.updated_at.desc(), models.AudioFile.created_at.desc()).first()
        if audio_record:
            audio_record.file_path = output_path
            audio_record.filename = output_filename
            audio_record.original_filename = audio_record.original_filename or "meeting_recording.wav"
            audio_record.file_size = os.path.getsize(output_path)
            audio_record.format = "WAV"
            audio_record.sample_rate = audio_record.sample_rate or 16000
            audio_record.channels = audio_record.channels or 1
            audio_record.upload_status = "PROCESSED"
        else:
            audio_record = models.AudioFile(
                meeting_id=meeting.id,
                filename=output_filename,
                original_filename="meeting_recording.wav",
                file_path=output_path,
                file_size=os.path.getsize(output_path),
                format="WAV",
                sample_rate=16000,
                channels=1,
                upload_status="PROCESSED",
            )
            db.add(audio_record)
            db.flush()

        _sync_meeting_audio_urls(db, meeting, audio_record)
        db.commit()
        db.refresh(meeting)

        for candidate in candidate_files:
            try:
                os.unlink(candidate)
            except OSError:
                pass
        return "READY"
    except subprocess.CalledProcessError as exc:
        logger.warning("ffmpeg publish failed for meeting %s: %s", meeting.id, exc.stderr)
        return "PROCESSING"
    except FileNotFoundError as exc:
        logger.warning("ffmpeg not available while publishing audio for meeting %s: %s", meeting.id, exc)
        return "FAILED"
    except Exception as exc:
        logger.error("Unexpected audio publish failure for meeting %s: %s", meeting.id, exc, exc_info=True)
        return "FAILED"
    finally:
        # Clean up temp normalized files (not the originals)
        norm_set = set(normalized_files)
        for nf in norm_set:
            if nf not in candidate_files:
                try:
                    os.unlink(nf)
                except OSError:
                    pass
        if os.path.exists(concat_list_path):
            try:
                os.unlink(concat_list_path)
            except OSError:
                pass


# ─── Meeting Detail Payload ─────────────────────────────────────────────────


def build_meeting_detail_payload(
    db: Session,
    meeting: models.Meeting,
    user_lang: str = "vi",
    access_mode: Optional[str] = None,
) -> Dict[str, Any]:
    from src.api.domains.organizations.operations import enrich_organization_payload
    from src.api.domains.organizations.groups import enrich_group_payload

    audio_status = ensure_meeting_audio_published(db, meeting)
    latest_transcript = _latest_processed_record(meeting.transcripts or [])
    draft_payload = build_transcript_from_drafts(db, meeting.id)
    has_transcript_draft = bool(
        str(draft_payload.get("transcript") or "").strip()
        or bool(draft_payload.get("segments"))
    )
    speaker_mappings = sorted(meeting.speaker_mappings or [], key=lambda item: item.speaker_label)
    speaker_map = {item.speaker_label: item.display_name for item in speaker_mappings if item.display_name}
    summaries = meeting.summaries or []
    lang_match = [s for s in summaries if (s.language or "vi") == user_lang]
    summary_pool = lang_match if lang_match else summaries
    latest_summary_any = _latest_processed_record(summary_pool, fallback_to_any=True)
    latest_summary = _latest_processed_record(summary_pool, fallback_to_any=False)
    summary_status = latest_summary_any.processing_status if latest_summary_any else None
    summary_error_text = (
        latest_summary_any.meeting_summary
        if latest_summary_any and latest_summary_any.processing_status == "FAILED"
        else None
    )
    serialized_action_items = [serialize_action_item_payload(item) for item in (meeting.action_items or [])]
    transcript_segments = (
        transcript_segment_response_payloads(latest_transcript, speaker_map)
        if latest_transcript
        else draft_transcript_segment_response_payloads(draft_payload.get("segments") or [], speaker_map)
    )
    transcript_content = latest_transcript.content if latest_transcript else (draft_payload.get("transcript") or None)
    transcript_language = (
        latest_transcript.language
        if latest_transcript
        else draft_payload.get("language") if draft_payload.get("language") not in {None, "", "auto"} else None
    )
    transcript_status = "COMPLETED" if latest_transcript else "DRAFT" if has_transcript_draft else "EMPTY"
    key_points_text = summarize_json_items(latest_summary.key_points if latest_summary else None)
    decisions_text = summarize_json_items(latest_summary.decisions if latest_summary else None)
    timeline_highlights_text = summarize_json_items(latest_summary.timeline_highlights if latest_summary else None)
    attended_participants = get_attended_participants(meeting)
    activity = build_meeting_activity_payload(
        meeting,
        transcript_status=transcript_status,
        has_transcript_draft=has_transcript_draft,
        audio_status=audio_status,
        summary_status=summary_status,
        summary_error_text=summary_error_text,
        action_items=serialized_action_items,
    )

    return {
        "id": meeting.id,
        "organization_id": meeting.organization_id,
        "group_id": meeting.group_id,
        "title": meeting.title,
        "description": meeting.description,
        "scheduled_start": meeting.scheduled_start,
        "scheduled_end": meeting.scheduled_end,
        "actual_start": meeting.actual_start,
        "actual_end": meeting.actual_end,
        "duration": compute_meeting_duration_minutes(meeting),
        "location": meeting.location,
        "meeting_type": meeting.meeting_type,
        "status": meeting.status,
        "code": meeting.code,
        "recording_url": meeting.recording_url,
        "transcript_url": meeting.transcript_url,
        "audio_url": meeting.audio_url,
        "audio_status": audio_status,
        "is_pinned": meeting.is_pinned,
        "created_by": meeting.created_by,
        "created_at": meeting.created_at,
        "updated_at": meeting.updated_at,
        "organization": enrich_organization_payload(meeting.organization) if meeting.organization else None,
        "group": enrich_group_payload(meeting.group) if meeting.group else None,
        "created_by_user": format_user_payload(meeting.created_by_user) if meeting.created_by_user else None,
        "participants": meeting.participants or [],
        "attended_participants": attended_participants,
        "attended_participants_count": len(attended_participants),
        "audio_files": meeting.audio_files or [],
        "transcripts": meeting.transcripts or [],
        "transcript_segments": transcript_segments,
        "speaker_mappings": [speaker_mapping_payload(item) for item in speaker_mappings],
        "summaries": meeting.summaries or [],
        "action_items": serialized_action_items,
        "transcript_content": transcript_content,
        "transcript_language": transcript_language,
        "transcript_status": transcript_status,
        "has_transcript_draft": has_transcript_draft,
        "activity": activity,
        "meeting_summary_text": latest_summary.meeting_summary if latest_summary else None,
        "key_points_text": key_points_text,
        "key_points_items": build_anchored_text_items(key_points_text, transcript_segments),
        "decisions_text": decisions_text,
        "decisions_items": build_anchored_text_items(decisions_text, transcript_segments),
        "risks_text": summarize_json_items(latest_summary.risks if latest_summary else None),
        "open_questions_text": summarize_json_items(latest_summary.open_questions if latest_summary else None),
        "timeline_highlights_text": timeline_highlights_text,
        "timeline_highlights_items": build_anchored_text_items(timeline_highlights_text, transcript_segments),
        "speaker_summaries_text": summarize_json_items(latest_summary.speaker_summaries if latest_summary else None),
        "summary_status": summary_status,
        "summary_error_text": summary_error_text,
        "summary_provider": latest_summary_any.ai_provider if latest_summary_any else None,
        "summary_model_name": latest_summary_any.model_name if latest_summary_any else None,
        "access_mode": access_mode,
    }


# ─── Room Snapshot ──────────────────────────────────────────────────────────


def build_room_snapshot(db: Session, meeting_id: str, current_user: models.User) -> Dict[str, Any]:
    from src.api.crud import get_meeting_by_id

    meeting = get_meeting_by_id(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    require_meeting_room_access(db, current_user, meeting)

    messages = db.query(models.MeetingMessage).options(
        joinedload(models.MeetingMessage.user)
    ).filter(
        models.MeetingMessage.meeting_id == meeting_id
    ).order_by(models.MeetingMessage.created_at.asc()).limit(100).all()
    draft = build_transcript_from_drafts(db, meeting_id)
    draft_payload = {
        "transcript": draft["transcript"],
        "segments": draft["segments"],
        "language": draft["language"],
        "chunks": serialize_transcript_draft_chunks(draft["chunks"]),
    }
    latest_transcript = _latest_processed_record(meeting.transcripts or [])
    has_transcript_draft = bool(str(draft["transcript"] or "").strip() or bool(draft["segments"]))
    transcript_status = "COMPLETED" if latest_transcript else "DRAFT" if has_transcript_draft else "EMPTY"
    latest_summary = _latest_processed_record(meeting.summaries or [], fallback_to_any=True)
    participant_records = db.query(models.MeetingParticipant).options(
        joinedload(models.MeetingParticipant.user)
    ).filter(models.MeetingParticipant.meeting_id == meeting_id).all()

    return {
        "type": "room.snapshot",
        "meeting_id": meeting_id,
        "meeting": {
            "id": meeting.id,
            "status": meeting.status,
            "title": meeting.title,
            "code": meeting.code,
            "access_mode": get_meeting_access_mode(db, current_user, meeting),
        },
        "participants": [format_meeting_participant_payload(item) for item in participant_records],
        "online_participants": meeting_room_manager.get_participants(meeting_id),
        "action_items": [serialize_action_item_payload(item) for item in (meeting.action_items or [])],
        "messages": [format_meeting_message_payload(message) for message in messages],
        "transcript": draft_payload,
        "transcript_status": transcript_status,
        "has_transcript_draft": has_transcript_draft,
        "ai_notes": format_summary_payload(latest_summary),
    }


# ─── Broadcast Helpers ──────────────────────────────────────────────────────


def broadcast_meeting_room_event(meeting_id: Optional[str], payload: Dict[str, Any]) -> None:
    if not meeting_id:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(meeting_room_manager.broadcast(meeting_id, payload))
    else:
        loop.create_task(meeting_room_manager.broadcast(meeting_id, payload))


def broadcast_participant_list_event(meeting_id: Optional[str]) -> None:
    from src.api.database import SessionLocal

    if not meeting_id:
        return
    participant_rows: List[Dict[str, Any]] = []
    db = SessionLocal()
    try:
        participant_records = db.query(models.MeetingParticipant).options(
            joinedload(models.MeetingParticipant.user)
        ).filter(models.MeetingParticipant.meeting_id == meeting_id).all()
        participant_rows = [format_meeting_participant_payload(item) for item in participant_records]
    except Exception:
        logger.exception("Failed to build participant list event for meeting %s", meeting_id)
    finally:
        db.close()
    broadcast_meeting_room_event(
        meeting_id,
        {
            "type": "participant.list",
            "meeting_id": meeting_id,
            "participants": meeting_room_manager.get_participants(meeting_id),
            "all_participants": participant_rows,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


# ─── Speaker Mapping ────────────────────────────────────────────────────────


def get_speaker_mapping_dict(db: Session, meeting_id: str) -> Dict[str, str]:
    rows = db.query(models.MeetingSpeakerMapping).filter(
        models.MeetingSpeakerMapping.meeting_id == meeting_id
    ).all()
    return {row.speaker_label: row.display_name for row in rows if row.display_name}


def ensure_speaker_mapping(db: Session, meeting_id: str, speaker_label: str, display_name: Optional[str] = None) -> models.MeetingSpeakerMapping:
    normalized_label = normalize_speaker_label(speaker_label)
    mapping = db.query(models.MeetingSpeakerMapping).filter(
        models.MeetingSpeakerMapping.meeting_id == meeting_id,
        models.MeetingSpeakerMapping.speaker_label == normalized_label,
    ).first()
    if mapping:
        if display_name and mapping.display_name == mapping.speaker_label:
            mapping.display_name = display_name
        return mapping
    mapping = models.MeetingSpeakerMapping(
        meeting_id=meeting_id,
        speaker_label=normalized_label,
        display_name=display_name or normalized_label,
    )
    db.add(mapping)
    db.flush()
    return mapping


def ensure_speaker_identity_mapping(
    db: Session,
    meeting_id: str,
    speaker_label: str,
    *,
    display_name: Optional[str] = None,
    user_id: Optional[str] = None,
) -> models.MeetingSpeakerMapping:
    mapping = ensure_speaker_mapping(db, meeting_id, speaker_label, display_name=display_name)
    if user_id and mapping.user_id != user_id:
        mapping.user_id = user_id
    if display_name and (not mapping.display_name or mapping.display_name == mapping.speaker_label):
        mapping.display_name = display_name
    db.flush()
    return mapping


# ─── Meeting DateTime / Manager ─────────────────────────────────────────────


def normalize_meeting_datetime(value: Optional[datetime]) -> Optional[datetime]:
    if not value:
        return value
    if value.tzinfo:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def require_meeting_manager(db: Session, user: models.User, meeting: models.Meeting) -> None:
    if user.role == "system-admin" or meeting.created_by == user.id:
        return

    org_role = auth.get_user_org_role(db, user, meeting.organization_id)
    if org_role == "org-admin":
        return

    if meeting.group_id and auth.get_user_group_role(db, user, meeting.group_id) == "group-admin":
        return

    raise HTTPException(status_code=403, detail="Bạn không có quyền chỉnh sửa cuộc họp này")
