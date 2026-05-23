"""
Background scheduler for meeting reminders and status transitions.
Runs as an asyncio loop alongside the FastAPI app.
"""
import asyncio
import logging
from datetime import datetime, timedelta

logger = logging.getLogger("scheduler")


def _get_db():
    """Create a new database session for the scheduler."""
    from .database import SessionLocal
    return SessionLocal()


async def reminder_loop():
    """Check every 60 seconds for upcoming meetings that need reminders."""
    from . import models
    from src.api.core.notifications_support import push_runtime_notification

    while True:
        db = _get_db()
        try:
            now = datetime.utcnow()
            soon = now + timedelta(minutes=15)

            # Find upcoming meetings within 15 minutes that haven't been reminded
            meetings = (
                db.query(models.Meeting)
                .filter(
                    models.Meeting.status == "upcoming",
                    models.Meeting.reminder_sent == False,
                    models.Meeting.scheduled_start <= soon,
                    models.Meeting.scheduled_start > now,
                )
                .all()
            )

            for meeting in meetings:
                participants = (
                    db.query(models.MeetingParticipant)
                    .filter(
                        models.MeetingParticipant.meeting_id == meeting.id,
                        models.MeetingParticipant.user_id.isnot(None),
                    )
                    .all()
                )

                minutes_left = int((meeting.scheduled_start - now).total_seconds() / 60)
                for p in participants:
                    push_runtime_notification({
                        "id": f"runtime-reminder-{meeting.id}-{p.user_id}-{int(now.timestamp())}",
                        "recipient_user_id": p.user_id,
                        "type": "meeting_reminder",
                        "priority": "urgent",
                        "title": "Cuộc họp sắp bắt đầu",
                        "message": f"\"{meeting.title}\" bắt đầu trong {minutes_left} phút.",
                        "timestamp": now.isoformat(),
                        "isRead": False,
                        "metadata": {"meeting_id": meeting.id},
                    })

                meeting.reminder_sent = True
                logger.info(f"Sent reminder for meeting '{meeting.title}' ({len(participants)} participants)")

            db.commit()
        except Exception as e:
            logger.error(f"Reminder loop error: {e}")
            db.rollback()
        finally:
            db.close()

        await asyncio.sleep(60)


async def status_transition_loop():
    """Auto-transition meetings: upcoming->live at scheduled_start, live->completed after 4h."""
    from . import models

    while True:
        db = _get_db()
        try:
            now = datetime.utcnow()

            # Upcoming meetings that should now be live
            overdue = (
                db.query(models.Meeting)
                .filter(
                    models.Meeting.status == "upcoming",
                    models.Meeting.scheduled_start <= now,
                )
                .all()
            )
            for meeting in overdue:
                meeting.status = "live"
                meeting.actual_start = now
                logger.info(f"Auto-transitioned '{meeting.title}' to live")

            # Live meetings running > 4 hours → auto-complete
            cutoff = now - timedelta(hours=4)
            stale_live = (
                db.query(models.Meeting)
                .filter(
                    models.Meeting.status == "live",
                    models.Meeting.actual_start < cutoff,
                )
                .all()
            )
            for meeting in stale_live:
                meeting.status = "completed"
                meeting.actual_end = now
                if meeting.actual_start:
                    meeting.duration = int((now - meeting.actual_start).total_seconds() / 60)
                logger.info(f"Auto-completed stale live meeting '{meeting.title}'")

            db.commit()
        except Exception as e:
            logger.error(f"Status transition loop error: {e}")
            db.rollback()
        finally:
            db.close()

        await asyncio.sleep(30)


async def retention_cleanup_loop():
    """Run the transcript retention purge once per day."""
    from src.api.core.retention import purge_transcripts_for_retention

    # Stagger the first run by 60s to avoid contention with app boot.
    await asyncio.sleep(60)
    while True:
        db = _get_db()
        try:
            deleted = purge_transcripts_for_retention(db)
            if deleted:
                logger.info(f"Retention cleanup purged {deleted} transcript(s)")
        except Exception as e:
            logger.error(f"Retention cleanup error: {e}")
            try:
                db.rollback()
            except Exception:
                pass
        finally:
            db.close()
        await asyncio.sleep(24 * 60 * 60)


async def run_scheduler():
    """Run all scheduler tasks concurrently."""
    logger.info("Meeting scheduler started")
    await asyncio.gather(
        reminder_loop(),
        status_transition_loop(),
        retention_cleanup_loop(),
    )
