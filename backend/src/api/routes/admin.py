from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.api import auth
from src.api.core.admin_operations import (
    create_admin_broadcast_payload,
    delete_admin_broadcast_payload,
    delete_admin_user_payload,
    get_admin_ai_services_payload,
    get_admin_ai_usage_payload,
    get_admin_audit_logs_payload,
    get_admin_broadcasts_payload,
    get_admin_prompts_payload,
    get_admin_prompt_versions_payload,
    get_admin_settings_payload,
    get_admin_stats_payload,
    get_admin_users_payload,
    get_costs_payload,
    get_feature_flags_payload,
    rollback_admin_prompt_payload,
    test_admin_prompt_payload,
    update_admin_ai_services_payload,
    update_admin_prompt_payload,
    update_admin_settings_payload,
    update_admin_user_role_payload,
    update_admin_user_status_payload,
    view_as_org_begin_payload,
    view_as_org_end_payload,
)
from src.api.database import get_db

router = APIRouter(tags=["admin"])


class AdminUserStatusUpdateRequest(BaseModel):
    is_active: bool


class AdminUserRoleUpdateRequest(BaseModel):
    role: str


class AdminPromptUpdateRequest(BaseModel):
    key: Optional[str] = None  # accepted for backwards compatibility; URL path is the source of truth
    name: str
    description: Optional[str] = None
    content: str
    version: Optional[str] = None


class AdminBroadcastRequest(BaseModel):
    title: str
    content: str
    type: str = "info"
    target: str = "all"


class AdminSettingsUpdateRequest(BaseModel):
    public_registration_enabled: Optional[bool] = None
    storage_limit_gb_per_org: Optional[int] = None
    transcript_retention_policy: Optional[str] = None
    maintenance_mode: Optional[bool] = None


class AdminAIServicesUpdateRequest(BaseModel):
    llm_provider: Optional[str] = None
    stt_provider: Optional[str] = None
    gemini_model: Optional[str] = None
    deepgram_model: Optional[str] = None
    groq_model: Optional[str] = None


class AdminPromptRollbackRequest(BaseModel):
    version_id: str


class AdminPromptTestRequest(BaseModel):
    sample_text: str


@router.get("/api/admin/costs")
def get_costs(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_costs_payload(db, current_user)


@router.get("/api/admin/stats")
def admin_get_stats(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_admin_stats_payload(db, current_user)


@router.get("/api/admin/users")
def admin_list_users(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_admin_users_payload(db, current_user)


@router.patch("/api/admin/users/{user_id}/status")
def admin_update_user_status(
    user_id: str,
    payload: AdminUserStatusUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_admin_user_status_payload(user_id, payload.is_active, db, current_user)


@router.patch("/api/admin/users/{user_id}/role")
def admin_update_user_role(
    user_id: str,
    payload: AdminUserRoleUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_admin_user_role_payload(user_id, payload.role, db, current_user)


@router.delete("/api/admin/users/{user_id}")
def admin_delete_user(
    user_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return delete_admin_user_payload(user_id, db, current_user)


@router.get("/api/admin/ai-services")
def admin_get_ai_services(current_user=Depends(auth.get_current_user)):
    return get_admin_ai_services_payload(current_user)


@router.patch("/api/admin/ai-services")
def admin_update_ai_services(
    payload: AdminAIServicesUpdateRequest,
    current_user=Depends(auth.get_current_user),
):
    return update_admin_ai_services_payload(
        payload.model_dump(exclude_unset=True),
        current_user,
    )


@router.get("/api/admin/ai-services/usage")
def admin_get_ai_usage(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_admin_ai_usage_payload(db, current_user)


@router.get("/api/admin/prompts")
def admin_get_prompts(current_user=Depends(auth.get_current_user)):
    return get_admin_prompts_payload(current_user)


@router.put("/api/admin/prompts/{prompt_key}")
def admin_update_prompt(
    prompt_key: str,
    payload: AdminPromptUpdateRequest,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_admin_prompt_payload(prompt_key, payload.model_dump(), db, current_user)


@router.get("/api/admin/prompts/{prompt_key}/versions")
def admin_get_prompt_versions(
    prompt_key: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_admin_prompt_versions_payload(prompt_key, db, current_user)


@router.post("/api/admin/prompts/{prompt_key}/rollback")
def admin_rollback_prompt(
    prompt_key: str,
    payload: AdminPromptRollbackRequest,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return rollback_admin_prompt_payload(prompt_key, payload.version_id, db, current_user)


@router.post("/api/admin/prompts/{prompt_key}/test")
def admin_test_prompt(
    prompt_key: str,
    payload: AdminPromptTestRequest,
    current_user=Depends(auth.get_current_user),
):
    return test_admin_prompt_payload(prompt_key, payload.sample_text, current_user)


@router.get("/api/admin/notifications")
def admin_list_broadcasts(current_user=Depends(auth.get_current_user)):
    return get_admin_broadcasts_payload(current_user)


@router.post("/api/admin/notifications")
def admin_create_broadcast(
    payload: AdminBroadcastRequest,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return create_admin_broadcast_payload(payload.model_dump(), db, current_user)


@router.delete("/api/admin/notifications/{notification_id}")
def admin_delete_broadcast(notification_id: str, current_user=Depends(auth.get_current_user)):
    return delete_admin_broadcast_payload(notification_id, current_user)


@router.get("/api/admin/audit-logs")
def admin_get_audit_logs(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_admin_audit_logs_payload(skip, limit, db, current_user)


@router.get("/api/admin/settings")
def admin_get_settings(current_user=Depends(auth.get_current_user)):
    return get_admin_settings_payload(current_user)


@router.patch("/api/admin/settings")
def admin_update_settings(
    payload: AdminSettingsUpdateRequest,
    current_user=Depends(auth.get_current_user),
):
    return update_admin_settings_payload(payload.model_dump(exclude_unset=True), current_user)


@router.get("/api/config/features")
def get_feature_flags(current_user=Depends(auth.get_current_user)):
    return get_feature_flags_payload(current_user)


@router.post("/api/admin/view-as-org/{org_id}")
def admin_view_as_org_begin(
    org_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return view_as_org_begin_payload(org_id, db, current_user)


@router.delete("/api/admin/view-as-org/{org_id}")
def admin_view_as_org_end(
    org_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return view_as_org_end_payload(org_id, db, current_user)
