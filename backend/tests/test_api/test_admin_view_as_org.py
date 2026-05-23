"""TDD tests for P2 #22 — system-admin "view-as-org" mode.

A system-admin can explicitly enter and exit a "view-as" session against
a specific org. Both transitions append an audit log line so the org's
audit history (P2 #21) shows that a system-admin was operating with
that org's scope at a known time.

  POST   /api/admin/view-as-org/{org_id}  → 200, returns org info, audit BEGIN
  DELETE /api/admin/view-as-org/{org_id}  → 200, audit END

Access is restricted to system-admin. Org-admins / members get 403.
Unknown org_id returns 404.
"""
import pytest
from fastapi.testclient import TestClient

from src.api.crud import create_organization, create_user


def login(client: TestClient, username: str, password: str = "securepassword123") -> str:
    response = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200, response.text
    return response.json()["access_token"]


def make_user(db, username, email, role="member"):
    return create_user(
        db,
        {
            "username": username,
            "email": email,
            "password": "securepassword123",
            "role": role,
        },
    )


def test_view_as_org_begin_returns_org_and_audits(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_vaso", "sys_vaso@example.com", role="system-admin")
    org = create_organization(db_session, {"name": "ViewAsOrg"})
    token = login(client, sysadmin.username)

    res = client.post(
        f"/api/admin/view-as-org/{org.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["organization_id"] == org.id
    assert body["organization_name"] == "ViewAsOrg"
    assert body["mode"] == "begin"

    # An audit-log row must exist with action=VIEW_AS_ORG_BEGIN and org=ViewAsOrg.
    logs_res = client.get(
        "/api/admin/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert logs_res.status_code == 200
    actions = [row["action"] for row in logs_res.json()]
    assert "VIEW_AS_ORG_BEGIN" in actions


def test_view_as_org_end_appends_audit(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_vaso_end", "sys_vaso_end@example.com", role="system-admin")
    org = create_organization(db_session, {"name": "EndAsOrg"})
    token = login(client, sysadmin.username)

    client.post(
        f"/api/admin/view-as-org/{org.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    res = client.delete(
        f"/api/admin/view-as-org/{org.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["mode"] == "end"

    logs = client.get(
        "/api/admin/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    actions = [row["action"] for row in logs]
    assert "VIEW_AS_ORG_END" in actions


def test_view_as_org_blocks_non_system_admin(client: TestClient, db_session):
    member = make_user(db_session, "vaso_member", "vaso_member@example.com")
    org = create_organization(db_session, {"name": "BlockedOrg"})
    token = login(client, member.username)
    res = client.post(
        f"/api/admin/view-as-org/{org.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403, res.text


def test_view_as_org_404_for_unknown_org(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_vaso_404", "sys_vaso_404@example.com", role="system-admin")
    token = login(client, sysadmin.username)
    res = client.post(
        "/api/admin/view-as-org/nonexistent",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404, res.text
