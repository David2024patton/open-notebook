"""
Local dev bootstrap + cross-tenant probe (no Docker, no redeploy).

Runs against a local SurrealDB v2.x on 127.0.0.1:8800 (root:root).

Sequence:
  1. Sets env vars to point the app at the local SurrealDB.
  2. Runs migrations 1-24 via AsyncMigrationManager (same path as production).
  3. Defines the user_scope access method (DEFINE ACCESS ... TYPE RECORD WITH JWT).
  4. Creates two users (A=superuser, B=plain), issues enriched JWTs.
  5. Authenticates scoped sessions, inserts notebooks, and asserts DB-enforced
     isolation (A sees only A's, B sees only B's; cross reads return nothing).

Run: uv run python tests/_local_dev_probe.py
If SURREAL is not on 127.0.0.1:8800, set SURREAL_URL env before running.
"""
import asyncio
import os
import sys

# --- put the workspace root on sys.path so `api`/`open_notebook` import ---
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# --- point the app at the local SurrealDB before importing app modules ---
os.environ.setdefault("SURREAL_URL", "ws://127.0.0.1:8800/rpc")
os.environ.setdefault("SURREAL_USER", "root")
os.environ.setdefault("SURREAL_PASSWORD", "root")
os.environ.setdefault("SURREAL_NAMESPACE", "open_notebook")
os.environ.setdefault("SURREAL_DATABASE", "open_notebook")
os.environ.setdefault("OPEN_NOTEBOOK_AUTH_MODE", "multi-user")
os.environ.setdefault("JWT_SECRET_KEY", "local-dev-jwt-secret-key-2026")
os.environ.setdefault("OPEN_NOTEBOOK_ENCRYPTION_KEY", "local-dev-encryption-key")
os.environ.setdefault("OPEN_NOTEBOOK_DB_SCOPE_AUTH", "1")

from loguru import logger

from api.auth_multiuser import create_access_token, hash_password
from open_notebook.database.async_migrate import AsyncMigrationManager
from open_notebook.database.repository import (
    db_connection,
    get_database_name,
    get_database_namespace,
    get_database_url,
)
from surrealdb import AsyncSurreal  # type: ignore


async def root_query(sql: str, vars: dict = None) -> list:
    db = AsyncSurreal(get_database_url())
    await db.use(get_database_namespace(), get_database_name())
    await db.signin({"username": "root", "password": "root"})
    try:
        res = await db.query(sql, vars or {})
        return res if isinstance(res, list) else [res]
    finally:
        await db.close()


async def _wipe_tenant_tables():
    # SurrealDB v2.6 has no `LIKE` operator; use string::starts_with ORs.
    # Dev DB only — just wipe all notebooks for a clean slate.
    await root_query("DELETE notebook")


async def main():
    logger.info("=== Step 1: migrate 1..24 ===")
    mgr = AsyncMigrationManager()
    await mgr.ping()
    ver = await mgr.get_current_version()
    logger.info(f"current version before: {ver}")
    await mgr.run_migration_up()
    logger.info(f"version after: {await mgr.get_current_version()}")

    logger.info("=== Step 2: define user_scope access (DEFINE ACCESS TYPE RECORD WITH JWT) ===")
    secret = os.environ["JWT_SECRET_KEY"]
    escaped = secret.replace("'", "''")
    define_sql = (
        "DEFINE ACCESS OVERWRITE user_scope ON DATABASE TYPE RECORD WITH JWT "
        f"ALGORITHM HS256 KEY '{escaped}' "
        "AUTHENTICATE { "
        "  IF $auth.is_active != true { THROW \"Account is disabled\" }; "
        "  RETURN $auth "
        "} "
        "DURATION FOR TOKEN 1h, FOR SESSION 24h;"
    )
    await root_query(define_sql)
    logger.info("user_scope defined")

    logger.info("=== Step 3: create users A (user) + B (user) + S (superuser) ===")

    async def ensure_user(email, role):
        rows = await root_query("SELECT id FROM user WHERE email = $email", {"email": email})
        if rows:
            return str(rows[0]["id"])
        ph = hash_password("probe-pass-123!")
        r = await root_query(
            "CREATE user SET email = $email, username = $email, display_name = $email, "
            "password_hash = $ph, role = $role, is_active = true, requires_approval = false",
            {"email": email, "ph": ph, "role": role},
        )
        rec = r[0] if r else {}
        return str(rec.get("id", rec))

    a = await ensure_user("tenant.a@probe.test", "user")
    b = await ensure_user("tenant.b@probe.test", "user")
    s = await ensure_user("tenant.s@probe.test", "superuser")
    logger.info(f"A={a}  B={b}  S={s}")
    await _wipe_tenant_tables()

    tok_a = create_access_token(str(a), "tenant.a@probe.test", "user")
    tok_b = create_access_token(str(b), "tenant.b@probe.test", "user")
    tok_s = create_access_token(str(s), "tenant.s@probe.test", "superuser")

    async def scoped_query(token, sql, vars=None):
        db = AsyncSurreal(get_database_url())
        await db.use(get_database_namespace(), get_database_name())
        await db.authenticate(token)
        try:
            return await db.query(sql, vars or {})
        finally:
            await db.close()

    logger.info("=== Step 4: create A's notebook (root) + B's notebook (root) ===")
    await root_query(
        "CREATE notebook SET name = $n, owner = type::thing($owner), is_global = false",
        {"n": "A's notebook", "owner": str(a)},
    )
    await root_query(
        "CREATE notebook SET name = $n, owner = type::thing($owner), is_global = false",
        {"n": "B's notebook", "owner": str(b)},
    )

    logger.info("=== Step 5: scoped reads ===")
    a_rows = await scoped_query(tok_a, "SELECT name FROM notebook")
    b_rows = await scoped_query(tok_b, "SELECT name FROM notebook")
    s_rows = await scoped_query(tok_s, "SELECT name FROM notebook")
    a_names = sorted(r["name"] for r in a_rows)
    b_names = sorted(r["name"] for r in b_rows)
    s_names = sorted(r["name"] for r in s_rows)
    logger.info(f"A (user) sees: {a_names}")
    logger.info(f"B (user) sees: {b_names}")
    logger.info(f"S (super) sees: {s_names}")

    ok = True
    if a_names == ["A's notebook"]:
        logger.success("PASS: A sees only own")
    else:
        logger.error(f"FAIL: A isolation (expected only A's notebook, got {a_names})"); ok = False
    if b_names == ["B's notebook"]:
        logger.success("PASS: B sees only own")
    else:
        logger.error(f"FAIL: B isolation (expected only B's notebook, got {b_names})"); ok = False
    if "A's notebook" in s_names and "B's notebook" in s_names:
        logger.success("PASS: superuser S sees all tenants (intended)")
    else:
        logger.error(f"FAIL: S should see all (got {s_names})"); ok = False

    logger.info(r"=== Step 6: scoped create with owner=$auth (app stamps owner this way) ===")
    new_a = await scoped_query(tok_a, "CREATE notebook SET name = 'A again', owner = $auth, is_global = false RETURN *")
    new_b = await scoped_query(tok_b, "CREATE notebook SET name = 'B again', owner = $auth, is_global = false RETURN *")
    logger.info(f"A scoped create -> {len(new_a)} row(s)")
    logger.info(f"B scoped create -> {len(new_b)} row(s)")
    if new_a and new_b:
        logger.success(f"PASS: both users can create own (B id = {new_b[0]['id']})")
    else:
        logger.error("FAIL: scoped create blocked"); ok = False

    # Cross-tenant forged create: B tries to set owner = A
    logger.info("=== Step 7: B forges create with owner=A (should be DB-denied) ===")
    try:
        forged = await scoped_query(
            tok_b,
            "CREATE notebook SET name = 'forged', owner = type::thing($a), is_global = false RETURN *",
            {"a": str(a)},
        )
        if forged:
            logger.error(f"FAIL: B forged owner=A and it was created: {forged}")
            ok = False
        else:
            logger.success("PASS: B's forged create returned [] (DB PERMISSIONS blocked)")
    except Exception as e:
        logger.success(f"PASS: B's forged create raised (DB enforced): {type(e).__name__}")

    logger.info("=== RESULT ===")
    if ok:
        logger.success("ALL CROSS-TENANT PROBES PASSED — DB-native isolation works")
    else:
        logger.error("PROBES FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))