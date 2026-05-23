import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping

from fastapi import HTTPException
from sqlalchemy.orm import Session, joinedload

from src.api import models
from src.api.core.admin_runtime import (
    ADMIN_BROADCAST_HISTORY,
    ADMIN_PROMPTS,
    ADMIN_SYSTEM_SETTINGS,
    append_admin_audit_log,
    delete_admin_broadcast,
    ensure_admin_runtime_tables,
    ensure_audit_log_table,
    persist_admin_broadcast,
    persist_admin_prompt,
    persist_admin_setting,
)
from src.api.core.notifications_support import create_persisted_notification
from src.api.core.upload_jobs import feature_flags_for_user
from src.api.core.user_payloads import format_user_payload
from src.api.crud import update_user


def require_system_admin_user(current_user: models.User) -> None:
    if current_user.role != "system-admin":
        raise HTTPException(status_code=403, detail="System admin access required")


def get_admin_stats_payload(db: Session, current_user: models.User) -> Dict[str, int]:
    require_system_admin_user(current_user)
    return {
        "total_users": db.query(models.User).count(),
        "total_organizations": db.query(models.Organization).count(),
        "total_meetings": db.query(models.Meeting).count(),
        "active_meetings": db.query(models.Meeting).filter(models.Meeting.status == "live").count(),
        "total_groups": db.query(models.Group).count(),
    }


def get_admin_users_payload(db: Session, current_user: models.User) -> List[Dict[str, Any]]:
    require_system_admin_user(current_user)
    users = db.query(models.User).options(
        joinedload(models.User.user_organizations).joinedload(models.UserOrganization.organization),
        joinedload(models.User.group_memberships).joinedload(models.GroupMembership.group),
    ).order_by(models.User.created_at.desc()).all()
    return [format_user_payload(user) for user in users]


def update_admin_user_status_payload(
    user_id: str,
    is_active: bool,
    db: Session,
    current_user: models.User,
) -> Dict[str, Any]:
    require_system_admin_user(current_user)
    user = update_user(db, user_id, {"is_active": is_active})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    append_admin_audit_log(
        actor=current_user.username,
        action="ACTIVATE_USER" if is_active else "SUSPEND_USER",
        target=user.email,
    )
    return format_user_payload(user)


def update_admin_user_role_payload(
    user_id: str,
    role: str,
    db: Session,
    current_user: models.User,
) -> Dict[str, Any]:
    require_system_admin_user(current_user)
    if role not in ("system-admin", "member"):
        raise HTTPException(status_code=400, detail="Role must be 'system-admin' or 'member'")
    user = update_user(db, user_id, {"role": role})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    append_admin_audit_log(
        actor=current_user.username,
        action="CHANGE_USER_ROLE",
        target=f"{user.email} -> {role}",
    )
    return format_user_payload(user)


def _reassign_resources_to_org_admin(db: Session, deleted_user: models.User) -> List[Dict[str, Any]]:
    """For each organization the soft-deleted user belongs to, transfer the
    active resources they own (meetings, action items created by them) to one
    of the org's org-admins. Returns a list of {org_id, new_owner_id, counts}
    for audit logging. We never reassign across organizations and we skip if
    no org-admin exists in that org.
    """
    reassignments: List[Dict[str, Any]] = []
    user_orgs = db.query(models.UserOrganization).filter(
        models.UserOrganization.user_id == deleted_user.id,
    ).all()
    for membership in user_orgs:
        org_admin = (
            db.query(models.UserOrganization)
            .filter(
                models.UserOrganization.organization_id == membership.organization_id,
                models.UserOrganization.role == "org-admin",
                models.UserOrganization.user_id != deleted_user.id,
            )
            .first()
        )
        if not org_admin:
            continue
        new_owner_id = org_admin.user_id
        meetings_q = db.query(models.Meeting).filter(
            models.Meeting.organization_id == membership.organization_id,
            models.Meeting.created_by == deleted_user.id,
        )
        meeting_count = meetings_q.count()
        meetings_q.update({models.Meeting.created_by: new_owner_id}, synchronize_session=False)

        # Scope action items to THIS organization by joining through Meeting.
        # ActionItem has no direct organization_id, but the spec says
        # "we never reassign across organizations" — so we filter via the
        # meeting's org. ActionItems whose meeting belongs to a different org
        # are left alone (they will be handled when we visit that org).
        action_item_ids = [
            row[0]
            for row in db.query(models.ActionItem.id)
            .join(models.Meeting, models.ActionItem.meeting_id == models.Meeting.id)
            .filter(
                models.Meeting.organization_id == membership.organization_id,
                models.ActionItem.created_by == deleted_user.id,
            )
            .all()
        ]
        action_item_count = len(action_item_ids)
        if action_item_ids:
            db.query(models.ActionItem).filter(
                models.ActionItem.id.in_(action_item_ids)
            ).update(
                {models.ActionItem.created_by: new_owner_id},
                synchronize_session=False,
            )

        reassignments.append({
            "organization_id": membership.organization_id,
            "new_owner_id": new_owner_id,
            "meetings": meeting_count,
            "action_items": action_item_count,
        })
    db.commit()
    return reassignments


def delete_admin_user_payload(user_id: str, db: Session, current_user: models.User) -> Dict[str, Any]:
    require_system_admin_user(current_user)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = update_user(db, user_id, {"is_active": False})
    reassignments = _reassign_resources_to_org_admin(db, user)

    append_admin_audit_log(
        actor=current_user.username,
        action="DELETE_USER",
        target=user.email,
    )
    for entry in reassignments:
        append_admin_audit_log(
            actor=current_user.username,
            action="REASSIGN_OWNERSHIP",
            target=(
                f"org={entry['organization_id']} new_owner={entry['new_owner_id']} "
                f"meetings={entry['meetings']} action_items={entry['action_items']}"
            ),
        )
    return {
        "detail": "User deactivated",
        "user_id": user_id,
        "reassignments": reassignments,
    }


def get_admin_ai_services_payload(current_user: models.User) -> Dict[str, Any]:
    require_system_admin_user(current_user)

    llm_provider = os.getenv("LLM_PROVIDER", "google").lower()
    stt_provider = os.getenv("STT_PROVIDER", "deepgram").lower()
    groq_key = os.getenv("GROQ_API_KEY", "")
    google_key = os.getenv("GOOGLE_API_KEY", "")
    phobert_enabled = os.getenv("PHOBERT_ENABLED", "false").lower() == "true"

    def _key_set(key: str, placeholder: str = "") -> bool:
        return bool(key) and key != placeholder

    llm_services = []
    if _key_set(groq_key, "your_groq_key_here"):
        llm_services.append({
            "name": "Groq",
            "model": os.getenv("ROUTER_MODEL", "llama-3.3-70b-versatile"),
            "role": "primary" if llm_provider in ("router", "groq") else "fallback",
            "enabled": True,
            "api_key_set": True,
        })
    if _key_set(google_key, "your_google_ai_studio_key_here"):
        llm_services.append({
            "name": "Google Gemini",
            "model": os.getenv("GEMINI_MODEL", "gemini-1.5-flash"),
            "role": "primary" if llm_provider == "google" else "fallback",
            "enabled": True,
            "api_key_set": True,
        })

    stt_providers = [
        {"name": "Deepgram", "id": "deepgram", "model": os.getenv("DEEPGRAM_MODEL", "nova-3")},
        {"name": "PhoWhisper", "id": "phowhisper", "model": "vinai/PhoWhisper-base"},
        {"name": "ViWhisper", "id": "viwhisper", "model": "NhutP/ViWhisper-small"},
    ]
    for provider in stt_providers:
        provider["active"] = provider["id"] == stt_provider

    nlp_services = []
    if phobert_enabled:
        nlp_services.append({
            "name": "PhoBERT Post-Processor",
            "model": os.getenv("PHOBERT_MODEL", "vinai/phobert-base"),
            "enabled": True,
            "features": {
                "dialect_detection": os.getenv("PHOBERT_DIALECT_ENABLED", "true").lower() == "true",
                "context_correction": True,
                "llm_correction": os.getenv("PHOBERT_LLM_CORRECTION_ENABLED", "false").lower() == "true",
            },
        })

    return {
        "llm": {"provider": llm_provider, "services": llm_services},
        "stt": {
            "provider": stt_provider,
            "available_providers": stt_providers,
            "realtime_mode": os.getenv("REALTIME_STT_MODE", "deepgram_streaming"),
        },
        "nlp": {"services": nlp_services},
    }


def get_admin_ai_usage_payload(db: Session, current_user: models.User) -> Dict[str, Any]:
    require_system_admin_user(current_user)

    from sqlalchemy import func as sqlfunc

    usage_by_service = db.query(
        models.CostTracking.service,
        models.CostTracking.model_name,
        sqlfunc.sum(models.CostTracking.input_tokens).label("total_input_tokens"),
        sqlfunc.sum(models.CostTracking.output_tokens).label("total_output_tokens"),
        sqlfunc.sum(models.CostTracking.cost_usd).label("total_cost_usd"),
        sqlfunc.count(models.CostTracking.id).label("request_count"),
    ).group_by(models.CostTracking.service, models.CostTracking.model_name).all()

    now = datetime.now(timezone.utc)
    month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    monthly_cost = db.query(sqlfunc.sum(models.CostTracking.cost_usd)).filter(
        models.CostTracking.created_at >= month_start
    ).scalar() or 0

    day_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    daily_cost = db.query(sqlfunc.sum(models.CostTracking.cost_usd)).filter(
        models.CostTracking.created_at >= day_start
    ).scalar() or 0

    return {
        "services": [
            {
                "service": row.service,
                "model": row.model_name,
                "total_input_tokens": int(row.total_input_tokens or 0),
                "total_output_tokens": int(row.total_output_tokens or 0),
                "total_cost_usd": float(row.total_cost_usd or 0),
                "request_count": int(row.request_count or 0),
            }
            for row in usage_by_service
        ],
        "monthly_cost_usd": float(monthly_cost),
        "daily_cost_usd": float(daily_cost),
    }


def get_admin_prompts_payload(current_user: models.User) -> List[Dict[str, Any]]:
    require_system_admin_user(current_user)
    return list(ADMIN_PROMPTS.values())


def update_admin_prompt_payload(
    prompt_key: str,
    payload: Mapping[str, Any],
    current_user: models.User,
) -> Dict[str, Any]:
    require_system_admin_user(current_user)
    next_version = payload.get("version") or ADMIN_PROMPTS.get(prompt_key, {}).get("version", "1.0.0")
    prompt_record = {
        "key": prompt_key,
        "name": payload["name"],
        "description": payload.get("description"),
        "content": payload["content"],
        "version": next_version,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }
    persist_admin_prompt(prompt_key, prompt_record)
    ADMIN_PROMPTS[prompt_key] = prompt_record
    append_admin_audit_log(actor=current_user.username, action="UPDATE_PROMPT", target=prompt_key)
    return ADMIN_PROMPTS[prompt_key]


def get_admin_broadcasts_payload(current_user: models.User) -> List[Dict[str, Any]]:
    require_system_admin_user(current_user)
    return ADMIN_BROADCAST_HISTORY


def create_admin_broadcast_payload(
    payload: Mapping[str, Any],
    db: Session,
    current_user: models.User,
) -> Dict[str, Any]:
    require_system_admin_user(current_user)
    item = {
        "id": str(uuid.uuid4()),
        "title": payload["title"],
        "content": payload["content"],
        "type": payload.get("type", "info"),
        "target": payload.get("target", "all"),
        "status": "sent",
        "sentAt": datetime.now(timezone.utc).isoformat(),
        "reach": 0,
    }

    recipients: List[models.User] = []
    if item["target"] == "all":
        recipients = db.query(models.User).filter(models.User.is_active == True).all()
    else:
        recipients = db.query(models.User).join(models.UserOrganization).filter(
            models.UserOrganization.organization_id == item["target"],
            models.User.is_active == True,
        ).all()

    for recipient in recipients:
        create_persisted_notification(
            db,
            recipient_user_id=recipient.id,
            notification_type="system",
            priority="today",
            title=item["title"],
            message=item["content"],
            metadata={"target": item["target"]},
            source_type="admin-broadcast",
            source_id=item["id"],
            commit=False,
        )
    item["reach"] = len(recipients)
    db.commit()
    persist_admin_broadcast(item, actor=current_user.username)
    ADMIN_BROADCAST_HISTORY.insert(0, item)
    append_admin_audit_log(actor=current_user.username, action="SEND_BROADCAST", target=item["target"])
    return item


def delete_admin_broadcast_payload(notification_id: str, current_user: models.User) -> Dict[str, str]:
    require_system_admin_user(current_user)
    removed_from_db = delete_admin_broadcast(notification_id)
    before = len(ADMIN_BROADCAST_HISTORY)
    ADMIN_BROADCAST_HISTORY[:] = [item for item in ADMIN_BROADCAST_HISTORY if item.get("id") != notification_id]
    removed_from_cache = len(ADMIN_BROADCAST_HISTORY) < before
    if not removed_from_db and not removed_from_cache:
        raise HTTPException(status_code=404, detail="Notification not found")
    append_admin_audit_log(actor=current_user.username, action="DELETE_BROADCAST", target=notification_id)
    return {"message": "Notification deleted"}


def get_admin_audit_logs_payload(
    skip: int,
    limit: int,
    db: Session,
    current_user: models.User,
) -> List[Dict[str, Any]]:
    require_system_admin_user(current_user)
    ensure_audit_log_table()
    db_logs = (
        db.query(models.AuditLog)
        .order_by(models.AuditLog.time.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return [
        {
            "id": log.id,
            "time": log.time.isoformat() if log.time else datetime.now(timezone.utc).isoformat(),
            "user": log.user,
            "role": log.role,
            "action": log.action,
            "target": log.target,
            "org": log.org,
            "ip": log.ip,
        }
        for log in db_logs
    ]


def get_admin_settings_payload(current_user: models.User) -> Dict[str, Any]:
    require_system_admin_user(current_user)
    return ADMIN_SYSTEM_SETTINGS


def update_admin_settings_payload(payload: Mapping[str, Any], current_user: models.User) -> Dict[str, Any]:
    require_system_admin_user(current_user)
    for key, value in payload.items():
        if value is None:
            continue
        ADMIN_SYSTEM_SETTINGS[key] = value
        persist_admin_setting(key, value)
    append_admin_audit_log(actor=current_user.username, action="UPDATE_SYSTEM_SETTINGS", target="admin.settings")
    return ADMIN_SYSTEM_SETTINGS


def get_costs_payload() -> None:
    raise HTTPException(status_code=503, detail="Cost tracking temporarily disabled")


def get_feature_flags_payload(current_user: models.User) -> Dict[str, bool]:
    return feature_flags_for_user(current_user)
