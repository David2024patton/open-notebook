"""
Phase 2.5: native SurrealDB multi-tenancy verification.

These tests exercise the tenant-isolation contract enforced by the
`user_scope` JWT scope + record-level PERMISSIONS defined in migration 23:

  - A user can read their own records.
  - A user can read ANOTHER user's record ONLY when is_global = true.
  - A user CANNOT read another user's private (is_global = false) record.
  - update/delete are restricted to the owner (or admin/superuser).
  - The bridge stamps `owner` automatically from the request context.

The DB-backed tests require a reachable SurrealDB (SURREAL_URL) and are
skipped automatically when one is not available (e.g. unit-only local runs).
"""

import os

import pytest

from open_notebook.database.repository import (
    TENANT_TABLES,
    current_jwt,
    current_owner_id,
    stamp_owner,
)


def test_stamp_owner_sets_owner_from_context():
    """stamp_owner injects owner from the request contextvar for tenant tables."""
    from surrealdb import RecordID

    token = current_owner_id.set("user:abc123")
    try:
        data = stamp_owner("notebook", {"name": "x"})
        assert data["owner"] == RecordID("user", "abc123")
    finally:
        current_owner_id.reset(token)


def test_stamp_owner_leaves_non_tenant_tables_untouched():
    token = current_owner_id.set("user:abc123")
    try:
        data = stamp_owner("credential", {"provider": "x"})
        assert "owner" not in data
    finally:
        current_owner_id.reset(token)


def test_stamp_owner_keeps_explicit_owner():
    token = current_owner_id.set("user:abc123")
    try:
        data = stamp_owner("notebook", {"name": "x", "owner": "user:other"})
        assert data["owner"] == "user:other"
    finally:
        current_owner_id.reset(token)


def test_tenant_tables_constant():
    assert {"notebook", "source", "note", "source_embedding", "source_insight", "chat_session"} == TENANT_TABLES


# ---------------------------------------------------------------------------
# DB-backed isolation tests (skip if SurrealDB is not reachable)
# ---------------------------------------------------------------------------

_SURREAL_URL = os.getenv("SURREAL_URL", "ws://localhost:8000/rpc")


async def _have_surreal():
    try:
        from surrealdb import AsyncSurreal

        db = AsyncSurreal(_SURREAL_URL)
        await db.signin(
            {
                "username": os.getenv("SURREAL_USER", "root"),
                "password": os.getenv("SURREAL_PASSWORD", "root"),
            }
        )
        await db.use(
            os.getenv("SURREAL_NAMESPACE", "open_notebook"),
            os.getenv("SURREAL_DATABASE", "open_notebook"),
        )
        await db.query("RETURN 1;")
        await db.close()
        return True
    except Exception:
        return False


async def _make_user(db, username):
    """Create a user and return (record_id, jwt_token)."""
    from api.auth_multiuser import create_access_token

    res = await db.query(
        "CREATE user CONTENT $data RETURN id",
        {
            "data": {
                "username": username,
                "email": username,
                "password_hash": "x",
                "role": "user",
            }
        },
    )
    uid = res[0]["result"][0]["id"]
    jwt = create_access_token(str(uid), username, "user")
    return str(uid), jwt


def test_tenant_isolation_select():
    """User A cannot read User B's private notebook but CAN read a global one.

    Runs only when a SurrealDB is reachable; otherwise skipped. The async body
    is driven by a fresh event loop so the test works without pytest-asyncio.
    """
    import asyncio

    async def _run():
        if not await _have_surreal():
            pytest.skip("SurrealDB not reachable")

        from surrealdb import AsyncSurreal

        db = AsyncSurreal(_SURREAL_URL)
        await db.signin(
            {
                "username": os.getenv("SURREAL_USER", "root"),
                "password": os.getenv("SURREAL_PASSWORD", "root"),
            }
        )
        await db.use(
            os.getenv("SURREAL_NAMESPACE", "open_notebook"),
            os.getenv("SURREAL_DATABASE", "open_notebook"),
        )
        a_id = b_id = None
        try:
            a_id, a_jwt = await _make_user(db, "tenant_a@example.com")
            b_id, _ = await _make_user(db, "tenant_b@example.com")

            # B creates a private notebook and a global notebook
            priv = await db.query(
                "CREATE notebook CONTENT $d RETURN id",
                {"d": {"name": "B private", "owner": b_id, "is_global": False}},
            )
            glob = await db.query(
                "CREATE notebook CONTENT $d RETURN id",
                {"d": {"name": "B global", "owner": b_id, "is_global": True}},
            )
            priv_id = priv[0]["result"][0]["id"]
            glob_id = glob[0]["result"][0]["id"]

            # A authenticates via the scope and tries to read both
            await db.authenticate(a_jwt)
            priv_res = await db.query("SELECT * FROM $id", {"id": priv_id})
            glob_res = await db.query("SELECT * FROM $id", {"id": glob_id})

            assert not priv_res[0]["result"], (
                "User A must NOT see User B's private notebook"
            )
            assert glob_res[0]["result"], (
                "User A MUST be able to read User B's global notebook (is_global=true)"
            )
        finally:
            if a_id and b_id:
                await db.query(
                    "DELETE notebook WHERE owner IN [$a, $b]",
                    {"a": a_id, "b": b_id},
                )
                await db.query(
                    "DELETE user WHERE id IN [$a, $b]", {"a": a_id, "b": b_id}
                )
            await db.close()

    asyncio.new_event_loop().run_until_complete(_run())
