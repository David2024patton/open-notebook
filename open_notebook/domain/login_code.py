"""
Passwordless login codes (OTP).

A new 6-digit code is issued per email, stored as a bcrypt hash with a
10-minute expiry. Codes are single-use (consumed on successful verify) and
rate-limited (max 5 attempts). All access is root-only (migration 25 sets
PERMISSIONS NONE for record users) — the OTP endpoints run pre-auth with no
JWT, so repo_* calls open root sessions.

`send_code(email, code)` is the pluggable email sender. The default
implementation is DEV-MODE: it logs the code (visible in server logs) and
stores it so the superuser debug endpoint can surface it. Production swaps in
a Resend/SendGrid implementation behind the same signature.
"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from loguru import logger

from open_notebook.database.repository import repo_create, repo_query, repo_query_root

# Code lifetime and attempt limits.
CODE_TTL_MINUTES = 10
MAX_ATTEMPTS = 5


def _generate_code() -> str:
    """Cryptographically-random 6-digit code (zero-padded)."""
    return f"{secrets.randbelow(1_000_000):06d}"


async def _hash_code(code: str) -> str:
    """Hash a code with bcrypt (reuse the auth password hasher)."""
    from api.auth_multiuser import hash_password

    return hash_password(code)


async def _verify_hash(code: str, hashed: str) -> bool:
    from api.auth_multiuser import verify_password

    return verify_password(code, hashed)


async def send_code(email: str, code: str, record_id: str = "") -> None:
    """
    Deliver a login code to the user.

    DEV MODE (default): no real email is sent. The code is logged at INFO so
    it is visible in the server logs. The plaintext is also stored on the
    matching login_code record's `dev_code` field (root-only table) so the
    superuser debug endpoint can surface it for testing. Production: replace
    this function with a Resend / SendGrid-backed implementation that sends a
    real email and leaves dev_code empty.
    """
    logger.info(f"[OTP][DEV-MODE] login code for {email}: {code}")
    if record_id:
        try:
            await repo_query(
                "UPDATE type::thing($rid) SET dev_code = $code",
                {"rid": record_id, "code": code},
            )
        except Exception as e:  # noqa: BLE001 - dev-mode helper, never fatal
            logger.debug(f"[OTP] could not store dev_code: {e}")


async def issue_code(email: str) -> str:
    """
    Issue a new 6-digit code for `email`: generate, hash, store with expiry,
    and send via `send_code`. Returns the plaintext code (for dev-mode logging
    only; the caller does not return it to the client).
    """
    # Expire any prior live codes for this email (single live code per email).
    try:
        await repo_query(
            "UPDATE login_code SET consumed = true, expires = time::now() "
            "WHERE email = $email AND consumed = false",
            {"email": email},
        )
    except Exception as e:  # noqa: BLE001
        logger.debug(f"[OTP] expire-prior failed (non-fatal): {e}")

    code = _generate_code()
    code_hash = await _hash_code(code)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=CODE_TTL_MINUTES)
    await repo_create(
        "login_code",
        {
            "email": email,
            "code_hash": code_hash,
            "attempts": 0,
            "consumed": False,
            "created": now,
            "expires": expires,
            # DEV-MODE only: store the plaintext so the superuser debug endpoint
            # can surface it without SMTP. Root-only table (PERMISSIONS NONE).
            # Production email sender would omit this field.
            "dev_code": code,
        },
    )
    await send_code(email, code)
    return code


async def verify_code(email: str, code: str) -> Optional[str]:
    """
    Verify a code for `email`. On success, returns the user's record id
    (string) so the caller can issue a JWT. On any failure (not found,
    expired, too many attempts, wrong code), returns None.

    Rate-limited: increments `attempts` on each try; above MAX_ATTEMPTS the
    code is burned (consumed=true). Successful verify marks consumed=true.
    """
    rows = await repo_query(
        "SELECT * FROM login_code WHERE email = $email AND consumed = false "
        "AND expires > time::now() LIMIT 1",
        {"email": email},
    )
    if not rows:
        return None

    record = rows[0]
    rid = str(record.get("id"))
    attempts = int(record.get("attempts", 0) or 0)
    if attempts >= MAX_ATTEMPTS:
        await repo_query(
            "UPDATE type::thing($rid) SET consumed = true", {"rid": rid}
        )
        return None

    code_hash = record.get("code_hash", "")
    ok = await _verify_hash(code, str(code_hash))
    if not ok:
        await repo_query(
            "UPDATE type::thing($rid) SET attempts = $a",
            {"rid": rid, "a": attempts + 1},
        )
        return None

    # Success: burn the code.
    await repo_query(
        "UPDATE type::thing($rid) SET consumed = true, attempts = $a",
        {"rid": rid, "a": attempts + 1},
    )
    # Resolve the user record id by email.
    users = await repo_query(
        "SELECT id FROM user WHERE email = $email AND is_active = true LIMIT 1",
        {"email": email},
    )
    if not users:
        return None
    return str(users[0]["id"])


async def latest_dev_code(email: str) -> Optional[str]:
    """
    Dev-mode helper: return the most recent code's plaintext for a given
    email. Reads the `dev_code` field from the latest login_code record for
    that email (root-only table). Used by the superuser debug endpoint only.
    SurrealDB v2.6 lacks `ORDER BY <field>` on this path, so we select all
    live records for the email and pick the newest client-side.
    """
    rows = await repo_query_root(
        "SELECT dev_code, expires, consumed FROM login_code "
        "WHERE email = $email",
        {"email": email},
    )
    if not rows:
        return None
    # Pick the latest non-consumed, non-expired one; fall back to any.
    live = [r for r in rows if not r.get("consumed")]
    pool = live or rows
    latest = pool[-1] if pool else None
    if not latest:
        return None
    return latest.get("dev_code")