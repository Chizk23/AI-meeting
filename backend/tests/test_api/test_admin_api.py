from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api import models
from src.api.crud import create_user
from src.api.database import Base, get_db
from src.api.main import app
from src.api.domains.admin.runtime import (
    ADMIN_BROADCAST_HISTORY,
    ADMIN_PROMPTS,
    ADMIN_SYSTEM_SETTINGS,
)


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


@pytest.fixture(autouse=True)
def restore_admin_runtime_state():
    prompts_snapshot = {key: dict(value) for key, value in ADMIN_PROMPTS.items()}
    settings_snapshot = dict(ADMIN_SYSTEM_SETTINGS)
    broadcasts_snapshot = [dict(item) for item in ADMIN_BROADCAST_HISTORY]
    try:
        yield
    finally:
        ADMIN_PROMPTS.clear()
        ADMIN_PROMPTS.update(prompts_snapshot)
        ADMIN_SYSTEM_SETTINGS.clear()
        ADMIN_SYSTEM_SETTINGS.update(settings_snapshot)
        ADMIN_BROADCAST_HISTORY[:] = broadcasts_snapshot


def make_user(db_session, username: str, email: str, role: str = "member") -> models.User:
    return create_user(
        db_session,
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


def test_admin_stats_and_feature_flags(client: TestClient, db_session):
    make_user(db_session, "sysadmin", "sysadmin@example.com", role="system-admin")
    make_user(db_session, "member", "member@example.com")

    admin_headers = auth_headers(client, "sysadmin")
    member_headers = auth_headers(client, "member")

    stats_response = client.get("/api/admin/stats", headers=admin_headers)
    assert stats_response.status_code == 200
    stats = stats_response.json()
    assert stats["total_users"] == 2
    assert "total_organizations" in stats
    assert "active_meetings" in stats

    member_denied = client.get("/api/admin/stats", headers=member_headers)
    assert member_denied.status_code == 403

    admin_flags = client.get("/api/config/features", headers=admin_headers)
    member_flags = client.get("/api/config/features", headers=member_headers)
    assert admin_flags.status_code == 200
    assert admin_flags.json()["uploadEnabled"] is True
    assert member_flags.status_code == 200
    assert member_flags.json()["uploadEnabled"] is True


def test_admin_user_status_and_role_updates(client: TestClient, db_session):
    admin = make_user(db_session, "sysadmin", "sysadmin@example.com", role="system-admin")
    member = make_user(db_session, "member", "member@example.com")
    admin_headers = auth_headers(client, admin.username)

    list_response = client.get("/api/admin/users", headers=admin_headers)
    assert list_response.status_code == 200
    assert len(list_response.json()) == 2

    status_response = client.patch(
        f"/api/admin/users/{member.id}/status",
        headers=admin_headers,
        json={"is_active": False},
    )
    assert status_response.status_code == 200
    assert status_response.json()["isActive"] is False

    role_response = client.patch(
        f"/api/admin/users/{member.id}/role",
        headers=admin_headers,
        json={"role": "system-admin"},
    )
    assert role_response.status_code == 200
    assert role_response.json()["role"] == "system-admin"

    delete_response = client.delete(f"/api/admin/users/{member.id}", headers=admin_headers)
    assert delete_response.status_code == 200
    assert delete_response.json()["user_id"] == member.id


def test_admin_ai_services_and_usage(client: TestClient, db_session, monkeypatch):
    admin = make_user(db_session, "sysadmin", "sysadmin@example.com", role="system-admin")
    admin_headers = auth_headers(client, admin.username)

    monkeypatch.setenv("GROQ_API_KEY", "groq-test-key")
    monkeypatch.setenv("GOOGLE_API_KEY", "google-test-key")
    monkeypatch.setenv("LLM_PROVIDER", "google")
    monkeypatch.setenv("STT_PROVIDER", "deepgram")
    monkeypatch.setenv("PHOBERT_ENABLED", "true")

    db_session.add(
        models.CostTracking(
            service="llm",
            api_endpoint="/v1/chat/completions",
            model_name="gpt-test",
            input_tokens=11,
            output_tokens=7,
            cost_usd=0.123456,
        )
    )
    db_session.commit()

    services_response = client.get("/api/admin/ai-services", headers=admin_headers)
    assert services_response.status_code == 200
    services = services_response.json()
    assert services["llm"]["provider"] == "google"
    assert len(services["llm"]["services"]) == 2
    assert services["stt"]["provider"] == "deepgram"
    assert services["nlp"]["services"][0]["enabled"] is True

    usage_response = client.get("/api/admin/ai-services/usage", headers=admin_headers)
    assert usage_response.status_code == 200
    usage = usage_response.json()
    assert usage["monthly_cost_usd"] > 0
    assert usage["services"][0]["service"] == "llm"
    assert usage["services"][0]["request_count"] == 1


def test_admin_prompts_settings_broadcasts_and_audit_logs(client: TestClient, db_session):
    admin = make_user(db_session, "sysadmin", "sysadmin@example.com", role="system-admin")
    member = make_user(db_session, "member", "member@example.com")
    admin_headers = auth_headers(client, admin.username)

    prompt_response = client.put(
        "/api/admin/prompts/custom_prompt",
        headers=admin_headers,
        json={
            "key": "custom_prompt",
            "name": "Custom Prompt",
            "description": "admin managed prompt",
            "content": "Hello from admin",
            "version": "9.9.9",
        },
    )
    assert prompt_response.status_code == 200
    assert prompt_response.json()["content"] == "Hello from admin"

    prompts_response = client.get("/api/admin/prompts", headers=admin_headers)
    assert prompts_response.status_code == 200
    assert any(item["key"] == "custom_prompt" for item in prompts_response.json())

    settings_response = client.patch(
        "/api/admin/settings",
        headers=admin_headers,
        json={"maintenance_mode": True, "storage_limit_gb_per_org": 99},
    )
    assert settings_response.status_code == 200
    assert settings_response.json()["maintenance_mode"] is True
    assert settings_response.json()["storage_limit_gb_per_org"] == 99

    get_settings_response = client.get("/api/admin/settings", headers=admin_headers)
    assert get_settings_response.status_code == 200
    assert get_settings_response.json()["maintenance_mode"] is True

    broadcast_response = client.post(
        "/api/admin/notifications",
        headers=admin_headers,
        json={
            "title": "System notice",
            "content": "This is a broadcast",
            "type": "info",
            "target": "all",
        },
    )
    assert broadcast_response.status_code == 200
    broadcast = broadcast_response.json()
    assert broadcast["reach"] == 2

    notifications = db_session.query(models.Notification).order_by(models.Notification.created_at.asc()).all()
    assert len(notifications) == 2
    assert {item.recipient_user_id for item in notifications} == {admin.id, member.id}

    list_broadcasts_response = client.get("/api/admin/notifications", headers=admin_headers)
    assert list_broadcasts_response.status_code == 200
    assert list_broadcasts_response.json()[0]["id"] == broadcast["id"]

    delete_broadcast_response = client.delete(
        f"/api/admin/notifications/{broadcast['id']}",
        headers=admin_headers,
    )
    assert delete_broadcast_response.status_code == 200

    audit_log = models.AuditLog(
        id="audit-1",
        time=datetime.now(timezone.utc),
        user="sysadmin",
        role="System Admin",
        action="TEST_ACTION",
        target="target",
        org="System",
        ip="127.0.0.1",
    )
    db_session.add(audit_log)
    db_session.commit()

    audit_logs_response = client.get("/api/admin/audit-logs", headers=admin_headers)
    assert audit_logs_response.status_code == 200
    assert audit_logs_response.json()[0]["action"] == "TEST_ACTION"
