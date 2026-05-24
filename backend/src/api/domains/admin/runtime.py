"""Admin runtime: settings, prompts, broadcast history, audit logs.

All state is persisted in the database. Module-level dicts/list are kept as a
fast read cache that is populated by `reload_admin_runtime_from_db()` at
startup and on every mutation.

For testability the module exposes `_runtime_session_factory` which defaults
to `SessionLocal` from `database`. Tests can monkey-patch it to point at an
in-memory test engine.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from src.api import models
from src.api.core.app_state import logger
from src.api.database import SessionLocal, engine

MAX_ADMIN_AUDIT_LOGS = 2000

DEFAULT_ADMIN_PROMPTS: Dict[str, Dict[str, Any]] = {
    "summary_vi": {
        "key": "summary_vi",
        "name": "Tóm tắt cuộc họp (VI)",
        "description": "Prompt tạo tóm tắt cuộc họp bằng tiếng Việt",
        "content": (
            "Tạo biên bản tóm tắt cuộc họp bằng tiếng Việt ở mức vừa đủ: không quá ngắn, không lan man. "
            "Phải nêu rõ mục tiêu/bối cảnh cuộc họp, các chủ đề chính đã bàn, kết luận hoặc quyết định, "
            "việc cần làm tiếp theo, người phụ trách nếu transcript có nói rõ, và các vấn đề còn mở. "
            "Giữ đúng nội dung transcript, không bịa thêm quyết định hoặc deadline."
        ),
        "version": "2.2.0",
    },
    "summary_en": {
        "key": "summary_en",
        "name": "Meeting Summary (EN)",
        "description": "Meeting summary prompt in English",
        "content": (
            "Create a balanced meeting brief in English: complete enough to preserve the main content, "
            "but not a transcript recap. Cover the meeting goal/context, main discussion themes, outcomes "
            "or explicit decisions, next steps, owners when clearly stated, and open issues. Do not invent "
            "decisions, deadlines, owners, or tasks."
        ),
        "version": "2.2.0",
    },
    "summary_zh": {
        "key": "summary_zh",
        "name": "会议摘要 (ZH)",
        "description": "Meeting summary prompt in Chinese",
        "content": (
            "请用中文生成详略适中的会议摘要：内容要覆盖主要信息，但不要逐字复述。"
            "请说明会议目标/背景、主要讨论主题、结果或明确决定、下一步行动、明确提到的负责人以及未解决问题。"
            "不要编造决定、截止日期、负责人或任务。"
        ),
        "version": "2.2.0",
    },
    "summary_ja": {
        "key": "summary_ja",
        "name": "会議サマリー (JA)",
        "description": "Meeting summary prompt in Japanese",
        "content": (
            "日本語で、短すぎず長すぎない会議要約を作成してください。逐語的な議事録ではなく、"
            "会議の目的/背景、主要な議論、結果または明確な決定事項、次のアクション、"
            "明示された担当者、未解決事項を十分に含めてください。決定、期限、担当者、タスクを推測で追加しないでください。"
        ),
        "version": "2.2.0",
    },
    "summary_ko": {
        "key": "summary_ko",
        "name": "회의 요약 (KO)",
        "description": "Meeting summary prompt in Korean",
        "content": (
            "한국어로 너무 짧지도 길지도 않은 균형 잡힌 회의 요약을 작성해 주세요. "
            "회의 목적/배경, 주요 논의 주제, 결과 또는 명확한 결정, 다음 단계, 명시된 담당자, "
            "남은 이슈를 포함하되, 회의록을 그대로 반복하지 마세요. 결정, 기한, 담당자, 할 일을 추측해 추가하지 마세요."
        ),
        "version": "2.2.0",
    },
}

DEFAULT_ADMIN_SYSTEM_SETTINGS: Dict[str, Any] = {
    "public_registration_enabled": True,
    "storage_limit_gb_per_org": 50,
    "transcript_retention_policy": "forever",
    "maintenance_mode": False,
}

# In-memory cache, populated from DB at startup and on every mutation.
ADMIN_PROMPTS: Dict[str, Dict[str, Any]] = {
    key: dict(value, last_updated=datetime.now(timezone.utc).isoformat())
    for key, value in DEFAULT_ADMIN_PROMPTS.items()
}
ADMIN_SYSTEM_SETTINGS: Dict[str, Any] = dict(DEFAULT_ADMIN_SYSTEM_SETTINGS)
ADMIN_BROADCAST_HISTORY: List[Dict[str, Any]] = []

# Legacy JSON files (used only for one-time migration into DB).
_LEGACY_SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "data", "admin_settings.json")
_LEGACY_PROMPTS_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "data", "admin_prompts.json")

# Session factory used for all DB access. Tests may monkey-patch this.
_runtime_session_factory: Callable[[], Session] = SessionLocal


def _open_session() -> Session:
    return _runtime_session_factory()


def ensure_admin_runtime_tables() -> None:
    """Create admin_settings, admin_prompts, admin_broadcasts, audit_logs,
    glossaries tables if missing. Safe to call at startup."""
    for model_cls in (
        models.AuditLog,
        models.AdminSetting,
        models.AdminPrompt,
        models.AdminBroadcast,
        models.Glossary,
    ):
        try:
            model_cls.__table__.create(bind=engine, checkfirst=True)
        except Exception as exc:
            logger.warning("Could not ensure table %s: %s", model_cls.__tablename__, exc)


def ensure_audit_log_table() -> None:
    """Backward-compat shim — older call sites import this name."""
    try:
        models.AuditLog.__table__.create(bind=engine, checkfirst=True)
    except Exception:
        pass


def _legacy_settings_from_file() -> Dict[str, Any]:
    try:
        if os.path.exists(_LEGACY_SETTINGS_FILE):
            with open(_LEGACY_SETTINGS_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _legacy_prompts_from_file() -> Dict[str, Dict[str, Any]]:
    try:
        if os.path.exists(_LEGACY_PROMPTS_FILE):
            with open(_LEGACY_PROMPTS_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _seed_defaults_if_empty(db: Session) -> None:
    """Populate admin_settings + admin_prompts with built-in defaults if those
    tables are empty. Also migrate any pre-existing JSON file contents."""
    legacy_settings = _legacy_settings_from_file()
    if db.query(models.AdminSetting).first() is None:
        merged = dict(DEFAULT_ADMIN_SYSTEM_SETTINGS)
        merged.update(legacy_settings)
        for key, value in merged.items():
            db.add(models.AdminSetting(key=key, value=value))
        db.commit()

    legacy_prompts = _legacy_prompts_from_file()
    if db.query(models.AdminPrompt).first() is None:
        merged_prompts = {key: dict(value) for key, value in DEFAULT_ADMIN_PROMPTS.items()}
        for key, value in legacy_prompts.items():
            merged_prompts.setdefault(key, {}).update(value)
        for key, value in merged_prompts.items():
            db.add(
                models.AdminPrompt(
                    key=key,
                    name=value.get("name", key),
                    description=value.get("description"),
                    content=value.get("content", ""),
                    version=value.get("version", "1.0.0"),
                )
            )
        db.commit()


def reload_admin_runtime_from_db(db: Optional[Session] = None) -> None:
    """Refresh the in-memory caches (ADMIN_SYSTEM_SETTINGS, ADMIN_PROMPTS,
    ADMIN_BROADCAST_HISTORY) from the database. Safe to call at any time; will
    create tables and seed defaults on first call."""
    ensure_admin_runtime_tables()
    owns_session = db is None
    if owns_session:
        db = _open_session()
    try:
        _seed_defaults_if_empty(db)

        settings_rows = db.query(models.AdminSetting).all()
        ADMIN_SYSTEM_SETTINGS.clear()
        ADMIN_SYSTEM_SETTINGS.update(DEFAULT_ADMIN_SYSTEM_SETTINGS)
        for row in settings_rows:
            ADMIN_SYSTEM_SETTINGS[row.key] = row.value

        # AI service overrides are stored as ai_* settings but also need to
        # be reflected in os.environ so legacy os.getenv() call sites in
        # provider modules pick them up after restart without an .env edit.
        _AI_SETTING_TO_ENV = {
            "ai_llm_provider": "LLM_PROVIDER",
            "ai_stt_provider": "STT_PROVIDER",
            "ai_gemini_model": "GEMINI_MODEL",
            "ai_deepgram_model": "DEEPGRAM_MODEL",
            "ai_groq_model": "ROUTER_MODEL",
        }
        for setting_key, env_key in _AI_SETTING_TO_ENV.items():
            if setting_key in ADMIN_SYSTEM_SETTINGS:
                os.environ[env_key] = str(ADMIN_SYSTEM_SETTINGS[setting_key])

        prompt_rows = db.query(models.AdminPrompt).all()
        ADMIN_PROMPTS.clear()
        for row in prompt_rows:
            ADMIN_PROMPTS[row.key] = {
                "key": row.key,
                "name": row.name,
                "description": row.description,
                "content": row.content,
                "version": row.version,
                "last_updated": row.last_updated.isoformat() if row.last_updated else None,
            }

        broadcast_rows = (
            db.query(models.AdminBroadcast)
            .order_by(models.AdminBroadcast.sent_at.desc())
            .limit(500)
            .all()
        )
        ADMIN_BROADCAST_HISTORY.clear()
        for row in broadcast_rows:
            ADMIN_BROADCAST_HISTORY.append(_broadcast_row_to_dict(row))
    except Exception as exc:
        logger.warning("Could not reload admin runtime from DB: %s", exc)
    finally:
        if owns_session and db is not None:
            db.close()


def _broadcast_row_to_dict(row: models.AdminBroadcast) -> Dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "content": row.content,
        "type": row.type,
        "target": row.target,
        "status": row.status,
        "sentAt": row.sent_at.isoformat() if row.sent_at else None,
        "reach": row.reach,
        "sentBy": row.sent_by,
    }


def persist_admin_setting(key: str, value: Any) -> None:
    """Write a single setting to DB. Caller is responsible for updating the
    in-memory cache (or call `reload_admin_runtime_from_db()` afterwards)."""
    ensure_admin_runtime_tables()
    db = _open_session()
    try:
        row = db.query(models.AdminSetting).filter_by(key=key).first()
        if row is None:
            db.add(models.AdminSetting(key=key, value=value))
        else:
            row.value = value
        db.commit()
    except Exception as exc:
        logger.warning("Could not persist admin setting %s: %s", key, exc)
        db.rollback()
    finally:
        db.close()


def persist_admin_prompt(
    key: str,
    prompt: Dict[str, Any],
    actor: Optional[str] = None,
    snapshot_previous: bool = True,
) -> None:
    """Persist a prompt update to ``admin_prompts``.

    When ``snapshot_previous`` is True and a row already exists for ``key``,
    the prior state is appended to ``admin_prompt_versions`` first so the
    edit is reversible via the rollback endpoint.
    """
    ensure_admin_runtime_tables()
    db = _open_session()
    try:
        row = db.query(models.AdminPrompt).filter_by(key=key).first()
        if row is None:
            db.add(
                models.AdminPrompt(
                    key=key,
                    name=prompt.get("name", key),
                    description=prompt.get("description"),
                    content=prompt.get("content", ""),
                    version=prompt.get("version", "1.0.0"),
                )
            )
        else:
            if snapshot_previous:
                db.add(
                    models.AdminPromptVersion(
                        prompt_key=row.key,
                        name=row.name,
                        description=row.description,
                        content=row.content,
                        version=row.version,
                        created_by=actor,
                    )
                )
            row.name = prompt.get("name", row.name)
            row.description = prompt.get("description", row.description)
            row.content = prompt.get("content", row.content)
            row.version = prompt.get("version", row.version)
        db.commit()
    except Exception as exc:
        logger.warning("Could not persist admin prompt %s: %s", key, exc)
        db.rollback()
    finally:
        db.close()


def persist_admin_broadcast(item: Dict[str, Any], actor: Optional[str] = None) -> None:
    ensure_admin_runtime_tables()
    db = _open_session()
    try:
        sent_at = item.get("sentAt")
        if isinstance(sent_at, str):
            try:
                sent_at_dt = datetime.fromisoformat(sent_at.replace("Z", "+00:00"))
            except ValueError:
                sent_at_dt = datetime.now(timezone.utc)
        else:
            sent_at_dt = datetime.now(timezone.utc)
        row = models.AdminBroadcast(
            id=item["id"],
            title=item["title"],
            content=item["content"],
            type=item.get("type", "info"),
            target=item.get("target", "all"),
            status=item.get("status", "sent"),
            reach=int(item.get("reach", 0)),
            sent_at=sent_at_dt,
            sent_by=actor,
        )
        db.merge(row)
        db.commit()
    except Exception as exc:
        logger.warning("Could not persist admin broadcast %s: %s", item.get("id"), exc)
        db.rollback()
    finally:
        db.close()


def delete_admin_broadcast(broadcast_id: str) -> bool:
    ensure_admin_runtime_tables()
    db = _open_session()
    try:
        row = db.query(models.AdminBroadcast).filter_by(id=broadcast_id).first()
        if row is None:
            return False
        db.delete(row)
        db.commit()
        return True
    except Exception as exc:
        logger.warning("Could not delete admin broadcast %s: %s", broadcast_id, exc)
        db.rollback()
        return False
    finally:
        db.close()


def append_admin_audit_log(
    actor: str,
    action: str,
    target: str,
    ip: str = "system",
    role: str = "System Admin",
    org: str = "System",
) -> None:
    """Persist a single audit log entry to the audit_logs table."""
    ensure_admin_runtime_tables()
    timestamp = datetime.now(timezone.utc)
    actor_name = actor or "unknown"
    db = _open_session()
    try:
        db.add(
            models.AuditLog(
                id=str(uuid.uuid4()),
                time=timestamp,
                user=actor_name,
                role=role,
                action=action,
                target=target,
                org=org,
                ip=ip,
            )
        )
        db.commit()
    except Exception as exc:
        logger.warning("Could not append admin audit log: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


# Backward-compat aliases for old callers.
_save_admin_settings = lambda: None  # noqa: E731 — no-op; mutations now persist per-key
_save_admin_prompts = lambda: None  # noqa: E731 — no-op; mutations now persist per-key
