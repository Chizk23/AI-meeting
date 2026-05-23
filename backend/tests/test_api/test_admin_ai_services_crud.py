"""TDD tests for P2 #18 — AI services CRUD.

Admins should be able to flip the primary LLM/STT provider and the model
name from the UI without editing the .env. Overrides live in
``admin_settings`` (rows ``ai_llm_provider``, ``ai_stt_provider``,
``ai_gemini_model``, ``ai_deepgram_model``). Env values stay as
fallback defaults.

API:
  GET   /api/admin/ai-services           — returns effective config (already exists)
  PATCH /api/admin/ai-services           — updates overrides

Validation:
  - ``llm_provider`` must be one of {"google", "groq", "router"}.
  - ``stt_provider`` must be one of {"deepgram", "phowhisper", "viwhisper"}.
  - Unknown values are rejected with 400.
  - Only system-admins can call PATCH.
"""
import os
import pytest
from fastapi.testclient import TestClient

from src.api.core.admin_runtime import ADMIN_SYSTEM_SETTINGS
from src.api.crud import create_user


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


def test_patch_ai_services_overrides_llm_provider(client: TestClient, db_session, monkeypatch):
    sysadmin = make_user(db_session, "sys_ai_crud", "sys_ai_crud@example.com", role="system-admin")
    monkeypatch.setenv("LLM_PROVIDER", "google")
    monkeypatch.setenv("GROQ_API_KEY", "fakekey")
    token = login(client, sysadmin.username)

    res = client.patch(
        "/api/admin/ai-services",
        json={"llm_provider": "groq"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["llm"]["provider"] == "groq"
    assert ADMIN_SYSTEM_SETTINGS.get("ai_llm_provider") == "groq"

    # GET must also reflect the override now.
    res2 = client.get("/api/admin/ai-services", headers={"Authorization": f"Bearer {token}"})
    assert res2.status_code == 200
    assert res2.json()["llm"]["provider"] == "groq"


def test_patch_ai_services_overrides_stt_provider_and_model(client: TestClient, db_session, monkeypatch):
    sysadmin = make_user(db_session, "sys_ai_crud2", "sys_ai_crud2@example.com", role="system-admin")
    monkeypatch.setenv("STT_PROVIDER", "deepgram")
    monkeypatch.setenv("DEEPGRAM_MODEL", "nova-3")
    token = login(client, sysadmin.username)

    res = client.patch(
        "/api/admin/ai-services",
        json={"stt_provider": "phowhisper", "deepgram_model": "nova-2"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["stt"]["provider"] == "phowhisper"
    # The deepgram entry in available_providers must reflect the new model.
    deepgram_entry = next(p for p in body["stt"]["available_providers"] if p["id"] == "deepgram")
    assert deepgram_entry["model"] == "nova-2"


def test_patch_ai_services_rejects_unknown_provider(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_ai_crud3", "sys_ai_crud3@example.com", role="system-admin")
    token = login(client, sysadmin.username)

    res = client.patch(
        "/api/admin/ai-services",
        json={"llm_provider": "not-a-real-llm"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400, res.text


def test_patch_ai_services_requires_system_admin(client: TestClient, db_session):
    member = make_user(db_session, "ai_member", "ai_member@example.com")
    token = login(client, member.username)
    res = client.patch(
        "/api/admin/ai-services",
        json={"llm_provider": "google"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403, res.text
