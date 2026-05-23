"""TDD tests for P1 #12: transcript retention policy enforcement.

The admin setting ``transcript_retention_policy`` accepts three values:
    - "forever" (default): nothing is deleted
    - "1y": transcripts older than 365 days are purged
    - "6m": transcripts older than 180 days are purged

``purge_transcripts_for_retention`` is the pure function used by the
background scheduler. It returns the number of rows deleted. Tests cover
all three policies + the no-op case.
"""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from src.api import models
from src.api.crud import create_meeting, create_organization, create_user
from src.api.database import Base


TEST_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=test_engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=test_engine)


def _seed_transcript(db, age_days: int) -> models.Transcript:
    owner = create_user(
        db,
        {
            "username": f"owner_{age_days}",
            "email": f"owner_{age_days}@example.com",
            "password": "securepassword123",
            "role": "member",
        },
    )
    org = create_organization(db, {"name": f"Org {age_days}"})
    meeting = create_meeting(
        db,
        {"title": f"Old meeting {age_days}d", "organization_id": org.id, "status": "completed"},
        created_by=owner.id,
    )
    transcript = models.Transcript(
        meeting_id=meeting.id,
        content="lorem ipsum",
        processing_status="COMPLETED",
        created_at=datetime.now(timezone.utc) - timedelta(days=age_days),
        updated_at=datetime.now(timezone.utc) - timedelta(days=age_days),
    )
    db.add(transcript)
    db.commit()
    db.refresh(transcript)
    return transcript


def test_purge_forever_policy_is_noop(db_session):
    from src.api.core.retention import purge_transcripts_for_retention

    _seed_transcript(db_session, age_days=1000)
    deleted = purge_transcripts_for_retention(db_session, policy="forever")
    assert deleted == 0
    assert db_session.query(models.Transcript).count() == 1


def test_purge_1y_policy_deletes_transcripts_older_than_365_days(db_session):
    from src.api.core.retention import purge_transcripts_for_retention

    _seed_transcript(db_session, age_days=400)
    _seed_transcript(db_session, age_days=300)

    deleted = purge_transcripts_for_retention(db_session, policy="1y")
    assert deleted == 1
    remaining = db_session.query(models.Transcript).all()
    assert len(remaining) == 1
    # The 300-day-old one should still be here.
    age = datetime.now(timezone.utc).replace(tzinfo=None) - remaining[0].created_at.replace(tzinfo=None)
    assert age.days < 365


def test_purge_6m_policy_deletes_transcripts_older_than_180_days(db_session):
    from src.api.core.retention import purge_transcripts_for_retention

    _seed_transcript(db_session, age_days=200)
    _seed_transcript(db_session, age_days=100)
    _seed_transcript(db_session, age_days=500)

    deleted = purge_transcripts_for_retention(db_session, policy="6m")
    assert deleted == 2
    assert db_session.query(models.Transcript).count() == 1


def test_purge_unknown_policy_is_noop(db_session):
    from src.api.core.retention import purge_transcripts_for_retention

    _seed_transcript(db_session, age_days=400)
    deleted = purge_transcripts_for_retention(db_session, policy="not-a-real-policy")
    assert deleted == 0
    assert db_session.query(models.Transcript).count() == 1
