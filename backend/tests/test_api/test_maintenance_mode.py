"""TDD tests for P1 #9: maintenance mode middleware.

When the admin setting ``maintenance_mode`` is True, every request from a
non-system-admin user (including anonymous traffic) must be rejected with
HTTP 503. System admins keep full access so they can disable the flag.

Health, docs and the auth/login endpoints stay reachable so the admin can
still recover from a misconfiguration.
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
from src.api.domains.admin.runtime import ADMIN_SYSTEM_SETTINGS


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
def reset_maintenance_flag():
    prev = ADMIN_SYSTEM_SETTINGS.get("maintenance_mode")
    try:
        yield
    finally:
        if prev is None:
            ADMIN_SYSTEM_SETTINGS.pop("maintenance_mode", None)
        else:
            ADMIN_SYSTEM_SETTINGS["maintenance_mode"] = prev


def make_user(db, username: str, email: str, role: str = "member"):
    return create_user(
        db,
        {
            "username": username,
            "email": email,
            "password": "securepassword123",
            "role": role,
        },
    )


def login(client: TestClient, username: str) -> str:
    res = client.post(
        "/api/auth/login",
        json={"username": username, "password": "securepassword123"},
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def test_maintenance_mode_blocks_regular_user(client: TestClient, db_session):
    user = make_user(db_session, "regular", "regular@example.com")
    token = login(client, user.username)

    ADMIN_SYSTEM_SETTINGS["maintenance_mode"] = True
    res = client.get(
        "/api/profile",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 503, res.text
    body = res.json()
    detail = body.get("detail") if isinstance(body, dict) else ""
    assert "maintenance" in (detail or "").lower()


def test_maintenance_mode_allows_system_admin(client: TestClient, db_session):
    admin = make_user(db_session, "admin_user", "admin_user@example.com", role="system-admin")
    token = login(client, admin.username)

    ADMIN_SYSTEM_SETTINGS["maintenance_mode"] = True
    res = client.get(
        "/api/profile",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text


def test_maintenance_mode_allows_login_and_health(client: TestClient, db_session):
    admin = make_user(db_session, "boot_admin", "boot_admin@example.com", role="system-admin")
    ADMIN_SYSTEM_SETTINGS["maintenance_mode"] = True

    # Login endpoint must remain reachable.
    res_login = client.post(
        "/api/auth/login",
        json={"username": admin.username, "password": "securepassword123"},
    )
    assert res_login.status_code == 200

    # Health endpoint must remain reachable for liveness probes.
    res_health = client.get("/health")
    assert res_health.status_code == 200


def test_maintenance_mode_off_allows_regular_user(client: TestClient, db_session):
    user = make_user(db_session, "off_user", "off_user@example.com")
    token = login(client, user.username)
    ADMIN_SYSTEM_SETTINGS["maintenance_mode"] = False

    res = client.get(
        "/api/profile",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
