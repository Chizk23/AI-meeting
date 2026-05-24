from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload

from src.api import auth, models, schemas
from src.api.domains.admin.runtime import append_admin_audit_log
from src.api.core.notifications_support import create_persisted_notification, push_runtime_notification
from src.api.crud import (
    add_user_to_group,
    create_group,
    create_group_message,
    delete_group,
    delete_group_message,
    get_group_by_id,
    get_group_memberships,
    get_group_messages,
    get_user_by_email,
    get_user_by_id,
    get_groups_by_org,
    remove_user_from_group,
    update_group,
    update_group_membership,
    update_group_message,
)


class GroupInviteByEmailRequest(BaseModel):
    email: str
    role: str = "member"


def enrich_group_payload(group: models.Group) -> Dict[str, Any]:
    meetings = group.meetings or []
    total_minutes = sum((meeting.duration or 0) for meeting in meetings)
    return {
        "id": group.id,
        "organization_id": group.organization_id,
        "name": group.name,
        "description": group.description,
        "privacy_level": group.privacy_level,
        "settings": group.settings,
        "created_by": group.created_by,
        "created_at": group.created_at,
        "updated_at": group.updated_at,
        "member_count": len(group.memberships or []),
        "meeting_count": len(meetings),
        "total_hours": round(total_minutes / 60, 2),
    }


def group_member_payload(membership: models.GroupMembership) -> Dict[str, Any]:
    user = membership.user
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "avatar_url": user.avatar_url,
        "language": user.language or "vi",
        "timezone": user.timezone or "Asia/Ho_Chi_Minh",
        "notification_preferences": user.notification_preferences,
        "is_active": user.is_active,
        "is_verified": user.is_verified,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
        "last_login": user.last_login,
        "groupMemberships": [{"groupId": membership.group_id, "role": membership.role}],
    }


def list_groups_payload(org_id: str, db: Session, current_user: models.User) -> List[schemas.Group]:
    auth.require_org_member(db, current_user, org_id)
    groups = get_groups_by_org(db, org_id)
    visible_groups = []
    for group in groups:
        if group.privacy_level != "private":
            visible_groups.append(group)
            continue
        if current_user.role == "system-admin":
            visible_groups.append(group)
            continue
        org_role = auth.get_user_org_role(db, current_user, org_id)
        group_role = auth.get_user_group_role(db, current_user, group.id)
        if org_role == "org-admin" or group_role:
            visible_groups.append(group)
    return [schemas.Group.model_validate(enrich_group_payload(group)) for group in visible_groups]


def get_group_payload(group_id: str, db: Session, current_user: models.User) -> schemas.Group:
    auth.require_group_member(db, current_user, group_id)
    group = get_group_by_id(db, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    return schemas.Group.model_validate(enrich_group_payload(group))


def create_group_payload(
    group_data: schemas.GroupCreate,
    db: Session,
    current_user: models.User,
) -> schemas.Group:
    auth.require_org_admin(db, current_user, group_data.organization_id)
    group = create_group(db, group_data.model_dump(), created_by=current_user.id)
    append_admin_audit_log(
        actor=current_user.username,
        action="CREATE_GROUP",
        target=group.name,
        role=current_user.role or "org-admin",
    )
    return schemas.Group.model_validate(enrich_group_payload(group))


def update_group_payload(
    group_id: str,
    updates: schemas.GroupUpdate,
    db: Session,
    current_user: models.User,
) -> schemas.Group:
    auth.require_group_admin(db, current_user, group_id)
    group = update_group(db, group_id, updates.model_dump(exclude_unset=True))
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    append_admin_audit_log(
        actor=current_user.username,
        action="UPDATE_GROUP",
        target=group.name,
        role=current_user.role or "group-admin",
    )
    return schemas.Group.model_validate(enrich_group_payload(group))


def delete_group_payload(group_id: str, db: Session, current_user: models.User) -> Dict[str, str]:
    auth.require_group_admin(db, current_user, group_id)
    group = get_group_by_id(db, group_id)
    if not delete_group(db, group_id):
        raise HTTPException(status_code=404, detail="Group not found")
    append_admin_audit_log(
        actor=current_user.username,
        action="DELETE_GROUP",
        target=group.name if group else group_id,
        role=current_user.role or "group-admin",
    )
    return {"message": "Group deleted successfully"}


def list_group_members_payload(group_id: str, db: Session, current_user: models.User) -> List[Dict[str, Any]]:
    auth.require_group_member(db, current_user, group_id)
    return [group_member_payload(membership) for membership in get_group_memberships(db, group_id)]


def search_invitable_group_users_payload(
    group_id: str,
    q: str,
    db: Session,
    current_user: models.User,
) -> List[Dict[str, Any]]:
    group = auth.require_group_admin(db, current_user, group_id)
    query = q.strip().lower()

    existing_group_user_ids = db.query(models.GroupMembership.user_id).filter(
        models.GroupMembership.group_id == group_id,
    )
    filters = [
        models.UserOrganization.organization_id == group.organization_id,
        models.User.is_active == True,
        ~models.User.id.in_(existing_group_user_ids),
    ]
    if len(query) >= 2:
        search_pattern = f"%{query}%"
        filters.append(
            or_(
                models.User.email.ilike(search_pattern),
                models.User.username.ilike(search_pattern),
                models.User.first_name.ilike(search_pattern),
                models.User.last_name.ilike(search_pattern),
            )
        )

    users = db.query(models.User).join(models.UserOrganization).filter(
        *filters,
    ).order_by(models.User.email.asc()).limit(20).all()

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


def _validate_group_member_role(role: str, group: models.Group, db: Session, current_user: models.User) -> None:
    if role not in {"member", "group-admin"}:
        raise HTTPException(status_code=400, detail="Only member or group-admin can be assigned when adding a group member")
    current_org_role = auth.get_user_org_role(db, current_user, group.organization_id)
    if role == "group-admin" and current_org_role not in {"system-admin", "org-admin"}:
        raise HTTPException(status_code=403, detail="Only organization admins can grant group-admin role")


def add_group_member_payload(
    group_id: str,
    membership: schemas.GroupMembershipCreate,
    db: Session,
    current_user: models.User,
) -> models.GroupMembership:
    group = auth.require_group_admin(db, current_user, group_id)
    _validate_group_member_role(membership.role, group, db, current_user)
    user = get_user_by_id(db, membership.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not auth.get_user_org_role(db, user, group.organization_id):
        raise HTTPException(status_code=400, detail="User must belong to the group organization")
    existing_membership = db.query(models.GroupMembership).filter(
        models.GroupMembership.group_id == group_id,
        models.GroupMembership.user_id == user.id,
    ).first()
    if existing_membership:
        raise HTTPException(status_code=409, detail="Người dùng đã ở trong nhóm này rồi.")

    created_membership = add_user_to_group(db, group_id, user.id, membership.role, invited_by=current_user.id)
    create_persisted_notification(
        db,
        recipient_user_id=user.id,
        notification_type="user",
        priority="today",
        title="Bạn đã được thêm vào nhóm",
        message=f"{current_user.email} đã thêm bạn vào nhóm {group.name}.",
        metadata={
            "groupId": group.id,
            "groupName": group.name,
            "organizationId": group.organization_id,
            "role": membership.role,
            "type": "group-member-added",
        },
        source_type="group-membership",
        source_id=created_membership.id,
    )
    append_admin_audit_log(
        actor=current_user.username,
        action="ADD_GROUP_MEMBER",
        target=f"{user.email} -> {group.name}",
        role=current_user.role or "group-admin",
    )
    return created_membership


def add_group_member_by_email_payload(
    group_id: str,
    payload: Mapping[str, Any],
    db: Session,
    current_user: models.User,
) -> models.GroupMembership:
    group = auth.require_group_admin(db, current_user, group_id)
    email = str(payload.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")
    role = str(payload.get("role") or "member")
    _validate_group_member_role(role, group, db, current_user)

    user = get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=404, detail="Email này chưa có tài khoản. Hãy mời vào tổ chức trước.")

    if not auth.get_user_org_role(db, user, group.organization_id):
        raise HTTPException(status_code=400, detail="Người dùng chưa thuộc tổ chức. Hãy mời vào tổ chức trước.")

    existing_membership = db.query(models.GroupMembership).filter(
        models.GroupMembership.group_id == group_id,
        models.GroupMembership.user_id == user.id,
    ).first()
    if existing_membership:
        raise HTTPException(status_code=409, detail="Người dùng đã ở trong nhóm này rồi.")

    membership = add_user_to_group(db, group_id, user.id, role, invited_by=current_user.id)
    create_persisted_notification(
        db,
        recipient_user_id=user.id,
        notification_type="user",
        priority="today",
        title="Bạn đã được thêm vào nhóm",
        message=f"{current_user.email} đã thêm bạn vào nhóm {group.name}.",
        metadata={
            "groupId": group.id,
            "groupName": group.name,
            "organizationId": group.organization_id,
            "role": role,
            "type": "group-member-added",
        },
        source_type="group-membership",
        source_id=membership.id,
    )
    append_admin_audit_log(
        actor=current_user.username,
        action="ADD_GROUP_MEMBER",
        target=f"{email} -> {group.name}",
        role=current_user.role or "group-admin",
    )
    return membership


def update_group_member_payload(
    group_id: str,
    user_id: str,
    updates: schemas.GroupMembershipUpdate,
    db: Session,
    current_user: models.User,
) -> models.GroupMembership:
    auth.require_group_admin(db, current_user, group_id)
    membership = update_group_membership(db, group_id, user_id, updates.model_dump(exclude_unset=True))
    if not membership:
        raise HTTPException(status_code=404, detail="Group membership not found")
    return membership


def delete_group_member_payload(group_id: str, user_id: str, db: Session, current_user: models.User) -> Dict[str, str]:
    auth.require_group_admin(db, current_user, group_id)
    if not remove_user_from_group(db, group_id, user_id):
        raise HTTPException(status_code=404, detail="Group membership not found")
    return {"message": "Group member removed successfully"}


def get_group_messages_payload(
    group_id: str,
    limit: int,
    offset: int,
    db: Session,
    current_user: models.User,
) -> List[models.GroupMessage]:
    auth.require_strict_group_member(db, current_user, group_id)
    return get_group_messages(db, group_id, limit, offset)


def create_group_message_payload(
    group_id: str,
    message: schemas.GroupMessageCreate,
    db: Session,
    current_user: models.User,
) -> models.GroupMessage:
    group = auth.require_strict_group_member(db, current_user, group_id)
    created_message = create_group_message(db, group_id, current_user.id, message.text, reply_to_id=message.reply_to_id)

    actor_name = current_user.first_name or current_user.username or current_user.email
    memberships = db.query(models.GroupMembership).filter(
        models.GroupMembership.group_id == group_id
    ).all()
    recipient_ids = {
        membership.user_id
        for membership in memberships
        if membership.user_id != current_user.id
    }

    timestamp = datetime.now(timezone.utc).isoformat()
    for recipient_id in recipient_ids:
        push_runtime_notification(
            {
                "id": f"group-message-{created_message.id}-{recipient_id}",
                "type": "mention",
                "priority": "today",
                "title": "Tin nhan moi trong team",
                "message": f'{actor_name} vua gui tin nhan moi trong team "{group.name}".',
                "timestamp": timestamp,
                "isRead": False,
                "metadata": {
                    "group": group.name,
                    "group_id": group.id,
                    "message_id": created_message.id,
                },
                "recipient_user_id": recipient_id,
            }
        )

    return created_message


def get_latest_group_message_payload(
    group_id: str,
    db: Session,
    current_user: models.User,
) -> Optional[models.GroupMessage]:
    auth.require_strict_group_member(db, current_user, group_id)
    return (
        db.query(models.GroupMessage)
        .options(joinedload(models.GroupMessage.user))
        .filter(models.GroupMessage.group_id == group_id)
        .order_by(models.GroupMessage.created_at.desc())
        .first()
    )


def update_group_message_payload(
    message_id: str,
    updates: schemas.GroupMessageUpdate,
    db: Session,
    current_user: models.User,
) -> models.GroupMessage:
    db_message = db.query(models.GroupMessage).filter(models.GroupMessage.id == message_id).first()
    if not db_message:
        raise HTTPException(status_code=404, detail="Message not found")
    auth.require_strict_group_member(db, current_user, db_message.group_id)

    if db_message.user_id != current_user.id:
        auth.require_group_admin(db, current_user, db_message.group_id)

    updated = update_group_message(db, message_id, updates.model_dump(exclude_unset=True))
    if not updated:
        raise HTTPException(status_code=404, detail="Message not found")
    return updated


def delete_group_message_payload(message_id: str, db: Session, current_user: models.User) -> Dict[str, str]:
    db_message = db.query(models.GroupMessage).filter(models.GroupMessage.id == message_id).first()
    if not db_message:
        raise HTTPException(status_code=404, detail="Message not found")
    auth.require_strict_group_member(db, current_user, db_message.group_id)

    if db_message.user_id != current_user.id:
        auth.require_group_admin(db, current_user, db_message.group_id)

    success = delete_group_message(db, message_id)
    if not success:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"message": "Message deleted"}
