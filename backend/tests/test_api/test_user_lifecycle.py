"""TDD tests for P1 #16 (soft-delete + reassign ownership) and #17
(invalidate tokens when an admin suspends/deletes a user).

User-level deletion behaviour (per audit plan, verbatim user decision):
- Soft-delete: keep the row, mark is_active=False (and is_deleted=True once
  the new column lands).
- Reassign active ownership of meetings created by the deleted user to an
  org-admin of the same organization so resources are not orphaned.
- Audit history (audit_logs) stays intact.

Token invalidation:
- A token issued before suspension must no longer be usable after the
  admin sets is_active=False / deletes the user.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from src.api import models
from src.api.crud import (
    add_user_to_organization,
    create_meeting,
    create_organization,
    create_user,
)
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
def client(monkeypatch):
    from src.api.domains.admin import runtime
    monkeypatch.setattr(runtime, "_runtime_session_factory", TestingSessionLocal)
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


def login(client: TestClient, username: str, password: str = "securepassword123") -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


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


def test_admin_soft_delete_user_marks_inactive_and_reassigns_meeting_ownership(
    client: TestClient, db_session: Session
):
    sysadmin = make_user(db_session, "sys_admin", "sys@example.com", role="system-admin")
    org_admin = make_user(db_session, "org_admin", "orgadmin@example.com")
    member = make_user(db_session, "the_member", "the_member@example.com")

    org = create_organization(
        db_session,
        {"name": "Acme Co", "settings": {"approval_status": "active"}},
    )
    add_user_to_organization(db_session, org_admin.id, org.id, "org-admin")
    add_user_to_organization(db_session, member.id, org.id, "member")

    meeting_owned_by_member = create_meeting(
        db_session,
        {"title": "Member's meeting", "organization_id": org.id, "status": "live"},
        created_by=member.id,
    )

    sysadmin_token = login(client, sysadmin.username)
    res = client.delete(
        f"/api/admin/users/{member.id}",
        headers={"Authorization": f"Bearer {sysadmin_token}"},
    )
    assert res.status_code == 200, res.text

    db_session.expire_all()
    refreshed_member = db_session.query(models.User).filter_by(id=member.id).one()
    assert refreshed_member.is_active is False, "soft-delete must mark user inactive"

    refreshed_meeting = db_session.query(models.Meeting).filter_by(id=meeting_owned_by_member.id).one()
    assert refreshed_meeting.created_by == org_admin.id, (
        "active ownership of the member's meeting must be reassigned to the org-admin"
    )


def test_soft_delete_reassigns_action_items_only_within_their_org(
    client: TestClient, db_session: Session
):
    """Regression for the cross-org action-item bug found in PR #3 review:
    when the deleted user belongs to two orgs, action items must follow the
    org boundary of their parent meeting — they cannot all be vacuumed into
    the first org's admin.
    """
    sysadmin = make_user(db_session, "sys_admin_xorg", "sys_xorg@example.com", role="system-admin")
    admin_a = make_user(db_session, "admin_a_xorg", "admin_a_xorg@example.com")
    admin_b = make_user(db_session, "admin_b_xorg", "admin_b_xorg@example.com")
    member = make_user(db_session, "multi_member", "multi_member@example.com")

    org_a = create_organization(db_session, {"name": "Org A xorg", "settings": {"approval_status": "active"}})
    org_b = create_organization(db_session, {"name": "Org B xorg", "settings": {"approval_status": "active"}})
    add_user_to_organization(db_session, admin_a.id, org_a.id, "org-admin")
    add_user_to_organization(db_session, admin_b.id, org_b.id, "org-admin")
    add_user_to_organization(db_session, member.id, org_a.id, "member")
    add_user_to_organization(db_session, member.id, org_b.id, "member")

    meeting_a = create_meeting(
        db_session,
        {"title": "Meeting in A", "organization_id": org_a.id, "status": "live"},
        created_by=member.id,
    )
    meeting_b = create_meeting(
        db_session,
        {"title": "Meeting in B", "organization_id": org_b.id, "status": "live"},
        created_by=member.id,
    )
    action_a = models.ActionItem(
        meeting_id=meeting_a.id,
        title="todo in A",
        description="x",
        created_by=member.id,
    )
    action_b = models.ActionItem(
        meeting_id=meeting_b.id,
        title="todo in B",
        description="y",
        created_by=member.id,
    )
    db_session.add_all([action_a, action_b])
    db_session.commit()
    db_session.refresh(action_a)
    db_session.refresh(action_b)

    sysadmin_token = login(client, sysadmin.username)
    res = client.delete(
        f"/api/admin/users/{member.id}",
        headers={"Authorization": f"Bearer {sysadmin_token}"},
    )
    assert res.status_code == 200, res.text

    db_session.expire_all()
    refreshed_a = db_session.query(models.ActionItem).filter_by(id=action_a.id).one()
    refreshed_b = db_session.query(models.ActionItem).filter_by(id=action_b.id).one()

    assert refreshed_a.created_by == admin_a.id, "action item in org A must go to org A's admin"
    assert refreshed_b.created_by == admin_b.id, "action item in org B must go to org B's admin"


def test_admin_suspend_user_invalidates_existing_token(client: TestClient, db_session: Session):
    sysadmin = make_user(db_session, "sysadmin_susp", "sysadmin_susp@example.com", role="system-admin")
    target = make_user(db_session, "target_user", "target_user@example.com")

    target_token = login(client, target.username)

    # Sanity: the token works while the user is active.
    me_before = client.get("/api/profile", headers={"Authorization": f"Bearer {target_token}"})
    assert me_before.status_code == 200

    sysadmin_token = login(client, sysadmin.username)
    res = client.patch(
        f"/api/admin/users/{target.id}/status",
        json={"is_active": False},
        headers={"Authorization": f"Bearer {sysadmin_token}"},
    )
    assert res.status_code == 200, res.text

    # The previously-issued token must now be rejected because the user
    # is no longer active.
    me_after = client.get("/api/profile", headers={"Authorization": f"Bearer {target_token}"})
    assert me_after.status_code in (401, 403), (
        f"Suspended user's token must be rejected, got {me_after.status_code}: {me_after.text}"
    )
