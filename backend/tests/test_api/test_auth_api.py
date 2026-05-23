import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from src.api import models
from src.api.crud import create_user
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


def register_payload(**overrides):
    payload = {
        "username": "testuser",
        "email": "test@example.com",
        "password": "securepassword123",
        "firstName": "Test",
        "lastName": "User",
        "dateOfBirth": "1995-01-01",
    }
    payload.update(overrides)
    return payload


def test_register_duplicate_username(client):
    client.post("/api/auth/register", json=register_payload(email="test1@example.com"))

    response = client.post(
        "/api/auth/register",
        json=register_payload(email="test2@example.com"),
    )

    assert response.status_code == 400
    assert "already registered" in response.json()["detail"]


def test_login_success(client):
    client.post("/api/auth/register", json=register_payload())

    response = client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "securepassword123"},
    )

    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["username"] == "testuser"


def test_login_wrong_password(client):
    client.post("/api/auth/register", json=register_payload())

    response = client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "wrongpassword"},
    )

    assert response.status_code == 401
    assert "Incorrect username or password" in response.json()["detail"]


def test_login_nonexistent_user(client):
    response = client.post(
        "/api/auth/login",
        json={"username": "nonexistent", "password": "password123"},
    )

    assert response.status_code == 401
    assert "Incorrect username or password" in response.json()["detail"]


def test_forgot_and_reset_password(client):
    client.post("/api/auth/register", json=register_payload())

    forgot_response = client.post("/api/auth/forgot-password", json={"email": "test@example.com"})
    assert forgot_response.status_code == 200
    otp = forgot_response.json().get("dev_otp")
    assert otp

    reset_response = client.post(
        "/api/auth/reset-password",
        json={"email": "test@example.com", "otp": otp, "newPassword": "newpassword123"},
    )
    assert reset_response.status_code == 200

    login_response = client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "newpassword123"},
    )
    assert login_response.status_code == 200


def test_forgot_password_triggers_email_send(client, monkeypatch):
    sent_payload = {}

    def fake_send_email(recipient_email, subject, html_content):
        sent_payload["recipient_email"] = recipient_email
        sent_payload["subject"] = subject
        sent_payload["html_content"] = html_content
        return True

    monkeypatch.setattr("src.api.main.send_email", fake_send_email)

    client.post(
        "/api/auth/register",
        json=register_payload(username="mailuser", email="mailuser@example.com"),
    )

    forgot_response = client.post("/api/auth/forgot-password", json={"email": "mailuser@example.com"})
    assert forgot_response.status_code == 200

    assert sent_payload["recipient_email"] == "mailuser@example.com"
    assert "dat lai mat khau" in sent_payload["subject"].lower()
    assert "mailuser@example.com" not in sent_payload["html_content"]


def test_profile_update(client):
    client.post("/api/auth/register", json=register_payload())
    login_response = client.post(
        "/api/auth/login",
        json={"username": "testuser", "password": "securepassword123"},
    )
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    response = client.patch(
        "/api/profile",
        headers=headers,
        json={"first_name": "Updated", "language": "en", "timezone": "UTC"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["firstName"] == "Updated"
    assert data["language"] == "en"
    assert data["timezone"] == "UTC"


def test_health_check(client):
    response = client.get("/health")

    assert response.status_code == 200
    data = response.json()
    assert data["status"] in ["healthy", "degraded"]
    assert "timestamp" in data


def test_register_without_username_generates_unique_username(client):
    response_one = client.post(
        "/api/auth/register",
        json=register_payload(username=None, email="same@example.com"),
    )
    assert response_one.status_code == 200

    response_two = client.post(
        "/api/auth/register",
        json=register_payload(username=None, email="same@another.com"),
    )
    assert response_two.status_code == 200

    login_one = client.post(
        "/api/auth/login",
        json={"username": "same", "password": "securepassword123"},
    )
    assert login_one.status_code == 200

    login_two = client.post(
        "/api/auth/login",
        json={"username": "same-2", "password": "securepassword123"},
    )
    assert login_two.status_code == 200


def test_member_created_organization_requires_approval_then_promotes_creator(client):
    register_response = client.post(
        "/api/auth/register",
        json=register_payload(
            username=None,
            email="creator@example.com",
            firstName="Org",
            lastName="Creator",
        ),
    )
    assert register_response.status_code == 200

    login_response = client.post(
        "/api/auth/login",
        json={"username": "creator@example.com", "password": "securepassword123"},
    )
    member_token = login_response.json()["access_token"]
    member_headers = {"Authorization": f"Bearer {member_token}"}

    create_org_response = client.post(
        "/api/organizations",
        headers=member_headers,
        json={"name": "Pending Org"},
    )
    assert create_org_response.status_code == 200
    organization = create_org_response.json()
    assert organization["approval_status"] == "pending"

    member_profile = client.get("/api/auth/me", headers=member_headers)
    assert member_profile.status_code == 200
    memberships = member_profile.json()["orgMemberships"]
    assert memberships[0]["role"] == "member"

    db: Session = TestingSessionLocal()
    try:
        create_user(
            db,
            {
                "username": "sysadmin",
                "email": "sysadmin@example.com",
                "password": "securepassword123",
                "role": "system-admin",
            },
        )
    finally:
        db.close()

    admin_login = client.post(
        "/api/auth/login",
        json={"username": "sysadmin", "password": "securepassword123"},
    )
    admin_token = admin_login.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    approve_response = client.post(
        f"/api/admin/organizations/{organization['id']}/approve",
        headers=admin_headers,
    )
    assert approve_response.status_code == 200
    assert approve_response.json()["approval_status"] == "active"

    refreshed_member = client.get("/api/auth/me", headers=member_headers)
    assert refreshed_member.status_code == 200
    refreshed_memberships = refreshed_member.json()["orgMemberships"]
    assert refreshed_memberships[0]["role"] == "org-admin"


def test_register_blocked_when_public_registration_disabled(client):
    from src.api.core.admin_runtime import ADMIN_SYSTEM_SETTINGS
    saved = ADMIN_SYSTEM_SETTINGS.get("public_registration_enabled", True)
    ADMIN_SYSTEM_SETTINGS["public_registration_enabled"] = False
    try:
        response = client.post(
            "/api/auth/register",
            json=register_payload(username="blocked_user", email="blocked@example.com"),
        )
        assert response.status_code == 403
        assert "Public registration is disabled" in response.json()["detail"]
    finally:
        ADMIN_SYSTEM_SETTINGS["public_registration_enabled"] = saved


def test_register_with_invite_token_allowed_even_when_public_registration_disabled(client):
    """Invited users must still be able to register when public registration is off."""
    from src.api.core.admin_runtime import ADMIN_SYSTEM_SETTINGS
    saved = ADMIN_SYSTEM_SETTINGS.get("public_registration_enabled", True)
    ADMIN_SYSTEM_SETTINGS["public_registration_enabled"] = False
    try:
        response = client.post(
            "/api/auth/register",
            json=register_payload(
                username="invited_user",
                email="invited@example.com",
                inviteToken="not-a-real-token",
            ),
        )
        # Invite token path is exercised: we get past the public-registration
        # guard and fail on the invite token validation instead (400).
        assert response.status_code == 400
        assert response.json()["detail"] != "Public registration is disabled"
    finally:
        ADMIN_SYSTEM_SETTINGS["public_registration_enabled"] = saved
