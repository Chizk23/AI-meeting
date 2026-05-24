import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session, joinedload

from src.api import auth, models


def resolve_pending_invitation_by_token(db: Session, token: str) -> Optional[models.Invitation]:
    now = datetime.now(timezone.utc)

    expired_count = db.query(models.Invitation).filter(
        models.Invitation.status == "pending",
        models.Invitation.expires_at < now,
    ).update({"status": "expired"}, synchronize_session=False)
    if expired_count:
        db.commit()

    token_sha256 = hashlib.sha256(token.encode("utf-8")).hexdigest()
    invitation = db.query(models.Invitation).options(
        joinedload(models.Invitation.organization),
        joinedload(models.Invitation.group),
    ).filter(
        models.Invitation.status == "pending",
        models.Invitation.token_sha256 == token_sha256,
        models.Invitation.expires_at >= now,
    ).first()

    if invitation and auth.verify_password(token, invitation.token_hash):
        return invitation

    # Backward compatibility for invitations created before token_sha256 existed.
    legacy_invitations = db.query(models.Invitation).options(
        joinedload(models.Invitation.organization),
        joinedload(models.Invitation.group),
    ).filter(
        models.Invitation.status == "pending",
        models.Invitation.token_sha256.is_(None),
        models.Invitation.expires_at >= now,
    ).all()
    for legacy_invitation in legacy_invitations:
        if auth.verify_password(token, legacy_invitation.token_hash):
            legacy_invitation.token_sha256 = token_sha256
            db.flush()
            return legacy_invitation

    return None


def invitation_preview_payload(invitation: models.Invitation) -> Dict[str, Any]:
    return {
        "email": invitation.email,
        "organization_id": invitation.organization_id,
        "organization_name": invitation.organization.name if invitation.organization else None,
        "role": invitation.role,
        "status": invitation.status,
        "expires_at": invitation.expires_at,
    }


def build_invitation_email_html(org_name: str, role: str, invite_url: str) -> str:
    role_labels = {
        "org-admin": "Quản trị tổ chức",
        "member": "Thành viên",
        "viewer": "Người xem",
    }
    role_label = role_labels.get(role, role)
    return f"""
    <div style='font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;'>
        <div style='background: linear-gradient(135deg, #16a34a 0%, #22c55e 100%); padding: 30px; border-radius: 12px 12px 0 0;'>
            <h1 style='color: white; margin: 0;'>Lời mời tham gia tổ chức</h1>
        </div>
        <div style='background: #f8fafc; padding: 30px; border-radius: 0 0 12px 12px;'>
            <p style='color: #0f172a; font-size: 16px;'>Bạn được mời tham gia <strong>{org_name}</strong>.</p>
            <p style='color: #475569; font-size: 14px;'>Vai trò của bạn sau khi tham gia: <strong>{role_label}</strong>.</p>
            <div style='margin: 28px 0; text-align: center;'>
                <a href='{invite_url}' style='background: #16a34a; color: white; text-decoration: none; padding: 12px 24px; border-radius: 9999px; font-weight: bold; display: inline-block;'>Tham gia tổ chức</a>
            </div>
            <p style='color: #64748b; font-size: 12px;'>Nếu nút không hoạt động, hãy mở liên kết này:</p>
            <p style='color: #2563eb; font-size: 12px; word-break: break-all;'>{invite_url}</p>
        </div>
    </div>
    """
