import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from src.api import auth, models, schemas
from src.api.core.admin_operations import require_system_admin_user
from src.api.core.admin_runtime import append_admin_audit_log
from src.api.core.invitation_support import (
    build_invitation_email_html,
    invitation_preview_payload,
    resolve_pending_invitation_by_token,
)
from src.api.core.notifications_support import create_persisted_notification
from src.api.core.user_payloads import format_user_payload
from src.api.crud import (
    add_user_to_group,
    add_user_to_organization,
    create_organization,
    delete_organization,
    get_organization_by_id,
    get_organizations,
    update_organization,
    update_user_organization_role,
)
from src.api.notifications import FRONTEND_URL, send_email


def _current_time_for(value: datetime) -> datetime:
    now = datetime.now(timezone.utc)
    if value.tzinfo is None:
        return now.replace(tzinfo=None)
    return now


def enrich_organization_payload(org: models.Organization) -> Dict[str, Any]:
    meetings = org.meetings or []
    total_minutes = sum((meeting.duration or 0) for meeting in meetings)
    settings = org.settings or {}
    return {
        "id": org.id,
        "name": org.name,
        "description": org.description,
        "domain": org.domain,
        "logo_url": org.logo_url,
        "settings": org.settings,
        "created_at": org.created_at,
        "updated_at": org.updated_at,
        "member_count": len(org.user_organizations or []),
        "group_count": len(org.groups or []),
        "meeting_count": len(meetings),
        "total_hours": round(total_minutes / 60, 2),
        "approval_status": settings.get("approval_status", "active"),
        "requested_by_user_id": settings.get("requested_by_user_id"),
        "approved_by_user_id": settings.get("approved_by_user_id"),
        "approved_at": settings.get("approved_at"),
    }


def list_organizations_payload(
    skip: int,
    limit: int,
    db: Session,
    current_user: models.User,
) -> List[schemas.Organization]:
    if current_user.role == "system-admin":
        orgs = get_organizations(db, skip=skip, limit=limit)
    else:
        orgs = [membership.organization for membership in current_user.user_organizations]
    return [schemas.Organization.model_validate(enrich_organization_payload(org)) for org in orgs]


ALLOWED_APPROVAL_STATUSES = {"pending", "active", "rejected", "suspended"}


def admin_list_organizations_payload(
    status_filter: Optional[str],
    skip: int,
    limit: int,
    db: Session,
    current_user: models.User,
) -> List[schemas.Organization]:
    """Admin-only listing of organizations with optional approval_status filter.

    approval_status lives inside the JSON ``settings`` column, so we cannot
    push the filter down to SQL portably. To avoid the pagination bug where
    SQL OFFSET/LIMIT slices the data before the Python filter runs, when a
    real status_filter is supplied we fetch the full set (capped at a large
    safety limit), filter in Python, then apply skip/limit. When no filter
    is supplied (or status == "all") we can paginate at the SQL level.
    """
    if current_user.role != "system-admin":
        raise HTTPException(status_code=403, detail="System admin access required")
    if status_filter and status_filter != "all" and status_filter not in ALLOWED_APPROVAL_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of: all, {', '.join(sorted(ALLOWED_APPROVAL_STATUSES))}",
        )

    if status_filter and status_filter != "all":
        # Fetch a generous slice (10k orgs is far beyond realistic admin views)
        # and filter in Python, then apply skip/limit on the filtered list.
        orgs = get_organizations(db, skip=0, limit=10_000)
        enriched = [enrich_organization_payload(org) for org in orgs]
        filtered = [item for item in enriched if item.get("approval_status") == status_filter]
        page = filtered[skip : skip + limit]
        return [schemas.Organization.model_validate(item) for item in page]

    orgs = get_organizations(db, skip=skip, limit=limit)
    enriched = [enrich_organization_payload(org) for org in orgs]
    return [schemas.Organization.model_validate(item) for item in enriched]


def create_organization_payload(
    org_data: schemas.OrganizationCreate,
    db: Session,
    current_user: models.User,
) -> schemas.Organization:
    org_payload = org_data.model_dump()
    if current_user.role == "system-admin":
        org_payload["settings"] = {
            **(org_payload.get("settings") or {}),
            "approval_status": "active",
            "approved_by_user_id": current_user.id,
            "approved_at": datetime.now(timezone.utc).isoformat(),
        }
        org = create_organization(db, org_payload)
        add_user_to_organization(db, current_user.id, org.id, "org-admin")
        append_admin_audit_log(
            actor=current_user.username,
            action="CREATE_ORGANIZATION",
            target=org.name,
            role="System Admin",
        )
    else:
        org_payload["settings"] = {
            **(org_payload.get("settings") or {}),
            "approval_status": "pending",
            "requested_by_user_id": current_user.id,
        }
        org = create_organization(db, org_payload)
        add_user_to_organization(db, current_user.id, org.id, "member")
        append_admin_audit_log(
            actor=current_user.username,
            action="REQUEST_ORGANIZATION_APPROVAL",
            target=org.name,
            role=current_user.role or "member",
        )

    db.refresh(org)
    return schemas.Organization.model_validate(enrich_organization_payload(org))


def approve_organization_payload(
    org_id: str,
    db: Session,
    current_user: models.User,
) -> schemas.Organization:
    require_system_admin_user(current_user)
    org = get_organization_by_id(db, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    current_settings = org.settings or {}
    requested_by_user_id = current_settings.get("requested_by_user_id")
    org.settings = {
        **current_settings,
        "approval_status": "active",
        "approved_by_user_id": current_user.id,
        "approved_at": datetime.now(timezone.utc).isoformat(),
    }

    if requested_by_user_id:
        membership = update_user_organization_role(db, requested_by_user_id, org.id, "org-admin")
        if not membership:
            add_user_to_organization(db, requested_by_user_id, org.id, "org-admin")

    db.commit()
    db.refresh(org)
    append_admin_audit_log(
        actor=current_user.username,
        action="APPROVE_ORGANIZATION",
        target=org.name,
        role="System Admin",
    )
    return schemas.Organization.model_validate(enrich_organization_payload(org))


def reject_organization_payload(org_id: str, db: Session, current_user: models.User) -> Dict[str, str]:
    require_system_admin_user(current_user)
    org = get_organization_by_id(db, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    current_settings = org.settings or {}
    org.settings = {
        **current_settings,
        "approval_status": "rejected",
        "rejected_by_user_id": current_user.id,
        "rejected_at": datetime.now(timezone.utc).isoformat(),
    }
    db.commit()
    db.refresh(org)
    append_admin_audit_log(
        actor=current_user.username,
        action="REJECT_ORGANIZATION",
        target=org.name,
    )
    return {"detail": "Organization rejected", "org_id": org_id}


def suspend_organization_payload(org_id: str, db: Session, current_user: models.User) -> Dict[str, str]:
    require_system_admin_user(current_user)
    org = get_organization_by_id(db, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    current_settings = org.settings or {}
    org.settings = {
        **current_settings,
        "approval_status": "suspended",
        "suspended_by_user_id": current_user.id,
        "suspended_at": datetime.now(timezone.utc).isoformat(),
    }
    db.commit()
    db.refresh(org)
    append_admin_audit_log(
        actor=current_user.username,
        action="SUSPEND_ORGANIZATION",
        target=org.name,
    )
    return {"detail": "Organization suspended", "org_id": org_id}


def get_organization_payload(org_id: str, db: Session, current_user: models.User) -> schemas.Organization:
    org = auth.require_org_member(db, current_user, org_id)
    return schemas.Organization.model_validate(enrich_organization_payload(org))


def update_organization_payload(
    org_id: str,
    updates: schemas.OrganizationUpdate,
    db: Session,
    current_user: models.User,
) -> schemas.Organization:
    auth.require_org_admin(db, current_user, org_id)
    org = update_organization(db, org_id, updates.model_dump(exclude_unset=True))
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    append_admin_audit_log(
        actor=current_user.username,
        action="UPDATE_ORGANIZATION",
        target=org.name,
        role=current_user.role or "org-admin",
    )
    return schemas.Organization.model_validate(enrich_organization_payload(org))


def delete_organization_payload(org_id: str, db: Session, current_user: models.User) -> Dict[str, str]:
    auth.require_org_admin(db, current_user, org_id)
    org = get_organization_by_id(db, org_id)
    if not delete_organization(db, org_id):
        raise HTTPException(status_code=404, detail="Organization not found")
    append_admin_audit_log(
        actor=current_user.username,
        action="DELETE_ORGANIZATION",
        target=org.name if org else org_id,
        role=current_user.role or "org-admin",
    )
    return {"message": "Organization deleted successfully"}


def search_invitable_organization_users_payload(
    org_id: str,
    q: str,
    db: Session,
    current_user: models.User,
) -> List[Dict[str, Any]]:
    auth.require_org_admin(db, current_user, org_id)
    query = q.strip().lower()
    if len(query) < 2:
        return []

    existing_member_user_ids = db.query(models.UserOrganization.user_id).filter(
        models.UserOrganization.organization_id == org_id
    )
    search_pattern = f"%{query}%"
    users = db.query(models.User).filter(
        models.User.is_active == True,
        ~models.User.id.in_(existing_member_user_ids),
        or_(
            models.User.email.ilike(search_pattern),
            models.User.username.ilike(search_pattern),
            models.User.first_name.ilike(search_pattern),
            models.User.last_name.ilike(search_pattern),
        ),
    ).order_by(models.User.email.asc()).limit(10).all()

    return [
        {
            "id": user.id,
            "email": user.email,
            "displayName": " ".join(part for part in [user.first_name, user.last_name] if part) or user.username or user.email,
            "username": user.username,
            "avatarUrl": user.avatar_url,
        }
        for user in users
    ]


def search_invitable_users_alias_payload(
    organization_id: str,
    q: str,
    db: Session,
    current_user: models.User,
) -> List[Dict[str, Any]]:
    return search_invitable_organization_users_payload(
        org_id=organization_id,
        q=q,
        db=db,
        current_user=current_user,
    )


def create_invitation_payload(
    inv_data: schemas.InvitationCreate,
    db: Session,
    current_user: models.User,
) -> Dict[str, Any]:
    auth.require_org_admin(db, current_user, inv_data.organization_id)
    invite_email = inv_data.email.lower()

    target_group = None
    if inv_data.group_id:
        target_group = db.query(models.Group).filter(
            models.Group.id == inv_data.group_id,
            models.Group.organization_id == inv_data.organization_id,
        ).first()
        if not target_group:
            raise HTTPException(status_code=400, detail="Group does not belong to this organization")

    target_user = db.query(models.User).filter(models.User.email == invite_email).first()
    existing_member = db.query(models.UserOrganization).join(models.User).filter(
        models.User.email == invite_email,
        models.UserOrganization.organization_id == inv_data.organization_id,
    ).first()
    if existing_member:
        raise HTTPException(status_code=409, detail="User already belongs to this organization")

    organization = db.query(models.Organization).filter(models.Organization.id == inv_data.organization_id).first()
    existing_invite = db.query(models.Invitation).filter(
        models.Invitation.email == invite_email,
        models.Invitation.organization_id == inv_data.organization_id,
        models.Invitation.status == "pending",
        models.Invitation.group_id == inv_data.group_id,
    ).first()
    if existing_invite:
        if target_user:
            create_persisted_notification(
                db,
                recipient_user_id=target_user.id,
                notification_type="invitation",
                priority="today",
                title="Bạn có lời mời tham gia tổ chức",
                message=f"{current_user.email} đã mời bạn tham gia {organization.name if organization else 'tổ chức'}.",
                metadata={
                    "invitationId": existing_invite.id,
                    "organizationId": existing_invite.organization_id,
                    "organizationName": organization.name if organization else None,
                    "role": existing_invite.role,
                    "type": "invitation",
                },
                source_type="invitation",
                source_id=existing_invite.id,
            )
        return {
            "message": "Invitation is already pending",
            "email": invite_email,
            "organization_id": existing_invite.organization_id,
            "expires_at": existing_invite.expires_at,
            "invitation_id": existing_invite.id,
            "emailSent": False,
            "alreadyPending": True,
        }

    token = secrets.token_urlsafe(32)
    token_hash = auth.get_password_hash(token)
    token_sha256 = hashlib.sha256(token.encode("utf-8")).hexdigest()
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

    invitation = models.Invitation(
        email=invite_email,
        organization_id=inv_data.organization_id,
        group_id=inv_data.group_id,
        role=inv_data.role,
        token_hash=token_hash,
        token_sha256=token_sha256,
        expires_at=expires_at,
        invited_by=current_user.id,
        status="pending",
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)

    invite_url = f"{FRONTEND_URL.rstrip('/')}/invite?token={token}"
    email_html = build_invitation_email_html(
        organization.name if organization else "tổ chức của bạn",
        inv_data.role,
        invite_url,
    )
    subject = f"Lời mời tham gia {organization.name if organization else 'CONVIA'}"
    email_sent = send_email(invite_email, subject, email_html)
    if target_user:
        create_persisted_notification(
            db,
            recipient_user_id=target_user.id,
            notification_type="invitation",
            priority="today",
            title="Bạn có lời mời tham gia tổ chức",
            message=f"{current_user.email} đã mời bạn tham gia {organization.name if organization else 'tổ chức'}.",
            metadata={
                "invitationId": invitation.id,
                "organizationId": invitation.organization_id,
                "organizationName": organization.name if organization else None,
                "role": invitation.role,
                "type": "invitation",
            },
            source_type="invitation",
            source_id=invitation.id,
        )
    append_admin_audit_log(
        actor=current_user.username,
        action="CREATE_ORG_INVITATION" if not target_user else "CREATE_REGISTERED_USER_INVITATION",
        target=f"{inv_data.email} -> {target_group.name if target_group else inv_data.organization_id}",
        role=current_user.role or "org-admin",
    )

    return {
        "message": "Invitation created successfully" if not email_sent else "Invitation email sent successfully",
        "email": invite_email,
        "organization_id": inv_data.organization_id,
        "expires_at": expires_at,
        "invitation_id": invitation.id,
        "emailSent": email_sent,
        "alreadyPending": False,
    }


def create_bulk_invitations_payload(
    bulk_data: schemas.BulkInvitationCreate,
    db: Session,
    current_user: models.User,
) -> Dict[str, Any]:
    auth.require_org_admin(db, current_user, bulk_data.organization_id)
    results = []
    invited_count = 0
    skipped_count = 0
    error_count = 0

    for raw_email in bulk_data.emails:
        email = raw_email.strip().lower()
        if not email or "@" not in email:
            results.append({"email": raw_email, "status": "error", "message": "Invalid email format", "invitation_id": None})
            error_count += 1
            continue

        try:
            inv_data = schemas.InvitationCreate(
                email=email,
                organization_id=bulk_data.organization_id,
                group_id=bulk_data.group_id,
                role=bulk_data.role,
            )
            result = create_invitation_payload(inv_data, db, current_user)
            if result.get("alreadyPending"):
                results.append({"email": email, "status": "already_pending", "message": "Invitation already pending", "invitation_id": result.get("invitation_id")})
                skipped_count += 1
            else:
                results.append({"email": email, "status": "invited", "message": "Invitation created", "invitation_id": result.get("invitation_id")})
                invited_count += 1
        except HTTPException as exc:
            if exc.status_code == 409:
                results.append({"email": email, "status": "already_member", "message": "Already a member", "invitation_id": None})
                skipped_count += 1
            else:
                results.append({"email": email, "status": "error", "message": exc.detail or "Failed", "invitation_id": None})
                error_count += 1
        except Exception as exc:
            results.append({"email": email, "status": "error", "message": str(exc), "invitation_id": None})
            error_count += 1

    return {
        "results": results,
        "total": len(bulk_data.emails),
        "invited": invited_count,
        "skipped": skipped_count,
        "errors": error_count,
    }


def preview_invitation_payload(token: str, db: Session) -> Dict[str, Any]:
    invitation = resolve_pending_invitation_by_token(db, token)
    if not invitation:
        raise HTTPException(status_code=400, detail="Invalid or expired invitation token")
    return invitation_preview_payload(invitation)


def list_my_pending_invitations_payload(db: Session, current_user: models.User) -> List[Dict[str, Any]]:
    invitations = db.query(models.Invitation).options(
        joinedload(models.Invitation.organization)
    ).filter(
        models.Invitation.email == current_user.email,
        models.Invitation.status == "pending",
    ).order_by(models.Invitation.created_at.desc()).all()

    pending_items = []
    changed = False
    for invitation in invitations:
        now = _current_time_for(invitation.expires_at)
        if invitation.expires_at < now:
            invitation.status = "expired"
            changed = True
            continue

        pending_items.append(
            {
                "id": invitation.id,
                "email": invitation.email,
                "organization_id": invitation.organization_id,
                "organization_name": invitation.organization.name if invitation.organization else None,
                "role": invitation.role,
                "expires_at": invitation.expires_at,
                "created_at": invitation.created_at,
            }
        )

    if changed:
        db.commit()

    return pending_items


def _accept_invitation_record(
    invitation: models.Invitation,
    db: Session,
    current_user: models.User,
) -> Dict[str, str]:
    if invitation.email.lower() != current_user.email.lower():
        raise HTTPException(status_code=400, detail="This invitation was sent to a different email address")

    existing_membership = db.query(models.UserOrganization).filter(
        models.UserOrganization.user_id == current_user.id,
        models.UserOrganization.organization_id == invitation.organization_id,
    ).first()

    if not existing_membership:
        org_role = invitation.role if invitation.role in {"org-admin", "member", "viewer"} else "member"
        add_user_to_organization(db, current_user.id, invitation.organization_id, org_role)

    if invitation.group_id:
        group_role = invitation.role if invitation.role in {"group-admin", "member", "viewer"} else "member"
        add_user_to_group(
            db,
            invitation.group_id,
            current_user.id,
            group_role,
            invited_by=invitation.invited_by,
        )

    invitation.status = "accepted"
    invitation.accepted_at = datetime.now(timezone.utc)
    invitation.accepted_by = current_user.id
    db.commit()

    return {
        "message": "Successfully joined the organization",
        "organization_id": invitation.organization_id,
    }


def accept_invitation_by_token_payload(
    req: schemas.InvitationAccept,
    db: Session,
    current_user: models.User,
) -> Dict[str, str]:
    invitation = resolve_pending_invitation_by_token(db, req.token)
    if not invitation:
        token_sha256 = hashlib.sha256(req.token.encode("utf-8")).hexdigest()
        accepted_invitation = db.query(models.Invitation).filter(
            models.Invitation.token_sha256 == token_sha256,
            models.Invitation.status == "accepted",
            models.Invitation.accepted_by == current_user.id,
        ).first()
        if accepted_invitation:
            return {
                "message": "Successfully joined the organization",
                "organization_id": accepted_invitation.organization_id,
            }
        raise HTTPException(status_code=400, detail="Invalid or expired invitation token")

    return _accept_invitation_record(invitation, db, current_user)


def accept_invitation_by_id_payload(
    invitation_id: str,
    db: Session,
    current_user: models.User,
) -> Dict[str, str]:
    invitation = db.query(models.Invitation).filter(models.Invitation.id == invitation_id).first()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invitation.status == "accepted" and invitation.accepted_by == current_user.id:
        return {
            "message": "Successfully joined the organization",
            "organization_id": invitation.organization_id,
        }
    if invitation.status != "pending":
        raise HTTPException(status_code=400, detail="Invitation is no longer pending")
    if invitation.expires_at < _current_time_for(invitation.expires_at):
        invitation.status = "expired"
        db.commit()
        raise HTTPException(status_code=400, detail="Invitation has expired")

    return _accept_invitation_record(invitation, db, current_user)


def list_organization_members_payload(
    org_id: str,
    db: Session,
    current_user: models.User,
) -> List[Dict[str, Any]]:
    auth.require_org_member(db, current_user, org_id)
    members = db.query(models.User).options(
        joinedload(models.User.user_organizations).joinedload(models.UserOrganization.organization),
        joinedload(models.User.group_memberships).joinedload(models.GroupMembership.group),
    ).join(models.UserOrganization).filter(models.UserOrganization.organization_id == org_id).all()
    return [format_user_payload(member) for member in members]
