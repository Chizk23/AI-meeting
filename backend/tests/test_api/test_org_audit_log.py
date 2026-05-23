"""TDD tests for P2 #21: org-scoped audit log.

`GET /api/organizations/{org_id}/audit-logs` returns AuditLog rows whose
``org`` field matches the organization's name. Access is gated to:
  - system-admin (full access)
  - org-admin of that specific organization

Anyone else gets HTTP 403.
"""
import pytest
from fastapi.testclient import TestClient

from src.api import models
from src.api.crud import (
    add_user_to_organization,
    create_organization,
    create_user,
)
from src.api.core.admin_runtime import append_admin_audit_log


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


def test_org_audit_log_returns_only_events_for_that_org(client: TestClient, db_session):
    org_admin = make_user(db_session, "oa_audit", "oa_audit@example.com")
    other_admin = make_user(db_session, "oo_audit", "oo_audit@example.com")

    org = create_organization(db_session, {"name": "AuditOrg"})
    other_org = create_organization(db_session, {"name": "OtherOrg"})
    add_user_to_organization(db_session, org_admin.id, org.id, "org-admin")
    add_user_to_organization(db_session, other_admin.id, other_org.id, "org-admin")

    append_admin_audit_log(actor="oa_audit", action="UPDATE_ORG", target=org.id, org="AuditOrg")
    append_admin_audit_log(actor="oa_audit", action="INVITE_USER", target="x@y.com", org="AuditOrg")
    append_admin_audit_log(actor="someone", action="UPDATE_ORG", target=other_org.id, org="OtherOrg")
    append_admin_audit_log(actor="oa_audit", action="LOGIN_SUCCESS", target="oa_audit", org="System")

    token = login(client, org_admin.username)
    res = client.get(
        f"/api/organizations/{org.id}/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    actions = [row["action"] for row in body]
    assert "UPDATE_ORG" in actions
    assert "INVITE_USER" in actions
    # Events from other orgs and from "System" scope must not leak.
    for row in body:
        assert row["org"] == "AuditOrg"


def test_org_audit_log_blocks_other_org_admin(client: TestClient, db_session):
    org_admin_a = make_user(db_session, "audit_a", "audit_a@example.com")
    org_admin_b = make_user(db_session, "audit_b", "audit_b@example.com")
    org_a = create_organization(db_session, {"name": "OrgAAA"})
    org_b = create_organization(db_session, {"name": "OrgBBB"})
    add_user_to_organization(db_session, org_admin_a.id, org_a.id, "org-admin")
    add_user_to_organization(db_session, org_admin_b.id, org_b.id, "org-admin")

    token = login(client, org_admin_b.username)
    res = client.get(
        f"/api/organizations/{org_a.id}/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403, res.text


def test_org_audit_log_blocks_regular_member(client: TestClient, db_session):
    member = make_user(db_session, "audit_mem", "audit_mem@example.com")
    org = create_organization(db_session, {"name": "MemOrg"})
    add_user_to_organization(db_session, member.id, org.id, "member")

    token = login(client, member.username)
    res = client.get(
        f"/api/organizations/{org.id}/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403, res.text


def test_org_audit_log_calls_ensure_audit_log_table(client: TestClient, db_session, monkeypatch):
    """Regression for Devin Review on PR #6: the audit_logs table is created
    on-demand (not via Base.metadata.create_all on prod startup outside of
    ensure_admin_runtime_tables). The endpoint must call ensure_audit_log_table()
    so a cold-start org-admin call does not 500 with OperationalError.
    """
    org_admin = make_user(db_session, "cold_oa", "cold_oa@example.com")
    org = create_organization(db_session, {"name": "ColdStartOrg"})
    add_user_to_organization(db_session, org_admin.id, org.id, "org-admin")

    called = {"count": 0}

    from src.api.core import admin_runtime as runtime

    original = runtime.ensure_audit_log_table

    def spy():
        called["count"] += 1
        original()

    monkeypatch.setattr(runtime, "ensure_audit_log_table", spy)

    token = login(client, org_admin.username)
    res = client.get(
        f"/api/organizations/{org.id}/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert called["count"] == 1, "list_organization_audit_logs_payload must call ensure_audit_log_table()"


def test_org_audit_log_allows_system_admin(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_audit", "sys_audit@example.com", role="system-admin")
    org = create_organization(db_session, {"name": "SysOrgAudit"})
    append_admin_audit_log(actor="sys_audit", action="UPDATE_ORG", target=org.id, org="SysOrgAudit")

    token = login(client, sysadmin.username)
    res = client.get(
        f"/api/organizations/{org.id}/audit-logs",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert any(row["org"] == "SysOrgAudit" for row in res.json())
