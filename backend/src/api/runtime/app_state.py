"""Application state: config, logger, directories, and lazy AI service initialization."""

import os
from typing import Optional

from src.api.config import get_config
from src.api.logging_middleware import setup_logging

config = get_config()
setup_logging(log_level=config.log_level, json_format=config.environment == "production")

import logging
logger = logging.getLogger(__name__)
logger.info("Logging initialized", extra=config.to_dict())

BACKEND_ROOT_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
AUDIO_UPLOAD_DIR = os.path.join(BACKEND_ROOT_DIR, "uploads", "audio")
LEGACY_AUDIO_UPLOAD_DIR = os.path.join(BACKEND_ROOT_DIR, "data", "meetings", "audio")
AVATAR_UPLOAD_DIR = os.path.join(BACKEND_ROOT_DIR, "uploads", "avatars")


def ensure_audio_upload_dir() -> str:
    os.makedirs(AUDIO_UPLOAD_DIR, exist_ok=True)
    return AUDIO_UPLOAD_DIR


def resolve_audio_storage_path(path: Optional[str]) -> Optional[str]:
    if not path:
        return None

    candidate = path
    if not os.path.isabs(candidate):
        candidate = os.path.abspath(os.path.join(BACKEND_ROOT_DIR, candidate))
    if os.path.exists(candidate):
        return candidate

    normalized = os.path.normpath(candidate)
    legacy_root = os.path.normpath(LEGACY_AUDIO_UPLOAD_DIR)
    canonical_root = os.path.normpath(AUDIO_UPLOAD_DIR)

    if normalized.startswith(legacy_root):
        relative = os.path.relpath(normalized, legacy_root)
        migrated = os.path.join(canonical_root, relative)
        if os.path.exists(migrated):
            return migrated

    legacy_marker = os.path.join("data", "meetings", "audio")
    if legacy_marker in normalized:
        relative = normalized.split(legacy_marker, 1)[1].lstrip(os.sep)
        migrated = os.path.join(canonical_root, relative)
        if os.path.exists(migrated):
            return migrated

    return candidate


logger.info("Audio upload root configured: %s", AUDIO_UPLOAD_DIR)
logger.info("Legacy audio upload root configured: %s", LEGACY_AUDIO_UPLOAD_DIR)

cost_logger = None
adapter = None


def init_ai_services():
    """Lazy initialization of AI services (called on first use)"""
    global cost_logger, adapter
    if cost_logger is None or adapter is None:
        try:
            from src.cost.cost_logger import CostLogger
            from src.providers.google_llm import GoogleLLMAdapter
            cost_logger = CostLogger(monthly_hard_limit_usd=config.cost.monthly_limit_usd)
            adapter = GoogleLLMAdapter(cost_logger=cost_logger)
            logger.info("AI services initialized")
        except Exception as e:
            logger.error(f"Failed to initialize AI services: {e}")
            cost_logger = False
            adapter = False


def get_cost_logger():
    return cost_logger


def get_adapter():
    return adapter
