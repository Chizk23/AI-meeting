from typing import Any, Dict, Optional

from src.api import models


def normalize_global_role(role: Optional[str]) -> str:
    return "system-admin" if role == "system-admin" else "member"


def get_organization_approval_status(org: models.Organization) -> str:
    settings = org.settings or {}
    return settings.get("approval_status", "active")


def format_user_payload(user: models.User) -> Dict[str, Any]:
    display_name = " ".join(part for part in [user.first_name, user.last_name] if part).strip() or user.username
    system_role = normalize_global_role(user.role)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": system_role,
        "systemRole": system_role,
        "displayName": display_name,
        "firstName": user.first_name,
        "lastName": user.last_name,
        "avatarUrl": user.avatar_url,
        "bio": user.bio,
        "phone": user.phone,
        "gender": user.gender,
        "dateOfBirth": user.date_of_birth.isoformat() if user.date_of_birth else None,
        "language": user.language or "vi",
        "timezone": user.timezone or "Asia/Ho_Chi_Minh",
        "notificationPreferences": user.notification_preferences or {},
        "isActive": user.is_active,
        "createdAt": user.created_at.isoformat() if user.created_at else None,
        "updatedAt": user.updated_at.isoformat() if user.updated_at else None,
        "orgMemberships": [
            {
                "orgId": om.organization_id,
                "role": om.role,
                "orgName": om.organization.name if om.organization else None,
                "approvalStatus": get_organization_approval_status(om.organization) if om.organization else "active",
            }
            for om in user.user_organizations
        ],
        "groupMemberships": [
            {"groupId": gm.group_id, "role": gm.role, "groupName": gm.group.name if gm.group else None}
            for gm in user.group_memberships
        ],
    }

from sqlalchemy import or_, func
from src.api import auth
from fastapi import HTTPException

def user_org_ids(user: models.User) -> list[str]:
    return [membership.organization_id for membership in user.user_organizations]

def meeting_participant_meeting_ids_for_user(db, user: models.User):
    email = (user.email or "").lower()
    participant_filter = models.MeetingParticipant.user_id == user.id
    if email:
        participant_filter = or_(
            participant_filter,
            func.lower(models.MeetingParticipant.email) == email,
        )
    return db.query(models.MeetingParticipant.meeting_id).filter(
        participant_filter,
        or_(
            models.MeetingParticipant.invite_status.is_(None),
            models.MeetingParticipant.invite_status != "declined",
        ),
    )

def meeting_group_ids_for_user(user: models.User) -> list[str]:
    return [membership.group_id for membership in user.group_memberships]

def get_meeting_participant_for_user(db, meeting_id: str, user: models.User):
    email = (user.email or "").lower()
    if not email:
        return None
    participant = db.query(models.MeetingParticipant).filter(
        models.MeetingParticipant.meeting_id == meeting_id,
        func.lower(models.MeetingParticipant.email) == email,
    ).first()
    if participant and not participant.user_id:
        existing_user_participant = db.query(models.MeetingParticipant).filter(
            models.MeetingParticipant.meeting_id == meeting_id,
            models.MeetingParticipant.user_id == user.id,
        ).first()
        if not existing_user_participant:
            participant.user_id = user.id
            participant.name = participant.name or " ".join(
                part for part in [user.first_name, user.last_name] if part
            ).strip() or user.username
            db.flush()
    return participant

def require_meeting_room_access(db, user: models.User, meeting: models.Meeting) -> Optional[models.MeetingParticipant]:
    try:
        auth.require_org_member(db, user, meeting.organization_id)
        return get_meeting_participant_for_user(db, meeting.id, user)
    except HTTPException as org_error:
        participant = get_meeting_participant_for_user(db, meeting.id, user)
        if participant and participant.invite_status != "declined":
            return participant
        raise org_error

def get_meeting_by_id(db, meeting_id: str) -> models.Meeting:
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return meeting

def ensure_speaker_mapping(db, meeting_id: str, speaker_label: str, display_name: str):
    from src.api.domains.meetings.support import normalize_speaker_label
    mapping = db.query(models.MeetingSpeakerMapping).filter(
        models.MeetingSpeakerMapping.meeting_id == meeting_id,
        models.MeetingSpeakerMapping.speaker_label == speaker_label,
    ).first()
    if mapping:
        if not mapping.display_name or mapping.display_name == speaker_label:
            mapping.display_name = display_name
            db.flush()
    else:
        mapping = models.MeetingSpeakerMapping(
            meeting_id=meeting_id,
            speaker_label=speaker_label,
            display_name=display_name,
        )
        db.add(mapping)
        db.flush()
    return mapping

