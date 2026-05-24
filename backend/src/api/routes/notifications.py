from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api import auth
from src.api.domains.notifications.operations import (
    dismiss_notification_payload,
    get_notifications_payload,
    mark_all_notifications_read_payload,
    mark_notification_read_payload,
)
from src.api.database import get_db

router = APIRouter(tags=["notifications"])


@router.get("/api/notifications")
def get_notifications(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_notifications_payload(db, current_user)


@router.patch("/api/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return mark_notification_read_payload(notification_id, db, current_user)


@router.post("/api/notifications/read-all")
def mark_all_notifications_read(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return mark_all_notifications_read_payload(db, current_user)


@router.delete("/api/notifications/{notification_id}")
def dismiss_notification(
    notification_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return dismiss_notification_payload(notification_id, db, current_user)
