"""TDD tests for P1 #15: expanded audit log coverage.

Required events to log (per audit plan):
- LOGIN_FAILED on bad credentials.
- LOGIN_SUCCESS on successful login.
- CHANGE_PASSWORD on profile password change.
- RESET_PASSWORD on password reset OTP flow.
- APPROVE_ORGANIZATION / REJECT_ORGANIZATION (already implemented, regression-tested).
- DELETE_MEETING (already implemented, regression-tested).
- EXPORT_MEETING on /api/export/generate.
- BROADCAST (already implemented, regression-tested).
"""
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
def client(monkeypatch):
    # admin_runtime persistence uses its own session factory; point it at the
    # in-memory test engine for the duration of the test.
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


def make_user(db: Session, username: str, email: str, password: str = "securepassword123") -> models.User:
    return create_user(
        db,
        {
            "username": username,
            "email": email,
            "password": password,
            "role": "member",
        },
    )


def latest_audit(db: Session, action: str) -> models.AuditLog | None:
    return (
        db.query(models.AuditLog)
        .filter(models.AuditLog.action == action)
        .order_by(models.AuditLog.time.desc())
        .first()
    )


def test_login_failed_writes_audit_log(client: TestClient, db_session: Session):
    make_user(db_session, "alice", "alice@example.com")

    response = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "wrong-password"},
    )
    assert response.status_code == 401

    log = latest_audit(db_session, "LOGIN_FAILED")
    assert log is not None, "LOGIN_FAILED audit row must be written on bad credentials"
    assert log.target == "alice"


def test_login_success_writes_audit_log(client: TestClient, db_session: Session):
    make_user(db_session, "bob", "bob@example.com")

    response = client.post(
        "/api/auth/login",
        json={"username": "bob", "password": "securepassword123"},
    )
    assert response.status_code == 200

    log = latest_audit(db_session, "LOGIN_SUCCESS")
    assert log is not None, "LOGIN_SUCCESS audit row must be written"
    assert log.user == "bob"


def test_change_password_writes_audit_log(client: TestClient, db_session: Session):
    make_user(db_session, "charlie", "charlie@example.com")
    login = client.post(
        "/api/auth/login",
        json={"username": "charlie", "password": "securepassword123"},
    )
    token = login.json()["access_token"]

    response = client.post(
        "/api/profile/change-password",
        json={"current_password": "securepassword123", "new_password": "newpassword456"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200, response.text

    log = latest_audit(db_session, "CHANGE_PASSWORD")
    assert log is not None, "CHANGE_PASSWORD audit row must be written"
    assert log.user == "charlie"


def test_reset_password_writes_audit_log(client: TestClient, db_session: Session):
    make_user(db_session, "dora", "dora@example.com")

    # Trigger OTP creation
    forgot_response = client.post(
        "/api/auth/forgot-password",
        json={"email": "dora@example.com"},
    )
    assert forgot_response.status_code == 200
    otp = forgot_response.json().get("dev_otp")
    assert otp, "OTP must be exposed in dev mode"

    reset_response = client.post(
        "/api/auth/reset-password",
        json={"email": "dora@example.com", "otp": otp, "newPassword": "anotherpass789"},
    )
    assert reset_response.status_code == 200, reset_response.text

    log = latest_audit(db_session, "RESET_PASSWORD")
    assert log is not None, "RESET_PASSWORD audit row must be written"
    assert log.target == "dora@example.com"


def test_export_meeting_writes_audit_log(client: TestClient, db_session: Session):
    """POST /api/export/generate must write EXPORT_MEETING to audit log."""
    from src.api.crud import create_organization, add_user_to_organization, create_meeting

    owner = make_user(db_session, "exporter", "exporter@example.com")
    org = create_organization(
        db_session,
        {"name": "Acme Inc", "settings": {"approval_status": "active"}},
    )
    add_user_to_organization(db_session, owner.id, org.id, "org-admin")
    meeting = create_meeting(
        db_session,
        {
            "title": "Quarterly review",
            "organization_id": org.id,
            "status": "completed",
        },
        created_by=owner.id,
    )

    login = client.post(
        "/api/auth/login",
        json={"username": owner.username, "password": "securepassword123"},
    )
    token = login.json()["access_token"]

    res = client.post(
        "/api/export/generate",
        json={"meeting_id": meeting.id, "format": "docx", "include_transcript": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text

    log = latest_audit(db_session, "EXPORT_MEETING")
    assert log is not None, "EXPORT_MEETING audit row must be written"
    assert "Quarterly review" in (log.target or "")
