"""
Local dev OTP flow probe (no Docker, no redeploy).

Runs against the local SurrealDB v2.6 on 127.0.0.1:8800 (root:root).

Sequence:
  1. Migrate to latest (includes 25: login_code table).
  2. Define user_scope access.
  3. Ensure david@itak.live exists + active (superuser) + set to require NO
     approval so we can test auto-approve too.
  4. Exercise: request-code -> latest_dev_code -> verify-code -> token.
  5. Assert the token authenticates a scoped session.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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

from open_notebook.database.async_migrate import AsyncMigrationManager
from open_notebook.database.repository import db_connection, get_database_name, get_database_namespace, get_database_url, current_jwt, current_owner_id
from surrealdb import AsyncSurreal  # type: ignore


async def root_query(sql, vars=None):
    db = AsyncSurreal(get_database_url())
    await db.use(get_database_namespace(), get_database_name())
    await db.signin({"username": "root", "password": "root"})
    try:
        r = await db.query(sql, vars or {})
        return r if isinstance(r, list) else [r]
    finally:
        await db.close()


async def main():
    logger.info("=== migrate to 25 ===")
    mgr = AsyncMigrationManager()
    await mgr.ping()
    await mgr.run_migration_up()
    logger.info(f"version: {await mgr.get_current_version()}")

    logger.info("=== define user_scope ===")
    secret = os.environ["JWT_SECRET_KEY"]
    await root_query(
        "DEFINE ACCESS OVERWRITE user_scope ON DATABASE TYPE RECORD WITH JWT "
        f"ALGORITHM HS256 KEY '{secret.replace(chr(39), chr(39)+chr(39))}' "
        "AUTHENTICATE { IF $auth.is_active != true { THROW \"Account is disabled\" }; RETURN $auth } "
        "DURATION FOR TOKEN 1h, FOR SESSION 24h;"
    )

    logger.info("=== ensure david exists + active ===")
    rows = await root_query("SELECT id FROM user WHERE email = $e", {"e": "david@local.test"})
    if rows:
        did = str(rows[0]["id"])
        await root_query("UPDATE type::thing($id) SET is_active = true, role = 'superuser'", {"id": did})
    else:
        from api.auth_multiuser import hash_password
        r = await root_query(
            "CREATE user SET email = $e, username = $e, display_name = $e, "
            "password_hash = $ph, role = 'superuser', is_active = true, requires_approval = false",
            {"e": "david@local.test", "ph": hash_password("dontuse-123!")},
        )
        did = str(r[0]["id"])
    logger.info(f"david id = {did}")

    # Exercise the OTP domain functions directly (no HTTP needed).
    from open_notebook.domain.login_code import issue_code, verify_code, latest_dev_code

    logger.info("=== issue_code(david@local.test) ===")
    # issue_code runs under repo_create which uses db_connection(); we are in
    # a bare asyncio context with no current_jwt set -> root session. Good.
    code = await issue_code("david@local.test")
    logger.info(f"issued code (plaintext from issue_code) = {code}")

    dev_code = await latest_dev_code("david@local.test")
    logger.info(f"latest_dev_code = {dev_code}")

    assert dev_code == code, "latest_dev_code should match issued code"
    logger.success("PASS: dev-mode code retrieval works")

    logger.info("=== verify_code (correct) ===")
    uid = await verify_code("david@local.test", dev_code)
    logger.info(f"verify_code returned user id = {uid}")
    assert uid == did, "verify_code should return david's id"
    logger.success("PASS: verify_code returns correct user id")

    logger.info("=== verify_code replay (should be None — consumed) ===")
    again = await verify_code("david@local.test", dev_code)
    logger.info(f"replay verify = {again}")
    assert again is None, "consumed code must not verify again"
    logger.success("PASS: consumed code rejected")

    logger.info("=== verify_code wrong (should be None) ===")
    code2 = await issue_code("david@local.test")
    bad = await verify_code("david@local.test", "000000")
    logger.info(f"wrong-code verify = {bad}")
    assert bad is None, "wrong code must not verify"
    logger.success("PASS: wrong code rejected")

    logger.info("=== issue + verify -> token via auth helper ===")
    code3 = await issue_code("david@local.test")
    uid3 = await verify_code("david@local.test", code3)
    from api.auth_multiuser import create_access_token
    token = create_access_token(uid3, "david@local.test", "superuser")
    logger.info(f"token len = {len(token)}")

    # Authenticate a scoped session with the token and confirm $auth populates.
    db = AsyncSurreal(get_database_url())
    await db.use(get_database_namespace(), get_database_name())
    await db.authenticate(token)
    try:
        role = await db.query("RETURN $auth.role")
        aid = await db.query("RETURN $auth.id")
        logger.info(f"scoped session after OTP: auth.id={aid} auth.role={role}")
        assert role == "superuser"
        logger.success("PASS: OTP-issued JWT opens a scoped record-user session")
    finally:
        await db.close()

    logger.success("ALL OTP PROBES PASSED")


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))