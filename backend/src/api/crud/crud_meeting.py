import logging
import os
import shutil
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional, Set
from datetime import datetime
import random
import string
import uuid
from .. import models
from ..runtime.app_state import AUDIO_UPLOAD_DIR, LEGACY_AUDIO_UPLOAD_DIR, resolve_audio_storage_path

logger = logging.getLogger(__name__)


def _is_within_audio_roots(path: str) -> bool:
    normalized_path = os.path.normpath(path)
    for root in (AUDIO_UPLOAD_DIR, LEGACY_AUDIO_UPLOAD_DIR):
        normalized_root = os.path.normpath(root)
        try:
            if os.path.commonpath([normalized_path, normalized_root]) == normalized_root:
                return True
        except ValueError:
            continue
    return False


def _collect_meeting_audio_paths(meeting: models.Meeting) -> Set[str]:
    paths: Set[str] = set()

    for audio_file in meeting.audio_files:
        resolved_path = resolve_audio_storage_path(audio_file.file_path)
        if resolved_path and _is_within_audio_roots(resolved_path):
            paths.add(resolved_path)

    for root in (AUDIO_UPLOAD_DIR, LEGACY_AUDIO_UPLOAD_DIR):
        meeting_dir = os.path.join(root, meeting.id)
        if _is_within_audio_roots(meeting_dir):
            paths.add(meeting_dir)

    return paths


def _cleanup_meeting_audio_storage(paths: Set[str]) -> None:
    for path in sorted(paths, key=len, reverse=True):
        try:
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=False)
            elif os.path.isfile(path):
                os.remove(path)
        except FileNotFoundError:
            continue
        except OSError as exc:
            logger.warning("Failed to remove meeting audio path %s: %s", path, exc)


def generate_meeting_code(db: Session) -> str:
    """Generate a unique 3x3 meeting code (e.g. ABC-DEF-GHI)."""
    chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        parts = []
        for _ in range(3):
            parts.append("".join(random.choice(chars) for _ in range(3)))
        code = "-".join(parts)
        existing = db.query(models.Meeting).filter(models.Meeting.code == code).first()
        if not existing:
            return code


def check_meeting_overlap(
    db: Session,
    participant_ids: List[str],
    scheduled_start: datetime,
    scheduled_end: datetime,
    exclude_meeting_id: Optional[str] = None,
) -> List[dict]:
    if not participant_ids or not scheduled_start or not scheduled_end:
        return []

    overlapping = (
        db.query(models.Meeting)
        .filter(
            models.Meeting.status.in_(["upcoming", "live"]),
            models.Meeting.scheduled_start.isnot(None),
            models.Meeting.scheduled_end.isnot(None),
            models.Meeting.scheduled_start < scheduled_end,
            models.Meeting.scheduled_end > scheduled_start,
        )
    )
    if exclude_meeting_id:
        overlapping = overlapping.filter(models.Meeting.id != exclude_meeting_id)

    overlapping = overlapping.all()
    if not overlapping:
        return []

    conflicts = []
    participant_set = set(participant_ids)
    for m in overlapping:
        meeting_participant_ids = {p.user_id for p in m.participants if p.user_id}
        conflicting_users = meeting_participant_ids.intersection(participant_set)
        if conflicting_users:
            conflicts.append({
                "meeting_id": m.id,
                "meeting_title": m.title,
                "scheduled_start": m.scheduled_start.isoformat(),
                "scheduled_end": m.scheduled_end.isoformat(),
                "conflicting_user_ids": list(conflicting_users),
            })

    return conflicts


def get_meeting_by_id(db: Session, meeting_id: str) -> Optional[models.Meeting]:
    return db.query(models.Meeting).options(
        joinedload(models.Meeting.organization),
        joinedload(models.Meeting.group).joinedload(models.Group.memberships),
        joinedload(models.Meeting.created_by_user),
        joinedload(models.Meeting.participants).joinedload(models.MeetingParticipant.user),
        joinedload(models.Meeting.audio_files),
        joinedload(models.Meeting.transcripts),
        joinedload(models.Meeting.summaries),
        joinedload(models.Meeting.action_items).joinedload(models.ActionItem.assignees).joinedload(models.ActionItemAssignee.user),
        joinedload(models.Meeting.speaker_mappings),
    ).filter(models.Meeting.id == meeting_id).first()


def get_meetings(
    db: Session,
    organization_id: Optional[str] = None,
    group_id: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100
) -> List[models.Meeting]:
    query = db.query(models.Meeting).options(
        joinedload(models.Meeting.organization),
        joinedload(models.Meeting.group),
        joinedload(models.Meeting.created_by_user)
    )
    
    if organization_id:
        query = query.filter(models.Meeting.organization_id == organization_id)

    if group_id:
        query = query.filter(models.Meeting.group_id == group_id)

    if status:
        query = query.filter(models.Meeting.status == status)
    
    return query.order_by(models.Meeting.created_at.desc()).offset(skip).limit(limit).all()


def create_meeting(db: Session, meeting_data: dict, created_by: str) -> models.Meeting:
    code = meeting_data.get("code") or generate_meeting_code(db)
    db_meeting = models.Meeting(
        id=meeting_data.get("id", str(uuid.uuid4())),
        organization_id=meeting_data.get("organization_id"),
        group_id=meeting_data.get("group_id"),
        title=meeting_data["title"],
        description=meeting_data.get("description"),
        scheduled_start=meeting_data.get("scheduled_start"),
        scheduled_end=meeting_data.get("scheduled_end"),
        actual_start=meeting_data.get("actual_start"),
        actual_end=meeting_data.get("actual_end"),
        duration=meeting_data.get("duration", 0),
        location=meeting_data.get("location"),
        meeting_type=meeting_data.get("meeting_type", "MEETING"),
        status=meeting_data.get("status", "upcoming"),
        code=code,
        recording_url=meeting_data.get("recording_url"),
        transcript_url=meeting_data.get("transcript_url"),
        audio_url=meeting_data.get("audio_url"),
        is_pinned=meeting_data.get("is_pinned", False),
        created_by=created_by,
    )
    # Auto-compute duration from scheduled times if not set
    if db_meeting.duration == 0 and db_meeting.scheduled_start and db_meeting.scheduled_end:
        db_meeting.duration = max(0, int((db_meeting.scheduled_end - db_meeting.scheduled_start).total_seconds() / 60))
    db.add(db_meeting)
    db.commit()
    db.refresh(db_meeting)
    return db_meeting


VALID_STATUS_TRANSITIONS = {
    "upcoming": ["live", "canceled"],
    "live": ["processing", "completed", "canceled"],
    "processing": ["completed", "failed"],
    "completed": [],
    "failed": ["processing"],  # retry
    "canceled": [],
    "queued": ["processing", "canceled"],
}


def update_meeting(db: Session, meeting_id: str, updates: dict) -> models.Meeting:
    db_meeting = get_meeting_by_id(db, meeting_id)
    if not db_meeting:
        return None

    new_status = updates.get("status")
    if new_status and new_status != db_meeting.status:
        allowed = VALID_STATUS_TRANSITIONS.get(db_meeting.status, [])
        if new_status not in allowed:
            raise ValueError(f"Cannot transition from '{db_meeting.status}' to '{new_status}'")

    for key, value in updates.items():
        if hasattr(db_meeting, key):
            setattr(db_meeting, key, value)

    db.commit()
    db.refresh(db_meeting)
    return db_meeting


def delete_meeting(db: Session, meeting_id: str) -> bool:
    db_meeting = get_meeting_by_id(db, meeting_id)
    if not db_meeting:
        return False

    audio_paths = _collect_meeting_audio_paths(db_meeting)

    db.delete(db_meeting)
    db.commit()
    _cleanup_meeting_audio_storage(audio_paths)
    return True


def add_meeting_participant(
    db: Session,
    meeting_id: str,
    user_id: Optional[str] = None,
    email: Optional[str] = None,
    name: Optional[str] = None,
    speaker_label: Optional[str] = None,
    role: str = "PARTICIPANT",
    invite_status: str = "accepted",
) -> Optional[models.MeetingParticipant]:
    # Check if participant already exists
    if user_id:
        existing = db.query(models.MeetingParticipant).filter(
            models.MeetingParticipant.meeting_id == meeting_id,
            models.MeetingParticipant.user_id == user_id
        ).first()
        if existing:
            return existing
    elif email:
        existing = db.query(models.MeetingParticipant).filter(
            models.MeetingParticipant.meeting_id == meeting_id,
            models.MeetingParticipant.email == email
        ).first()
        if existing:
            return existing
    
    db_participant = models.MeetingParticipant(
        id=str(uuid.uuid4()),
        meeting_id=meeting_id,
        user_id=user_id,
        email=email,
        name=name,
        speaker_label=speaker_label,
        role=role,
        invite_status=invite_status,
    )
    db.add(db_participant)
    db.commit()
    db.refresh(db_participant)
    return db_participant


def remove_meeting_participant(db: Session, meeting_id: str, user_id: Optional[str] = None, email: Optional[str] = None) -> bool:
    query = db.query(models.MeetingParticipant).filter(
        models.MeetingParticipant.meeting_id == meeting_id
    )
    
    if user_id:
        query = query.filter(models.MeetingParticipant.user_id == user_id)
    elif email:
        query = query.filter(models.MeetingParticipant.email == email)
    else:
        return False
    
    db_participant = query.first()
    if not db_participant:
        return False
    
    db.delete(db_participant)
    db.commit()
    return True


def update_meeting_status(db: Session, meeting_id: str, status: str) -> Optional[models.Meeting]:
    return update_meeting(db, meeting_id, {"status": status})
