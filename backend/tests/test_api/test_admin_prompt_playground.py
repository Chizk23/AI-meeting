"""TDD tests for P2 #19 — Prompt playground (version history + rollback + test).

Three new admin operations on top of the existing prompt CRUD:

1. ``GET /api/admin/prompts/{key}/versions`` — returns the historical
   snapshots saved every time a prompt is updated. Most-recent-first.
2. ``POST /api/admin/prompts/{key}/rollback`` body ``{"version_id": ...}``
   restores that historical version, snapshotting the current one first
   so the rollback is itself reversible.
3. ``POST /api/admin/prompts/{key}/test`` body ``{"sample_text": ...}``
   calls the configured LLM with the prompt as system message and the
   sample text as user message, returning the LLM's response. Useful as
   a "playground" before saving a tweak. The LLM client is monkey-patched
   in tests to keep them hermetic.

Every state-changing endpoint is gated to system-admin.
"""
import pytest
from fastapi.testclient import TestClient

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


def test_prompt_update_creates_version_snapshot(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_pp", "sys_pp@example.com", role="system-admin")
    token = login(client, sysadmin.username)

    # Two updates → expect 2 historical versions of the previous state.
    client.put(
        "/api/admin/prompts/summary_vi",
        json={"name": "Tóm tắt VI", "content": "Phiên bản A", "version": "1.0.1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    client.put(
        "/api/admin/prompts/summary_vi",
        json={"name": "Tóm tắt VI", "content": "Phiên bản B", "version": "1.0.2"},
        headers={"Authorization": f"Bearer {token}"},
    )

    res = client.get(
        "/api/admin/prompts/summary_vi/versions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    versions = res.json()
    assert len(versions) >= 2
    contents = [v["content"] for v in versions]
    # Both prior contents must be archived.
    assert any("Phiên bản A" in c for c in contents)


def test_prompt_rollback_restores_previous_content(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_pp_rb", "sys_pp_rb@example.com", role="system-admin")
    token = login(client, sysadmin.username)

    client.put(
        "/api/admin/prompts/summary_vi",
        json={"name": "Tóm tắt VI", "content": "Phiên bản gốc", "version": "1.0.1"},
        headers={"Authorization": f"Bearer {token}"},
    )
    client.put(
        "/api/admin/prompts/summary_vi",
        json={"name": "Tóm tắt VI", "content": "Phiên bản mới", "version": "1.0.2"},
        headers={"Authorization": f"Bearer {token}"},
    )

    versions = client.get(
        "/api/admin/prompts/summary_vi/versions",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    target = next(v for v in versions if v["content"] == "Phiên bản gốc")

    res = client.post(
        f"/api/admin/prompts/summary_vi/rollback",
        json={"version_id": target["id"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["content"] == "Phiên bản gốc"

    # Subsequent GET /api/admin/prompts must reflect the rollback.
    current = client.get(
        "/api/admin/prompts",
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    summary_prompt = next(p for p in current if p["key"] == "summary_vi")
    assert summary_prompt["content"] == "Phiên bản gốc"


def test_prompt_rollback_unknown_version_returns_404(client: TestClient, db_session):
    sysadmin = make_user(db_session, "sys_pp_404", "sys_pp_404@example.com", role="system-admin")
    token = login(client, sysadmin.username)

    res = client.post(
        f"/api/admin/prompts/summary_vi/rollback",
        json={"version_id": "does-not-exist"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404, res.text


def test_prompt_test_endpoint_calls_llm_and_returns_output(client: TestClient, db_session, monkeypatch):
    sysadmin = make_user(db_session, "sys_pp_test", "sys_pp_test@example.com", role="system-admin")
    token = login(client, sysadmin.username)

    # Monkey-patch the LLM adapter so the test is hermetic.
    captured = {}

    def fake_chat(self, system_prompt, user_prompt, temperature=0.3, max_tokens=2000):
        captured["system"] = system_prompt
        captured["user"] = user_prompt
        return "Đây là bản tóm tắt mẫu."

    from src.providers import router_llm
    monkeypatch.setattr(router_llm.RouterLLMAdapter, "chat_completion", fake_chat)

    res = client.post(
        "/api/admin/prompts/summary_vi/test",
        json={"sample_text": "Cuộc họp về kế hoạch Q1."},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["output"] == "Đây là bản tóm tắt mẫu."
    assert "Cuộc họp" in captured["user"]


def test_prompt_versions_require_system_admin(client: TestClient, db_session):
    member = make_user(db_session, "pp_member", "pp_member@example.com")
    token = login(client, member.username)
    res = client.get(
        "/api/admin/prompts/summary_vi/versions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403, res.text
