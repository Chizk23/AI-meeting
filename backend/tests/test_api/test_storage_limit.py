"""TDD tests for P1 #10: enforce ``storage_limit_gb_per_org``.

When a non-zero ``storage_limit_gb_per_org`` setting is configured in the
admin runtime, ``/api/upload`` must reject uploads that would push the
organization's total audio storage past the configured cap. The error
code is 413 (Payload Too Large) and the response body must mention the
storage quota so the client knows what happened.

Setting the value to 0 disables the cap (unlimited).
"""
import io
import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api import models
from src.api.crud import (
    add_user_to_organization,
    create_audio_file,
    create_meeting,
    create_organization,
    create_user,
)
from src.api.database import Base, get_db
from src.api.main import app
from src.api.core.admin_runtime import ADMIN_SYSTEM_SETTINGS


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
def client(monkeypatch, tmp_path):
    from src.api.core import admin_runtime as runtime
    monkeypatch.setattr(runtime, "_runtime_session_factory", TestingSessionLocal)
    # Point uploads at a per-test temp dir so we don't write into the repo.
    monkeypatch.setenv("AUDIO_UPLOAD_DIR", str(tmp_path / "uploads"))
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
def reset_storage_setting():
    prev = ADMIN_SYSTEM_SETTINGS.get("storage_limit_gb_per_org")
    try:
        yield
    finally:
        if prev is None:
            ADMIN_SYSTEM_SETTINGS.pop("storage_limit_gb_per_org", None)
        else:
            ADMIN_SYSTEM_SETTINGS["storage_limit_gb_per_org"] = prev


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


def login(client, username):
    res = client.post(
        "/api/auth/login",
        json={"username": username, "password": "securepassword123"},
    )
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _seed_existing_storage(db, org_id, total_bytes):
    """Pre-seed an audio_file row attributed to a meeting in the org so
    the org's current storage usage equals ``total_bytes`` when the upload
    handler computes the running total.
    """
    placeholder = create_user(
        db,
        {
            "username": f"placeholder_{org_id[:8]}",
            "email": f"placeholder_{org_id[:8]}@example.com",
            "password": "securepassword123",
            "role": "member",
        },
    )
    meeting = create_meeting(
        db,
        {
            "title": "seeded",
            "organization_id": org_id,
            "status": "completed",
        },
        created_by=placeholder.id,
    )
    create_audio_file(
        db,
        {
            "meeting_id": meeting.id,
            "filename": "seeded.wav",
            "original_filename": "seeded.wav",
            "file_path": "/dev/null",
            "file_size": total_bytes,
            "format": "WAV",
            "upload_status": "UPLOADED",
        },
    )


def test_upload_rejected_when_storage_limit_exceeded(client, db_session):
    user = make_user(db_session, "uploader", "uploader@example.com")
    org = create_organization(
        db_session,
        {"name": "Capped Org", "settings": {"approval_status": "active"}},
    )
    add_user_to_organization(db_session, user.id, org.id, "member")

    # 1 GB cap, pre-seed 1023 MB so anything beyond a few KB is over budget.
    ADMIN_SYSTEM_SETTINGS["storage_limit_gb_per_org"] = 1
    _seed_existing_storage(db_session, org.id, 1023 * 1024 * 1024)

    token = login(client, user.username)
    # 2 MB payload — easily breaks the 1 MB remaining budget.
    file_bytes = b"a" * (2 * 1024 * 1024)
    res = client.post(
        "/api/upload",
        files={"file": ("clip.wav", io.BytesIO(file_bytes), "audio/wav")},
        data={"organization_id": org.id, "title": "Should fail"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 413, res.text
    detail = (res.json().get("detail") or "").lower()
    assert "storage" in detail or "quota" in detail or "limit" in detail


def test_upload_allowed_when_within_storage_limit(client, db_session):
    user = make_user(db_session, "uploader_ok", "uploader_ok@example.com")
    org = create_organization(
        db_session,
        {"name": "Roomy Org", "settings": {"approval_status": "active"}},
    )
    add_user_to_organization(db_session, user.id, org.id, "member")

    # 1 GB cap, no pre-seeded usage.
    ADMIN_SYSTEM_SETTINGS["storage_limit_gb_per_org"] = 1

    token = login(client, user.username)
    file_bytes = b"a" * (8 * 1024)  # 8 KB
    res = client.post(
        "/api/upload",
        files={"file": ("tiny.wav", io.BytesIO(file_bytes), "audio/wav")},
        data={"organization_id": org.id, "title": "Should pass"},
        headers={"Authorization": f"Bearer {token}"},
    )
    # 200 (success) or 5xx because background processing fails without real
    # STT keys; both are fine — the storage gate did not block the request.
    assert res.status_code != 413, res.text


def test_upload_unlimited_when_storage_limit_zero(client, db_session):
    user = make_user(db_session, "uploader_inf", "uploader_inf@example.com")
    org = create_organization(
        db_session,
        {"name": "Unlimited", "settings": {"approval_status": "active"}},
    )
    add_user_to_organization(db_session, user.id, org.id, "member")

    ADMIN_SYSTEM_SETTINGS["storage_limit_gb_per_org"] = 0
    _seed_existing_storage(db_session, org.id, 5 * 1024 * 1024 * 1024)

    token = login(client, user.username)
    file_bytes = b"a" * (8 * 1024)
    res = client.post(
        "/api/upload",
        files={"file": ("tiny.wav", io.BytesIO(file_bytes), "audio/wav")},
        data={"organization_id": org.id, "title": "Should pass"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code != 413, res.text
