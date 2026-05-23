from typing import Any, Dict, List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api import auth, schemas
from src.api.core.organization_operations import (
    accept_invitation_by_id_payload,
    accept_invitation_by_token_payload,
    admin_list_organizations_payload,
    approve_organization_payload,
    create_bulk_invitations_payload,
    create_invitation_payload,
    create_organization_payload,
    delete_organization_payload,
    get_organization_payload,
    list_my_pending_invitations_payload,
    list_organization_members_payload,
    list_organizations_payload,
    preview_invitation_payload,
    reject_organization_payload,
    search_invitable_organization_users_payload,
    search_invitable_users_alias_payload,
    suspend_organization_payload,
    update_organization_payload,
)
from typing import Optional
from src.api.database import get_db

router = APIRouter(tags=["organizations"])


@router.get("/api/organizations", response_model=Any)
@router.get("/api/organizations/", response_model=Any)
def list_organizations(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return list_organizations_payload(skip, limit, db, current_user)


@router.post("/api/organizations", response_model=Any)
@router.post("/api/organizations/", response_model=Any)
def create_organization(
    org_data: schemas.OrganizationCreate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return create_organization_payload(org_data, db, current_user)


@router.get("/api/admin/organizations", response_model=Any)
def admin_list_organizations(
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return admin_list_organizations_payload(status, skip, limit, db, current_user)


@router.post("/api/admin/organizations/{org_id}/approve", response_model=schemas.Organization)
def approve_organization(
    org_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return approve_organization_payload(org_id, db, current_user)


@router.post("/api/admin/organizations/{org_id}/reject")
def reject_organization(
    org_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return reject_organization_payload(org_id, db, current_user)


@router.post("/api/admin/organizations/{org_id}/suspend")
def suspend_organization(
    org_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return suspend_organization_payload(org_id, db, current_user)


@router.get("/api/organizations/{org_id}", response_model=schemas.Organization)
def get_organization(
    org_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return get_organization_payload(org_id, db, current_user)


@router.patch("/api/organizations/{org_id}", response_model=schemas.Organization)
def update_organization(
    org_id: str,
    updates: schemas.OrganizationUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_organization_payload(org_id, updates, db, current_user)


@router.delete("/api/organizations/{org_id}")
def delete_organization(
    org_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return delete_organization_payload(org_id, db, current_user)


@router.get("/api/organizations/{org_id}/users/search", response_model=List[schemas.UserSearchResult])
def search_invitable_organization_users(
    org_id: str,
    q: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return search_invitable_organization_users_payload(org_id, q, db, current_user)


@router.get("/api/users/search", response_model=List[schemas.UserSearchResult])
def search_invitable_users_alias(
    organization_id: str,
    q: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return search_invitable_users_alias_payload(organization_id, q, db, current_user)


@router.post("/api/invitations", response_model=schemas.InvitationCreateResponse)
def create_invitation(
    inv_data: schemas.InvitationCreate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return create_invitation_payload(inv_data, db, current_user)


@router.post("/api/organizations/{org_id}/invitations/bulk", response_model=schemas.BulkInvitationResponse)
def bulk_create_invitations(
    org_id: str,
    bulk_data: schemas.BulkInvitationCreate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    bulk_data.organization_id = org_id
    return create_bulk_invitations_payload(bulk_data, db, current_user)


@router.get("/api/invitations/preview", response_model=schemas.InvitationPreview)
def preview_invitation(token: str, db: Session = Depends(get_db)):
    return preview_invitation_payload(token, db)


@router.get("/api/invitations/pending")
def list_my_pending_invitations(
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return list_my_pending_invitations_payload(db, current_user)


@router.post("/api/invitations/accept", response_model=schemas.InvitationAcceptResponse)
def accept_invitation(
    req: schemas.InvitationAccept,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return accept_invitation_by_token_payload(req, db, current_user)


@router.post("/api/invitations/{invitation_id}/accept", response_model=schemas.InvitationAcceptResponse)
def accept_invitation_by_id(
    invitation_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return accept_invitation_by_id_payload(invitation_id, db, current_user)


@router.get("/api/organizations/{org_id}/members", response_model=List[Dict[str, Any]])
def list_organization_members(
    org_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return list_organization_members_payload(org_id, db, current_user)
