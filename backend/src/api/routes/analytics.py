from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api import auth
from src.api.domains.admin.analytics import (
    get_meeting_analytics_payload,
    get_performance_analytics_payload,
    get_stats_payload,
)
from src.api.database import get_db

router = APIRouter(tags=["analytics"])


@router.get("/api/analytics/meetings")
def get_meeting_analytics(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_meeting_analytics_payload(db, current_user)


@router.get("/api/analytics/performance")
def get_performance_analytics():
    return get_performance_analytics_payload()


@router.get("/api/dashboard/stats")
def get_stats(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_stats_payload(db, current_user)
