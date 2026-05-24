from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api import auth, schemas
from src.api.domains.organizations.groups import (
    GroupInviteByEmailRequest,
    add_group_member_by_email_payload,
    add_group_member_payload,
    create_group_message_payload,
    create_group_payload,
    delete_group_member_payload,
    delete_group_message_payload,
    delete_group_payload,
    get_group_messages_payload,
    get_group_payload,
    get_latest_group_message_payload,
    list_group_members_payload,
    list_groups_payload,
    search_invitable_group_users_payload,
    update_group_member_payload,
    update_group_message_payload,
    update_group_payload,
)
from src.api.database import get_db

router = APIRouter(tags=["groups"])


@router.get("/api/groups", response_model=List[schemas.Group])
def list_groups(
    org_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return list_groups_payload(org_id, db, current_user)


@router.get("/api/groups/{group_id}", response_model=schemas.Group)
def get_group(
    group_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_group_payload(group_id, db, current_user)


@router.post("/api/groups", response_model=schemas.Group)
def create_group(
    group_data: schemas.GroupCreate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return create_group_payload(group_data, db, current_user)


@router.patch("/api/groups/{group_id}", response_model=schemas.Group)
def update_group(
    group_id: str,
    updates: schemas.GroupUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_group_payload(group_id, updates, db, current_user)


@router.delete("/api/groups/{group_id}")
def delete_group(
    group_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return delete_group_payload(group_id, db, current_user)


@router.get("/api/groups/{group_id}/members", response_model=List[schemas.GroupMember])
def list_group_members(
    group_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return list_group_members_payload(group_id, db, current_user)


@router.get("/api/groups/{group_id}/users/search", response_model=List[schemas.UserSearchResult])
def search_invitable_group_users(
    group_id: str,
    q: str = "",
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return search_invitable_group_users_payload(group_id, q, db, current_user)


@router.post("/api/groups/{group_id}/members", response_model=schemas.GroupMembership)
def add_group_member(
    group_id: str,
    membership: schemas.GroupMembershipCreate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return add_group_member_payload(group_id, membership, db, current_user)


@router.post("/api/groups/{group_id}/members/invite-by-email", response_model=schemas.GroupMembership)
def add_group_member_by_email(
    group_id: str,
    payload: GroupInviteByEmailRequest,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return add_group_member_by_email_payload(group_id, payload.model_dump(), db, current_user)


@router.patch("/api/groups/{group_id}/members/{user_id}", response_model=schemas.GroupMembership)
def update_group_member(
    group_id: str,
    user_id: str,
    updates: schemas.GroupMembershipUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_group_member_payload(group_id, user_id, updates, db, current_user)


@router.delete("/api/groups/{group_id}/members/{user_id}")
def delete_group_member(
    group_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return delete_group_member_payload(group_id, user_id, db, current_user)


@router.get("/api/groups/{group_id}/messages", response_model=List[schemas.GroupMessage])
def get_group_messages(
    group_id: str,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_group_messages_payload(group_id, limit, offset, db, current_user)


@router.post("/api/groups/{group_id}/messages", response_model=schemas.GroupMessage)
def create_group_message(
    group_id: str,
    message: schemas.GroupMessageCreate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return create_group_message_payload(group_id, message, db, current_user)


@router.get("/api/groups/{group_id}/messages/latest", response_model=Optional[schemas.GroupMessage])
def get_latest_group_message(
    group_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_latest_group_message_payload(group_id, db, current_user)


@router.patch("/api/groups/messages/{message_id}", response_model=schemas.GroupMessage)
def update_group_message(
    message_id: str,
    updates: schemas.GroupMessageUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_group_message_payload(message_id, updates, db, current_user)


@router.delete("/api/groups/messages/{message_id}")
def delete_group_message(
    message_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return delete_group_message_payload(message_id, db, current_user)
