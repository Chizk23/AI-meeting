from typing import Any, Dict, List

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from src.api import models
from src.api.domains.shared.user_payloads import (
    meeting_participant_meeting_ids_for_user,
    user_org_ids,
)
from src.api.domains.meetings.support import normalize_speaker_label
from src.api.domains.action_items.support import action_item_visible_to_user, serialize_action_item_payload


def search_entities_payload(q: str, db: Session, current_user: models.User) -> List[Dict[str, Any]]:
    term = q.strip()
    if len(term) < 2:
        return []

    lowered = f"%{term.lower()}%"
    results: List[Dict[str, Any]] = []

    meeting_query = db.query(models.Meeting)
    if current_user.role != "system-admin":
        org_ids = user_org_ids(current_user)
        participant_ids = meeting_participant_meeting_ids_for_user(db, current_user)
        if not org_ids:
            meeting_query = meeting_query.filter(models.Meeting.id.in_(participant_ids))
        else:
            meeting_query = meeting_query.filter(
                or_(
                    models.Meeting.organization_id.in_(org_ids),
                    models.Meeting.id.in_(participant_ids),
                )
            )

    meetings = meeting_query.filter(
        or_(
            func.lower(models.Meeting.title).like(lowered),
            func.lower(func.coalesce(models.Meeting.description, "")).like(lowered),
        )
    ).order_by(models.Meeting.updated_at.desc(), models.Meeting.created_at.desc()).limit(8).all()
    for meeting in meetings:
        results.append({
            "id": meeting.id,
            "type": "meeting",
            "title": meeting.title,
            "subtitle": meeting.group.name if meeting.group else meeting.organization.name if meeting.organization else "Cuộc họp",
            "route": f"/meetings/{meeting.id}",
            "context": {"initial_tab": "summary"},
        })

    group_query = db.query(models.Group)
    if current_user.role != "system-admin":
        org_ids = user_org_ids(current_user)
        if not org_ids:
            group_query = group_query.filter(models.Group.id == "__none__")
        else:
            group_query = group_query.filter(models.Group.organization_id.in_(org_ids))
    groups = group_query.filter(
        or_(
            func.lower(models.Group.name).like(lowered),
            func.lower(func.coalesce(models.Group.description, "")).like(lowered),
        )
    ).order_by(models.Group.updated_at.desc(), models.Group.created_at.desc()).limit(6).all()
    for group in groups:
        results.append({
            "id": group.id,
            "type": "group",
            "title": group.name,
            "subtitle": group.description or "Nhóm làm việc",
            "route": f"/groups/{group.id}",
            "context": {},
        })

    action_items = db.query(models.ActionItem).options(
        joinedload(models.ActionItem.meeting),
        joinedload(models.ActionItem.assignees),
    ).order_by(models.ActionItem.updated_at.desc(), models.ActionItem.created_at.desc()).limit(200).all()
    task_hits = 0
    for item in action_items:
        haystack = " ".join([
            item.title or "",
            item.description or "",
            item.meeting.title if item.meeting else "",
            " ".join(filter(None, [assignee.display_name or assignee.email for assignee in (item.assignees or [])])),
        ]).lower()
        if term.lower() not in haystack:
            continue
        if not action_item_visible_to_user(db, item, current_user):
            continue
        results.append({
            "id": item.id,
            "type": "task",
            "title": item.title,
            "subtitle": item.meeting.title if item.meeting else "Việc cá nhân",
            "route": f"/meetings/{item.meeting_id}" if item.meeting_id else "/actions",
            "context": {
                "initial_tab": "actions" if item.meeting_id else None,
                "meeting_id": item.meeting_id,
                "transcript_anchor": serialize_action_item_payload(item).get("anchor"),
            },
        })
        task_hits += 1
        if task_hits >= 8:
            break

    transcript_query = db.query(models.TranscriptSegment, models.Transcript, models.Meeting).join(
        models.Transcript, models.Transcript.id == models.TranscriptSegment.transcript_id,
    ).join(
        models.Meeting, models.Meeting.id == models.Transcript.meeting_id,
    )
    if current_user.role != "system-admin":
        org_ids = user_org_ids(current_user)
        participant_ids = meeting_participant_meeting_ids_for_user(db, current_user)
        if not org_ids:
            transcript_query = transcript_query.filter(models.Meeting.id.in_(participant_ids))
        else:
            transcript_query = transcript_query.filter(
                or_(
                    models.Meeting.organization_id.in_(org_ids),
                    models.Meeting.id.in_(participant_ids),
                )
            )
    transcript_hits = transcript_query.filter(
        func.lower(models.TranscriptSegment.text).like(lowered)
    ).order_by(models.TranscriptSegment.created_at.desc()).limit(8).all()
    for segment, transcript, meeting in transcript_hits:
        speaker_label = normalize_speaker_label(segment.speaker_label or "Speaker_01")
        display_name = next(
            (mapping.display_name for mapping in (meeting.speaker_mappings or []) if mapping.speaker_label == speaker_label and mapping.display_name),
            speaker_label,
        )
        snippet = (segment.text or "").strip()
        if len(snippet) > 120:
            snippet = snippet[:117].rstrip() + "..."
        results.append({
            "id": f"segment:{segment.id}",
            "type": "transcript",
            "title": meeting.title,
            "subtitle": f"{display_name}: {snippet}",
            "route": f"/meetings/{meeting.id}",
            "context": {
                "meeting_id": meeting.id,
                "initial_tab": "transcript",
                "transcript_anchor": {
                    "start_time": float(segment.start_time or 0),
                    "end_time": float(segment.end_time or 0),
                    "speaker_label": display_name,
                    "source_segment_ids": [segment.id],
                },
            },
        })

    deduped: List[Dict[str, Any]] = []
    seen = set()
    for item in results:
        key = (item["type"], item["id"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped[:20]
