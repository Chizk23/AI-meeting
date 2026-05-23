import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from src.api import auth, models
from src.api.crud import add_user_to_organization, create_group, create_organization, create_user
from src.api.database import Base, get_db
from src.api.main import app


TEST_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture(scope="function")
def client():
    Base.metadata.create_all(bind=test_engine)
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.pop(get_db, None)
    Base.metadata.drop_all(bind=test_engine)


@pytest.fixture()
def db_session():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


def make_user(db: Session, username: str, email: str, role: str = "member") -> models.User:
    return create_user(
        db,
        {
            "username": username,
            "email": email,
            "password": "securepassword123",
            "role": role,
        },
    )


def auth_headers(client: TestClient, username: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": "securepassword123"},
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def make_active_org(db: Session, admin_user: models.User, name: str = "Acme") -> models.Organization:
    org = create_organization(db, {"name": name, "settings": {"approval_status": "active"}})
    add_user_to_organization(db, admin_user.id, org.id, "org-admin")
    return org


def make_invitation(
    db: Session,
    organization_id: str,
    invited_by: str,
    email: str,
    token: str = "invite-token",
    group_id: str | None = None,
    role: str = "member",
    expires_at: datetime | None = None,
    status: str = "pending",
) -> models.Invitation:
    invitation = models.Invitation(
        email=email,
        organization_id=organization_id,
        group_id=group_id,
        role=role,
        token_hash=auth.get_password_hash(token),
        token_sha256=hashlib.sha256(token.encode("utf-8")).hexdigest(),
        status=status,
        expires_at=expires_at or (datetime.now(timezone.utc) + timedelta(days=7)),
        invited_by=invited_by,
    )
    db.add(invitation)
    db.commit()
    db.refresh(invitation)
    return invitation


def test_member_and_system_admin_create_organizations(client: TestClient, db_session: Session):
    member = make_user(db_session, "member", "member@example.com")
    sysadmin = make_user(db_session, "sysadmin", "sysadmin@example.com", role="system-admin")

    member_response = client.post(
        "/api/organizations",
        headers=auth_headers(client, member.username),
        json={"name": "Pending Org"},
    )
    assert member_response.status_code == 200
    member_org = member_response.json()
    assert member_org["approval_status"] == "pending"

    member_membership = db_session.query(models.UserOrganization).filter_by(
        user_id=member.id,
        organization_id=member_org["id"],
    ).first()
    assert member_membership is not None
    assert member_membership.role == "member"

    admin_response = client.post(
        "/api/organizations",
        headers=auth_headers(client, sysadmin.username),
        json={"name": "Active Org"},
    )
    assert admin_response.status_code == 200
    admin_org = admin_response.json()
    assert admin_org["approval_status"] == "active"

    admin_membership = db_session.query(models.UserOrganization).filter_by(
        user_id=sysadmin.id,
        organization_id=admin_org["id"],
    ).first()
    assert admin_membership is not None
    assert admin_membership.role == "org-admin"


def test_organization_approval_transitions_and_member_listing(client: TestClient, db_session: Session):
    creator = make_user(db_session, "creator", "creator@example.com")
    sysadmin = make_user(db_session, "sysadmin", "sysadmin@example.com", role="system-admin")

    create_response = client.post(
        "/api/organizations",
        headers=auth_headers(client, creator.username),
        json={"name": "Review Org"},
    )
    assert create_response.status_code == 200
    org_id = create_response.json()["id"]

    approve_response = client.post(
        f"/api/admin/organizations/{org_id}/approve",
        headers=auth_headers(client, sysadmin.username),
    )
    assert approve_response.status_code == 200
    assert approve_response.json()["approval_status"] == "active"

    membership = db_session.query(models.UserOrganization).filter_by(
        user_id=creator.id,
        organization_id=org_id,
    ).first()
    assert membership is not None
    assert membership.role == "org-admin"

    members_response = client.get(
        f"/api/organizations/{org_id}/members",
        headers=auth_headers(client, creator.username),
    )
    assert members_response.status_code == 200
    assert members_response.json()[0]["orgMemberships"][0]["role"] == "org-admin"

    suspend_response = client.post(
        f"/api/admin/organizations/{org_id}/suspend",
        headers=auth_headers(client, sysadmin.username),
    )
    assert suspend_response.status_code == 200
    assert suspend_response.json()["detail"] == "Organization suspended"

    other_org = client.post(
        "/api/organizations",
        headers=auth_headers(client, creator.username),
        json={"name": "Rejected Org"},
    ).json()
    reject_response = client.post(
        f"/api/admin/organizations/{other_org['id']}/reject",
        headers=auth_headers(client, sysadmin.username),
    )
    assert reject_response.status_code == 200
    assert reject_response.json()["detail"] == "Organization rejected"


def test_search_and_registered_user_invitation_flow(client: TestClient, db_session: Session, monkeypatch):
    admin_user = make_user(db_session, "orgadmin", "orgadmin@example.com")
    invitee = make_user(db_session, "invitee", "invitee@example.com")
    existing_member = make_user(db_session, "member2", "member2@example.com")
    org = make_active_org(db_session, admin_user)
    add_user_to_organization(db_session, existing_member.id, org.id, "member")
    group = create_group(
        db_session,
        {"organization_id": org.id, "name": "Product", "privacy_level": "internal"},
        created_by=admin_user.id,
    )

    search_headers = auth_headers(client, admin_user.username)
    too_short = client.get(
        f"/api/organizations/{org.id}/users/search",
        headers=search_headers,
        params={"q": "i"},
    )
    assert too_short.status_code == 200
    assert too_short.json() == []

    search_response = client.get(
        f"/api/organizations/{org.id}/users/search",
        headers=search_headers,
        params={"q": "invitee"},
    )
    assert search_response.status_code == 200
    assert search_response.json()[0]["email"] == "invitee@example.com"

    alias_response = client.get(
        "/api/users/search",
        headers=search_headers,
        params={"organization_id": org.id, "q": "member2"},
    )
    assert alias_response.status_code == 200
    assert alias_response.json() == []

    monkeypatch.setattr("src.api.core.organization_operations.send_email", lambda *args, **kwargs: False)

    invalid_group = client.post(
        "/api/invitations",
        headers=search_headers,
        json={
            "email": "invitee@example.com",
            "organization_id": org.id,
            "group_id": "wrong-group",
            "role": "member",
        },
    )
    assert invalid_group.status_code == 400

    duplicate_member = client.post(
        "/api/invitations",
        headers=search_headers,
        json={
            "email": "member2@example.com",
            "organization_id": org.id,
            "role": "member",
        },
    )
    assert duplicate_member.status_code == 409

    invite_response = client.post(
        "/api/invitations",
        headers=search_headers,
        json={
            "email": "invitee@example.com",
            "organization_id": org.id,
            "group_id": group.id,
            "role": "group-admin",
        },
    )
    assert invite_response.status_code == 200
    assert invite_response.json()["alreadyPending"] is False
    assert db_session.query(models.Notification).count() == 1

    pending_response = client.post(
        "/api/invitations",
        headers=search_headers,
        json={
            "email": "invitee@example.com",
            "organization_id": org.id,
            "group_id": group.id,
            "role": "group-admin",
        },
    )
    assert pending_response.status_code == 200
    assert pending_response.json()["alreadyPending"] is True
    assert db_session.query(models.Notification).count() == 1


def test_preview_pending_and_accept_invitation_flows(client: TestClient, db_session: Session):
    admin_user = make_user(db_session, "orgadmin", "orgadmin@example.com")
    invitee = make_user(db_session, "acceptuser", "acceptuser@example.com")
    stranger = make_user(db_session, "stranger", "stranger@example.com")
    org = make_active_org(db_session, admin_user, name="Accept Org")
    group = create_group(
        db_session,
        {"organization_id": org.id, "name": "Ops", "privacy_level": "private"},
        created_by=admin_user.id,
    )
    invitation = make_invitation(
        db_session,
        org.id,
        admin_user.id,
        invitee.email,
        token="accept-token",
        group_id=group.id,
        role="group-admin",
    )

    preview_response = client.get("/api/invitations/preview", params={"token": "accept-token"})
    assert preview_response.status_code == 200
    assert preview_response.json()["organization_id"] == org.id

    pending_headers = auth_headers(client, invitee.username)
    pending_response = client.get("/api/invitations/pending", headers=pending_headers)
    assert pending_response.status_code == 200
    assert pending_response.json()[0]["id"] == invitation.id

    accept_response = client.post(
        "/api/invitations/accept",
        headers=pending_headers,
        json={"token": "accept-token"},
    )
    assert accept_response.status_code == 200
    assert accept_response.json()["organization_id"] == org.id

    db_session.refresh(invitation)
    assert invitation.status == "accepted"

    org_membership = db_session.query(models.UserOrganization).filter_by(
        user_id=invitee.id,
        organization_id=org.id,
    ).first()
    group_membership = db_session.query(models.GroupMembership).filter_by(
        user_id=invitee.id,
        group_id=group.id,
    ).first()
    assert org_membership is not None
    assert org_membership.role == "member"
    assert group_membership is not None
    assert group_membership.role == "group-admin"

    accept_again = client.post(
        "/api/invitations/accept",
        headers=pending_headers,
        json={"token": "accept-token"},
    )
    assert accept_again.status_code == 200

    expired = make_invitation(
        db_session,
        org.id,
        admin_user.id,
        stranger.email,
        token="expired-token",
        expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    expired_response = client.post(
        f"/api/invitations/{expired.id}/accept",
        headers=auth_headers(client, stranger.username),
    )
    assert expired_response.status_code == 400
    db_session.refresh(expired)
    assert expired.status == "expired"

    mismatch = make_invitation(
        db_session,
        org.id,
        admin_user.id,
        "different@example.com",
        token="mismatch-token",
    )
    mismatch_response = client.post(
        f"/api/invitations/{mismatch.id}/accept",
        headers=auth_headers(client, stranger.username),
    )
    assert mismatch_response.status_code == 400


def test_admin_organizations_filter_by_status(client: TestClient, db_session: Session):
    """GET /api/admin/organizations?status=pending must return only orgs with
    approval_status=pending. Same for active, rejected, suspended, all."""
    sysadmin = make_user(db_session, "filter_sysadmin", "filter_sysadmin@example.com", role="system-admin")

    pending_org = create_organization(db_session, {"name": "Pending Co", "settings": {"approval_status": "pending"}})
    active_org = create_organization(db_session, {"name": "Active Co", "settings": {"approval_status": "active"}})
    rejected_org = create_organization(db_session, {"name": "Rejected Co", "settings": {"approval_status": "rejected"}})

    headers = auth_headers(client, sysadmin.username)

    pending_res = client.get("/api/admin/organizations?status=pending", headers=headers)
    assert pending_res.status_code == 200, pending_res.text
    pending_payload = pending_res.json()
    assert all(item["approval_status"] == "pending" for item in pending_payload)
    assert any(item["id"] == pending_org.id for item in pending_payload)

    active_res = client.get("/api/admin/organizations?status=active", headers=headers)
    assert active_res.status_code == 200
    active_payload = active_res.json()
    assert all(item["approval_status"] == "active" for item in active_payload)
    assert any(item["id"] == active_org.id for item in active_payload)
    assert not any(item["id"] == pending_org.id for item in active_payload)

    rejected_res = client.get("/api/admin/organizations?status=rejected", headers=headers)
    assert rejected_res.status_code == 200
    assert any(item["id"] == rejected_org.id for item in rejected_res.json())

    all_res = client.get("/api/admin/organizations", headers=headers)
    assert all_res.status_code == 200
    all_ids = {item["id"] for item in all_res.json()}
    assert pending_org.id in all_ids
    assert active_org.id in all_ids
    assert rejected_org.id in all_ids


def test_admin_organizations_requires_system_admin(client: TestClient, db_session: Session):
    member = make_user(db_session, "regular_member", "regular_member@example.com")
    res = client.get("/api/admin/organizations", headers=auth_headers(client, member.username))
    assert res.status_code == 403


def test_admin_organizations_filter_paginates_after_filter(client: TestClient, db_session: Session):
    """Regression test for review bot finding: pagination must happen AFTER the
    Python-level approval_status filter, not before. Create 25 active orgs +
    a single pending org positioned at the END of the natural list, then ask
    for ?status=pending&limit=10 — the pending org must still be returned.
    """
    sysadmin = make_user(db_session, "page_sysadmin", "page_sysadmin@example.com", role="system-admin")

    # Create 25 active orgs first so they fill the "first page" of the natural
    # ordering returned by get_organizations.
    for i in range(25):
        create_organization(
            db_session,
            {"name": f"Active {i:02d}", "settings": {"approval_status": "active"}},
        )
    # Then 1 pending org that lands AFTER all the actives.
    pending = create_organization(
        db_session,
        {"name": "Late Pending", "settings": {"approval_status": "pending"}},
    )

    headers = auth_headers(client, sysadmin.username)
    res = client.get("/api/admin/organizations?status=pending&limit=10", headers=headers)
    assert res.status_code == 200, res.text
    payload = res.json()
    # Before the fix this would return [] because skip/limit was applied
    # before the python filter. After the fix the pending org is in the result.
    assert any(item["id"] == pending.id for item in payload), (
        "pending org positioned after pagination window must still be returned"
    )
