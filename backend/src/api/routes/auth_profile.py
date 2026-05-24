from typing import Any, Dict

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.api import auth, schemas
from src.api.domains.organizations.auth_profile import (
    change_password_payload,
    forgot_password_payload,
    get_profile_payload,
    get_user_avatar_payload,
    login_payload,
    register_payload,
    reset_password_payload,
    update_profile_payload,
    upload_profile_avatar_payload,
)
from src.api.database import get_db

router = APIRouter(tags=["auth-profile"])


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: Dict[str, Any]


@router.post("/api/auth/register", response_model=schemas.RegisterResponse)
def register(
    req: schemas.RegisterRequest,
    db: Session = Depends(get_db),
):
    return register_payload(req, db)


@router.post("/api/auth/login", response_model=TokenResponse)
async def login(
    req: schemas.UserLogin,
    db: Session = Depends(get_db),
):
    return login_payload(req, db)


@router.post("/api/auth/forgot-password")
def forgot_password(
    req: schemas.ForgotPasswordRequest,
    db: Session = Depends(get_db),
):
    return forgot_password_payload(req, db)


@router.post("/api/auth/reset-password", response_model=schemas.MessageResponse)
def reset_password(
    req: schemas.ResetPasswordRequest,
    db: Session = Depends(get_db),
):
    return reset_password_payload(req, db)


@router.get("/api/profile")
@router.get("/api/auth/me")
def get_profile(current_user=Depends(auth.get_current_user)):
    return get_profile_payload(current_user)


@router.patch("/api/profile")
def update_profile(
    updates: schemas.ProfileUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return update_profile_payload(updates, db, current_user)


@router.post("/api/profile/change-password", response_model=schemas.MessageResponse)
def change_password(
    req: schemas.ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return change_password_payload(req, db, current_user)


@router.get("/api/users/{user_id}/avatar")
def get_user_avatar(user_id: str, db: Session = Depends(get_db)):
    return get_user_avatar_payload(user_id, db)


@router.post("/api/profile/avatar")
async def upload_profile_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(auth.get_current_user),
):
    return await upload_profile_avatar_payload(file, db, current_user)
