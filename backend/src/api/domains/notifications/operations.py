from datetime import datetime, timezone
from typing import Any, Dict, List

from sqlalchemy.orm import Session

from src.api import models
from src.api.domains.notifications.support import RUNTIME_NOTIFICATIONS, normalize_notification_metadata, notification_payload
from src.api.domains.shared.user_payloads import meeting_participant_meeting_ids_for_user, user_org_ids


def get_notifications_payload(db: Session, current_user: models.User) -> List[Dict[str, Any]]:
    """Get in-app notifications for the current user based on real meeting activity."""
    persisted_notifications = db.query(models.Notification).filter(
        models.Notification.recipient_user_id == current_user.id,
    ).order_by(models.Notification.created_at.desc()).limit(50).all()
    notifications = [notification_payload(notification) for notification in persisted_notifications]
    now = datetime.now()

    query = db.query(models.Meeting)
    if current_user.role != "system-admin":
        org_ids = user_org_ids(current_user)
        if not org_ids:
            return []
        query = query.filter(models.Meeting.organization_id.in_(org_ids))
    meetings = query.order_by(models.Meeting.created_at.desc()).limit(20).all()

    for m in meetings:
        created_at = m.created_at or now
        # Notification: meeting was recently created
        diff_hours = (now - created_at).total_seconds() / 3600
        if diff_hours < 48:
            priority = "urgent" if diff_hours < 2 else "today" if diff_hours < 24 else "recent"
            notifications.append({
                "id": f"created-{m.id}",
                "type": "meeting",
                "priority": priority,
                "title": "Cuộc họp mới được tạo",
                "message": f'"{m.title}" đã được tạo thành công.',
                "timestamp": created_at.isoformat(),
                "isRead": False,
                "metadata": normalize_notification_metadata({
                    "entity_type": "meeting",
                    "meeting_id": m.id,
                    "group_id": m.group_id,
                    "organization_id": m.organization_id,
                }),
            })

        # Notification: upcoming scheduled meeting
        if m.scheduled_start:
            diff_start = (m.scheduled_start - now).total_seconds() / 3600
            if 0 < diff_start < 24:
                notifications.append({
                    "id": f"upcoming-{m.id}",
                    "type": "meeting",
                    "priority": "urgent" if diff_start < 1 else "today",
                    "title": "Cuộc họp sắp diễn ra",
                    "message": f'"{m.title}" sẽ bắt đầu trong {int(diff_start * 60)} phút.',
                    "timestamp": m.scheduled_start.isoformat(),
                    "isRead": False,
                    "metadata": normalize_notification_metadata({
                        "entity_type": "meeting",
                        "meeting_id": m.id,
                        "group_id": m.group_id,
                        "organization_id": m.organization_id,
                    }),
                })

        # Notification: completed meeting
        if m.status == "completed" and m.scheduled_end:
            diff_end = (now - m.scheduled_end).total_seconds() / 3600
            if diff_end < 48:
                notifications.append({
                    "id": f"done-{m.id}",
                    "type": "meeting",
                    "priority": "recent",
                    "title": "Cuộc họp đã kết thúc",
                    "message": f'"{m.title}" đã hoàn thành. AI đang xử lý biên bản.',
                    "timestamp": m.scheduled_end.isoformat(),
                    "isRead": True,
                    "metadata": normalize_notification_metadata({
                        "entity_type": "meeting",
                        "meeting_id": m.id,
                        "group_id": m.group_id,
                        "organization_id": m.organization_id,
                    }),
                })

    runtime_for_user = [
        {
            **item,
            "metadata": normalize_notification_metadata(item.get("metadata")),
        }
        for item in RUNTIME_NOTIFICATIONS if item.get("recipient_user_id") == current_user.id
    ]
    notifications.extend(runtime_for_user)

    # Sort by timestamp descending
    notifications.sort(key=lambda x: x["timestamp"], reverse=True)
    return notifications


def mark_notification_read_payload(notification_id: str, db: Session, current_user: models.User) -> Dict[str, Any]:
    notification = db.query(models.Notification).filter(
        models.Notification.id == notification_id,
        models.Notification.recipient_user_id == current_user.id,
    ).first()
    if not notification:
        return {"message": "Notification is not persisted"}

    notification.is_read = True
    notification.read_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(notification)
    return notification_payload(notification)


def mark_all_notifications_read_payload(db: Session, current_user: models.User) -> Dict[str, str]:
    db.query(models.Notification).filter(
        models.Notification.recipient_user_id == current_user.id,
        models.Notification.is_read == False,
    ).update(
        {"is_read": True, "read_at": datetime.now(timezone.utc)},
        synchronize_session=False,
    )
    db.commit()
    return {"message": "Notifications marked as read"}


def dismiss_notification_payload(notification_id: str, db: Session, current_user: models.User) -> Dict[str, str]:
    notification = db.query(models.Notification).filter(
        models.Notification.id == notification_id,
        models.Notification.recipient_user_id == current_user.id,
    ).first()
    if not notification:
        return {"message": "Notification is not persisted"}

    db.delete(notification)
    db.commit()
    return {"message": "Notification dismissed"}
