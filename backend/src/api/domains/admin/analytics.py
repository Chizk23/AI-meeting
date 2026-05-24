from datetime import datetime, timedelta
from typing import Any, Dict

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from src.api import models
from src.api.core.user_payloads import user_org_ids
from src.api.domains.admin.operations import ADMIN_SYSTEM_SETTINGS


def get_meeting_analytics_payload(db: Session, current_user: models.User) -> Dict[str, Any]:
    # Meetings over time (last 30 days)
    thirty_days_ago = datetime.now() - timedelta(days=30)
    org_ids = user_org_ids(current_user)
    base_query = db.query(models.Meeting)
    if current_user.role != "system-admin" and org_ids:
        base_query = base_query.filter(models.Meeting.organization_id.in_(org_ids))

    meetings_over_time = {}
    rows = (
        base_query
        .filter(models.Meeting.created_at >= thirty_days_ago)
        .with_entities(
            func.date(models.Meeting.created_at).label("day"),
            func.count().label("cnt"),
        )
        .group_by(func.date(models.Meeting.created_at))
        .all()
    )
    for row in rows:
        meetings_over_time[str(row.day)] = row.cnt

    # Status distribution
    status_rows = (
        base_query
        .with_entities(models.Meeting.status, func.count())
        .group_by(models.Meeting.status)
        .all()
    )
    provider_distribution = {str(s): c for s, c in status_rows}

    # Top action item owners
    action_rows = (
        db.query(
            func.coalesce(
                models.ActionItemAssignee.display_name,
                models.ActionItemAssignee.email,
            ),
            func.count(),
        )
        .filter(models.ActionItemAssignee.email.isnot(None))
        .group_by(
            func.coalesce(
                models.ActionItemAssignee.display_name,
                models.ActionItemAssignee.email,
            )
        )
        .order_by(func.count().desc())
        .limit(10)
        .all()
    )
    top_action_owners = {str(name or "Chưa gán"): c for name, c in action_rows}

    # Topic trends (from meeting titles - simple word frequency)
    topic_rows = (
        base_query
        .filter(models.Meeting.status == "completed")
        .with_entities(models.Meeting.title)
        .order_by(models.Meeting.created_at.desc())
        .limit(100)
        .all()
    )
    topic_trends: Dict[str, int] = {}
    for (title,) in topic_rows:
        if title:
            topic_trends[title[:30]] = topic_trends.get(title[:30], 0) + 1
    # Sort by count and take top 8
    topic_trends = dict(sorted(topic_trends.items(), key=lambda x: x[1], reverse=True)[:8])

    return {
        "total_meetings_over_time": meetings_over_time,
        "provider_distribution": provider_distribution,
        "top_action_owners": top_action_owners,
        "topic_trends": topic_trends,
    }


def get_performance_analytics_payload() -> Dict[str, Any]:
    # Temporarily disabled
    raise HTTPException(status_code=503, detail="Analytics temporarily disabled")


def get_stats_payload(db: Session, current_user: models.User) -> Dict[str, Any]:
    base_query = db.query(models.Meeting)
    if current_user.role != "system-admin":
        org_ids = user_org_ids(current_user)
        if not org_ids:
            return {
                "totalMeetings": 0,
                "totalHours": 0,
                "processingCount": 0,
                "actualCostUsd": 0,
                "estimatedCostUsd": 0,
                "liveSuccessRate": "100%",
                "modelHealth": {},
                "features": {
                    "uploadEnabled": ADMIN_SYSTEM_SETTINGS.get("upload_enabled", True),
                    "jobTrackingEnabled": ADMIN_SYSTEM_SETTINGS.get("job_tracking_enabled", True),
                    "systemAdminEnabled": current_user.role == "system-admin",
                },
            }
        base_query = base_query.filter(models.Meeting.organization_id.in_(org_ids))

    # SQL aggregation instead of loading all rows
    total_meetings = base_query.with_entities(func.count()).scalar() or 0
    processing_count = base_query.filter(
        models.Meeting.status.in_(["processing", "queued"])
    ).with_entities(func.count()).scalar() or 0
    total_minutes = base_query.with_entities(
        func.coalesce(func.sum(models.Meeting.duration), 0)
    ).scalar() or 0

    return {
        "totalMeetings": total_meetings,
        "totalHours": round(total_minutes / 60, 2),
        "processingCount": processing_count,
        "actualCostUsd": 0,
        "estimatedCostUsd": 0,
        "liveSuccessRate": "100%",
        "modelHealth": {},
        "features": {
            "uploadEnabled": ADMIN_SYSTEM_SETTINGS.get("upload_enabled", True),
            "jobTrackingEnabled": ADMIN_SYSTEM_SETTINGS.get("job_tracking_enabled", True),
            "systemAdminEnabled": current_user.role == "system-admin",
        },
    }
