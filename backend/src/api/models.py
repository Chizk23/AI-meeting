from sqlalchemy import Column, String, Integer, DateTime, Boolean, ForeignKey, Text, JSON, Numeric, Date, CheckConstraint, UniqueConstraint, Index, BigInteger
from typing import Optional
from sqlalchemy.orm import relationship, Mapped, mapped_column
from sqlalchemy.sql import func
import uuid
from .database import Base

def generate_uuid():
    return str(uuid.uuid4())

# ==================== Users & Organizations ====================

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # system-admin, member
    first_name: Mapped[str] = mapped_column(String(100), nullable=True)
    last_name: Mapped[str] = mapped_column(String(100), nullable=True)
    avatar_url: Mapped[str] = mapped_column(String(500), nullable=True)
    bio: Mapped[str] = mapped_column(Text, nullable=True)
    language: Mapped[str] = mapped_column(String(10), default="vi")
    timezone: Mapped[str] = mapped_column(String(100), default="Asia/Ho_Chi_Minh")
    notification_preferences: Mapped[dict] = mapped_column(JSON, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=True)
    gender: Mapped[str] = mapped_column(String(10), nullable=True)
    date_of_birth: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    last_login: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("role IN ('system-admin', 'member')", name='check_user_role'),
        CheckConstraint("gender IS NULL OR gender IN ('male', 'female', 'other')", name='check_user_gender'),
    )

    # Relationships
    user_organizations = relationship("UserOrganization", back_populates="user", cascade="all, delete-orphan")
    group_memberships = relationship("GroupMembership", back_populates="user", cascade="all, delete-orphan", foreign_keys="GroupMembership.user_id")
    password_reset_otps = relationship("PasswordResetOtp", back_populates="user", cascade="all, delete-orphan")
    created_meetings = relationship("Meeting", back_populates="created_by_user", foreign_keys="Meeting.created_by")
    meeting_participants = relationship("MeetingParticipant", back_populates="user", cascade="all, delete-orphan")
    meeting_messages = relationship("MeetingMessage", back_populates="user", cascade="all, delete-orphan")
    assigned_action_items = relationship("ActionItem", back_populates="assigned_to_user", foreign_keys="ActionItem.assigned_to")
    action_item_assignments = relationship("ActionItemAssignee", back_populates="user", cascade="all, delete-orphan")
    created_action_items = relationship("ActionItem", back_populates="created_by_user", foreign_keys="ActionItem.created_by")
    sent_invitations = relationship("Invitation", back_populates="invited_by_user", foreign_keys="Invitation.invited_by")
    accepted_invitations = relationship("Invitation", back_populates="accepted_by_user", foreign_keys="Invitation.accepted_by")
    notifications = relationship("Notification", back_populates="recipient", cascade="all, delete-orphan")
    export_files = relationship("ExportFile", back_populates="generated_by_user")


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    domain: Mapped[str] = mapped_column(String(255), nullable=True)
    logo_url: Mapped[str] = mapped_column(String(500), nullable=True)
    settings: Mapped[dict] = mapped_column(JSON, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    user_organizations = relationship("UserOrganization", back_populates="organization", cascade="all, delete-orphan")
    groups = relationship("Group", back_populates="organization", cascade="all, delete-orphan")
    meetings = relationship("Meeting", back_populates="organization", cascade="all, delete-orphan")
    invitations = relationship("Invitation", back_populates="organization", cascade="all, delete-orphan")


class UserOrganization(Base):
    __tablename__ = "user_organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # org-admin, member, viewer
    joined_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint('user_id', 'organization_id', name='uq_user_org'),
        CheckConstraint("role IN ('org-admin', 'member', 'viewer')", name='check_user_org_role'),
    )

    # Relationships
    user = relationship("User", back_populates="user_organizations")
    organization = relationship("Organization", back_populates="user_organizations")


# ==================== Groups ====================

class Group(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    privacy_level: Mapped[str] = mapped_column(String(20), default="private")
    settings: Mapped[dict] = mapped_column(JSON, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    organization = relationship("Organization", back_populates="groups")
    created_by_user = relationship("User", foreign_keys=[created_by])
    memberships = relationship("GroupMembership", back_populates="group", cascade="all, delete-orphan")
    invitations = relationship("Invitation", back_populates="group", cascade="all, delete-orphan")
    meetings = relationship("Meeting", back_populates="group")
    messages = relationship("GroupMessage", back_populates="group", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("privacy_level IN ('private', 'internal', 'public')", name='check_group_privacy'),
    )


class GroupMembership(Base):
    __tablename__ = "group_memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="member")
    invited_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    joined_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('group_id', 'user_id', name='uq_group_user'),
        CheckConstraint("role IN ('group-admin', 'member', 'viewer')", name='check_group_membership_role'),
    )

    group = relationship("Group", back_populates="memberships")
    user = relationship("User", back_populates="group_memberships", foreign_keys=[user_id])
    invited_by_user = relationship("User", foreign_keys=[invited_by])


class GroupMessage(Base):
    __tablename__ = "group_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    reply_to_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("group_messages.id", ondelete="SET NULL"), nullable=True)
    reactions: Mapped[dict] = mapped_column(JSON, nullable=True) # e.g. [{"emoji": "👍", "count": 1}]
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    group = relationship("Group", back_populates="messages")
    user = relationship("User", foreign_keys=[user_id])
    reply_to = relationship("GroupMessage", remote_side=[id], foreign_keys=[reply_to_id])


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    organization_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("groups.id", ondelete="CASCADE"), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default="member")
    token_hash: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    token_sha256: Mapped[str] = mapped_column(String(64), unique=True, nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    expires_at: Mapped[DateTime] = mapped_column(DateTime, nullable=False)
    accepted_at: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    invited_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    accepted_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("role IN ('org-admin', 'group-admin', 'member', 'viewer')", name='check_invitation_role'),
        CheckConstraint("status IN ('pending', 'accepted', 'revoked', 'expired')", name='check_invitation_status'),
        Index('idx_invitations_email', 'email'),
    )

    organization = relationship("Organization", back_populates="invitations")
    group = relationship("Group", back_populates="invitations")
    invited_by_user = relationship("User", back_populates="sent_invitations", foreign_keys=[invited_by])
    accepted_by_user = relationship("User", back_populates="accepted_invitations", foreign_keys=[accepted_by])


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    recipient_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, default="system")
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="recent")
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    source_type: Mapped[str] = mapped_column(String(50), nullable=True)
    source_id: Mapped[str] = mapped_column(String(36), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    read_at: Mapped[DateTime] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("priority IN ('urgent', 'today', 'recent')", name='check_notification_priority'),
        Index('idx_notifications_recipient_created', 'recipient_user_id', 'created_at'),
        Index('idx_notifications_source', 'source_type', 'source_id'),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )

    recipient = relationship("User", back_populates="notifications")


class PasswordResetOtp(Base):
    __tablename__ = "password_reset_otps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    otp_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[DateTime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())

    user = relationship("User", back_populates="password_reset_otps")


# ==================== Meetings ====================

class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    scheduled_start: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    scheduled_end: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    actual_start: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    actual_end: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    duration: Mapped[int] = mapped_column(Integer, default=0) # minutes
    location: Mapped[str] = mapped_column(String(255), nullable=True)
    meeting_type: Mapped[str] = mapped_column(String(50), default='MEETING')  # MEETING, INTERVIEW, TRAINING, REVIEW
    status: Mapped[str] = mapped_column(String(20), default='upcoming')  # queued, processing, completed, failed, live, upcoming, canceled
    code: Mapped[str] = mapped_column(String(20), nullable=True) # Short code for joining
    recording_url: Mapped[str] = mapped_column(String(500), nullable=True)
    transcript_url: Mapped[str] = mapped_column(String(500), nullable=True)
    audio_url: Mapped[str] = mapped_column(String(500), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    reminder_sent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("meeting_type IN ('MEETING', 'INTERVIEW', 'TRAINING', 'REVIEW')", name='check_meeting_type'),
        CheckConstraint("status IN ('queued', 'processing', 'completed', 'failed', 'live', 'upcoming', 'canceled')", name='check_meeting_status'),
        Index('idx_meetings_group_id', 'group_id'),
        Index('idx_meetings_status', 'status'),
    )

    # Relationships
    organization = relationship("Organization", back_populates="meetings")
    group = relationship("Group", back_populates="meetings")
    created_by_user = relationship("User", back_populates="created_meetings", foreign_keys=[created_by])
    participants = relationship("MeetingParticipant", back_populates="meeting", cascade="all, delete-orphan")
    audio_files = relationship("AudioFile", back_populates="meeting", cascade="all, delete-orphan")
    transcripts = relationship("Transcript", back_populates="meeting", cascade="all, delete-orphan")
    summaries = relationship("MeetingSummary", back_populates="meeting", cascade="all, delete-orphan")
    action_items = relationship("ActionItem", back_populates="meeting", cascade="all, delete-orphan")
    export_files = relationship("ExportFile", back_populates="meeting", cascade="all, delete-orphan")
    cost_tracking = relationship("CostTracking", back_populates="meeting", cascade="all, delete-orphan")
    messages = relationship("MeetingMessage", back_populates="meeting", cascade="all, delete-orphan")
    speaker_mappings = relationship("MeetingSpeakerMapping", back_populates="meeting", cascade="all, delete-orphan")


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    speaker_label: Mapped[str] = mapped_column(String(50), nullable=True)
    email: Mapped[str] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(50), default='PARTICIPANT')
    invite_status: Mapped[str] = mapped_column(String(20), default='accepted')  # pending, accepted, declined, attended
    is_required: Mapped[bool] = mapped_column(Boolean, default=False)
    attended: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    left_at: Mapped[DateTime] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint('meeting_id', 'user_id', name='uq_meeting_user'),
        UniqueConstraint('meeting_id', 'email', name='uq_meeting_email'),
        Index('idx_mp_user', 'user_id'),
    )

    # Relationships
    meeting = relationship("Meeting", back_populates="participants")
    user = relationship("User", back_populates="meeting_participants")


class MeetingMessage(Base):
    __tablename__ = "meeting_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(String(20), default="chat")
    reply_to_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("meeting_messages.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("message_type IN ('chat', 'system')", name='check_meeting_message_type'),
        Index('idx_meeting_messages_meeting_id', 'meeting_id'),
    )

    meeting = relationship("Meeting", back_populates="messages")
    user = relationship("User", back_populates="meeting_messages")
    reply_to = relationship("MeetingMessage", remote_side=[id], foreign_keys=[reply_to_id])


class MeetingSpeakerMapping(Base):
    __tablename__ = "meeting_speaker_mappings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    speaker_label: Mapped[str] = mapped_column(String(50), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('meeting_id', 'speaker_label', name='uq_meeting_speaker_label'),
        Index('idx_meeting_speaker_mappings_meeting_id', 'meeting_id'),
    )

    meeting = relationship("Meeting", back_populates="speaker_mappings")
    user = relationship("User", foreign_keys=[user_id])


# ==================== Audio Files ====================

class AudioFile(Base):
    __tablename__ = "audio_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=True)
    format: Mapped[str] = mapped_column(String(20), nullable=False)
    sample_rate: Mapped[int] = mapped_column(Integer, nullable=True)
    channels: Mapped[int] = mapped_column(Integer, nullable=True)
    upload_status: Mapped[str] = mapped_column(String(20), default='UPLOADING')  # UPLOADING, UPLOADED, PROCESSING, PROCESSED, FAILED
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("upload_status IN ('UPLOADING', 'UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED')", name='check_upload_status'),
        Index('idx_audio_meeting', 'meeting_id'),
    )

    # Relationships
    meeting = relationship("Meeting", back_populates="audio_files")
    transcripts = relationship("Transcript", back_populates="audio_file", cascade="all, delete-orphan")


# ==================== Transcripts ====================

class Transcript(Base):
    __tablename__ = "transcripts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    audio_file_id: Mapped[str] = mapped_column(String(36), ForeignKey("audio_files.id", ondelete="SET NULL"), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(String(10), default='vi')
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    processing_status: Mapped[str] = mapped_column(String(20), default='PENDING')  # PENDING, PROCESSING, COMPLETED, FAILED
    stt_provider: Mapped[str] = mapped_column(String(50), default='whisper')
    confidence_score: Mapped[float] = mapped_column(Numeric(3, 2), nullable=True)
    post_processed: Mapped[bool] = mapped_column(Boolean, default=False)
    nlp_metadata: Mapped[dict] = mapped_column(JSON, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("processing_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')", name='check_transcript_status'),
        Index('idx_transcripts_meeting_id', 'meeting_id'),
    )

    # Relationships
    meeting = relationship("Meeting", back_populates="transcripts")
    audio_file = relationship("AudioFile", back_populates="transcripts")
    segments = relationship("TranscriptSegment", back_populates="transcript", cascade="all, delete-orphan")


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    transcript_id: Mapped[str] = mapped_column(String(36), ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False)
    speaker_label: Mapped[str] = mapped_column(String(50), nullable=False)
    start_time: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    end_time: Mapped[float] = mapped_column(Numeric(10, 3), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    original_text: Mapped[str] = mapped_column(Text, nullable=True)
    language: Mapped[str] = mapped_column(String(10), default='auto')
    confidence_score: Mapped[float] = mapped_column(Numeric(3, 2), nullable=True)
    nlp_metadata: Mapped[dict] = mapped_column(JSON, nullable=True)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (
        Index('idx_ts_transcript', 'transcript_id'),
    )

    # Relationships
    transcript = relationship("Transcript", back_populates="segments")


class MeetingTranscriptDraft(Base):
    __tablename__ = "meeting_transcript_drafts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    segments: Mapped[dict] = mapped_column(JSON, nullable=True)
    language: Mapped[str] = mapped_column(String(10), default='auto')
    provider: Mapped[str] = mapped_column(String(50), nullable=True)
    model: Mapped[str] = mapped_column(String(100), nullable=True)
    start_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint('meeting_id', 'user_id', 'chunk_index', name='uq_meeting_draft_chunk'),
        Index('idx_meeting_draft_meeting_user', 'meeting_id', 'user_id'),
        {"mysql_engine": "InnoDB", "mysql_charset": "utf8mb4", "mysql_collate": "utf8mb4_unicode_ci"},
    )


# ==================== Summaries & Action Items ====================

class MeetingSummary(Base):
    __tablename__ = "meeting_summaries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    language: Mapped[str] = mapped_column(String(10), default='vi')
    key_points: Mapped[dict] = mapped_column(JSON, nullable=True)
    decisions: Mapped[dict] = mapped_column(JSON, nullable=True)
    action_items: Mapped[dict] = mapped_column(JSON, nullable=True)
    risks: Mapped[dict] = mapped_column(JSON, nullable=True)
    open_questions: Mapped[dict] = mapped_column(JSON, nullable=True)
    timeline_highlights: Mapped[dict] = mapped_column(JSON, nullable=True)
    speaker_summaries: Mapped[dict] = mapped_column(JSON, nullable=True)
    meeting_summary: Mapped[str] = mapped_column(Text, nullable=True)
    ai_provider: Mapped[str] = mapped_column(String(50), default='openai')
    model_name: Mapped[str] = mapped_column(String(100), nullable=True)
    processing_status: Mapped[str] = mapped_column(String(20), default='PENDING')  # PENDING, PROCESSING, COMPLETED, FAILED
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("processing_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')", name='check_summary_status'),
        Index('idx_summary_meeting', 'meeting_id'),
    )

    # Relationships
    meeting = relationship("Meeting", back_populates="summaries")
    linked_action_items = relationship("ActionItem", back_populates="summary", cascade="all, delete-orphan")


class ActionItem(Base):
    __tablename__ = "action_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=True)
    summary_id: Mapped[str] = mapped_column(String(36), ForeignKey("meeting_summaries.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    assigned_to: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    assigned_email: Mapped[str] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default='PENDING')  # PENDING, IN_PROGRESS, COMPLETED, CANCELLED
    priority: Mapped[str] = mapped_column(String(20), default='MEDIUM')  # LOW, MEDIUM, HIGH, URGENT
    due_date: Mapped[Date] = mapped_column(Date, nullable=True)
    completed_at: Mapped[DateTime] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')", name='check_action_status'),
        CheckConstraint("priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')", name='check_action_priority'),
        Index('idx_action_items_assigned_to', 'assigned_to'),
    )

    # Relationships
    meeting = relationship("Meeting", back_populates="action_items")
    summary = relationship("MeetingSummary", back_populates="linked_action_items")
    assigned_to_user = relationship("User", back_populates="assigned_action_items", foreign_keys=[assigned_to])
    created_by_user = relationship("User", back_populates="created_action_items", foreign_keys=[created_by])
    assignees = relationship("ActionItemAssignee", back_populates="action_item", cascade="all, delete-orphan")


class ActionItemAssignee(Base):
    __tablename__ = "action_item_assignees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    action_item_id: Mapped[str] = mapped_column(String(36), ForeignKey("action_items.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="PENDING")
    completed_at: Mapped[Optional[DateTime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')", name='check_action_item_assignee_status'),
        UniqueConstraint('action_item_id', 'email', name='uq_action_item_assignee_email'),
        Index('idx_action_item_assignees_action_item_id', 'action_item_id'),
        Index('idx_action_item_assignees_user_id', 'user_id'),
        Index('idx_action_item_assignees_email', 'email'),
        Index('idx_action_item_assignees_status', 'status'),
    )

    action_item = relationship("ActionItem", back_populates="assignees")
    user = relationship("User", back_populates="action_item_assignments")


# ==================== Exports ====================

class ExportFile(Base):
    __tablename__ = "export_files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    format: Mapped[str] = mapped_column(String(20), nullable=False)  # PDF, DOCX, TXT
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=True)
    template_type: Mapped[str] = mapped_column(String(50), default='STANDARD')
    include_transcript: Mapped[bool] = mapped_column(Boolean, default=True)
    include_summary: Mapped[bool] = mapped_column(Boolean, default=True)
    include_action_items: Mapped[bool] = mapped_column(Boolean, default=True)
    generated_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    download_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[DateTime] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        CheckConstraint("format IN ('PDF', 'DOCX', 'TXT')", name='check_export_format'),
    )

    # Relationships
    meeting = relationship("Meeting", back_populates="export_files")
    generated_by_user = relationship("User", back_populates="export_files")


# ==================== Cost Tracking ====================

class CostTracking(Base):
    __tablename__ = "cost_tracking"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    meeting_id: Mapped[str] = mapped_column(String(36), ForeignKey("meetings.id", ondelete="CASCADE"), nullable=True)
    service: Mapped[str] = mapped_column(String(50), nullable=False)
    api_endpoint: Mapped[str] = mapped_column(String(255), nullable=True)
    model_name: Mapped[str] = mapped_column(String(100), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 6), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default='USD')
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())

    # Relationships
    meeting = relationship("Meeting", back_populates="cost_tracking")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    time: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    user: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="System Admin")
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    target: Mapped[str] = mapped_column(String(500), nullable=False)
    org: Mapped[str] = mapped_column(String(255), nullable=False, default="System")
    ip: Mapped[str] = mapped_column(String(64), nullable=False, default="system")

    __table_args__ = (
        Index('idx_audit_logs_time', 'time'),
        Index('idx_audit_logs_action', 'action'),
    )


class AdminSetting(Base):
    """System-wide admin settings persisted as key/value rows."""
    __tablename__ = "admin_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AdminPrompt(Base):
    """Admin-managed AI prompts (one row per prompt key)."""
    __tablename__ = "admin_prompts"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[str] = mapped_column(String(50), nullable=False, default="1.0.0")
    last_updated: Mapped[DateTime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AdminBroadcast(Base):
    """History of admin broadcast notifications sent to users."""
    __tablename__ = "admin_broadcasts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False, default="info")
    target: Mapped[str] = mapped_column(String(255), nullable=False, default="all")
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="sent")
    reach: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sent_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    sent_by: Mapped[str] = mapped_column(String(255), nullable=True)

    __table_args__ = (
        Index('idx_admin_broadcasts_sent_at', 'sent_at'),
    )


class Glossary(Base):
    """Per-organization glossary entries used for STT vocabulary boost and
    summary prompt expansion. system_wide=True (org_id NULL) glossaries apply
    to every meeting in every org as a system default."""
    __tablename__ = "glossaries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_uuid)
    organization_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    term: Mapped[str] = mapped_column(String(255), nullable=False)
    definition: Mapped[str] = mapped_column(Text, nullable=True)
    aliases: Mapped[list] = mapped_column(JSON, nullable=True)
    language: Mapped[str] = mapped_column(String(10), default="vi", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )
    created_by: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    __table_args__ = (
        UniqueConstraint("organization_id", "term", "language", name="uq_glossary_org_term_lang"),
        Index("idx_glossary_org", "organization_id"),
        Index("idx_glossary_active", "is_active"),
    )
