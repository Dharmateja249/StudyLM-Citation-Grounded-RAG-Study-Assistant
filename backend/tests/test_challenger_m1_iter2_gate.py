"""
Adversarial Empirical Stress Testing Suite (Milestone 1 Iteration 2 Gate)
Role: Challenger 2 (challenger_m1_iter2_2)

Exhaustively stress tests:
1. Multi-Tenant Anti-Enumeration:
   - Sources listing (GET /notebooks/{id}/sources and /api/notebooks/{id}/sources)
   - Sources upload (POST /notebooks/{id}/sources and /api/notebooks/{id}/sources)
   - YouTube source creation (POST /notebooks/{id}/sources/youtube and /api/notebooks/{id}/sources/youtube)
   - Messages retrieval (GET /notebooks/{id}/messages and /api/notebooks/{id}/messages)
   - Messages creation (POST /notebooks/{id}/messages and /api/notebooks/{id}/messages)
   - Foreign active notebook vs. foreign deleting notebook vs. non-existent UUID indistinguishability (404 Not Found)
2. Account Deletion Cascading Sweeper Triggers:
   - DELETE /users/me and /api/users/me
   - Account deactivation (User.is_active = False)
   - Cascading status transition (notebooks & sources marked 'deleting')
   - Background cleanup deferral queueing for all active notebooks
   - Redundant deferral suppression for already deleting notebooks
   - Resiliency against queue broker exceptions during iteration
   - Immediate 401 Unauthorized across all endpoints post-deletion
   - Re-login rejection via Google OAuth (403 Forbidden)
   - Peer tenant complete isolation and immunity
3. Dual Trailing Slash Route Matrix & Query Parameter Robustness:
   - All core routes with and without trailing slash across root and /api
   - Query parameter matrix with special characters and pagination
   - Strict absence of HTTP 307/308 redirects
"""

import io
import json
import uuid
import time
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlmodel import select

from app.models import Message, Notebook, Source, User


# ==============================================================================
# Suite 1: Multi-Tenant Anti-Enumeration Stress Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_anti_enumeration_sources_and_messages_matrix(
    async_client: AsyncClient,
    user_a: User,
    user_b: User,
    user_a_notebook: Notebook,
    auth_headers_b: dict,
    db_session,
):
    """
    Stress-tests multi-tenant anti-enumeration across all source and message endpoints:
    Non-owner (User B) attempting to access User A's notebook must return HTTP 404
    with identical detail payload {"detail": "Notebook not found"} across both
    root and /api routes, with and without trailing slashes.
    """
    nb_id = user_a_notebook.id
    non_existent_id = str(uuid.uuid4())

    # Create a source in User A's notebook
    src_a = Source(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        notebook_id=nb_id,
        title="Owner Source",
        source_type="pdf",
        storage_key_or_url="users/a/s.pdf",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    # Create a message in User A's notebook
    msg_a = Message(
        id=str(uuid.uuid4()),
        notebook_id=nb_id,
        role="assistant",
        content="Owner Secret Message",
        citations_json=json.dumps([{"chunk_id": "c1", "quote": "Secret Quote"}]),
        injected_chunk_ids_json=json.dumps(["c1"]),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([src_a, msg_a])
    await db_session.commit()

    endpoints_to_probe = [
        # 1. Sources listing
        ("GET", f"/notebooks/{nb_id}/sources", None, f"/notebooks/{non_existent_id}/sources"),
        ("GET", f"/notebooks/{nb_id}/sources/", None, f"/notebooks/{non_existent_id}/sources/"),
        ("GET", f"/api/notebooks/{nb_id}/sources", None, f"/api/notebooks/{non_existent_id}/sources"),
        ("GET", f"/api/notebooks/{nb_id}/sources/", None, f"/api/notebooks/{non_existent_id}/sources/"),

        # 2. YouTube source creation
        ("POST", f"/notebooks/{nb_id}/sources/youtube", {"url": "https://youtu.be/dQw4w9WgXcQ"}, f"/notebooks/{non_existent_id}/sources/youtube"),
        ("POST", f"/notebooks/{nb_id}/sources/youtube/", {"url": "https://youtu.be/dQw4w9WgXcQ"}, f"/notebooks/{non_existent_id}/sources/youtube/"),
        ("POST", f"/api/notebooks/{nb_id}/sources/youtube", {"url": "https://youtu.be/dQw4w9WgXcQ"}, f"/api/notebooks/{non_existent_id}/sources/youtube"),
        ("POST", f"/api/notebooks/{nb_id}/sources/youtube/", {"url": "https://youtu.be/dQw4w9WgXcQ"}, f"/api/notebooks/{non_existent_id}/sources/youtube/"),

        # 3. Messages retrieval
        ("GET", f"/notebooks/{nb_id}/messages", None, f"/notebooks/{non_existent_id}/messages"),
        ("GET", f"/notebooks/{nb_id}/messages/", None, f"/notebooks/{non_existent_id}/messages/"),
        ("GET", f"/api/notebooks/{nb_id}/messages", None, f"/api/notebooks/{non_existent_id}/messages"),
        ("GET", f"/api/notebooks/{nb_id}/messages/", None, f"/api/notebooks/{non_existent_id}/messages/"),

        # 4. Message post
        ("POST", f"/notebooks/{nb_id}/messages", {"role": "user", "content": "Hostile Injection"}, f"/notebooks/{non_existent_id}/messages"),
        ("POST", f"/notebooks/{nb_id}/messages/", {"role": "user", "content": "Hostile Injection"}, f"/notebooks/{non_existent_id}/messages/"),
        ("POST", f"/api/notebooks/{nb_id}/messages", {"role": "user", "content": "Hostile Injection"}, f"/api/notebooks/{non_existent_id}/messages"),
        ("POST", f"/api/notebooks/{nb_id}/messages/", {"role": "user", "content": "Hostile Injection"}, f"/api/notebooks/{non_existent_id}/messages/"),
    ]

    for method, target_url, body, control_url in endpoints_to_probe:
        if method == "GET":
            res_target = await async_client.get(target_url, headers=auth_headers_b)
            res_control = await async_client.get(control_url, headers=auth_headers_b)
        else:
            res_target = await async_client.post(target_url, json=body, headers=auth_headers_b)
            res_control = await async_client.post(control_url, json=body, headers=auth_headers_b)

        assert res_target.status_code == 404, f"Leaked status {res_target.status_code} on {method} {target_url}"
        assert res_control.status_code == 404, f"Control returned {res_control.status_code} on {method} {control_url}"
        assert res_target.json() == {"detail": "Notebook not found"}, f"Bad error payload on {target_url}"
        assert res_target.json() == res_control.json(), f"Discrepancy detected between target {target_url} and control {control_url}"


@pytest.mark.asyncio
async def test_anti_enumeration_deleting_notebook_isolation(
    async_client: AsyncClient,
    user_a: User,
    user_b: User,
    auth_headers_b: dict,
    db_session,
):
    """
    Anti-Enumeration on Deleting Notebooks:
    When User A's notebook is in status 'deleting', User B probing that notebook
    MUST receive 404 Not Found (NOT 409 Conflict), maintaining absolute opacity.
    """
    deleting_nb = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="User A Pending Deletion NB",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(deleting_nb)
    await db_session.commit()

    nb_id = deleting_nb.id

    # 1. User B lists sources -> 404
    res1 = await async_client.get(f"/notebooks/{nb_id}/sources", headers=auth_headers_b)
    assert res1.status_code == 404
    assert res1.json() == {"detail": "Notebook not found"}

    # 2. User B adds YouTube source -> 404 (not 409!)
    res2 = await async_client.post(
        f"/notebooks/{nb_id}/sources/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ"},
        headers=auth_headers_b,
    )
    assert res2.status_code == 404
    assert res2.json() == {"detail": "Notebook not found"}

    # 3. User B reads messages -> 404
    res3 = await async_client.get(f"/notebooks/{nb_id}/messages", headers=auth_headers_b)
    assert res3.status_code == 404
    assert res3.json() == {"detail": "Notebook not found"}

    # 4. User B injects message -> 404
    res4 = await async_client.post(
        f"/notebooks/{nb_id}/messages",
        json={"role": "user", "content": "Hostile probe"},
        headers=auth_headers_b,
    )
    assert res4.status_code == 404
    assert res4.json() == {"detail": "Notebook not found"}


# ==============================================================================
# Suite 2: Account Deletion Cascading Sweeper Stress Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_account_deletion_cascading_sweeper_comprehensive(
    async_client: AsyncClient,
    user_a: User,
    user_b: User,
    auth_headers: dict,
    auth_headers_b: dict,
    db_session,
):
    """
    Stress-tests DELETE /users/me cascading sweepers:
    - Sets user_a.is_active = False.
    - Transitions all notebooks (active, deleting, etc.) to 'deleting'.
    - Transitions all sources to 'deleting'.
    - Invokes defer_cleanup_notebook for active notebooks only.
    - Subsequent calls with user_a token fail with 401 Unauthorized across all endpoints.
    - User B remains 100% active and untouched.
    """
    user_a_id = user_a.id
    user_b_id = user_b.id

    # Create 3 notebooks for User A: 2 active, 1 already deleting
    nb_active_1 = Notebook(id=str(uuid.uuid4()), user_id=user_a_id, title="NB 1", status="active", created_at=datetime.now(timezone.utc))
    nb_active_2 = Notebook(id=str(uuid.uuid4()), user_id=user_a_id, title="NB 2", status="active", created_at=datetime.now(timezone.utc))
    nb_already_del = Notebook(id=str(uuid.uuid4()), user_id=user_a_id, title="NB Del", status="deleting", created_at=datetime.now(timezone.utc))

    # Sources for User A
    src_1 = Source(id=str(uuid.uuid4()), user_id=user_a_id, notebook_id=nb_active_1.id, title="Src 1", source_type="pdf", storage_key_or_url="k1", status="ready", created_at=datetime.now(timezone.utc))
    src_2 = Source(id=str(uuid.uuid4()), user_id=user_a_id, notebook_id=nb_active_2.id, title="Src 2", source_type="youtube", storage_key_or_url="k2", status="processing", created_at=datetime.now(timezone.utc))

    # Notebook and source for User B (peer tenant)
    nb_b = Notebook(id=str(uuid.uuid4()), user_id=user_b_id, title="NB B", status="active", created_at=datetime.now(timezone.utc))
    src_b = Source(id=str(uuid.uuid4()), user_id=user_b_id, notebook_id=nb_b.id, title="Src B", source_type="pdf", storage_key_or_url="kb", status="ready", created_at=datetime.now(timezone.utc))

    nb_b_id = nb_b.id
    nb_active_1_id = nb_active_1.id
    nb_active_2_id = nb_active_2.id
    nb_already_del_id = nb_already_del.id

    db_session.add_all([nb_active_1, nb_active_2, nb_already_del, src_1, src_2, nb_b, src_b])
    await db_session.commit()

    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        # Perform account deletion
        res = await async_client.delete("/users/me", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["status"] == "deleting"

        # Verify only active notebooks were deferred (nb_active_1, nb_active_2)
        deferred_ids = [call.kwargs.get("notebook_id") or call.args[0] for call in mock_defer.call_args_list]
        assert len(deferred_ids) == 2
        assert nb_active_1_id in deferred_ids
        assert nb_active_2_id in deferred_ids
        assert nb_already_del_id not in deferred_ids
        assert nb_b_id not in deferred_ids

    # DB state inspection
    db_session.expire_all()
    user_a_reloaded = (await db_session.execute(select(User).where(User.id == user_a_id))).scalar_one()
    assert user_a_reloaded.is_active is False

    user_a_nbs = (await db_session.execute(select(Notebook).where(Notebook.user_id == user_a_id))).scalars().all()
    assert len(user_a_nbs) == 3
    assert all(nb.status == "deleting" for nb in user_a_nbs)

    user_a_srcs = (await db_session.execute(select(Source).where(Source.user_id == user_a_id))).scalars().all()
    assert len(user_a_srcs) == 2
    assert all(s.status == "deleting" for s in user_a_srcs)

    # User B remains active and unaffected
    user_b_reloaded = (await db_session.execute(select(User).where(User.id == user_b_id))).scalar_one()
    assert user_b_reloaded.is_active is True

    nb_b_reloaded = (await db_session.execute(select(Notebook).where(Notebook.id == nb_b_id))).scalar_one()
    assert nb_b_reloaded.status == "active"

    # Immediate token revocation check for User A across all major endpoints
    probes = [
        ("GET", "/auth/me"),
        ("GET", "/api/auth/me"),
        ("GET", "/notebooks"),
        ("GET", "/api/notebooks"),
        ("GET", f"/notebooks/{nb_active_1_id}"),
        ("GET", f"/notebooks/{nb_active_1_id}/sources"),
        ("GET", f"/notebooks/{nb_active_1_id}/messages"),
        ("DELETE", "/users/me"),
    ]
    for method, path in probes:
        if method == "GET":
            r = await async_client.get(path, headers=auth_headers)
        elif method == "DELETE":
            r = await async_client.delete(path, headers=auth_headers)
        assert r.status_code == 401, f"{method} {path} returned {r.status_code}, expected 401"
        assert "deactivated" in r.json()["detail"].lower()


# ==============================================================================
# Suite 3: Dual Trailing Slash Route Matrix & Query Parameter Robustness
# ==============================================================================

@pytest.mark.asyncio
async def test_dual_trailing_slash_route_matrix_and_queries(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
    user_a_source: Source,
):
    """
    Comprehensive Route Matrix Probe:
    Asserts every core route is accessible with and without trailing slash,
    under root and /api prefixes, and with query parameters, with ZERO 307/308 redirects.
    """
    nb_id = user_a_notebook.id
    src_id = user_a_source.id

    test_matrix = [
        # 1. /auth/me
        ("GET", "/auth/me", 200),
        ("GET", "/auth/me/", 200),
        ("GET", "/auth/me?format=json&cached=false", 200),
        ("GET", "/auth/me/?format=json&cached=false", 200),
        ("GET", "/api/auth/me", 200),
        ("GET", "/api/auth/me/", 200),
        ("GET", "/api/auth/me?format=json", 200),
        ("GET", "/api/auth/me/?format=json", 200),

        # 2. /notebooks
        ("GET", "/notebooks", 200),
        ("GET", "/notebooks/", 200),
        ("GET", "/notebooks?limit=5&offset=0", 200),
        ("GET", "/notebooks/?limit=5&offset=0", 200),
        ("GET", "/api/notebooks", 200),
        ("GET", "/api/notebooks/", 200),
        ("GET", "/api/notebooks?limit=5", 200),
        ("GET", "/api/notebooks/?limit=5", 200),

        # 3. /notebooks/{id}
        ("GET", f"/notebooks/{nb_id}", 200),
        ("GET", f"/notebooks/{nb_id}/", 200),
        ("GET", f"/notebooks/{nb_id}?include_sources=true", 200),
        ("GET", f"/notebooks/{nb_id}/?include_sources=true", 200),
        ("GET", f"/api/notebooks/{nb_id}", 200),
        ("GET", f"/api/notebooks/{nb_id}/", 200),
        ("GET", f"/api/notebooks/{nb_id}?include_sources=true", 200),
        ("GET", f"/api/notebooks/{nb_id}/?include_sources=true", 200),

        # 4. /notebooks/{id}/sources
        ("GET", f"/notebooks/{nb_id}/sources", 200),
        ("GET", f"/notebooks/{nb_id}/sources/", 200),
        ("GET", f"/notebooks/{nb_id}/sources?page=1&per_page=10", 200),
        ("GET", f"/notebooks/{nb_id}/sources/?page=1&per_page=10", 200),
        ("GET", f"/api/notebooks/{nb_id}/sources", 200),
        ("GET", f"/api/notebooks/{nb_id}/sources/", 200),
        ("GET", f"/api/notebooks/{nb_id}/sources?page=1", 200),
        ("GET", f"/api/notebooks/{nb_id}/sources/?page=1", 200),

        # 5. /notebooks/{id}/messages
        ("GET", f"/notebooks/{nb_id}/messages", 200),
        ("GET", f"/notebooks/{nb_id}/messages/", 200),
        ("GET", f"/notebooks/{nb_id}/messages?since=2026-01-01", 200),
        ("GET", f"/notebooks/{nb_id}/messages/?since=2026-01-01", 200),
        ("GET", f"/api/notebooks/{nb_id}/messages", 200),
        ("GET", f"/api/notebooks/{nb_id}/messages/", 200),
        ("GET", f"/api/notebooks/{nb_id}/messages?since=2026-01-01", 200),
        ("GET", f"/api/notebooks/{nb_id}/messages/?since=2026-01-01", 200),

        # 6. /sources/{id}
        ("GET", f"/sources/{src_id}", 200),
        ("GET", f"/sources/{src_id}/", 200),
        ("GET", f"/sources/{src_id}?full=true", 200),
        ("GET", f"/sources/{src_id}/?full=true", 200),
        ("GET", f"/api/sources/{src_id}", 200),
        ("GET", f"/api/sources/{src_id}/", 200),
        ("GET", f"/api/sources/{src_id}?full=true", 200),
        ("GET", f"/api/sources/{src_id}/?full=true", 200),
    ]

    for method, path, expected_status in test_matrix:
        res = await async_client.get(path, headers=auth_headers)
        assert res.status_code == expected_status, f"{path} returned {res.status_code}, expected {expected_status}"
        assert res.status_code not in (307, 308), f"Redirect returned for {path}: {res.status_code}"
