# Load environment variables
from dotenv import load_dotenv

load_dotenv()

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from starlette.exceptions import HTTPException as StarletteHTTPException

from api.auth_multiuser import (
    decode_access_token,
    get_auth_excluded_paths,
    get_auth_middleware,
    get_jwt_secret,
    is_multi_user_mode,
)
from api.middleware import MaxBodySizeMiddleware, get_max_upload_size_bytes
from api.rate_limit import RateLimitMiddleware
from api.routers import (
    artifacts,
    auth,
    browser,
    capabilities,
    chat,
    chat_sessions,
    config,
    credentials,
    discovery,
    embedding,
    embedding_rebuild,
    episode_profiles,
    export,
    finance,
    flashcards,
    hardware,
    insights,
    languages,
    mcp,
    models,
    modes,
    notebooks,
    notes,
    podcasts,
    providers,
    sandbox,
    schedules,
    search,
    settings,
    side_by_side,
    source_chat,
    sources,
    speaker_profiles,
    transformations,
    verify,
)
from api.routers import commands as commands_router
from open_notebook.database.async_migrate import AsyncMigrationManager
from open_notebook.database.repository import current_jwt, current_owner_id
from open_notebook.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ExternalServiceError,
    InvalidInputError,
    NetworkError,
    NotFoundError,
    OpenNotebookError,
    RateLimitError,
    UnsupportedTypeException,
)
from open_notebook.utils.encryption import get_secret_from_env


def _parse_cors_origins(raw: str) -> list[str]:
    """Parse CORS_ORIGINS env value into a list of origins."""
    value = raw.strip()
    if value == "*":
        return ["*"]
    return [origin.strip() for origin in value.split(",") if origin.strip()]


# Parsed once at module load; CORS_ORIGINS changes require a restart.
_cors_origins_raw = os.getenv("CORS_ORIGINS")
CORS_ALLOWED_ORIGINS = _parse_cors_origins(_cors_origins_raw or "*")
CORS_IS_DEFAULT_WILDCARD = _cors_origins_raw is None
# Keyed on the parsed list, not on whether the env var was set: an operator
# who explicitly sets CORS_ORIGINS=* must get the same wildcard treatment as
# the default, or credentials would combine with a wildcard origin - the
# exact reflect-any-Origin behavior this flag exists to prevent.
CORS_ALLOW_CREDENTIALS = "*" not in CORS_ALLOWED_ORIGINS

# Parsed once at module load; OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB changes require a restart.
MAX_UPLOAD_SIZE_BYTES = get_max_upload_size_bytes()

DATABASE_STARTUP_RETRY_ATTEMPTS = 12
DATABASE_STARTUP_RETRY_INITIAL_DELAY_SECONDS = 1
DATABASE_STARTUP_RETRY_MAX_DELAY_SECONDS = 5
# Per-probe ceiling so a hung connection cannot exceed the retry budget or
# block startup indefinitely. A probe that exceeds this is treated as a
# transient failure and retried like any other unreachable-database attempt.
DATABASE_STARTUP_RETRY_PROBE_TIMEOUT_SECONDS = 5


def _cors_headers(request: Request) -> dict[str, str]:
    """
    Build CORS headers for error responses.

    Mirrors Starlette CORSMiddleware behavior: reflects the request Origin
    when the origin is allowed (or when wildcard is configured, since
    browsers reject `Access-Control-Allow-Origin: *` combined with
    credentials). Omits `Access-Control-Allow-Origin` for disallowed
    origins so the browser blocks the error body from leaking cross-origin.
    Only claims Access-Control-Allow-Credentials when the real CORSMiddleware
    would (see its allow_credentials comment above) - otherwise error
    responses would grant credentialed access the success path doesn't.
    """
    origin = request.headers.get("origin")
    headers: dict[str, str] = {
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
    }
    if CORS_ALLOW_CREDENTIALS:
        headers["Access-Control-Allow-Credentials"] = "true"

    if origin and ("*" in CORS_ALLOWED_ORIGINS or origin in CORS_ALLOWED_ORIGINS):
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"

    return headers


# Import commands to register them in the API process
try:
    logger.info("Commands imported in API process")
except Exception as e:
    logger.error(f"Failed to import commands in API process: {e}")


async def _wait_for_database(migration_manager: AsyncMigrationManager) -> None:
    """
    Wait for SurrealDB to accept connections before running migrations.

    Docker Compose can start the API before the database name is resolvable. Keep
    migration errors fail-fast by only retrying this lightweight readiness probe.
    """
    attempts = max(1, DATABASE_STARTUP_RETRY_ATTEMPTS)
    delay = DATABASE_STARTUP_RETRY_INITIAL_DELAY_SECONDS

    for attempt in range(1, attempts + 1):
        try:
            await asyncio.wait_for(
                migration_manager.ping(),
                timeout=DATABASE_STARTUP_RETRY_PROBE_TIMEOUT_SECONDS,
            )
            if attempt > 1:
                logger.info(f"Database became reachable on attempt {attempt}")
            return
        except Exception as e:
            if attempt == attempts:
                logger.error(
                    f"Database did not become reachable after {attempts} attempts"
                )
                raise

            logger.warning(
                "Database is not reachable yet "
                f"(attempt {attempt}/{attempts}): {str(e)}. "
                f"Retrying in {delay:g} seconds..."
            )
            await asyncio.sleep(delay)
            delay = min(delay * 2, DATABASE_STARTUP_RETRY_MAX_DELAY_SECONDS)


async def _run_database_migrations() -> None:
    """Run startup database migrations after SurrealDB is reachable."""
    migration_manager = AsyncMigrationManager()
    await _wait_for_database(migration_manager)

    current_version = await migration_manager.get_current_version()
    logger.info(f"Current database version: {current_version}")

    if await migration_manager.needs_migration():
        logger.warning("Database migrations are pending. Running migrations...")
        await migration_manager.run_migration_up()
        new_version = await migration_manager.get_current_version()
        logger.success(
            f"Migrations completed successfully. Database is now at version {new_version}"
        )
    else:
        logger.info("Database is already at the latest version. No migrations needed.")


# =============================================================================
# Phase 2.5: native SurrealDB multi-tenancy.
#
# The `user_scope` JWT scope is defined dynamically at startup (its HMAC key is
# an environment secret and must not be committed). DEFINE SCOPE ... TYPE JWT
# with KEY <secret> makes SurrealDB validate incoming JWTs and populate $auth
# (id/role) for the connection, which migration 23 PERMISSIONS then enforce.
# =============================================================================
async def _define_user_scope() -> None:
    """Define the user_scope JWT scope in SurrealDB using the live JWT secret."""
    from open_notebook.database.repository import db_connection

    secret = get_jwt_secret()
    # Single-quote-escape the secret so it is embedded as a SurrealQL string
    # literal (apostrophes doubled). The secret is never logged.
    escaped = secret.replace("'", "''")
    define_sql = (
        "DEFINE SCOPE IF NOT EXISTS user_scope TYPE JWT "
        f"ALGORITHM HS256 KEY '{escaped}';"
    )
    try:
        async with db_connection() as db:
            await db.query(define_sql)
        logger.info("Defined SurrealDB user_scope (JWT HS256) for tenant isolation")
    except Exception as e:
        logger.error(f"Failed to define user_scope: {str(e)}")
        raise


class RequestTenantBridge:
    """
    Middleware that bridges the request's bearer JWT into the per-request
    tenant contextvars (current_jwt / current_owner_id) consumed by
    repository.db_connection(). When a valid JWT is present, subsequent
    repo_* calls open a scoped SurrealDB session so migration 23 PERMISSIONS
    are enforced for that user. Requests without a token (login, public
    endpoints, the worker) fall through to a root session.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode("latin-1")
        token = None
        if auth_header.lower().startswith("bearer "):
            token = auth_header[7:].strip()
        if token:
            # Set the raw token for the scoped SurrealDB session. Also decode
            # the JWT to carry the subject (user id) so repo_create can stamp
            # the owner field that migration 23 PERMISSIONS rely on. Decoding
            # is verified with the live secret; an invalid token is ignored
            # (the auth middleware will reject the request separately).
            current_jwt.set(token)
            try:
                payload = decode_access_token(token)
                current_owner_id.set(payload.get("sub"))
            except Exception:
                current_owner_id.set(None)
        else:
            current_jwt.set(None)
            current_owner_id.set(None)
        await self.app(scope, receive, send)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan event handler for the FastAPI application.
    Runs database migrations automatically on startup.
    """
    # Startup: Security checks
    logger.info("Starting API initialization...")

    # Security check: Encryption key
    if not get_secret_from_env("OPEN_NOTEBOOK_ENCRYPTION_KEY"):
        logger.warning(
            "OPEN_NOTEBOOK_ENCRYPTION_KEY not set. "
            "API key encryption will fail until this is configured. "
            "Set OPEN_NOTEBOOK_ENCRYPTION_KEY to any secret string."
        )

    # Run database migrations

    try:
        await _run_database_migrations()
    except Exception as e:
        logger.error(f"CRITICAL: Database migration failed: {str(e)}")
        logger.exception(e)
        # Fail fast - don't start the API with an outdated database schema
        raise RuntimeError(f"Failed to run database migrations: {str(e)}") from e

    # Define the user_scope JWT scope for tenant isolation (Phase 2.5). This
    # must run after migrations (migration 23 defines the PERMISSIONS that the
    # scope session enforces) and uses the live JWT secret.
    if is_multi_user_mode():
        try:
            await _define_user_scope()
        except Exception as e:
            logger.error(f"CRITICAL: Failed to define user_scope: {str(e)}")
            logger.exception(e)
            raise RuntimeError(f"Failed to define user_scope: {str(e)}") from e

    # Run podcast profile data migration (legacy strings -> Model registry)
    try:
        from open_notebook.podcasts.migration import migrate_podcast_profiles

        await migrate_podcast_profiles()
    except Exception as e:
        logger.warning(f"Podcast profile migration encountered errors: {e}")
        # Non-fatal: profiles can be migrated manually via UI

    # Auto-sync models from all configured providers on startup
    try:
        from open_notebook.ai.model_discovery import sync_provider_models
        from open_notebook.domain.credential import Credential

        async def _startup_sync():
            try:
                # Get all credentials and sync each provider with its credential ID
                credentials = await Credential.get_all()
                for cred in credentials:
                    if cred.provider:
                        await sync_provider_models(
                            cred.provider,
                            auto_register=True,
                            credential_id=cred.id,
                        )
                        logger.info(f"Startup model sync: synced {cred.provider} models")
            except Exception as e:
                logger.warning(f"Startup model sync failed: {e}")

        asyncio.create_task(_startup_sync())
    except Exception as e:
        logger.warning(f"Could not start model sync: {e}")

    logger.success("API initialization completed successfully")

    # Yield control to the application
    yield

    # Shutdown: cleanup if needed
    logger.info("API shutdown complete")


app = FastAPI(
    title="Open Notebook API",
    description="API for Open Notebook - Research Assistant",
    lifespan=lifespan,
)

# Tenant bridge: carry the request JWT into per-request contextvars so repo_*
# calls open a scoped SurrealDB session (Phase 2.5). Registered first so it
# wraps the whole request pipeline.
app.add_middleware(RequestTenantBridge)

if CORS_IS_DEFAULT_WILDCARD:
    logger.warning(
        "CORS_ORIGINS is not set — API accepts cross-origin requests from any "
        "origin (default: '*'). For production deployments, set CORS_ORIGINS to "
        "your frontend origin(s), e.g. "
        "CORS_ORIGINS=https://notebook.example.com"
    )
else:
    logger.info(f"CORS allowed origins: {CORS_ALLOWED_ORIGINS}")

# Add rate limiting middleware (runs before auth so 429s short-circuit)
app.add_middleware(RateLimitMiddleware)

# Add authentication middleware (modular: selected by OPEN_NOTEBOOK_AUTH_MODE).
# In multi-user mode this installs MultiUserAuthMiddleware (JWT); otherwise it
# installs the upstream PasswordAuthMiddleware (single-password base). The
# selection happens in api/auth_multiuser.get_auth_middleware() — the single
# plug-and-play switch (Phase 6 feature flag ready).
_auth_middleware = get_auth_middleware()
_auth_excluded = get_auth_excluded_paths()
logger.info(f"Auth mode: {'multi-user (JWT)' if is_multi_user_mode() else 'single-password'}")
app.add_middleware(_auth_middleware, excluded_paths=_auth_excluded)

# Reject oversized request bodies before they reach auth or routing - added
# after the auth middleware (so it wraps around it) so a too-large request
# is rejected before spending any work checking credentials.
logger.info(
    f"Max request body size: {MAX_UPLOAD_SIZE_BYTES / (1024 * 1024):g}MB "
    "(set OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB to change)"
)
app.add_middleware(MaxBodySizeMiddleware, max_body_size=MAX_UPLOAD_SIZE_BYTES)

# Add CORS middleware last (so it processes first, and so it can attach
# CORS headers to a 413 raised by MaxBodySizeMiddleware)
#
# allow_credentials is tied to whether CORS_ORIGINS resolves to specific
# origins: combining allow_origins=["*"] with allow_credentials=True makes
# Starlette reflect the request's Origin header verbatim (browsers reject a
# literal "*" alongside credentials), which defeats the origin allowlist.
# The frontend never sends credentialed requests (withCredentials: false)
# and auth is a Bearer header, not a cookie, so this isn't independently
# exploitable today - but there's no reason to allow it for any wildcard
# case. Once an operator explicitly scopes CORS_ORIGINS to real origins,
# credentialed cross-origin requests to those origins are safe to allow.
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOWED_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Custom exception handler to ensure CORS headers are included in error responses
# This helps when errors occur before the CORS middleware can process them
@app.exception_handler(StarletteHTTPException)
async def custom_http_exception_handler(request: Request, exc: StarletteHTTPException):
    """
    Custom exception handler that ensures CORS headers are included in error responses.
    This is particularly important for 413 (Payload Too Large) errors during file uploads.

    Note: If a reverse proxy (nginx, traefik) returns 413 before the request reaches
    FastAPI, this handler won't be called. In that case, configure your reverse proxy
    to add CORS headers to error responses.
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers={**(exc.headers or {}), **_cors_headers(request)},
    )


@app.exception_handler(NotFoundError)
async def not_found_error_handler(request: Request, exc: NotFoundError):
    return JSONResponse(
        status_code=404,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(InvalidInputError)
async def invalid_input_error_handler(request: Request, exc: InvalidInputError):
    return JSONResponse(
        status_code=400,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(AuthenticationError)
async def authentication_error_handler(request: Request, exc: AuthenticationError):
    return JSONResponse(
        status_code=401,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(RateLimitError)
async def rate_limit_error_handler(request: Request, exc: RateLimitError):
    return JSONResponse(
        status_code=429,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(ConfigurationError)
async def configuration_error_handler(request: Request, exc: ConfigurationError):
    return JSONResponse(
        status_code=422,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(NetworkError)
async def network_error_handler(request: Request, exc: NetworkError):
    return JSONResponse(
        status_code=502,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(ExternalServiceError)
async def external_service_error_handler(request: Request, exc: ExternalServiceError):
    return JSONResponse(
        status_code=502,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(UnsupportedTypeException)
async def unsupported_type_error_handler(
    request: Request, exc: UnsupportedTypeException
):
    return JSONResponse(
        status_code=415,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


@app.exception_handler(OpenNotebookError)
async def open_notebook_error_handler(request: Request, exc: OpenNotebookError):
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers=_cors_headers(request),
    )


# Include routers
app.include_router(auth.router, prefix="/api", tags=["auth"])
app.include_router(config.router, prefix="/api", tags=["config"])
app.include_router(notebooks.router, prefix="/api", tags=["notebooks"])
app.include_router(search.router, prefix="/api", tags=["search"])
app.include_router(models.router, prefix="/api", tags=["models"])
app.include_router(transformations.router, prefix="/api", tags=["transformations"])
app.include_router(notes.router, prefix="/api", tags=["notes"])
app.include_router(embedding.router, prefix="/api", tags=["embedding"])
app.include_router(
    embedding_rebuild.router, prefix="/api/embeddings", tags=["embeddings"]
)
app.include_router(settings.router, prefix="/api", tags=["settings"])
app.include_router(sources.router, prefix="/api", tags=["sources"])
app.include_router(insights.router, prefix="/api", tags=["insights"])
app.include_router(commands_router.router, prefix="/api", tags=["commands"])
app.include_router(podcasts.router, prefix="/api", tags=["podcasts"])
app.include_router(episode_profiles.router, prefix="/api", tags=["episode-profiles"])
app.include_router(speaker_profiles.router, prefix="/api", tags=["speaker-profiles"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(source_chat.router, prefix="/api", tags=["source-chat"])
app.include_router(credentials.router, prefix="/api", tags=["credentials"])
app.include_router(providers.router, prefix="/api", tags=["providers"])
app.include_router(capabilities.router, prefix="/api", tags=["capabilities"])
app.include_router(languages.router, prefix="/api", tags=["languages"])
app.include_router(export.router, prefix="/api", tags=["export"])
app.include_router(flashcards.router, prefix="/api", tags=["flashcards"])
app.include_router(discovery.router, prefix="/api", tags=["discovery"])
app.include_router(artifacts.router, prefix="/api", tags=["artifacts"])
app.include_router(finance.router, prefix="/api", tags=["finance"])
app.include_router(verify.router, prefix="/api", tags=["verify"])
app.include_router(mcp.router, prefix="/api", tags=["mcp"])
app.include_router(schedules.router, prefix="/api", tags=["schedules"])
app.include_router(hardware.router, prefix="/api", tags=["hardware"])
app.include_router(chat_sessions.router, prefix="/api", tags=["chat-sessions"])
app.include_router(modes.router, prefix="/api", tags=["modes"])
app.include_router(sandbox.router, prefix="/api", tags=["sandbox"])
app.include_router(side_by_side.router, prefix="/api", tags=["side-by-side"])
app.include_router(browser.router, prefix="/api", tags=["browser"])


@app.get("/")
async def root():
    return {"message": "Open Notebook API is running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
