"""Transcript retention enforcement (P1 #12).

Implements the cleanup logic for the admin runtime setting
``transcript_retention_policy``. Supported policies:

    "forever" -> no-op (default)
    "1y"      -> delete transcripts whose ``created_at`` is older than 365 days
    "6m"      -> delete transcripts whose ``created_at`` is older than 180 days

Any other value is treated as ``forever`` (no-op) so an admin who fat-fingers
a value cannot accidentally drop production data.

The actual scheduling is wired up in ``scheduler.py``; this module contains
only the pure function so it is fully unit-testable.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from src.api import models
from src.api.core.admin_runtime import ADMIN_SYSTEM_SETTINGS

logger = logging.getLogger(__name__)

POLICY_TO_DAYS = {
    "1y": 365,
    "6m": 180,
}


def purge_transcripts_for_retention(db: Session, policy: str | None = None) -> int:
    """Delete transcripts older than the configured retention policy.

    Returns the number of rows deleted (0 for ``forever``/unknown policies).
    """
    if policy is None:
        policy = ADMIN_SYSTEM_SETTINGS.get("transcript_retention_policy", "forever")
    days = POLICY_TO_DAYS.get(policy)
    if not days:
        return 0

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    # SQLite stores naive datetimes; strip tz for the comparison so the
    # filter actually matches rows inserted via SQLAlchemy defaults.
    cutoff_naive = cutoff.replace(tzinfo=None)

    q = db.query(models.Transcript).filter(models.Transcript.created_at < cutoff_naive)
    count = q.count()
    if count:
        q.delete(synchronize_session=False)
        db.commit()
        logger.info(
            "Retention purge: deleted %d transcripts older than %d days (policy=%s)",
            count,
            days,
            policy,
        )
    return count
