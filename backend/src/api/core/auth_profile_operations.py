import os
import secrets
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

from src.api import auth, models, schemas
from src.api.config import get_config
from src.api.core.admin_runtime import ADMIN_SYSTEM_SETTINGS, append_admin_audit_log
from src.api.core.invitation_support import resolve_pending_invitation_by_token
from src.api.core.user_payloads import format_user_payload
from src.api import crud
from src.api.crud import (
    create_password_reset_otp,
    create_user,
    get_user_by_email,
    get_user_by_id,
    get_user_by_username,
    mark_password_reset_otp_used,
    update_user,
)

AVATAR_UPLOAD_DIR = str(Path(__file__).resolve().parents[3] / "uploads" / "avatars")
config = get_config()


def _send_email_via_main(recipient_email: str, subject: str, html_content: str) -> bool:
    from src.api import main

    return main.send_email(recipient_email, subject, html_content)


def build_unique_username(db: Session, requested_username: Optional[str], email: str) -> str:
    base_username = (requested_username or email.split("@")[0] or "user").strip().lower()
    sanitized = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "-" for ch in base_username).strip("-_.")
    candidate = sanitized or "user"
    suffix = 1

    while get_user_by_username(db, candidate):
        suffix += 1
        candidate = f"{sanitized or 'user'}-{suffix}"

    return candidate


def build_password_reset_email_html(reset_code: str, expires_minutes: int) -> str:
    return f"""
    <div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'>
        <div style='background: linear-gradient(135deg, #0ea5e9 0%, #22d3ee 100%); padding: 30px; border-radius: 12px 12px 0 0;'>
            <h1 style='color: white; margin: 0;'>Ma xac thuc dat lai mat khau</h1>
        </div>
        <div style='background: #f8fafc; padding: 30px; border-radius: 0 0 12px 12px;'>
            <p style='color: #0f172a; font-size: 16px;'>Ban vua yeu cau dat lai mat khau CONVIA.</p>
            <p style='color: #475569; font-size: 14px;'>Nhap ma OTP ben duoi vao man hinh "Quen mat khau".</p>
            <div style='margin: 28px 0; text-align: center;'>
                <div style='display: inline-block; font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #0f172a; background: white; border: 1px solid #dbeafe; border-radius: 12px; padding: 16px 24px;'>{reset_code}</div>
            </div>
            <p style='color: #64748b; font-size: 13px;'>Ma co hieu luc trong {expires_minutes} phut. Neu ban khong yeu cau, hay bo qua email nay.</p>
        </div>
    </div>
    """


def register_payload(req: schemas.RegisterRequest, db: Session) -> Dict[str, Any]:
    if not req.inviteToken and not ADMIN_SYSTEM_SETTINGS.get("public_registration_enabled", True):
        raise HTTPException(status_code=403, detail="Public registration is disabled")

    username = build_unique_username(db, req.username, req.email)
    invitation = None

    if req.inviteToken:
        invitation = resolve_pending_invitation_by_token(db, req.inviteToken)
        if not invitation:
            raise HTTPException(status_code=400, detail="Invalid or expired invitation token")
        if invitation.email.lower() != req.email.lower():
            raise HTTPException(status_code=400, detail="Invitation email does not match registration email")

    db_user = get_user_by_username(db, req.username) if req.username else None
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")

    db_user_email = get_user_by_email(db, req.email)
    if db_user_email:
        raise HTTPException(status_code=409, detail="Email already registered")

    try:
        user_data = {
            "username": username,
            "email": req.email,
            "password": req.password,
            "role": "member",
            "first_name": req.firstName,
            "last_name": req.lastName,
            "phone": req.phone,
            "gender": req.gender,
            "date_of_birth": datetime.combine(req.dateOfBirth, datetime.min.time()),
        }
        user = create_user(db, user_data, commit=False)
        next_step = "setup_org"
        accepted_invitation = False

        if req.orgName and not invitation:
            org = crud.create_organization(
                db,
                {
                    "name": req.orgName,
                    "settings": {
                        "approval_status": "pending",
                        "requested_by_user_id": user.id,
                    },
                },
                commit=False,
            )
            crud.add_user_to_organization(db, user.id, org.id, "member", commit=False)
            next_step = "pending_approval"

        if invitation:
            org_role = invitation.role if invitation.role in {"org-admin", "member", "viewer"} else "member"
            crud.add_user_to_organization(db, user.id, invitation.organization_id, org_role, commit=False)
            if invitation.group_id:
                group_role = invitation.role if invitation.role in {"group-admin", "member", "viewer"} else "member"
                crud.add_user_to_group(
                    db,
                    invitation.group_id,
                    user.id,
                    group_role,
                    invited_by=invitation.invited_by,
                    commit=False,
                )
            invitation.status = "accepted"
            invitation.accepted_at = datetime.now(timezone.utc)
            invitation.accepted_by = user.id
            accepted_invitation = True
            next_step = "dashboard"

        db.commit()
        user = db.query(models.User).options(
            joinedload(models.User.user_organizations).joinedload(models.UserOrganization.organization),
            joinedload(models.User.group_memberships).joinedload(models.GroupMembership.group),
        ).filter(models.User.id == user.id).first()
    except Exception:
        db.rollback()
        raise

    access_token = auth.create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": format_user_payload(user),
        "nextStep": next_step,
        "acceptedInvitation": accepted_invitation,
    }


def login_payload(req: schemas.UserLogin, db: Session) -> Dict[str, Any]:
    user = db.query(models.User).options(
        joinedload(models.User.user_organizations).joinedload(models.UserOrganization.organization),
        joinedload(models.User.group_memberships).joinedload(models.GroupMembership.group),
    ).filter((models.User.username == req.username) | (models.User.email == req.username)).first()

    if not user or not auth.verify_password(req.password, user.password_hash):
        append_admin_audit_log(
            actor=req.username or "",
            action="LOGIN_FAILED",
            target=req.username or "",
            role="anonymous",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        append_admin_audit_log(
            actor=user.username,
            action="LOGIN_BLOCKED_INACTIVE",
            target=user.username,
            role=user.role or "member",
        )
        raise HTTPException(status_code=403, detail="Account is deactivated")

    access_token = auth.create_access_token(
        data={"sub": user.username},
        expires_delta=timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    append_admin_audit_log(
        actor=user.username,
        action="LOGIN_SUCCESS",
        target=user.username,
        role=user.role or "member",
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": format_user_payload(user),
    }


def forgot_password_payload(req: schemas.ForgotPasswordRequest, db: Session) -> Dict[str, Any]:
    user = get_user_by_email(db, req.email)
    response = {"message": "If the email exists, a reset code has been sent"}
    if not user:
        return response

    otp = f"{secrets.randbelow(1_000_000):06d}"
    expires_minutes = 15
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    create_password_reset_otp(db, user.id, user.email, otp, expires_at)
    email_html = build_password_reset_email_html(otp, expires_minutes)
    email_sent = _send_email_via_main(
        user.email,
        "CONVIA - Ma dat lai mat khau",
        email_html,
    )

    if not email_sent and config.environment == "production":
        raise HTTPException(status_code=503, detail="Unable to send reset email. Please try again later.")

    if config.environment != "production":
        response["dev_otp"] = otp
        if not email_sent:
            response["email_delivery"] = "failed_dev_mode"
    return response


def reset_password_payload(req: schemas.ResetPasswordRequest, db: Session) -> Dict[str, str]:
    user = get_user_by_email(db, req.email)
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset code")

    now = datetime.now(timezone.utc)
    from src.api.crud import get_valid_password_reset_otp

    db_otp = get_valid_password_reset_otp(db, req.email, req.otp, now)
    if not db_otp:
        raise HTTPException(status_code=400, detail="Invalid or expired reset code")

    update_user(db, user.id, {"password": req.newPassword})
    mark_password_reset_otp_used(db, db_otp.id, now)
    append_admin_audit_log(
        actor=user.username,
        action="RESET_PASSWORD",
        target=req.email,
        role=user.role or "member",
    )
    return {"message": "Password reset successfully"}


def get_profile_payload(current_user: models.User) -> Dict[str, Any]:
    return format_user_payload(current_user)


def update_profile_payload(
    updates: schemas.ProfileUpdate,
    db: Session,
    current_user: models.User,
) -> Dict[str, Any]:
    user = update_user(db, current_user.id, updates.model_dump(exclude_unset=True))
    return format_user_payload(user)


def change_password_payload(
    req: schemas.ChangePasswordRequest,
    db: Session,
    current_user: models.User,
) -> Dict[str, str]:
    if not auth.verify_password(req.current_password, current_user.password_hash):
        append_admin_audit_log(
            actor=current_user.username,
            action="CHANGE_PASSWORD_FAILED",
            target=current_user.username,
            role=current_user.role or "member",
        )
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    update_user(db, current_user.id, {"password": req.new_password})
    append_admin_audit_log(
        actor=current_user.username,
        action="CHANGE_PASSWORD",
        target=current_user.username,
        role=current_user.role or "member",
    )
    return {"message": "Password changed successfully"}


def _avatar_extension_for_upload(file: UploadFile) -> Optional[str]:
    content_type = (file.content_type or "").lower()
    if content_type in {"image/jpeg", "image/jpg"}:
        return ".jpg"
    if content_type == "image/png":
        return ".png"
    if content_type == "image/webp":
        return ".webp"
    filename = (file.filename or "").lower()
    if filename.endswith((".jpg", ".jpeg")):
        return ".jpg"
    if filename.endswith(".png"):
        return ".png"
    if filename.endswith(".webp"):
        return ".webp"
    return None


def _avatar_file_path(user_id: str) -> Optional[str]:
    for extension in (".jpg", ".png", ".webp"):
        candidate = os.path.join(AVATAR_UPLOAD_DIR, f"{user_id}{extension}")
        if os.path.exists(candidate):
            return candidate
    return None


def get_user_avatar_payload(user_id: str, db: Session) -> FileResponse:
    user = get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    avatar_path = _avatar_file_path(user_id)
    if not avatar_path:
        raise HTTPException(status_code=404, detail="Avatar not found")
    return FileResponse(
        avatar_path,
        media_type="image/webp" if avatar_path.endswith(".webp") else "image/png" if avatar_path.endswith(".png") else "image/jpeg",
        filename=os.path.basename(avatar_path),
    )


async def upload_profile_avatar_payload(
    file: UploadFile,
    db: Session,
    current_user: models.User,
) -> Dict[str, Any]:
    extension = _avatar_extension_for_upload(file)
    if not extension:
        raise HTTPException(status_code=400, detail="Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File ảnh đang trống")
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ảnh đại diện tối đa 5MB")

    os.makedirs(AVATAR_UPLOAD_DIR, exist_ok=True)
    for existing_extension in (".jpg", ".png", ".webp"):
        existing_path = os.path.join(AVATAR_UPLOAD_DIR, f"{current_user.id}{existing_extension}")
        if os.path.exists(existing_path):
            try:
                os.remove(existing_path)
            except OSError:
                pass

    avatar_path = os.path.join(AVATAR_UPLOAD_DIR, f"{current_user.id}{extension}")
    with open(avatar_path, "wb") as avatar_file:
        avatar_file.write(content)

    avatar_url = f"/api/users/{current_user.id}/avatar?v={int(time.time())}"
    user = update_user(db, current_user.id, {"avatar_url": avatar_url})
    return format_user_payload(user)
