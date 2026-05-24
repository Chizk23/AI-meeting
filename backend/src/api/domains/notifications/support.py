"""Notification runtime: in-memory queue, persistence, and helpers."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from src.api import models
from src.api.database import SessionLocal

RUNTIME_NOTIFICATIONS: List[Dict[str, Any]] = []
MAX_RUNTIME_NOTIFICATIONS = 500


def push_runtime_notification(notification: Dict[str, Any]) -> None:
    RUNTIME_NOTIFICATIONS.append(notification)
    if len(RUNTIME_NOTIFICATIONS) > MAX_RUNTIME_NOTIFICATIONS:
        del RUNTIME_NOTIFICATIONS[:-MAX_RUNTIME_NOTIFICATIONS]


def normalize_notification_metadata(
    metadata: Optional[Dict[str, Any]] = None,
    *,
    source_type: Optional[str] = None,
    source_id: Optional[str] = None,
) -> Dict[str, Any]:
    raw = dict(metadata or {})
    entity_type = (
        raw.get("entity_type")
        or source_type
        or raw.get("type")
        or ("task" if raw.get("task_id") or raw.get("taskId") else None)
        or ("group" if raw.get("group_id") or raw.get("groupId") else None)
        or ("meeting" if raw.get("meeting_id") or raw.get("meetingId") else None)
        or ("invitation" if raw.get("invitationId") else None)
        or "system"
    )
    meeting_id = raw.get("meeting_id") or raw.get("meetingId")
    group_id = raw.get("group_id") or raw.get("groupId")
    task_id = raw.get("task_id") or raw.get("taskId")
    organization_id = raw.get("organization_id") or raw.get("organizationId")
    action_label = raw.get("action_label")

    if not action_label:
        action_label = {
            "meeting": "Mở cuộc họp",
            "task": "Mở việc",
            "group": "Mở nhóm",
            "invitation": "Xem lời mời",
            "system": "Xem chi tiết",
        }.get(str(entity_type), "Xem chi tiết")

    normalized = {
        **raw,
        "entity_type": entity_type,
        "meeting_id": meeting_id,
        "group_id": group_id,
        "task_id": task_id,
        "organization_id": organization_id,
        "action_label": action_label,
    }
    if source_id and entity_type in {"meeting", "task", "group", "invitation"}:
        key = f"{entity_type}_id"
        if not normalized.get(key):
            normalized[key] = source_id
    return normalized


def notification_payload(notification: models.Notification) -> Dict[str, Any]:
    return {
        "id": notification.id,
        "type": notification.type,
        "priority": notification.priority,
        "title": notification.title,
        "message": notification.message,
        "timestamp": (notification.created_at or datetime.now(timezone.utc)).isoformat(),
        "isRead": bool(notification.is_read),
        "metadata": normalize_notification_metadata(
            notification.metadata_json,
            source_type=notification.source_type,
            source_id=notification.source_id,
        ),
    }


def create_persisted_notification(
    db,
    *,
    recipient_user_id: str,
    notification_type: str,
    priority: str,
    title: str,
    message: str,
    metadata: Optional[Dict[str, Any]] = None,
    source_type: Optional[str] = None,
    source_id: Optional[str] = None,
    commit: bool = True,
) -> models.Notification:
    existing = None
    if source_type and source_id:
        existing = db.query(models.Notification).filter(
            models.Notification.recipient_user_id == recipient_user_id,
            models.Notification.source_type == source_type,
            models.Notification.source_id == source_id,
        ).first()
    if existing:
        return existing

    notification = models.Notification(
        recipient_user_id=recipient_user_id,
        type=notification_type,
        priority=priority,
        title=title,
        message=message,
        metadata_json=normalize_notification_metadata(metadata, source_type=source_type, source_id=source_id),
        source_type=source_type,
        source_id=source_id,
    )
    db.add(notification)
    if commit:
        db.commit()
        db.refresh(notification)
    else:
        db.flush()
    return notification


def get_org_admin_recipient_ids(db, organization_id: str, actor_user_id: str) -> List[str]:
    recipients = db.query(models.UserOrganization.user_id).filter(
        models.UserOrganization.organization_id == organization_id,
        models.UserOrganization.role == "org-admin",
        models.UserOrganization.user_id != actor_user_id,
    ).all()
    return [item[0] for item in recipients]
