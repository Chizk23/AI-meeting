"""Application lifecycle: startup and shutdown events."""

import os
import time
import uuid

from fastapi import FastAPI
from sqlalchemy.orm import joinedload

from src.api import models
from src.api.core.app_state import config, logger
from src.api.database import engine, SessionLocal, health_check as db_health_check, close_db_connections


def _ensure_column(table_name: str, column_name: str, ddl: str) -> None:
    try:
        with engine.begin() as connection:
            dialect = connection.dialect.name
            if dialect == "sqlite":
                existing = [row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()]
                if column_name not in existing:
                    connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN {ddl}")
            elif dialect in {"mysql", "mariadb"}:
                exists = connection.exec_driver_sql(
                    """
                    SELECT COUNT(*)
                    FROM information_schema.columns
                    WHERE table_schema = DATABASE()
                      AND table_name = %s
                      AND column_name = %s
                    """,
                    (table_name, column_name),
                ).scalar()
                if not exists:
                    connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN {ddl}")
    except Exception as exc:
        logger.warning("Failed to ensure column %s.%s: %s", table_name, column_name, exc)


def _ensure_meeting_runtime_columns() -> None:
    _ensure_column("transcript_segments", "language", "language VARCHAR(10) DEFAULT 'auto'")
    _ensure_column("transcripts", "post_processed", "post_processed BOOLEAN DEFAULT FALSE")
    _ensure_column("transcripts", "nlp_metadata", "nlp_metadata JSON")
    _ensure_column("transcript_segments", "original_text", "original_text TEXT")
    _ensure_column("transcript_segments", "nlp_metadata", "nlp_metadata JSON")
    _ensure_column("meetings", "reminder_sent", "reminder_sent BOOLEAN DEFAULT FALSE")
    _ensure_column("meeting_participants", "invite_status", "invite_status VARCHAR(20) DEFAULT 'accepted'")
    _ensure_column("meeting_summaries", "risks", "risks JSON")
    _ensure_column("meeting_summaries", "open_questions", "open_questions JSON")
    _ensure_column("meeting_summaries", "timeline_highlights", "timeline_highlights JSON")
    _ensure_column("meeting_summaries", "speaker_summaries", "speaker_summaries JSON")
    _ensure_column("users", "bio", "bio TEXT")


def _ensure_action_item_assignee_backfill() -> None:
    try:
        models.ActionItemAssignee.__table__.create(bind=engine, checkfirst=True)
        session = SessionLocal()
        try:
            legacy_items = session.query(models.ActionItem).options(
                joinedload(models.ActionItem.assignees),
                joinedload(models.ActionItem.assigned_to_user),
            ).all()
            changed = False
            for item in legacy_items:
                if item.assignees:
                    continue
                if not item.assigned_email and not item.assigned_to:
                    continue
                display_name = None
                if item.assigned_to_user:
                    display_name = " ".join(
                        part for part in [item.assigned_to_user.first_name, item.assigned_to_user.last_name] if part
                    ).strip() or item.assigned_to_user.username or item.assigned_to_user.email
                session.add(models.ActionItemAssignee(
                    id=str(uuid.uuid4()),
                    action_item_id=item.id,
                    user_id=item.assigned_to,
                    email=item.assigned_email or (item.assigned_to_user.email if item.assigned_to_user else ""),
                    display_name=display_name or item.assigned_email,
                    status=item.status or "PENDING",
                    completed_at=item.completed_at,
                ))
                changed = True
            if changed:
                session.commit()
        finally:
            session.close()
    except Exception as exc:
        logger.warning("Failed to ensure action item assignee backfill: %s", exc)


async def startup_event():
    """Initialize application on startup"""
    logger.info("Starting MultiMinutes AI API...")
    start_time = time.time()

    from src.api.scheduler import run_scheduler
    import asyncio
    asyncio.create_task(run_scheduler())

    try:
        models.AuditLog.__table__.create(bind=engine, checkfirst=True)
        models.Notification.__table__.create(bind=engine, checkfirst=True)
        models.MeetingTranscriptDraft.__table__.create(bind=engine, checkfirst=True)
        models.MeetingMessage.__table__.create(bind=engine, checkfirst=True)
        models.MeetingSpeakerMapping.__table__.create(bind=engine, checkfirst=True)
        models.ActionItemAssignee.__table__.create(bind=engine, checkfirst=True)
        _ensure_meeting_runtime_columns()
        _ensure_action_item_assignee_backfill()

        from src.api.domains.admin.runtime import (
            ensure_admin_runtime_tables,
            reload_admin_runtime_from_db,
        )
        ensure_admin_runtime_tables()
        reload_admin_runtime_from_db()

        db_status = db_health_check()
        if db_status["status"] != "healthy":
            logger.error(f"Database health check failed: {db_status}")
        else:
            logger.info(
                f"Database healthy - latency: {db_status.get('latency_ms')}ms, "
                f"pool: {db_status.get('pool_size')}/{db_status.get('checked_out')} connections"
            )

        logger.info("Configuration", extra=config.to_dict())

        if config.ai.provider == "google" and not config.ai.google_api_key:
            logger.warning("Google API key not configured - AI features will be disabled")
        elif config.ai.provider == "openai" and not config.ai.openai_api_key:
            logger.warning("OpenAI API key not configured - AI features will be disabled")

        elapsed = (time.time() - start_time) * 1000
        logger.info(f"Startup complete in {elapsed:.0f}ms")

    except Exception as e:
        logger.error(f"Startup failed: {e}", exc_info=True)


async def shutdown_event():
    """Cleanup on shutdown"""
    logger.info("Shutting down MultiMinutes AI API...")
    close_db_connections()
    logger.info("Shutdown complete")


def register_lifecycle(app: FastAPI) -> None:
    app.on_event("startup")(startup_event)
    app.on_event("shutdown")(shutdown_event)
