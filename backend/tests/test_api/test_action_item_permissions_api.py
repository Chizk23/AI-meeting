from src.api import auth
from src.api import models
from src.api.crud import (
    add_user_to_group,
    add_user_to_organization,
    create_action_item,
    create_group,
    create_meeting,
    create_organization,
    create_user,
)


def auth_headers(username: str) -> dict[str, str]:
    token = auth.create_access_token({"sub": username})
    return {"Authorization": f"Bearer {token}"}


def create_active_org(db_session, name: str):
    org = create_organization(db_session, {"name": name})
    org.settings = {"approval_status": "active"}
    db_session.commit()
    db_session.refresh(org)
    return org


def create_member(db_session, username: str, email: str, role: str = "member"):
    return create_user(
        db_session,
        {
            "username": username,
            "email": email,
            "password": "password123",
            "role": role,
        },
    )


def add_meeting_participants(db_session, meeting_id: str, *users):
    db_session.add_all([
        models.MeetingParticipant(
            meeting_id=meeting_id,
            user_id=user.id,
            email=user.email,
            name=user.username,
            invite_status="accepted",
        )
        for user in users
    ])
    db_session.commit()


def test_group_admin_can_manage_group_meeting_action_items(client, db_session):
    org = create_active_org(db_session, "Org A")
    group_admin = create_member(db_session, "groupadmin", "groupadmin@example.com")
    assignee = create_member(db_session, "assignee1", "assignee1@example.com")
    add_user_to_organization(db_session, group_admin.id, org.id, "member")
    add_user_to_organization(db_session, assignee.id, org.id, "member")
    group = create_group(db_session, {"organization_id": org.id, "name": "Team A"}, created_by=group_admin.id)
    add_user_to_group(db_session, group.id, group_admin.id, "group-admin")
    add_user_to_group(db_session, group.id, assignee.id, "member")
    meeting = create_meeting(
        db_session,
        {
            "organization_id": org.id,
            "group_id": group.id,
            "title": "Group Meeting",
            "status": "upcoming",
        },
        created_by=group_admin.id,
    )
    add_meeting_participants(db_session, meeting.id, group_admin, assignee)

    create_response = client.post(
        "/api/action-items",
        headers=auth_headers(group_admin.username),
        json={
            "meeting_id": meeting.id,
            "title": "Follow up with client",
            "assigned_email": assignee.email,
            "priority": "HIGH",
            "status": "PENDING",
        },
    )

    assert create_response.status_code == 200
    created = create_response.json()
    assert created["assigned_email"] == assignee.email

    update_response = client.patch(
        f"/api/action-items/{created['id']}",
        headers=auth_headers(group_admin.username),
        json={
            "title": "Updated follow up",
            "priority": "URGENT",
            "assigned_email": assignee.email,
        },
    )

    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["title"] == "Updated follow up"
    assert updated["priority"] == "URGENT"

    delete_response = client.delete(
        f"/api/action-items/{created['id']}",
        headers=auth_headers(group_admin.username),
    )
    assert delete_response.status_code == 200


def test_group_member_cannot_manage_group_meeting_action_items(client, db_session):
    org = create_active_org(db_session, "Org B")
    group_admin = create_member(db_session, "groupadmin2", "groupadmin2@example.com")
    member = create_member(db_session, "member2", "member2@example.com")
    assignee = create_member(db_session, "assignee2", "assignee2@example.com")
    add_user_to_organization(db_session, group_admin.id, org.id, "member")
    add_user_to_organization(db_session, member.id, org.id, "member")
    add_user_to_organization(db_session, assignee.id, org.id, "member")
    group = create_group(db_session, {"organization_id": org.id, "name": "Team B"}, created_by=group_admin.id)
    add_user_to_group(db_session, group.id, group_admin.id, "group-admin")
    add_user_to_group(db_session, group.id, member.id, "member")
    add_user_to_group(db_session, group.id, assignee.id, "member")
    meeting = create_meeting(
        db_session,
        {
            "organization_id": org.id,
            "group_id": group.id,
            "title": "Restricted Meeting",
            "status": "upcoming",
        },
        created_by=group_admin.id,
    )
    action_item = create_action_item(
        db_session,
        {
            "meeting_id": meeting.id,
            "title": "Admin only task",
            "assigned_email": assignee.email,
        },
        created_by=group_admin.id,
    )

    create_response = client.post(
        "/api/action-items",
        headers=auth_headers(member.username),
        json={
            "meeting_id": meeting.id,
            "title": "Member cannot create",
        },
    )
    assert create_response.status_code == 403
    assert create_response.json()["detail"] == "Group admin access required for this meeting's tasks"

    update_response = client.patch(
        f"/api/action-items/{action_item.id}",
        headers=auth_headers(member.username),
        json={"priority": "HIGH"},
    )
    assert update_response.status_code == 403
    assert update_response.json()["detail"] == "Group admin access required for this meeting's tasks"

    delete_response = client.delete(
        f"/api/action-items/{action_item.id}",
        headers=auth_headers(member.username),
    )
    assert delete_response.status_code == 403
    assert delete_response.json()["detail"] == "Group admin access required for this meeting's tasks"


def test_org_admin_can_manage_ungrouped_meeting_action_items(client, db_session):
    org = create_active_org(db_session, "Org C")
    org_admin = create_member(db_session, "orgadmin1", "orgadmin1@example.com")
    assignee = create_member(db_session, "assignee3", "assignee3@example.com")
    add_user_to_organization(db_session, org_admin.id, org.id, "org-admin")
    add_user_to_organization(db_session, assignee.id, org.id, "member")
    meeting = create_meeting(
        db_session,
        {
            "organization_id": org.id,
            "title": "Ungrouped Meeting",
            "status": "upcoming",
        },
        created_by=org_admin.id,
    )
    add_meeting_participants(db_session, meeting.id, org_admin, assignee)

    create_response = client.post(
        "/api/action-items",
        headers=auth_headers(org_admin.username),
        json={
            "meeting_id": meeting.id,
            "title": "Org admin task",
            "assigned_email": assignee.email,
        },
    )

    assert create_response.status_code == 200
    created = create_response.json()

    delete_response = client.delete(
        f"/api/action-items/{created['id']}",
        headers=auth_headers(org_admin.username),
    )
    assert delete_response.status_code == 200


def test_assignee_can_only_update_status(client, db_session):
    org = create_active_org(db_session, "Org D")
    group_admin = create_member(db_session, "groupadmin4", "groupadmin4@example.com")
    assignee = create_member(db_session, "assignee4", "assignee4@example.com")
    add_user_to_organization(db_session, group_admin.id, org.id, "member")
    add_user_to_organization(db_session, assignee.id, org.id, "member")
    group = create_group(db_session, {"organization_id": org.id, "name": "Team D"}, created_by=group_admin.id)
    add_user_to_group(db_session, group.id, group_admin.id, "group-admin")
    add_user_to_group(db_session, group.id, assignee.id, "member")
    meeting = create_meeting(
        db_session,
        {
            "organization_id": org.id,
            "group_id": group.id,
            "title": "Execution Meeting",
            "status": "upcoming",
        },
        created_by=group_admin.id,
    )
    add_meeting_participants(db_session, meeting.id, group_admin, assignee)
    action_item = create_action_item(
        db_session,
        {
            "meeting_id": meeting.id,
            "title": "Assigned execution",
            "assigned_to": assignee.id,
            "assigned_email": assignee.email,
            "status": "PENDING",
        },
        created_by=group_admin.id,
    )

    status_response = client.patch(
        f"/api/action-items/{action_item.id}",
        headers=auth_headers(assignee.username),
        json={"status": "IN_PROGRESS"},
    )
    assert status_response.status_code == 403
    assert status_response.json()["detail"] == "Use /assignees/me for personal status updates"

    forbidden_response = client.patch(
        f"/api/action-items/{action_item.id}",
        headers=auth_headers(assignee.username),
        json={"title": "I should not rename this"},
    )
    assert forbidden_response.status_code == 403
    assert forbidden_response.json()["detail"] == "Use /assignees/me for personal status updates"

    me_response = client.patch(
        f"/api/action-items/{action_item.id}/assignees/me",
        headers=auth_headers(assignee.username),
        json={"status": "IN_PROGRESS"},
    )
    assert me_response.status_code == 200
    assert me_response.json()["assignees"][0]["status"] == "IN_PROGRESS"
    assert me_response.json()["status"] == "IN_PROGRESS"


def test_group_admin_can_assign_multiple_people(client, db_session):
    org = create_active_org(db_session, "Org E")
    group_admin = create_member(db_session, "groupadmin5", "groupadmin5@example.com")
    assignee1 = create_member(db_session, "assignee5a", "assignee5a@example.com")
    assignee2 = create_member(db_session, "assignee5b", "assignee5b@example.com")
    add_user_to_organization(db_session, group_admin.id, org.id, "member")
    add_user_to_organization(db_session, assignee1.id, org.id, "member")
    add_user_to_organization(db_session, assignee2.id, org.id, "member")
    group = create_group(db_session, {"organization_id": org.id, "name": "Team E"}, created_by=group_admin.id)
    add_user_to_group(db_session, group.id, group_admin.id, "group-admin")
    add_user_to_group(db_session, group.id, assignee1.id, "member")
    add_user_to_group(db_session, group.id, assignee2.id, "member")
    meeting = create_meeting(
        db_session,
        {
            "organization_id": org.id,
            "group_id": group.id,
            "title": "Multi Assignee Meeting",
            "status": "upcoming",
        },
        created_by=group_admin.id,
    )
    add_meeting_participants(db_session, meeting.id, group_admin, assignee1, assignee2)

    response = client.post(
        "/api/action-items",
        headers=auth_headers(group_admin.username),
        json={
            "meeting_id": meeting.id,
            "title": "Shared execution",
            "assignee_emails": [assignee1.email, assignee2.email],
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert {item["email"] for item in data["assignees"]} == {assignee1.email, assignee2.email}
    assert data["status"] == "PENDING"


def test_assignee_me_endpoint_aggregates_completion(client, db_session):
    org = create_active_org(db_session, "Org F")
    group_admin = create_member(db_session, "groupadmin6", "groupadmin6@example.com")
    assignee1 = create_member(db_session, "assignee6a", "assignee6a@example.com")
    assignee2 = create_member(db_session, "assignee6b", "assignee6b@example.com")
    add_user_to_organization(db_session, group_admin.id, org.id, "member")
    add_user_to_organization(db_session, assignee1.id, org.id, "member")
    add_user_to_organization(db_session, assignee2.id, org.id, "member")
    group = create_group(db_session, {"organization_id": org.id, "name": "Team F"}, created_by=group_admin.id)
    add_user_to_group(db_session, group.id, group_admin.id, "group-admin")
    add_user_to_group(db_session, group.id, assignee1.id, "member")
    add_user_to_group(db_session, group.id, assignee2.id, "member")
    meeting = create_meeting(
        db_session,
        {
            "organization_id": org.id,
            "group_id": group.id,
            "title": "Aggregation Meeting",
            "status": "upcoming",
        },
        created_by=group_admin.id,
    )
    add_meeting_participants(db_session, meeting.id, group_admin, assignee1, assignee2)

    create_response = client.post(
        "/api/action-items",
        headers=auth_headers(group_admin.username),
        json={
            "meeting_id": meeting.id,
            "title": "Needs both people",
            "assignee_emails": [assignee1.email, assignee2.email],
        },
    )
    action_item_id = create_response.json()["id"]

    first_response = client.patch(
        f"/api/action-items/{action_item_id}/assignees/me",
        headers=auth_headers(assignee1.username),
        json={"status": "COMPLETED"},
    )
    assert first_response.status_code == 200
    assert first_response.json()["status"] == "PENDING"

    second_response = client.patch(
        f"/api/action-items/{action_item_id}/assignees/me",
        headers=auth_headers(assignee2.username),
        json={"status": "COMPLETED"},
    )
    assert second_response.status_code == 200
    assert second_response.json()["status"] == "COMPLETED"


def test_personal_action_item_list_only_shows_owned_items(client, db_session):
    owner = create_member(db_session, "owner1", "owner1@example.com")
    other = create_member(db_session, "other1", "other1@example.com")

    create_response = client.post(
        "/api/action-items",
        headers=auth_headers(owner.username),
        json={"title": "Personal follow-up"},
    )
    assert create_response.status_code == 200

    visible_to_owner = client.get("/api/action-items", headers=auth_headers(owner.username))
    assert visible_to_owner.status_code == 200
    assert [item["title"] for item in visible_to_owner.json()] == ["Personal follow-up"]

    hidden_from_other = client.get("/api/action-items", headers=auth_headers(other.username))
    assert hidden_from_other.status_code == 200
    assert hidden_from_other.json() == []


def test_action_item_list_includes_unassigned_meeting_tasks_for_participants(client, db_session):
    org = create_active_org(db_session, "Org List")
    creator = create_member(db_session, "listcreator", "listcreator@example.com")
    participant = create_member(db_session, "listparticipant", "listparticipant@example.com")
    outsider = create_member(db_session, "listoutsider", "listoutsider@example.com")
    add_user_to_organization(db_session, creator.id, org.id, "member")
    add_user_to_organization(db_session, participant.id, org.id, "member")
    add_user_to_organization(db_session, outsider.id, org.id, "member")
    meeting = create_meeting(
        db_session,
        {
            "organization_id": org.id,
            "title": "Participant Task Meeting",
            "status": "upcoming",
        },
        created_by=creator.id,
    )
    add_meeting_participants(db_session, meeting.id, participant)
    create_action_item(
        db_session,
        {
            "meeting_id": meeting.id,
            "title": "Unassigned participant task",
        },
        created_by=creator.id,
    )

    participant_response = client.get("/api/action-items", headers=auth_headers(participant.username))
    assert participant_response.status_code == 200
    assert [item["title"] for item in participant_response.json()] == ["Unassigned participant task"]

    outsider_response = client.get("/api/action-items", headers=auth_headers(outsider.username))
    assert outsider_response.status_code == 200
    assert outsider_response.json() == []


def test_action_item_list_with_unknown_meeting_returns_404(client, db_session):
    member = create_member(db_session, "member404", "member404@example.com")

    response = client.get(
        "/api/action-items",
        headers=auth_headers(member.username),
        params={"meeting_id": "missing-meeting"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Meeting not found"
