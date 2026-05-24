from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from src.api import auth, models
from src.api.crud import get_user_by_email, get_user_by_id
from src.api.domains.meetings.operations import (
    _anchor_from_segments,
    _latest_processed_record,
    broadcast_meeting_room_event,
    transcript_segment_response_payloads,
)


def action_item_visible_to_user(db: Session, action_item: models.ActionItem, user: models.User) -> bool:
    if user.role == "system-admin":
        return True
    if action_item.created_by == user.id:
        return True
    if action_item_assigned_to_user(action_item, user):
        return True
    if action_item.meeting_id:
        meeting = db.query(models.Meeting).filter(models.Meeting.id == action_item.meeting_id).first()
        return bool(meeting and auth.get_user_org_role(db, user, meeting.organization_id))
    return False


def action_item_assigned_to_user(action_item: models.ActionItem, user: models.User) -> bool:
    if any(assignee.user_id == user.id for assignee in action_item.assignees or [] if assignee.user_id):
        return True
    user_email = (user.email or "").lower()
    if user_email and any((assignee.email or "").lower() == user_email for assignee in action_item.assignees or []):
        return True
    if action_item.assigned_to == user.id:
        return True
    return bool(action_item.assigned_email and user_email and action_item.assigned_email.lower() == user_email)


def action_item_manager_error_detail(meeting: models.Meeting) -> str:
    if meeting.group_id:
        return "Group admin access required for this meeting's tasks"
    return "Org admin access required for ungrouped meeting tasks"


def can_manage_action_items_for_meeting(
    db: Session,
    user: models.User,
    meeting: models.Meeting,
) -> bool:
    if user.role == "system-admin":
        return True
    if meeting.group_id:
        return auth.get_user_group_role(db, user, meeting.group_id) == "group-admin"
    return auth.get_user_org_role(db, user, meeting.organization_id) == "org-admin"


def require_action_item_manager_for_meeting(
    db: Session,
    user: models.User,
    meeting: models.Meeting,
) -> None:
    if not can_manage_action_items_for_meeting(db, user, meeting):
        raise HTTPException(status_code=403, detail=action_item_manager_error_detail(meeting))


def action_item_manageable_by_user(db: Session, action_item: models.ActionItem, user: models.User) -> bool:
    if user.role == "system-admin":
        return True
    if not action_item.meeting_id:
        return action_item.created_by == user.id
    meeting = db.query(models.Meeting).filter(models.Meeting.id == action_item.meeting_id).first()
    return bool(meeting and can_manage_action_items_for_meeting(db, user, meeting))


def meeting_participant_assignee_options(meeting: Optional[models.Meeting]) -> List[Dict[str, Optional[str]]]:
    if not meeting:
        return []
    options: Dict[str, Dict[str, Optional[str]]] = {}
    for participant in meeting.participants or []:
        if participant.invite_status == "declined":
            continue
        user = participant.user
        email = participant.email or (user.email if user else "") or ""
        email = email.strip()
        if not email:
            continue
        name = (
            participant.name
            or (" ".join(part for part in [user.first_name, user.last_name] if part).strip() if user else "")
            or (user.username if user else "")
            or email
        )
        options[email.lower()] = {
            "email": email,
            "label": name,
            "user_id": participant.user_id,
        }
    return sorted(options.values(), key=lambda option: (option["label"] or option["email"] or "").lower())


def attach_action_item_display_data(action_item: models.ActionItem) -> models.ActionItem:
    meeting = getattr(action_item, "meeting", None)
    setattr(action_item, "meeting_title", meeting.title if meeting else None)
    setattr(action_item, "assignee_options", meeting_participant_assignee_options(meeting))
    return action_item


def serialize_action_item_assignee_payload(assignee: models.ActionItemAssignee) -> Dict[str, Any]:
    return {
        "id": assignee.id,
        "user_id": assignee.user_id,
        "email": assignee.email,
        "display_name": assignee.display_name or (assignee.user.email if assignee.user else assignee.email),
        "status": assignee.status,
        "completed_at": assignee.completed_at,
        "created_at": assignee.created_at,
        "updated_at": assignee.updated_at,
    }


def serialize_action_item_payload(action_item: models.ActionItem) -> Dict[str, Any]:
    attach_action_item_display_data(action_item)
    assignees = sorted(
        action_item.assignees or [],
        key=lambda item: (
            (item.display_name or item.email or "").lower(),
            (item.email or "").lower(),
        ),
    )
    first_assignee = assignees[0] if assignees else None
    meeting = getattr(action_item, "meeting", None)
    speaker_map = {
        mapping.speaker_label: mapping.display_name
        for mapping in (meeting.speaker_mappings or [])
        if mapping.display_name
    } if meeting else {}
    transcript = _latest_processed_record(meeting.transcripts or []) if meeting else None
    transcript_segments = transcript_segment_response_payloads(transcript, speaker_map) if transcript else []
    return {
        "id": action_item.id,
        "meeting_id": action_item.meeting_id,
        "meeting_title": getattr(action_item, "meeting_title", None),
        "assignee_options": getattr(action_item, "assignee_options", []),
        "assignees": [serialize_action_item_assignee_payload(item) for item in assignees],
        "summary_id": action_item.summary_id,
        "anchor": _anchor_from_segments(
            action_item.title,
            transcript_segments,
            preferred_speaker=first_assignee.display_name if first_assignee else None,
        ),
        "title": action_item.title,
        "description": action_item.description,
        "assigned_to": first_assignee.user_id if first_assignee else action_item.assigned_to,
        "assigned_email": first_assignee.email if first_assignee else action_item.assigned_email,
        "status": action_item.status,
        "priority": action_item.priority,
        "due_date": action_item.due_date,
        "completed_at": action_item.completed_at,
        "created_by": action_item.created_by,
        "created_at": action_item.created_at,
        "updated_at": action_item.updated_at,
    }


def _blank_to_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _meeting_participant_assignee_lookup(meeting: Optional[models.Meeting]) -> Dict[str, Dict[str, Optional[str]]]:
    return {option["email"].lower(): option for option in meeting_participant_assignee_options(meeting)}


def _resolve_single_assignee(
    db: Session,
    assignee_input: Dict[str, Any],
    meeting: Optional[models.Meeting],
) -> Optional[Dict[str, Any]]:
    resolved = dict(assignee_input)
    resolved["email"] = _blank_to_none(resolved.get("email") or resolved.get("assigned_email"))
    resolved["user_id"] = _blank_to_none(resolved.get("user_id") or resolved.get("assigned_to"))
    resolved["display_name"] = _blank_to_none(resolved.get("display_name"))
    if not resolved["email"] and not resolved["user_id"]:
        return None

    participant_lookup = _meeting_participant_assignee_lookup(meeting)
    assigned_to = resolved.get("user_id")
    if assigned_to:
        assignee = get_user_by_id(db, assigned_to)
        if not assignee:
            raise HTTPException(status_code=400, detail="Assigned user not found")
        if meeting and not auth.get_user_org_role(db, assignee, meeting.organization_id):
            raise HTTPException(status_code=400, detail="Assigned user must belong to the meeting organization")
        resolved["email"] = assignee.email
        resolved["display_name"] = resolved["display_name"] or " ".join(
            part for part in [assignee.first_name, assignee.last_name] if part
        ).strip() or assignee.username or assignee.email
        if meeting and assignee.email.lower() not in participant_lookup:
            raise HTTPException(status_code=400, detail="Assignee must belong to the meeting participants")
        return resolved

    email = resolved.get("email")
    if not email:
        return None

    if meeting and email.lower() not in participant_lookup:
        raise HTTPException(status_code=400, detail="Assignee must belong to the meeting participants")

    assignee = get_user_by_email(db, email)
    if assignee and (not meeting or auth.get_user_org_role(db, assignee, meeting.organization_id)):
        resolved["user_id"] = assignee.id
        resolved["email"] = assignee.email
        resolved["display_name"] = resolved["display_name"] or " ".join(
            part for part in [assignee.first_name, assignee.last_name] if part
        ).strip() or assignee.username or assignee.email
    elif meeting:
        participant_info = participant_lookup.get(email.lower())
        if participant_info:
            resolved["display_name"] = resolved["display_name"] or participant_info.get("label")
            resolved["user_id"] = participant_info.get("user_id")
    return resolved


def resolve_action_item_assignees(
    db: Session,
    payload: Dict[str, Any],
    meeting: Optional[models.Meeting],
    current_assignees: Optional[List[models.ActionItemAssignee]] = None,
) -> Dict[str, Any]:
    resolved = dict(payload)
    assignees_payload = payload.get("assignees")
    assignee_user_ids = payload.get("assignee_user_ids") or []
    assignee_emails = payload.get("assignee_emails") or []
    assign_all = bool(payload.get("assign_all_participants"))

    assignee_candidates: List[Dict[str, Any]] = []
    if assignees_payload is not None:
        assignee_candidates.extend([item for item in assignees_payload if isinstance(item, dict)])
    for user_id in assignee_user_ids:
        assignee_candidates.append({"user_id": user_id})
    for email in assignee_emails:
        assignee_candidates.append({"email": email})
    if "assigned_to" in payload or "assigned_email" in payload:
        assignee_candidates.append({
            "user_id": payload.get("assigned_to"),
            "email": payload.get("assigned_email"),
        })

    if assign_all:
        if not meeting:
            raise HTTPException(status_code=400, detail="assign_all_participants requires a meeting_id")
        assignee_candidates.extend([
            {
                "user_id": option.get("user_id"),
                "email": option["email"],
                "display_name": option.get("label"),
            }
            for option in meeting_participant_assignee_options(meeting)
        ])

    resolved_assignees: List[Dict[str, Any]] = []
    seen = set()
    if assignees_payload is not None or assignee_user_ids or assignee_emails or "assigned_to" in payload or "assigned_email" in payload or assign_all:
        current_status_by_email = {
            (assignee.email or "").lower(): {
                "status": assignee.status,
                "completed_at": assignee.completed_at,
            }
            for assignee in (current_assignees or [])
            if assignee.email
        }
        for candidate in assignee_candidates:
            normalized = _resolve_single_assignee(db, candidate, meeting)
            if not normalized:
                continue
            email_key = normalized["email"].lower()
            if email_key in seen:
                continue
            seen.add(email_key)
            preserved = current_status_by_email.get(email_key)
            normalized["status"] = normalized.get("status") or (preserved["status"] if preserved else "PENDING")
            normalized["completed_at"] = normalized.get("completed_at") if "completed_at" in normalized else (preserved["completed_at"] if preserved else None)
            resolved_assignees.append(normalized)
    else:
        resolved_assignees = [
            {
                "user_id": assignee.user_id,
                "email": assignee.email,
                "display_name": assignee.display_name,
                "status": assignee.status,
                "completed_at": assignee.completed_at,
            }
            for assignee in (current_assignees or [])
        ]

    if not meeting and len(resolved_assignees) > 1:
        raise HTTPException(status_code=400, detail="Personal tasks support at most one assignee")

    resolved["assignees"] = resolved_assignees
    first_assignee = resolved_assignees[0] if resolved_assignees else None
    resolved["assigned_to"] = first_assignee.get("user_id") if first_assignee else None
    resolved["assigned_email"] = first_assignee.get("email") if first_assignee else None
    return resolved


def broadcast_action_item_updated(action_item: models.ActionItem) -> None:
    if not action_item.meeting_id:
        return
    broadcast_meeting_room_event(
        action_item.meeting_id,
        {
            "type": "action_item.updated",
            "meeting_id": action_item.meeting_id,
            "action_item": serialize_action_item_payload(action_item),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


def broadcast_action_item_deleted(meeting_id: Optional[str], action_item_id: str) -> None:
    if not meeting_id:
        return
    broadcast_meeting_room_event(
        meeting_id,
        {
            "type": "action_item.deleted",
            "meeting_id": meeting_id,
            "action_item_id": action_item_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
