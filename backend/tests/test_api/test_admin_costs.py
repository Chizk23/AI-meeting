"""TDD tests for P2 #20: cost breakdown by organization.

``GET /api/admin/costs`` previously returned 503 (disabled). This PR
re-enables it and returns a breakdown shape:

    {
        "currency": "USD",
        "total_cost_usd": <float>,
        "organizations": [
            {
                "organization_id": <id>,
                "organization_name": <name>,
                "total_cost_usd": <float>,
                "by_service": {"openai": 1.23, "deepgram": 0.45, ...}
            },
            ...
        ]
    }

Costs from rows whose meeting has no organization (or where the meeting
is missing) collapse into an "unattributed" bucket. Only system-admins
can call this endpoint.
"""
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient

from src.api import models
from src.api.crud import (
    create_meeting,
    create_organization,
    create_user,
)


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


def test_admin_costs_breakdown_by_org(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_costs", "sys_costs@example.com", role="system-admin")
    owner = make_user(db_session, "cost_owner", "cost_owner@example.com")
    org_a = create_organization(db_session, {"name": "CostOrg A"})
    org_b = create_organization(db_session, {"name": "CostOrg B"})

    meeting_a = create_meeting(
        db_session,
        {"title": "A", "organization_id": org_a.id, "status": "completed"},
        created_by=owner.id,
    )
    meeting_b = create_meeting(
        db_session,
        {"title": "B", "organization_id": org_b.id, "status": "completed"},
        created_by=owner.id,
    )

    db_session.add_all([
        models.CostTracking(meeting_id=meeting_a.id, service="openai", cost_usd=Decimal("1.20")),
        models.CostTracking(meeting_id=meeting_a.id, service="deepgram", cost_usd=Decimal("0.30")),
        models.CostTracking(meeting_id=meeting_b.id, service="openai", cost_usd=Decimal("2.50")),
        models.CostTracking(meeting_id=None, service="openai", cost_usd=Decimal("0.10")),
    ])
    db_session.commit()

    token = login(client, sysadmin.username)
    res = client.get("/api/admin/costs", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["currency"] == "USD"
    assert abs(body["total_cost_usd"] - 4.10) < 0.001

    by_org = {row["organization_id"]: row for row in body["organizations"]}
    assert abs(by_org[org_a.id]["total_cost_usd"] - 1.50) < 0.001
    assert abs(by_org[org_b.id]["total_cost_usd"] - 2.50) < 0.001
    assert by_org[org_a.id]["organization_name"] == "CostOrg A"
    assert abs(by_org[org_a.id]["by_service"]["openai"] - 1.20) < 0.001
    assert abs(by_org[org_a.id]["by_service"]["deepgram"] - 0.30) < 0.001

    # Unattributed rows live in a bucket whose id is None
    unattributed = next((r for r in body["organizations"] if r["organization_id"] is None), None)
    assert unattributed is not None
    assert abs(unattributed["total_cost_usd"] - 0.10) < 0.001


def test_admin_costs_requires_system_admin(client: TestClient, db_session):
    member = make_user(db_session, "regular_costs", "regular_costs@example.com")
    token = login(client, member.username)
    res = client.get("/api/admin/costs", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 403, res.text


def test_admin_costs_empty_returns_zero(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_costs_empty", "sys_costs_empty@example.com", role="system-admin")
    token = login(client, sysadmin.username)
    res = client.get("/api/admin/costs", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total_cost_usd"] == 0
    assert body["organizations"] == []
