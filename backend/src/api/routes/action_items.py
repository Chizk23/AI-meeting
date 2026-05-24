from typing import List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api import auth, schemas
from src.api.domains.action_items.operations import (
    create_action_item_payload,
    delete_action_item_payload,
    list_action_items_payload,
    update_action_item_payload,
    update_my_action_item_assignment_payload,
)
from src.api.database import get_db

router = APIRouter()


@router.get("/api/action-items", response_model=List[schemas.ActionItem])
def list_action_items(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
    meeting_id: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
):
    return list_action_items_payload(db, current_user, meeting_id=meeting_id, status=status, skip=skip, limit=limit)


@router.post("/api/action-items", response_model=schemas.ActionItem)
def create_new_action_item(
    action_item: schemas.ActionItemCreate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return create_action_item_payload(action_item, db, current_user)


@router.patch("/api/action-items/{action_id}", response_model=schemas.ActionItem)
def update_existing_action_item(
    action_id: str,
    updates: schemas.ActionItemUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_action_item_payload(action_id, updates, db, current_user)


@router.patch("/api/action-items/{action_id}/assignees/me", response_model=schemas.ActionItem)
def update_my_action_item_assignment(
    action_id: str,
    updates: schemas.ActionItemAssigneeStatusUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_my_action_item_assignment_payload(action_id, updates, db, current_user)


@router.delete("/api/action-items/{action_id}")
def delete_existing_action_item(
    action_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return delete_action_item_payload(action_id, db, current_user)
