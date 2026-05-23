"""Admin runtime: prompts, settings, audit logs."""

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

from src.api import models
from src.api.core.app_state import logger
from src.api.database import engine, SessionLocal

MAX_ADMIN_AUDIT_LOGS = 2000

ADMIN_PROMPTS: Dict[str, Dict[str, Any]] = {
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
        "last_updated": datetime.now(timezone.utc).isoformat(),
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
        "last_updated": datetime.now(timezone.utc).isoformat(),
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
        "last_updated": datetime.now(timezone.utc).isoformat(),
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
        "last_updated": datetime.now(timezone.utc).isoformat(),
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
        "last_updated": datetime.now(timezone.utc).isoformat(),
    },
}

ADMIN_SYSTEM_SETTINGS: Dict[str, Any] = {
    "public_registration_enabled": True,
    "storage_limit_gb_per_org": 50,
    "transcript_retention_policy": "forever",
    "maintenance_mode": False,
}

ADMIN_BROADCAST_HISTORY: List[Dict[str, Any]] = []

_SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "data", "admin_settings.json")
_PROMPTS_FILE = os.path.join(os.path.dirname(__file__), "..", "..", "data", "admin_prompts.json")


def _load_admin_settings() -> None:
    global ADMIN_SYSTEM_SETTINGS
    try:
        if os.path.exists(_SETTINGS_FILE):
            with open(_SETTINGS_FILE, "r") as f:
                saved = json.load(f)
                ADMIN_SYSTEM_SETTINGS.update(saved)
    except Exception:
        pass


def _save_admin_settings() -> None:
    try:
        os.makedirs(os.path.dirname(_SETTINGS_FILE), exist_ok=True)
        with open(_SETTINGS_FILE, "w") as f:
            json.dump(ADMIN_SYSTEM_SETTINGS, f, indent=2)
    except Exception:
        pass


def _load_admin_prompts() -> None:
    global ADMIN_PROMPTS
    try:
        if os.path.exists(_PROMPTS_FILE):
            with open(_PROMPTS_FILE, "r") as f:
                saved = json.load(f)
                ADMIN_PROMPTS.update(saved)
    except Exception:
        pass


def _save_admin_prompts() -> None:
    try:
        os.makedirs(os.path.dirname(_PROMPTS_FILE), exist_ok=True)
        with open(_PROMPTS_FILE, "w") as f:
            json.dump(ADMIN_PROMPTS, f, indent=2, ensure_ascii=False)
    except Exception:
        pass


_load_admin_settings()
_load_admin_prompts()


def ensure_audit_log_table() -> None:
    try:
        models.AuditLog.__table__.create(bind=engine, checkfirst=True)
    except Exception:
        pass


def append_admin_audit_log(actor: str, action: str, target: str, ip: str = "system", role: str = "System Admin") -> None:
    actor_name = actor or "unknown"
    timestamp = datetime.now(timezone.utc)
    entry = {
        "id": str(uuid.uuid4()),
        "time": timestamp.isoformat(),
        "user": actor_name,
        "role": role,
        "action": action,
        "target": target,
        "org": "System",
        "ip": ip,
    }

    db = None
    try:
        ensure_audit_log_table()
        db = SessionLocal()
        db.add(
            models.AuditLog(
                id=entry["id"],
                time=timestamp,
                user=actor_name,
                role=role,
                action=action,
                target=target,
                org="System",
                ip=ip,
            )
        )
        db.commit()
    except Exception:
        try:
            if db:
                db.rollback()
        except Exception:
            pass
    finally:
        try:
            if db:
                db.close()
        except Exception:
            pass
