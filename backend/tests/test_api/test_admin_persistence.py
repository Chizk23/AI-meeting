"""TDD tests for P1 #8: admin runtime state (settings / prompts / broadcasts)
persists to the database, survives a simulated process restart, and is fully
re-readable after clearing the in-memory cache.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api import models
from src.api.crud import create_user
from src.api.database import Base, get_db
from src.api.main import app
from src.api.core.admin_runtime import (
    ADMIN_BROADCAST_HISTORY,
    ADMIN_PROMPTS,
    ADMIN_SYSTEM_SETTINGS,
    reload_admin_runtime_from_db,
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
    # Make admin_runtime persistence target the test engine instead of the
    # production database. We do this via a small indirection added to
    # admin_runtime: a module-level `get_runtime_session` callable.
    from src.api.core import admin_runtime as runtime
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


def admin_headers(client: TestClient, db_session) -> dict[str, str]:
    make_user(db_session, "sysadmin_persist", "sysadmin_persist@example.com", role="system-admin")
    response = client.post(
        "/api/auth/login",
        json={"username": "sysadmin_persist", "password": "securepassword123"},
    )
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_settings_update_persists_after_cache_clear(client, db_session):
    """PATCH /api/admin/settings must persist to admin_settings table so a
    restart that wipes the in-memory cache can re-read the value from DB."""
    headers = admin_headers(client, db_session)

    payload = {"maintenance_mode": True, "storage_limit_gb_per_org": 777}
    res = client.patch("/api/admin/settings", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["maintenance_mode"] is True
    assert res.json()["storage_limit_gb_per_org"] == 777

    # Verify DB row exists
    row = db_session.query(models.AdminSetting).filter_by(key="maintenance_mode").one()
    assert row.value is True
    row = db_session.query(models.AdminSetting).filter_by(key="storage_limit_gb_per_org").one()
    assert row.value == 777

    # Simulate restart: wipe in-memory cache, reload from DB
    ADMIN_SYSTEM_SETTINGS.clear()
    reload_admin_runtime_from_db()

    assert ADMIN_SYSTEM_SETTINGS.get("maintenance_mode") is True
    assert ADMIN_SYSTEM_SETTINGS.get("storage_limit_gb_per_org") == 777

    # And the HTTP endpoint reads the same value
    res2 = client.get("/api/admin/settings", headers=headers)
    assert res2.status_code == 200
    assert res2.json()["maintenance_mode"] is True
    assert res2.json()["storage_limit_gb_per_org"] == 777


def test_prompt_update_persists_after_cache_clear(client, db_session):
    """PUT /api/admin/prompts/{key} must persist to admin_prompts table."""
    headers = admin_headers(client, db_session)

    payload = {
        "key": "summary_vi",
        "name": "Tóm tắt cuộc họp (VI) – tuỳ chỉnh",
        "description": "Phiên bản test",
        "content": "Tóm tắt theo phong cách bullet-list.",
        "version": "9.9.9",
    }
    res = client.put("/api/admin/prompts/summary_vi", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["content"] == "Tóm tắt theo phong cách bullet-list."
    assert res.json()["version"] == "9.9.9"

    row = db_session.query(models.AdminPrompt).filter_by(key="summary_vi").one()
    assert row.content == "Tóm tắt theo phong cách bullet-list."
    assert row.version == "9.9.9"

    ADMIN_PROMPTS.clear()
    reload_admin_runtime_from_db()

    assert "summary_vi" in ADMIN_PROMPTS
    assert ADMIN_PROMPTS["summary_vi"]["content"] == "Tóm tắt theo phong cách bullet-list."
    assert ADMIN_PROMPTS["summary_vi"]["version"] == "9.9.9"


def test_broadcast_create_persists_and_delete_removes_from_db(client, db_session):
    """POST /api/admin/notifications must insert into admin_broadcasts.
    DELETE must remove from both DB and in-memory list."""
    headers = admin_headers(client, db_session)

    payload = {"title": "Test broadcast", "content": "Body", "type": "info", "target": "all"}
    res = client.post("/api/admin/notifications", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    broadcast_id = res.json()["id"]

    row = db_session.query(models.AdminBroadcast).filter_by(id=broadcast_id).one()
    assert row.title == "Test broadcast"
    assert row.target == "all"

    # Simulate restart
    ADMIN_BROADCAST_HISTORY.clear()
    reload_admin_runtime_from_db()
    assert any(item["id"] == broadcast_id for item in ADMIN_BROADCAST_HISTORY)

    res = client.get("/api/admin/notifications", headers=headers)
    assert res.status_code == 200
    assert any(item["id"] == broadcast_id for item in res.json())

    # Delete
    res = client.delete(f"/api/admin/notifications/{broadcast_id}", headers=headers)
    assert res.status_code == 200

    assert db_session.query(models.AdminBroadcast).filter_by(id=broadcast_id).first() is None

    # Simulate restart again — broadcast must NOT come back
    ADMIN_BROADCAST_HISTORY.clear()
    reload_admin_runtime_from_db()
    assert not any(item["id"] == broadcast_id for item in ADMIN_BROADCAST_HISTORY)
