"""Maintenance mode middleware.

When the runtime admin setting ``maintenance_mode`` is True, every request
from a non-system-admin user (including anonymous traffic) is rejected with
HTTP 503. System admins keep full access so they can disable the flag from
the admin console.

A small allow-list of paths stays reachable in any case (login, docs,
health, static OpenAPI/redoc) so that a misconfigured deployment can still
recover.

The check decodes the JWT (without raising on failure) so we don't add an
extra DB lookup; if the token has ``sub`` and a system-admin row exists in
the DB the request is allowed. Anything else gets the 503.
"""
from __future__ import annotations

from typing import Iterable, Set

from fastapi import Request
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware

from src.api import auth
from src.api.domains.admin.runtime import ADMIN_SYSTEM_SETTINGS
from src.api.domains.admin import runtime as admin_runtime


_DEFAULT_ALLOW_PATHS: Set[str] = {
    "/health",
    "/metrics",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/auth/login",
    "/api/auth/refresh",
}


class MaintenanceModeMiddleware(BaseHTTPMiddleware):
    """Block non-system-admin traffic when maintenance_mode is enabled."""

    def __init__(self, app, allow_paths: Iterable[str] | None = None) -> None:
        super().__init__(app)
        self.allow_paths = set(allow_paths) if allow_paths else _DEFAULT_ALLOW_PATHS

    async def dispatch(self, request: Request, call_next):
        if not ADMIN_SYSTEM_SETTINGS.get("maintenance_mode"):
            return await call_next(request)

        path = request.url.path
        if path in self.allow_paths or path.startswith("/docs") or path.startswith("/redoc"):
            return await call_next(request)

        if _request_actor_is_system_admin(request):
            return await call_next(request)

        return JSONResponse(
            status_code=503,
            content={
                "detail": "Maintenance mode is enabled. Only system administrators can access the system right now.",
                "maintenance": True,
            },
        )


def _request_actor_is_system_admin(request: Request) -> bool:
    """Best-effort: decode the bearer token, fetch the user, return True iff
    the user is an active system-admin. Any failure returns False so the
    request is blocked.
    """
    authorization = request.headers.get("authorization") or request.headers.get("Authorization")
    if not authorization or not authorization.lower().startswith("bearer "):
        return False
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
    except JWTError:
        return False
    username = payload.get("sub")
    if not username:
        return False

    db = admin_runtime._runtime_session_factory()
    try:
        from src.api.crud import get_user_by_username
        user = get_user_by_username(db, username)
        if not user or not user.is_active:
            return False
        return user.role == "system-admin"
    finally:
        db.close()
