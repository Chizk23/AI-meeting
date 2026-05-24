import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, Request
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from src.api import auth, models, schemas
from src.api.core.meetings_support import normalize_speaker_label
from src.api.core.meeting_operations import (
    broadcast_participant_list_event,
    build_meeting_detail_payload,
    build_room_snapshot,
    compute_meeting_duration_minutes,
    ensure_speaker_mapping,
    format_meeting_message_payload,
    format_meeting_participant_payload,
    format_user_payload,
    get_meeting_access_mode,
    get_attended_participants,
    get_ws_user,
    mark_participant_attended,
    meeting_room_manager,
    normalize_meeting_datetime,
    require_meeting_manager,
    speaker_mapping_payload,
)
from src.api.core.user_payloads import get_meeting_by_id, require_meeting_room_access, user_org_ids, meeting_participant_meeting_ids_for_user, meeting_group_ids_for_user
from src.api.crud import (
    add_meeting_participant,
    check_meeting_overlap,
    create_meeting,
    remove_meeting_participant,
    update_meeting,
)
from src.api.core.admin_runtime import append_admin_audit_log
from src.api.core.notifications_support import get_org_admin_recipient_ids, push_runtime_notification
from src.api.database import get_db, SessionLocal
from src.api.core.transcript_support import finalize_meeting_transcript, generate_meeting_ai_notes_all_languages

logger = logging.getLogger(__name__)
router = APIRouter(tags=["meetings"])


def _coerce_utc_aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)

@router.get("/api/meetings", response_model=List[schemas.Meeting])
def list_meetings(
    organization_id: Optional[str] = None,
    group_id: Optional[str] = None,
    status: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    query = db.query(models.Meeting)

    if group_id:
        group = auth.require_group_member(db, current_user, group_id)
        organization_id = organization_id or group.organization_id
        query = query.filter(models.Meeting.group_id == group_id)
    elif organization_id:
        auth.require_org_member(db, current_user, organization_id)
        query = query.filter(models.Meeting.organization_id == organization_id)
    elif current_user.role != "system-admin":
        org_ids = user_org_ids(current_user)
        if not org_ids:
            return []
        query = query.filter(models.Meeting.organization_id.in_(org_ids))

    # Filter by status if provided
    if status:
        query = query.filter(models.Meeting.status == status)

    can_view_all = current_user.role == "system-admin"
    if not can_view_all and organization_id:
        can_view_all = auth.get_user_org_role(db, current_user, organization_id) == "org-admin"
    if not can_view_all and group_id:
        can_view_all = auth.get_user_group_role(db, current_user, group_id) == "group-admin"

    # Regular users can only see meetings they created or are invited to.
    if not can_view_all:
        participant_meeting_ids = db.query(models.MeetingParticipant.meeting_id).filter(
            models.MeetingParticipant.user_id == current_user.id
        ).subquery()
        query = query.filter(
            or_(
                models.Meeting.created_by == current_user.id,
                models.Meeting.id.in_(participant_meeting_ids)
            )
        )

    meetings = query.options(
        joinedload(models.Meeting.organization),
        joinedload(models.Meeting.group),
        joinedload(models.Meeting.created_by_user),
        joinedload(models.Meeting.participants).joinedload(models.MeetingParticipant.user),
        joinedload(models.Meeting.summaries),
        joinedload(models.Meeting.action_items),
    ).order_by(models.Meeting.created_at.desc()).offset(skip).limit(limit).all()

    # Enrich with computed fields for list view
    user_lang = getattr(current_user, "language", None) or "vi"
    for m in meetings:
        m.group_name = m.group.name if m.group else None
        m.organization_name = m.organization.name if m.organization else None
        m.action_items_count = len(m.action_items) if m.action_items else 0
        m.attended_participants = get_attended_participants(m)
        m.attended_participants_count = len(m.attended_participants)
        m.duration = compute_meeting_duration_minutes(m)
        if m.summaries:
            # Prefer summary in user's language, fall back to any
            lang_match = [s for s in m.summaries if (s.language or "vi") == user_lang]
            pool = lang_match if lang_match else m.summaries
            latest = max(pool, key=lambda s: s.created_at or s.id)
            m.summary_text = latest.meeting_summary
            m.key_points_list = latest.key_points if isinstance(latest.key_points, list) else []
            m.decisions_list = latest.decisions if isinstance(latest.decisions, list) else []

    return meetings


@router.get("/api/meetings/by-code/{meeting_code}", response_model=schemas.MeetingDetailResponse)
def get_meeting_by_code(
    meeting_code: str,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user),
):
    meeting = db.query(models.Meeting).options(
        joinedload(models.Meeting.organization),
        joinedload(models.Meeting.group).joinedload(models.Group.memberships),
        joinedload(models.Meeting.created_by_user),
        joinedload(models.Meeting.participants).joinedload(models.MeetingParticipant.user),
        joinedload(models.Meeting.audio_files),
        joinedload(models.Meeting.transcripts).joinedload(models.Transcript.segments),
        joinedload(models.Meeting.summaries),
        joinedload(models.Meeting.action_items).joinedload(models.ActionItem.assignees).joinedload(models.ActionItemAssignee.user),
        joinedload(models.Meeting.speaker_mappings),
    ).filter(models.Meeting.code == meeting_code).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    require_meeting_room_access(db, current_user, meeting)
    user_lang = getattr(current_user, "language", None) or "vi"
    return schemas.MeetingDetailResponse.model_validate(
        build_meeting_detail_payload(
            db,
            meeting,
            user_lang,
            access_mode=get_meeting_access_mode(db, current_user, meeting),
        )
    )


@router.get("/api/meetings/{meeting_id}", response_model=schemas.MeetingDetailResponse)
def get_meeting(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    meeting = get_meeting_by_id(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    require_meeting_room_access(db, current_user, meeting)
    user_lang = getattr(current_user, "language", None) or "vi"
    return schemas.MeetingDetailResponse.model_validate(
        build_meeting_detail_payload(
            db,
            meeting,
            user_lang,
            access_mode=get_meeting_access_mode(db, current_user, meeting),
        )
    )


@router.get("/api/meetings/{meeting_id}/my-status")
def get_my_meeting_status(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user),
):
    """Get current user's participant status for a meeting."""
    meeting = get_meeting_by_id(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    require_meeting_room_access(db, current_user, meeting)

    participant = db.query(models.MeetingParticipant).filter(
        models.MeetingParticipant.meeting_id == meeting_id,
        models.MeetingParticipant.user_id == current_user.id,
    ).first()

    if not participant:
        return {"is_participant": False, "invite_status": None, "role": None}

    return {
        "is_participant": True,
        "invite_status": participant.invite_status,
        "role": participant.role,
        "participant_id": participant.id,
    }


@router.get("/api/meetings/{meeting_id}/messages", response_model=List[schemas.MeetingMessage])
def list_meeting_messages(
    meeting_id: str,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user),
):
    meeting = get_meeting_by_id(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    require_meeting_room_access(db, current_user, meeting)
    messages = db.query(models.MeetingMessage).options(
        joinedload(models.MeetingMessage.user)
    ).filter(
        models.MeetingMessage.meeting_id == meeting_id
    ).order_by(models.MeetingMessage.created_at.asc()).offset(offset).limit(limit).all()
    return [format_meeting_message_payload(message) for message in messages]


@router.post("/api/meetings/{meeting_id}/messages", response_model=schemas.MeetingMessage)
async def create_meeting_message_endpoint(
    meeting_id: str,
    message: schemas.MeetingMessageCreate,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user),
):
    meeting = get_meeting_by_id(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    require_meeting_room_access(db, current_user, meeting)
    text = message.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    db_message = models.MeetingMessage(
        meeting_id=meeting_id,
        user_id=current_user.id,
        text=text,
        message_type=message.message_type,
        reply_to_id=message.reply_to_id,
    )
    db.add(db_message)
    db.commit()
    db.refresh(db_message)
    db_message = db.query(models.MeetingMessage).options(
        joinedload(models.MeetingMessage.user)
    ).filter(models.MeetingMessage.id == db_message.id).first()
    payload = format_meeting_message_payload(db_message)
    await meeting_room_manager.broadcast(meeting_id, {"type": "chat.message", "message": payload})
    return payload


@router.get("/api/meetings/{meeting_id}/speaker-mappings", response_model=List[schemas.MeetingSpeakerMapping])
def list_meeting_speaker_mappings(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user),
):
    meeting = get_meeting_by_id(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    auth.require_org_member(db, current_user, meeting.organization_id)
    mappings = db.query(models.MeetingSpeakerMapping).filter(
        models.MeetingSpeakerMapping.meeting_id == meeting_id
    ).order_by(models.MeetingSpeakerMapping.speaker_label.asc()).all()
    return [speaker_mapping_payload(mapping) for mapping in mappings]


@router.patch("/api/meetings/{meeting_id}/speaker-mappings/{speaker_label}", response_model=schemas.MeetingSpeakerMapping)
async def update_meeting_speaker_mapping(
    meeting_id: str,
    speaker_label: str,
    payload: schemas.MeetingSpeakerMappingUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user),
):
    meeting = get_meeting_by_id(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    auth.require_org_member(db, current_user, meeting.organization_id)
    normalized_label = normalize_speaker_label(speaker_label)
    user_id = payload.user_id
    if user_id:
        participant = db.query(models.MeetingParticipant).filter(
            models.MeetingParticipant.meeting_id == meeting_id,
            models.MeetingParticipant.user_id == user_id,
        ).first()
        if not participant:
            raise HTTPException(status_code=400, detail="Selected user is not a meeting participant")
    mapping = ensure_speaker_mapping(db, meeting_id, normalized_label)
    mapping.display_name = payload.display_name.strip()
    mapping.user_id = user_id
    db.commit()
    db.refresh(mapping)
    response_payload = speaker_mapping_payload(mapping)
    await meeting_room_manager.broadcast(
        meeting_id,
        {"type": "speaker.mapping_updated", "mapping": response_payload},
    )
    return response_payload


@router.websocket("/api/meetings/{meeting_id}/stream")
async def meeting_room_stream(
    websocket: WebSocket,
    meeting_id: str,
    token: Optional[str] = Query(None),
):
    db = SessionLocal()
    current_user: Optional[models.User] = None
    meeting: Optional[models.Meeting] = None
    connected = False
    try:
        header_token = websocket.headers.get("authorization")
        current_user = get_ws_user(db, token or header_token)
        meeting = get_meeting_by_id(db, meeting_id)
        if not meeting:
            await websocket.close(code=1008, reason="Meeting not found")
            return
        participant = require_meeting_room_access(db, current_user, meeting)
        try:
            mark_participant_attended(db, participant)
            db.commit()
        except Exception as attendance_exc:
            logger.warning(
                "Failed to mark participant attended for meeting %s and user %s: %s",
                meeting_id,
                getattr(current_user, "id", None),
                attendance_exc,
                exc_info=True,
            )
            db.rollback()
        user_payload = format_user_payload(current_user)
        await meeting_room_manager.connect(meeting_id, websocket, user_payload)
        connected = True
        try:
            snapshot = build_room_snapshot(db, meeting_id, current_user)
        except Exception as snapshot_exc:
            logger.error(
                "Failed to build meeting room snapshot for meeting %s: %s",
                meeting_id,
                snapshot_exc,
                exc_info=True,
            )
            db.rollback()
            snapshot = {
                "type": "room.snapshot",
                "meeting_id": meeting_id,
                "meeting": {
                    "id": meeting.id,
                    "status": meeting.status,
                    "title": meeting.title,
                    "code": meeting.code,
                    "access_mode": get_meeting_access_mode(db, current_user, meeting),
                },
                "participants": [],
                "online_participants": meeting_room_manager.get_participants(meeting_id),
                "messages": [],
                "transcript": {"text": "", "segments": [], "chunks": []},
                "ai_notes": None,
                "summary_status": None,
                "snapshot_warning": "partial_snapshot",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        await websocket.send_json(snapshot)
        # Broadcast join to all (including sender)
        await meeting_room_manager.broadcast(
            meeting_id,
            {
                "type": "participant.joined",
                "meeting_id": meeting_id,
                "user": user_payload,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
        broadcast_participant_list_event(meeting_id)

        while True:
            data = await websocket.receive_json()
            event_type = data.get("type")
            if event_type == "ping":
                await websocket.send_json({"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()})
            elif event_type == "chat.send":
                text = str(data.get("text") or "").strip()
                if not text:
                    continue
                db_message = models.MeetingMessage(
                    meeting_id=meeting_id,
                    user_id=current_user.id,
                    text=text[:4000],
                    message_type="chat",
                    reply_to_id=data.get("reply_to_id"),
                )
                db.add(db_message)
                db.commit()
                db.refresh(db_message)
                db_message = db.query(models.MeetingMessage).options(
                    joinedload(models.MeetingMessage.user)
                ).filter(models.MeetingMessage.id == db_message.id).first()
                await meeting_room_manager.broadcast(
                    meeting_id,
                    {"type": "chat.message", "message": format_meeting_message_payload(db_message)},
                )
            elif event_type == "participant.state":
                await meeting_room_manager.broadcast(
                    meeting_id,
                    {
                        "type": "participant.state",
                        "meeting_id": meeting_id,
                        "user_id": current_user.id,
                        "micOn": bool(data.get("micOn", True)),
                        "cameraOn": bool(data.get("cameraOn", True)),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
    except WebSocketDisconnect:
        pass
    except HTTPException as exc:
        if not connected:
            await websocket.close(code=1008, reason=str(exc.detail))
    except Exception as exc:
        logger.error("Meeting websocket error: %s", exc, exc_info=True)
        if not connected:
            await websocket.close(code=1011, reason="WebSocket error")
    finally:
        if connected:
            left_user = await meeting_room_manager.disconnect(meeting_id, websocket)
            broadcast_participant_list_event(meeting_id)
            if left_user and current_user:
                await meeting_room_manager.broadcast(
                    meeting_id,
                    {
                        "type": "participant.left",
                        "meeting_id": meeting_id,
                        "user": format_user_payload(current_user),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                )
        db.close()


@router.post("/api/meetings", response_model=schemas.Meeting)
def create_meeting_endpoint(
    meeting_data: schemas.MeetingCreate,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    auth.require_org_member(db, current_user, meeting_data.organization_id)
    if meeting_data.group_id:
        group = auth.require_group_member(db, current_user, meeting_data.group_id)
        if group.organization_id != meeting_data.organization_id:
            raise HTTPException(status_code=400, detail="Group does not belong to organization")

    scheduled_start = normalize_meeting_datetime(meeting_data.scheduled_start)
    scheduled_end = normalize_meeting_datetime(meeting_data.scheduled_end)

    is_instant = meeting_data.status == "live"

    # For instant meetings: set actual_start if no scheduled_start provided
    if is_instant and not scheduled_start:
        scheduled_start = datetime.now(timezone.utc)
        if not scheduled_end:
            scheduled_end = scheduled_start  # duration tracked via actual_start/actual_end

    # Block meetings in the past (skip for instant live meetings)
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    if not is_instant and scheduled_start:
        if scheduled_start < now_utc:
            raise HTTPException(status_code=400, detail="Không thể tạo cuộc họp trong quá khứ")

    # scheduled_end must be after scheduled_start (skip for instant)
    if not is_instant and scheduled_start and scheduled_end:
        if scheduled_end <= scheduled_start:
            raise HTTPException(status_code=400, detail="Thời gian kết thúc phải sau thời gian bắt đầu")

    # Block if any participant has an overlapping meeting (skip for instant)
    if not is_instant and scheduled_start and scheduled_end:
        all_participant_ids = list(set([current_user.id] + (meeting_data.participant_ids or [])))
        conflicts = check_meeting_overlap(
            db,
            participant_ids=all_participant_ids,
            scheduled_start=scheduled_start,
            scheduled_end=scheduled_end,
        )
        if conflicts:
            titles = ", ".join(c["meeting_title"] for c in conflicts)
            raise HTTPException(
                status_code=409,
                detail=f"Trùng lịch với: {titles}. Vui lòng chọn giờ khác.",
            )

    meeting_payload = meeting_data.model_dump()
    meeting_payload["scheduled_start"] = scheduled_start
    meeting_payload["scheduled_end"] = scheduled_end
    if is_instant and not meeting_payload.get("actual_start"):
        meeting_payload["actual_start"] = datetime.now(timezone.utc)
    meeting = create_meeting(db, meeting_payload, created_by=current_user.id)

    # Determine invite_status based on meeting type
    participant_invite_status = "accepted" if is_instant else "pending"

    # Add creator as host participant
    add_meeting_participant(db, meeting.id, user_id=current_user.id, role="HOST", invite_status="accepted")

    # Add invited participants by user ID
    if meeting_data.participant_ids:
        for uid in meeting_data.participant_ids:
            if uid != current_user.id:
                add_meeting_participant(db, meeting.id, user_id=uid, role="PARTICIPANT", invite_status=participant_invite_status)

    # Add invited participants by email
    if meeting_data.participant_emails:
        for email in meeting_data.participant_emails:
            add_meeting_participant(db, meeting.id, email=email, role="PARTICIPANT", invite_status=participant_invite_status)

    # Notify invited participants (in-app)
    if not is_instant and meeting_data.participant_ids:
        for uid in meeting_data.participant_ids:
            if uid != current_user.id:
                push_runtime_notification({
                    "id": f"runtime-invite-{meeting.id}-{uid}-{int(datetime.now(timezone.utc).timestamp())}",
                    "recipient_user_id": uid,
                    "type": "meeting_invite",
                    "priority": "today",
                    "title": "Lời mời tham gia cuộc họp",
                    "message": f"Bạn được mời tham gia \"{meeting.title}\".",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "isRead": False,
                    "metadata": {"meeting_id": meeting.id},
                })

    append_admin_audit_log(
        actor=current_user.username,
        action="CREATE_MEETING",
        target=meeting.title,
        role=current_user.role or "member",
    )

    if current_user.role != "system-admin":
        recipient_ids = get_org_admin_recipient_ids(db, meeting.organization_id, current_user.id)
        actor_name = current_user.first_name or current_user.username or current_user.email
        for recipient_id in recipient_ids:
            push_runtime_notification(
                {
                    "id": f"runtime-create-{meeting.id}-{recipient_id}-{int(datetime.now(timezone.utc).timestamp())}",
                    "recipient_user_id": recipient_id,
                    "type": "meeting",
                    "priority": "today",
                    "title": "Nhân viên vừa tạo cuộc họp mới",
                    "message": f"{actor_name} đã lên lịch \"{meeting.title}\".",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "isRead": False,
                    "metadata": {"group": meeting.group.name if meeting.group else None, "meeting_id": meeting.id},
                }
            )

    return meeting


@router.post("/api/meetings/{meeting_id}/start", response_model=schemas.Meeting)
async def start_meeting_endpoint(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    meeting = get_meeting_by_id(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    auth.require_org_member(db, current_user, meeting.organization_id)
    require_meeting_manager(db, current_user, meeting)

    if meeting.status in {"completed", "failed", "canceled", "processing"}:
        raise HTTPException(status_code=400, detail=f"Cannot start meeting with status '{meeting.status}'")

    now = datetime.now(timezone.utc)
    updates = {
        "actual_start": meeting.actual_start or now,
        "scheduled_start": meeting.scheduled_start or now,
        "scheduled_end": meeting.scheduled_end or (now + timedelta(hours=1)),
    }
    if meeting.status == "upcoming":
        updates["status"] = "live"

    try:
        updated = update_meeting(db, meeting_id, updates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await meeting_room_manager.broadcast(
        meeting_id,
        {"type": "meeting.status", "meeting_id": meeting_id, "status": updated.status, "timestamp": datetime.now(timezone.utc).isoformat()},
    )
    return updated


@router.post("/api/meetings/{meeting_id}/end", response_model=schemas.Meeting)
async def end_meeting_endpoint(
    meeting_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    meeting = get_meeting_by_id(db, meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    auth.require_org_member(db, current_user, meeting.organization_id)
    require_meeting_manager(db, current_user, meeting)

    try:
        body = await request.json()
    except Exception:
        body = {}
    target_status = body.get("status") or "processing"
    if target_status not in {"processing", "completed", "failed"}:
        raise HTTPException(status_code=400, detail="Invalid meeting end status")

    if meeting.status in {"completed", "failed", "canceled"}:
        return meeting

    if target_status == "completed":
        try:
            await generate_meeting_ai_notes_all_languages(meeting_id, db, current_user, {})
            db.expire_all()
            refreshed = get_meeting_by_id(db, meeting_id)
            if refreshed:
                meeting = refreshed
            if meeting.status in {"completed", "failed", "canceled"}:
                await meeting_room_manager.broadcast(
                    meeting_id,
                    {"type": "meeting.status", "meeting_id": meeting_id, "status": meeting.status, "timestamp": datetime.now(timezone.utc).isoformat()},
                )
                return meeting
        except HTTPException as exc:
            if exc.status_code not in {400, 404}:
                raise
        except Exception:
            logger.exception("Auto-finalize before meeting completion failed for meeting %s", meeting_id)

    now = datetime.now(timezone.utc)
    if meeting.status == "upcoming":
        try:
            meeting = update_meeting(
                db,
                meeting_id,
                {
                    "actual_start": meeting.actual_start or now,
                    "scheduled_start": meeting.scheduled_start or now,
                    "scheduled_end": meeting.scheduled_end or (now + timedelta(hours=1)),
                    "status": "live",
                },
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    start = _coerce_utc_aware(meeting.actual_start) or _coerce_utc_aware(meeting.scheduled_start) or _coerce_utc_aware(meeting.created_at) or now
    duration = compute_meeting_duration_minutes(meeting, now)
    updates = {
        "actual_end": now,
        "duration": duration,
        "status": target_status,
    }
    try:
        updated = update_meeting(db, meeting_id, updates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    await meeting_room_manager.broadcast(
        meeting_id,
        {"type": "meeting.status", "meeting_id": meeting_id, "status": updated.status, "timestamp": datetime.now(timezone.utc).isoformat()},
    )
    return updated


@router.put("/api/meetings/{meeting_id}", response_model=schemas.Meeting)
def update_meeting_endpoint(
    meeting_id: str,
    meeting_data: schemas.MeetingUpdate,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    existing = get_meeting_by_id(db, meeting_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Meeting not found")
    auth.require_org_member(db, current_user, existing.organization_id)
    require_meeting_manager(db, current_user, existing)
    updates = meeting_data.model_dump(exclude_unset=True)
    if "scheduled_start" in updates:
        updates["scheduled_start"] = normalize_meeting_datetime(updates["scheduled_start"])
    if "scheduled_end" in updates:
        updates["scheduled_end"] = normalize_meeting_datetime(updates["scheduled_end"])

    # Validate time range if either is being updated
    if "scheduled_start" in updates or "scheduled_end" in updates:
        start = updates.get("scheduled_start", existing.scheduled_start)
        end = updates.get("scheduled_end", existing.scheduled_end)
        if start and end and end <= start:
            raise HTTPException(status_code=400, detail="Thời gian kết thúc phải sau thời gian bắt đầu")
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        if start and start < now_utc:
            raise HTTPException(status_code=400, detail="Không thể chuyển cuộc họp về thời gian trong quá khứ")

    if updates.get("group_id"):
        group = auth.require_group_member(db, current_user, updates["group_id"])
        if group.organization_id != existing.organization_id:
            raise HTTPException(status_code=400, detail="Group does not belong to organization")

    # Handle participant updates separately
    participant_ids = updates.pop("participant_ids", None)

    # Block if any participant has an overlapping meeting (excluding this meeting)
    start = updates.get("scheduled_start", existing.scheduled_start)
    end = updates.get("scheduled_end", existing.scheduled_end)
    check_ids = list(set([existing.created_by] + (participant_ids or [p.user_id for p in existing.participants if p.user_id])))
    if start and end and check_ids:
        conflicts = check_meeting_overlap(db, participant_ids=check_ids, scheduled_start=start, scheduled_end=end, exclude_meeting_id=meeting_id)
        if conflicts:
            titles = ", ".join(c["meeting_title"] for c in conflicts)
            raise HTTPException(status_code=409, detail=f"Trùng lịch với: {titles}. Vui lòng chọn giờ khác.")
    if participant_ids is not None:
        existing_participant_ids = {p.user_id for p in existing.participants if p.user_id}
        new_participant_ids = set(participant_ids) | {existing.created_by}  # Always keep creator
        for pid in existing_participant_ids - new_participant_ids:
            remove_meeting_participant(db, meeting_id, user_id=pid)
        for pid in new_participant_ids - existing_participant_ids:
            add_meeting_participant(db, meeting_id, user_id=pid, role="PARTICIPANT")

    try:
        meeting = update_meeting(db, meeting_id, updates)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    append_admin_audit_log(
        actor=current_user.username,
        action="UPDATE_MEETING",
        target=meeting.title if meeting else meeting_id,
        role=current_user.role or "member",
    )
    return meeting


@router.put("/api/participants/{participant_id}/rsvp")
def rsvp_participant(
    participant_id: str,
    body: dict,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user),
):
    """Allow a participant to accept or decline a meeting invitation."""
    participant = db.query(models.MeetingParticipant).filter(
        models.MeetingParticipant.id == participant_id
    ).first()
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")

    # Only the participant themselves can RSVP
    if participant.user_id and participant.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only RSVP for yourself")

    new_status = body.get("invite_status")
    if new_status not in ("accepted", "declined"):
        raise HTTPException(status_code=400, detail="invite_status must be 'accepted' or 'declined'")

    participant.invite_status = new_status
    db.commit()
    db.refresh(participant)
    return {"id": participant.id, "invite_status": participant.invite_status}


@router.delete("/api/meetings/{meeting_id}")
def delete_meeting_endpoint(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user = Depends(auth.get_current_user)
):
    from src.api.crud import delete_meeting
    existing = get_meeting_by_id(db, meeting_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Meeting not found")
    can_delete = False
    if current_user.role == "system-admin":
        can_delete = True
    elif existing.group_id:
        try:
            auth.require_group_admin(db, current_user, existing.group_id)
            can_delete = True
        except HTTPException:
            can_delete = False
    else:
        try:
            auth.require_org_admin(db, current_user, existing.organization_id)
            can_delete = True
        except HTTPException:
            can_delete = False

    if not can_delete:
        recipient_ids = get_org_admin_recipient_ids(db, existing.organization_id, current_user.id)
        actor_name = current_user.first_name or current_user.username or current_user.email
        for recipient_id in recipient_ids:
            push_runtime_notification(
                {
                    "id": f"runtime-delete-request-{meeting_id}-{recipient_id}-{int(datetime.now(timezone.utc).timestamp())}",
                    "recipient_user_id": recipient_id,
                    "type": "meeting",
                    "priority": "urgent",
                    "title": "Yeu cau xoa cuoc hop",
                    "message": f"{actor_name} vua yeu cau xoa \"{existing.title}\".",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "isRead": False,
                    "metadata": {"group": existing.group.name if existing.group else None, "meeting_id": existing.id},
                }
            )
        append_admin_audit_log(
            actor=current_user.username,
            action="REQUEST_DELETE_MEETING",
            target=existing.title,
            role=current_user.role or "member",
        )
        raise HTTPException(status_code=403, detail="Ban khong co quyen xoa truc tiep. Yeu cau da gui cho org admin.")

    deleted_title = existing.title
    deleted_group_name = existing.group.name if existing.group else None
    delete_meeting(db, meeting_id)
    append_admin_audit_log(
        actor=current_user.username,
        action="DELETE_MEETING",
        target=deleted_title,
        role=current_user.role or "admin",
    )

    if current_user.role != "system-admin":
        recipient_ids = get_org_admin_recipient_ids(db, existing.organization_id, current_user.id)
        actor_name = current_user.first_name or current_user.username or current_user.email
        for recipient_id in recipient_ids:
            push_runtime_notification(
                {
                    "id": f"runtime-delete-{meeting_id}-{recipient_id}-{int(datetime.now(timezone.utc).timestamp())}",
                    "recipient_user_id": recipient_id,
                    "type": "meeting",
                    "priority": "urgent",
                    "title": "Nhân viên vừa xóa cuộc họp",
                    "message": f"{actor_name} đã xóa \"{deleted_title}\".",
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "isRead": False,
                    "metadata": {"group": deleted_group_name, "meeting_id": meeting_id},
                }
            )

    return {"message": "Meeting deleted successfully"}

@router.post("/api/meetings/{meeting_id}/finalize")
async def finalize_meeting(
    meeting_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    body = await request.json()
    return await generate_meeting_ai_notes_all_languages(meeting_id, db, current_user, body)


@router.post("/api/meetings/{meeting_id}/ai-notes/regenerate")
async def regenerate_meeting_ai_notes(
    meeting_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    try:
        body = await request.json()
    except Exception:
        body = {}
    body["regenerate"] = True
    return await generate_meeting_ai_notes_all_languages(meeting_id, db, current_user, body)


@router.get("/api/meetings/{meeting_id}/dialect")
def get_meeting_dialect(
    meeting_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    auth.require_org_member(db, current_user, meeting.organization_id)

    transcript = db.query(models.Transcript).filter(
        models.Transcript.meeting_id == meeting_id,
    ).order_by(models.Transcript.created_at.desc()).first()
    metadata = transcript.nlp_metadata if transcript and transcript.nlp_metadata else {}
    return {
        "meeting_id": meeting_id,
        "dialect_hint": metadata.get("dialect_hint", "unknown"),
        "confidence": metadata.get("dialect_confidence", 0.0),
        "post_processed": bool(transcript.post_processed) if transcript else False,
        "correction_count": metadata.get("correction_count", 0),
        "nlp_metadata": metadata,
    }
