from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime, date


# ==================== Base Schemas ====================

class BaseSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class TimestampMixin(BaseModel):
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ==================== User Schemas ====================

class UserBase(BaseSchema):
    username: str = Field(..., min_length=3, max_length=50)
    email: str
    role: str = Field(default="member", pattern="^(system-admin|member)$")
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    avatar_url: Optional[str] = Field(None, max_length=500)
    bio: Optional[str] = Field(None, max_length=400)
    language: str = Field(default="vi", max_length=10)
    timezone: str = Field(default="Asia/Ho_Chi_Minh", max_length=100)
    notification_preferences: Optional[Dict[str, Any]] = None
    is_active: bool = True
    is_verified: bool = False
    phone: Optional[str] = Field(None, max_length=20)
    gender: Optional[str] = Field(None, pattern="^(male|female|other)$")
    date_of_birth: Optional[datetime] = None


class UserCreate(UserBase):
    password: str = Field(..., min_length=8)


class UserUpdate(BaseSchema):
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    email: Optional[EmailStr] = None
    role: Optional[str] = Field(None, pattern="^(system-admin|member)$")
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    avatar_url: Optional[str] = Field(None, max_length=500)
    bio: Optional[str] = Field(None, max_length=400)
    language: Optional[str] = Field(None, max_length=10)
    timezone: Optional[str] = Field(None, max_length=100)
    notification_preferences: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    is_verified: Optional[bool] = None
    phone: Optional[str] = Field(None, max_length=20)
    gender: Optional[str] = Field(None, pattern="^(male|female|other)$")
    date_of_birth: Optional[datetime] = None
    password: Optional[str] = Field(None, min_length=8)


class User(UserBase, TimestampMixin):
    id: str
    last_login: Optional[datetime] = None


class UserLogin(BaseSchema):
    username: str
    password: str


class RegisterRequest(BaseSchema):
    username: Optional[str] = Field(None, min_length=3, max_length=50)
    email: EmailStr
    password: str = Field(..., min_length=8)
    firstName: Optional[str] = Field(None, max_length=100)
    lastName: Optional[str] = Field(None, max_length=100)
    phone: Optional[str] = Field(None, max_length=20)
    gender: Optional[str] = Field(None, pattern="^(male|female|other)$")
    dateOfBirth: date
    inviteToken: Optional[str] = None
    orgName: Optional[str] = Field(None, max_length=255)


class ForgotPasswordRequest(BaseSchema):
    email: EmailStr


class ResetPasswordRequest(BaseSchema):
    email: EmailStr
    otp: str = Field(..., min_length=6, max_length=6)
    newPassword: str = Field(..., min_length=8)


class ProfileUpdate(BaseSchema):
    first_name: Optional[str] = Field(None, max_length=100)
    last_name: Optional[str] = Field(None, max_length=100)
    avatar_url: Optional[str] = Field(None, max_length=500)
    bio: Optional[str] = Field(None, max_length=400)
    language: Optional[str] = Field(None, max_length=10)
    timezone: Optional[str] = Field(None, max_length=100)
    notification_preferences: Optional[Dict[str, Any]] = None
    phone: Optional[str] = Field(None, max_length=20)
    gender: Optional[str] = Field(None, pattern="^(male|female|other)$")
    date_of_birth: Optional[datetime] = None


class ChangePasswordRequest(BaseSchema):
    current_password: str
    new_password: str = Field(..., min_length=8)


# ==================== Organization Schemas ====================

class OrganizationBase(BaseSchema):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    domain: Optional[str] = Field(None, max_length=255)
    logo_url: Optional[str] = Field(None, max_length=500)
    settings: Optional[Dict[str, Any]] = None


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationUpdate(BaseSchema):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    domain: Optional[str] = Field(None, max_length=255)
    logo_url: Optional[str] = Field(None, max_length=500)
    settings: Optional[Dict[str, Any]] = None


class Organization(OrganizationBase, TimestampMixin):
    id: str
    member_count: int = 0
    group_count: int = 0
    meeting_count: int = 0
    total_hours: float = 0
    approval_status: str = "active"
    requested_by_user_id: Optional[str] = None
    approved_by_user_id: Optional[str] = None
    approved_at: Optional[datetime] = None


# ==================== User Organization Schemas ====================

class UserOrganizationBase(BaseSchema):
    role: str = Field(default="member", pattern="^(org-admin|member|viewer)$")


class UserOrganizationCreate(UserOrganizationBase):
    user_id: str
    organization_id: str


class UserOrganization(UserOrganizationBase, TimestampMixin):
    id: str
    user_id: str
    organization_id: str
    joined_at: datetime


# ==================== Group Schemas ====================

class GroupBase(BaseSchema):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    privacy_level: str = Field(default="internal", pattern="^(private|internal|public)$")
    settings: Optional[Dict[str, Any]] = None


class GroupCreate(GroupBase):
    organization_id: str


class GroupUpdate(BaseSchema):
    name: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    privacy_level: Optional[str] = Field(None, pattern="^(private|internal|public)$")
    settings: Optional[Dict[str, Any]] = None


class Group(GroupBase, TimestampMixin):
    id: str
    organization_id: str
    created_by: Optional[str] = None
    member_count: int = 0
    meeting_count: int = 0
    total_hours: float = 0


class GroupMessageBase(BaseSchema):
    text: str
    reactions: Optional[List[Dict[str, Any]]] = None
    is_pinned: bool = False
    reply_to_id: Optional[str] = None


class GroupMessageCreate(BaseSchema):
    text: str
    reply_to_id: Optional[str] = None


class GroupMessageUpdate(BaseSchema):
    text: Optional[str] = None
    reactions: Optional[List[Dict[str, Any]]] = None
    is_pinned: Optional[bool] = None


class GroupMessage(GroupMessageBase, TimestampMixin):
    id: str
    group_id: str
    user_id: str
    user: Optional['User'] = None
    reply_to: Optional['GroupMessage'] = None


class GroupMembershipBase(BaseSchema):
    role: str = Field(default="member", pattern="^(group-admin|member|viewer)$")


class GroupMembershipCreate(GroupMembershipBase):
    user_id: str


class GroupMembershipUpdate(BaseSchema):
    role: str = Field(..., pattern="^(group-admin|member|viewer)$")


class GroupMembership(GroupMembershipBase, TimestampMixin):
    id: str
    group_id: str
    user_id: str
    invited_by: Optional[str] = None
    joined_at: datetime


class GroupMember(User):
    groupMemberships: List[Dict[str, Any]] = Field(default_factory=list)


class InvitationCreate(BaseSchema):
    email: EmailStr
    organization_id: str
    group_id: Optional[str] = None
    role: str = Field(default="member", pattern="^(org-admin|group-admin|member|viewer)$")


class BulkInvitationCreate(BaseSchema):
    emails: List[str]
    organization_id: str
    group_id: Optional[str] = None
    role: str = Field(default="member", pattern="^(org-admin|group-admin|member|viewer)$")


class BulkInvitationResult(BaseSchema):
    email: str
    status: str  # "invited" | "already_member" | "already_pending" | "error"
    message: str
    invitation_id: Optional[str] = None


class BulkInvitationResponse(BaseSchema):
    results: List[BulkInvitationResult]
    total: int
    invited: int
    skipped: int
    errors: int


class InvitationCreateResponse(BaseSchema):
    message: str
    email: EmailStr
    organization_id: str
    expires_at: datetime
    invitation_id: Optional[str] = None
    emailSent: bool = False
    alreadyPending: bool = False


class UserSearchResult(BaseSchema):
    id: str
    email: EmailStr
    displayName: Optional[str] = None
    username: Optional[str] = None
    avatarUrl: Optional[str] = None


class InvitationPreview(BaseSchema):
    email: EmailStr
    organization_id: str
    organization_name: Optional[str] = None
    role: str
    status: str
    expires_at: datetime


class InvitationAccept(BaseSchema):
    token: str


class InvitationAcceptResponse(BaseSchema):
    message: str
    organization_id: str


class Invitation(BaseSchema):
    id: str
    email: EmailStr
    organization_id: str
    group_id: Optional[str] = None
    role: str
    status: str
    expires_at: datetime
    invited_by: str
    accepted_by: Optional[str] = None
    accepted_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


# ==================== Meeting Schemas ====================

class MeetingBase(BaseSchema):
    title: str = Field(..., max_length=500)
    description: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    duration: int = 0
    location: Optional[str] = Field(None, max_length=255)
    meeting_type: str = Field(default="MEETING", pattern="^(MEETING|INTERVIEW|TRAINING|REVIEW)$")
    status: str = Field(default="upcoming", pattern="^(queued|processing|completed|failed|live|upcoming|canceled)$")
    code: Optional[str] = None
    recording_url: Optional[str] = None
    transcript_url: Optional[str] = None
    audio_url: Optional[str] = None
    audio_status: Optional[str] = Field(default="NONE", pattern="^(NONE|PROCESSING|READY|FAILED)$")
    is_pinned: bool = False


class MeetingCreate(MeetingBase):
    organization_id: str
    group_id: Optional[str] = None
    participant_ids: Optional[List[str]] = None
    participant_emails: Optional[List[str]] = None
    settings: Optional[Dict[str, Any]] = None


class MeetingUpdate(BaseSchema):
    title: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = None
    scheduled_start: Optional[datetime] = None
    scheduled_end: Optional[datetime] = None
    actual_start: Optional[datetime] = None
    actual_end: Optional[datetime] = None
    duration: Optional[int] = None
    location: Optional[str] = Field(None, max_length=255)
    meeting_type: Optional[str] = Field(None, pattern="^(MEETING|INTERVIEW|TRAINING|REVIEW)$")
    status: Optional[str] = Field(None, pattern="^(queued|processing|completed|failed|live|upcoming|canceled)$")
    code: Optional[str] = None
    recording_url: Optional[str] = None
    transcript_url: Optional[str] = None
    audio_url: Optional[str] = None
    group_id: Optional[str] = None
    participant_ids: Optional[List[str]] = None
    is_pinned: Optional[bool] = None


class Meeting(MeetingBase, TimestampMixin):
    id: str
    organization_id: str
    group_id: Optional[str] = None
    created_by: str
    participants: List["MeetingParticipant"] = Field(default_factory=list)
    attended_participants: List["MeetingParticipant"] = Field(default_factory=list)
    attended_participants_count: int = 0
    group_name: Optional[str] = None
    organization_name: Optional[str] = None
    summary_text: Optional[str] = None
    key_points_list: Optional[List[str]] = None
    decisions_list: Optional[List[str]] = None
    action_items_count: int = 0


# ==================== Meeting Participant Schemas ====================

class MeetingParticipantBase(BaseSchema):
    user_id: Optional[str] = None
    speaker_label: Optional[str] = Field(None, max_length=50)
    email: Optional[EmailStr] = None
    name: Optional[str] = Field(None, max_length=255)
    role: str = Field(default="PARTICIPANT", max_length=50)
    invite_status: str = Field(default="accepted", max_length=20)  # pending, accepted, declined, attended
    is_required: bool = False
    attended: bool = False
    joined_at: Optional[datetime] = None
    left_at: Optional[datetime] = None


class MeetingParticipantCreate(MeetingParticipantBase):
    meeting_id: str


class MeetingParticipantUpdate(BaseSchema):
    speaker_label: Optional[str] = Field(None, max_length=50)
    role: Optional[str] = Field(None, max_length=50)
    invite_status: Optional[str] = Field(None, max_length=20)
    is_required: Optional[bool] = None
    attended: Optional[bool] = None
    joined_at: Optional[datetime] = None
    left_at: Optional[datetime] = None


class MeetingParticipant(MeetingParticipantBase, TimestampMixin):
    id: str
    meeting_id: str
    user: Optional[User] = None


class MeetingMessageCreate(BaseSchema):
    text: str = Field(..., min_length=1, max_length=4000)
    message_type: str = Field(default="chat", pattern="^(chat|system)$")
    reply_to_id: Optional[str] = None


class MeetingMessage(BaseSchema):
    id: str
    meeting_id: str
    user_id: str
    text: str
    message_type: str = "chat"
    reply_to_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    user: Optional[Dict[str, Any]] = None


class MeetingSpeakerMappingUpdate(BaseSchema):
    display_name: str = Field(..., min_length=1, max_length=255)
    user_id: Optional[str] = None


class MeetingSpeakerMapping(BaseSchema):
    id: str
    meeting_id: str
    speaker_label: str
    display_name: str
    user_id: Optional[str] = None
    user: Optional[User] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ==================== Audio File Schemas ====================

class AudioFileBase(BaseSchema):
    filename: str = Field(..., max_length=255)
    original_filename: str = Field(..., max_length=255)
    file_path: str = Field(..., max_length=500)
    file_size: int
    duration_seconds: Optional[int] = None
    format: str = Field(..., max_length=20)
    sample_rate: Optional[int] = None
    channels: Optional[int] = None
    upload_status: str = Field(default="UPLOADING", pattern="^(UPLOADING|UPLOADED|PROCESSING|PROCESSED|FAILED)$")


class AudioFileCreate(AudioFileBase):
    meeting_id: str


class AudioFileUpdate(BaseSchema):
    upload_status: Optional[str] = Field(None, pattern="^(UPLOADING|UPLOADED|PROCESSING|PROCESSED|FAILED)$")
    duration_seconds: Optional[int] = None


class AudioFile(AudioFileBase, TimestampMixin):
    id: str
    meeting_id: str


# ==================== Transcript Schemas ====================

class TranscriptBase(BaseSchema):
    content: str
    language: str = Field(default="vi", max_length=10)
    word_count: int = 0
    processing_status: str = Field(default="PENDING", pattern="^(PENDING|PROCESSING|COMPLETED|FAILED)$")
    stt_provider: str = Field(default="whisper", max_length=50)
    confidence_score: Optional[float] = None
    post_processed: bool = False
    nlp_metadata: Optional[Dict[str, Any]] = None


class TranscriptCreate(TranscriptBase):
    meeting_id: str
    audio_file_id: Optional[str] = None


class TranscriptUpdate(BaseSchema):
    content: Optional[str] = None
    language: Optional[str] = Field(None, max_length=10)
    word_count: Optional[int] = None
    processing_status: Optional[str] = Field(None, pattern="^(PENDING|PROCESSING|COMPLETED|FAILED)$")
    confidence_score: Optional[float] = None
    post_processed: Optional[bool] = None
    nlp_metadata: Optional[Dict[str, Any]] = None


class Transcript(TranscriptBase, TimestampMixin):
    id: str
    meeting_id: str
    audio_file_id: Optional[str] = None


# ==================== Transcript Segment Schemas ====================

class TranscriptSegmentBase(BaseSchema):
    speaker_label: str = Field(..., max_length=50)
    start_time: float
    end_time: float
    text: str
    original_text: Optional[str] = None
    language: str = Field(default="auto", max_length=10)
    confidence_score: Optional[float] = None
    nlp_metadata: Optional[Dict[str, Any]] = None
    word_count: int = 0


class TranscriptSegmentCreate(TranscriptSegmentBase):
    transcript_id: str


class TranscriptSegment(TranscriptSegmentBase, TimestampMixin):
    id: str
    transcript_id: str


# ==================== Meeting Summary Schemas ====================

class MeetingSummaryBase(BaseSchema):
    language: str = Field(default="vi", max_length=10)
    key_points: Optional[List[Any]] = None
    decisions: Optional[List[Any]] = None
    action_items: Optional[List[Dict[str, Any]]] = None
    risks: Optional[List[Any]] = None
    open_questions: Optional[List[Any]] = None
    timeline_highlights: Optional[List[Any]] = None
    speaker_summaries: Optional[List[Any]] = None
    meeting_summary: Optional[str] = None
    ai_provider: str = Field(default="openai", max_length=50)
    model_name: Optional[str] = Field(None, max_length=100)
    processing_status: str = Field(default="PENDING", pattern="^(PENDING|PROCESSING|COMPLETED|FAILED)$")


class MeetingSummaryCreate(MeetingSummaryBase):
    meeting_id: str


class MeetingSummaryUpdate(BaseSchema):
    key_points: Optional[List[Any]] = None
    decisions: Optional[List[Any]] = None
    action_items: Optional[List[Dict[str, Any]]] = None
    risks: Optional[List[Any]] = None
    open_questions: Optional[List[Any]] = None
    timeline_highlights: Optional[List[Any]] = None
    speaker_summaries: Optional[List[Any]] = None
    meeting_summary: Optional[str] = None
    processing_status: Optional[str] = Field(None, pattern="^(PENDING|PROCESSING|COMPLETED|FAILED)$")


class MeetingSummary(MeetingSummaryBase, TimestampMixin):
    id: str
    meeting_id: str


# ==================== Action Item Schemas ====================

class ActionItemBase(BaseSchema):
    title: str = Field(..., max_length=500)
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    assigned_email: Optional[EmailStr] = None
    assignee_user_ids: Optional[List[str]] = None
    assignee_emails: Optional[List[EmailStr]] = None
    assign_all_participants: bool = False
    status: str = Field(default="PENDING", pattern="^(PENDING|IN_PROGRESS|COMPLETED|CANCELLED)$")
    priority: str = Field(default="MEDIUM", pattern="^(LOW|MEDIUM|HIGH|URGENT)$")
    due_date: Optional[date] = None


class ActionItemCreate(ActionItemBase):
    meeting_id: Optional[str] = None
    summary_id: Optional[str] = None


class ActionItemUpdate(BaseSchema):
    title: Optional[str] = Field(None, max_length=500)
    description: Optional[str] = None
    assigned_to: Optional[str] = None
    assigned_email: Optional[EmailStr] = None
    assignee_user_ids: Optional[List[str]] = None
    assignee_emails: Optional[List[EmailStr]] = None
    assign_all_participants: Optional[bool] = None
    status: Optional[str] = Field(None, pattern="^(PENDING|IN_PROGRESS|COMPLETED|CANCELLED)$")
    priority: Optional[str] = Field(None, pattern="^(LOW|MEDIUM|HIGH|URGENT)$")
    due_date: Optional[date] = None


class ActionItemAssigneeOption(BaseSchema):
    email: str
    label: str
    user_id: Optional[str] = None


class ActionItemAssigneeBase(BaseSchema):
    user_id: Optional[str] = None
    email: EmailStr
    display_name: Optional[str] = None
    status: str = Field(default="PENDING", pattern="^(PENDING|IN_PROGRESS|COMPLETED|CANCELLED)$")


class ActionItemAssignee(ActionItemAssigneeBase, TimestampMixin):
    id: str
    completed_at: Optional[datetime] = None


class ActionItemAssigneeStatusUpdate(BaseSchema):
    status: str = Field(..., pattern="^(PENDING|IN_PROGRESS|COMPLETED|CANCELLED)$")


class TranscriptAnchor(BaseSchema):
    start_time: float
    end_time: Optional[float] = None
    speaker_label: Optional[str] = None
    source_segment_ids: List[str] = Field(default_factory=list)


class AnchoredTextItem(BaseSchema):
    text: str
    anchor: Optional[TranscriptAnchor] = None


class ActionItem(ActionItemBase, TimestampMixin):
    id: str
    meeting_id: Optional[str] = None
    meeting_title: Optional[str] = None
    assignee_options: Optional[List[ActionItemAssigneeOption]] = None
    assignees: List[ActionItemAssignee] = Field(default_factory=list)
    summary_id: Optional[str] = None
    anchor: Optional[TranscriptAnchor] = None
    created_by: str
    completed_at: Optional[datetime] = None


# ==================== Export File Schemas ====================

class ExportFileBase(BaseSchema):
    filename: str = Field(..., max_length=255)
    file_path: str = Field(..., max_length=500)
    format: str = Field(..., pattern="^(PDF|DOCX|TXT)$")
    file_size: Optional[int] = None
    template_type: str = Field(default="STANDARD", max_length=50)
    include_transcript: bool = True
    include_summary: bool = True
    include_action_items: bool = True


class ExportFileCreate(ExportFileBase):
    meeting_id: str
    expires_at: Optional[datetime] = None


class ExportFile(ExportFileBase, TimestampMixin):
    id: str
    meeting_id: str
    generated_by: str
    download_count: int = 0
    expires_at: Optional[datetime] = None


# ==================== Cost Tracking Schemas ====================

class CostTrackingBase(BaseSchema):
    service: str = Field(..., max_length=50)
    api_endpoint: Optional[str] = Field(None, max_length=255)
    model_name: Optional[str] = Field(None, max_length=100)
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float
    currency: str = Field(default="USD", max_length=3)


class CostTrackingCreate(CostTrackingBase):
    meeting_id: Optional[str] = None


class CostTracking(CostTrackingBase, TimestampMixin):
    id: str
    meeting_id: Optional[str] = None


# ==================== Response Schemas ====================

class MessageResponse(BaseSchema):
    message: str


class RegisterResponse(BaseSchema):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]
    nextStep: str
    acceptedInvitation: bool = False


class PaginatedResponse(BaseSchema):
    items: List[Any]
    total: int
    skip: int
    limit: int


# ==================== Meeting Detail Response ====================

class MeetingDetailResponse(Meeting):
    organization: Optional[Organization] = None
    group: Optional[Group] = None
    created_by_user: Optional[User] = None
    participants: List[MeetingParticipant] = Field(default_factory=list)
    audio_files: List[AudioFile] = Field(default_factory=list)
    transcripts: List[Transcript] = Field(default_factory=list)
    transcript_segments: List[Dict[str, Any]] = Field(default_factory=list)
    speaker_mappings: List[MeetingSpeakerMapping] = Field(default_factory=list)
    summaries: List[MeetingSummary] = Field(default_factory=list)
    action_items: List[ActionItem] = Field(default_factory=list)
    transcript_content: Optional[str] = None
    transcript_language: Optional[str] = None
    transcript_status: Optional[str] = None
    has_transcript_draft: bool = False
    activity: List[Dict[str, Any]] = Field(default_factory=list)
    meeting_summary_text: Optional[str] = None
    key_points_text: List[str] = Field(default_factory=list)
    key_points_items: List[AnchoredTextItem] = Field(default_factory=list)
    decisions_text: List[str] = Field(default_factory=list)
    decisions_items: List[AnchoredTextItem] = Field(default_factory=list)
    risks_text: List[str] = Field(default_factory=list)
    open_questions_text: List[str] = Field(default_factory=list)
    timeline_highlights_text: List[str] = Field(default_factory=list)
    timeline_highlights_items: List[AnchoredTextItem] = Field(default_factory=list)
    speaker_summaries_text: List[str] = Field(default_factory=list)
    summary_status: Optional[str] = None
    summary_error_text: Optional[str] = None
    summary_provider: Optional[str] = None
    summary_model_name: Optional[str] = None
    access_mode: Optional[str] = None


class SearchResult(BaseSchema):
    id: str
    type: str
    title: str
    subtitle: Optional[str] = None
    route: str
    context: Optional[Dict[str, Any]] = None


class MeetingAnalysisActionItem(BaseSchema):
    task: str
    owner: str
    deadline: str


class MeetingAnalysisOutput(BaseSchema):
    meeting_summary: str
    key_points: List[str] = Field(default_factory=list)
    decisions: List[str] = Field(default_factory=list)
    action_items: List[MeetingAnalysisActionItem] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)
    open_questions: List[str] = Field(default_factory=list)
    timeline_highlights: List[str] = Field(default_factory=list)
    speaker_summaries: List[str] = Field(default_factory=list)


class MeetingFinalizeResponse(BaseSchema):
    meeting_id: str
    transcript_status: str
    summary_status: str
    has_transcript_draft: bool = False
    summary: MeetingAnalysisOutput
    nlp_metadata: Optional[Dict[str, Any]] = None
    errors: List[str] = Field(default_factory=list)


class TestSTTAnalyzeRequest(BaseSchema):
    transcript: str
    segments: List[Dict[str, Any]] = Field(default_factory=list)
    language: str = "vi"


class TestSTTAnalyzeResponse(BaseSchema):
    summary_status: str
    summary: MeetingAnalysisOutput
    nlp_metadata: Optional[Dict[str, Any]] = None
    errors: List[str] = Field(default_factory=list)
