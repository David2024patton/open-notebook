"""
Multi-user JWT authentication module (plug-and-play add-on).

This is a standalone, toggleable module that extends Open Notebook's base
single-password auth with JWT-based multi-user authentication. It is
activated by setting OPEN_NOTEBOOK_AUTH_MODE=multi-user in the environment.

Architecture (modular / feature-flag ready):
  - Base auth (api/auth.py): PasswordAuthMiddleware — single-password mode.
  - This module: MultiUserAuthMiddleware + JWT token utilities — multi-user mode.
  - api/main.py selects which middleware to install based on OPEN_NOTEBOOK_AUTH_MODE.

Nothing in the base codebase imports this module unless multi-user mode is
enabled, so the base upstream code remains untouched and the multi-user
feature can be turned on/off with a single env var (Phase 6 feature flag).

Dependencies: bcrypt, PyJWT (both optional at the base level — only required
when OPEN_NOTEBOOK_AUTH_MODE=multi-user).
"""

import os
from datetime import datetime, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import HTTPException, Request
from loguru import logger
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp

from open_notebook.utils.encryption import get_secret_from_env

# Configuration (read once at module load; restart required to change)
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = int(os.getenv("JWT_EXPIRATION_HOURS", "24"))
AUTH_MODE = os.getenv("OPEN_NOTEBOOK_AUTH_MODE", "single-password")


def is_multi_user_mode() -> bool:
    """Check if multi-user mode is enabled."""
    return AUTH_MODE == "multi-user"


def get_jwt_secret() -> str:
    """Get JWT secret key, falling back to the encryption key if not set."""
    if JWT_SECRET_KEY:
        return JWT_SECRET_KEY
    encryption_key = get_secret_from_env("OPEN_NOTEBOOK_ENCRYPTION_KEY")
    if encryption_key:
        return encryption_key
    raise HTTPException(
        status_code=500,
        detail="JWT_SECRET_KEY or OPEN_NOTEBOOK_ENCRYPTION_KEY must be configured",
    )


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against a bcrypt hash."""
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, username: str, role: str) -> str:
    """
    Create a JWT access token.

    Carries both app claims (sub/username/role) and SurrealDB record-user claims
    (ns/db/ac/id) so the same token authenticates the app AND opens a scoped
    SurrealDB session (Phase 2.5: DB-native tenant isolation via
    DEFINE ACCESS user_scope ... TYPE RECORD WITH JWT). The `id` claim is the
    user's record id (e.g. "user:abc..."); `ac` is the access-method name
    ("user_scope"); `ns`/`db` match the SurrealDB namespace/database so SurrealDB
    accepts the token only for the intended database.
    """
    secret = get_jwt_secret()
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    payload = {
        # app claims
        "sub": user_id,
        "username": username,
        "role": role,
        # SurrealDB record-user claims (read by DEFINE ACCESS user_scope)
        "id": user_id,
        "ac": "user_scope",
        "ns": os.getenv("SURREAL_NAMESPACE", "open_notebook"),
        "db": os.getenv("SURREAL_DB", "open_notebook"),
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Decode and validate a JWT access token."""
    secret = get_jwt_secret()
    try:
        payload = jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# Default paths excluded from auth in multi-user mode (login/register endpoints)
DEFAULT_EXCLUDED_PATHS = [
    "/",
    "/health",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/login/2fa",
    "/api/auth/register",
    "/api/auth/request-code",
    "/api/auth/verify-code",
    "/api/auth/register-code",
    "/api/auth/signup-policy",
    "/api/config",
    "/api/browser/status",
]


class MultiUserAuthMiddleware(BaseHTTPMiddleware):
    """
    JWT-based multi-user authentication middleware.

    Validates Bearer JWT tokens, extracts the user identity (sub, username,
    role) and stores it on request.state for downstream handlers. Requests
    without a valid token are rejected with 401 (except excluded paths).

    This middleware is installed ONLY when OPEN_NOTEBOOK_AUTH_MODE=multi-user.
    """

    def __init__(
        self, app: ASGIApp, excluded_paths: Optional[list[str]] = None
    ) -> None:
        super().__init__(app)
        self.excluded_paths: list[str] = excluded_paths or DEFAULT_EXCLUDED_PATHS

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Skip authentication for excluded paths
        if request.url.path in self.excluded_paths:
            return await call_next(request)

        # Skip CORS preflight
        if request.method == "OPTIONS":
            return await call_next(request)

        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing authorization header"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        try:
            scheme, credentials = auth_header.split(" ", 1)
            if scheme.lower() != "bearer":
                raise ValueError("Invalid authentication scheme")
        except ValueError:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid authorization header format"},
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Validate JWT and stash user identity on request.state
        try:
            payload = decode_access_token(credentials)
            request.state.user_id = payload.get("sub")
            request.state.username = payload.get("username")
            request.state.user_role = payload.get("role")
            return await call_next(request)
        except HTTPException as e:
            return JSONResponse(
                status_code=e.status_code,
                content={"detail": e.detail},
                headers={"WWW-Authenticate": "Bearer"},
            )
        except jwt.InvalidTokenError:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid token"},
                headers={"WWW-Authenticate": "Bearer"},
            )
        except Exception:
            logger.exception("Unexpected error during JWT validation")
            return await call_next(request)


def get_auth_middleware():
    """
    Return the appropriate auth middleware class based on OPEN_NOTEBOOK_AUTH_MODE.

    This is the single selection point used by api/main.py — the plug-and-play
    switch. Returns MultiUserAuthMiddleware in multi-user mode, otherwise
    PasswordAuthMiddleware (the upstream base).
    """
    if is_multi_user_mode():
        from api.auth_multiuser import MultiUserAuthMiddleware
        return MultiUserAuthMiddleware
    from api.auth import PasswordAuthMiddleware
    return PasswordAuthMiddleware


def get_auth_excluded_paths() -> list[str]:
    """Return the excluded paths for the active auth mode."""
    if is_multi_user_mode():
        return DEFAULT_EXCLUDED_PATHS
    return [
        "/",
        "/health",
        "/docs",
        "/openapi.json",
        "/redoc",
    ]