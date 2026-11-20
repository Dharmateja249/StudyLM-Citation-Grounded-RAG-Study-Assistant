"""
API Routing, Parity, Ingestion & Contract Verification Suite
File: backend/tests/test_api_routing.py

Verifies:
1. Trailing Slash Handling (GET & POST):
   - Dual slash support for /notebooks/{id}/sources and /sources/youtube without 307 redirects.
   - Dual slash support across /notebooks/{id}, /auth/me, and /users/me.
2. Universal /api Route Parity:
   - Identical contract behavior on /api/notebooks, /api/auth/me, /api/sources/{id}, /api/users/me.
3. YouTube Source Ingestion API:
   - 201 Created with canonical URL and status="processing".
   - 400 Bad Request on invalid YouTube URL patterns.
   - 404 Anti-Enumeration Defense on other tenant's notebooks.
4. Session Resume Citations & Chunk IDs:
   - MessageRead schema returns citations and injected_chunk_ids on GET /notebooks/{id}/messages.
5. Account Deletion Sweeper Trigger:
   - DELETE /users/me triggers defer_cleanup_notebook for each active user notebook.
"""

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlmodel import select

from app.models import Message, Notebook, Source, User


# ==============================================================================
# 1. Trailing Slash Handling Tests (Dual Slash Support)
# ==============================================================================

@pytest.mark.asyncio
async def test_trailing_slash_get_sources(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
    user_a_source: Source,
):
    """
    Asserts GET /notebooks/{id}/sources and GET /notebooks/{id}/sources/
    both return 200 OK directly without 307 temporary redirects.
    Also verifies /api prefixed variants.
    """
    nb_id = user_a_notebook.id

    # 1. Non-trailing slash root
    res1 = await async_client.get(f"/notebooks/{nb_id}/sources", headers=auth_headers)
    assert res1.status_code == 200, f"Expected 200, got {res1.status_code}"
    sources1 = res1.json()
    assert isinstance(sources1, list)
    assert any(s["id"] == user_a_source.id for s in sources1)

    # 2. Trailing slash root (must not be 307)
    res2 = await async_client.get(f"/notebooks/{nb_id}/sources/", headers=auth_headers)
    assert res2.status_code == 200, f"Expected 200 without redirect, got {res2.status_code}"
    sources2 = res2.json()
    assert isinstance(sources2, list)
    assert any(s["id"] == user_a_source.id for s in sources2)

    # 3. Non-trailing slash /api
    res3 = await async_client.get(f"/api/notebooks/{nb_id}/sources", headers=auth_headers)
    assert res3.status_code == 200, f"Expected 200 on /api, got {res3.status_code}"

    # 4. Trailing slash /api (must not be 307)
    res4 = await async_client.get(f"/api/notebooks/{nb_id}/sources/", headers=auth_headers)
    assert res4.status_code == 200, f"Expected 200 on /api/, got {res4.status_code}"


@pytest.mark.asyncio
async def test_trailing_slash_post_youtube(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Asserts POST /notebooks/{id}/sources/youtube and with trailing slash
    both return 201 Created directly without 307 temporary redirects.
    """
    nb_id = user_a_notebook.id
    payload1 = {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Test Vid 1"}
    payload2 = {"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Test Vid 2"}
    payload3 = {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Test Vid 3"}
    payload4 = {"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Test Vid 4"}

    # 1. Non-trailing slash root
    res1 = await async_client.post(f"/notebooks/{nb_id}/sources/youtube", json=payload1, headers=auth_headers)
    assert res1.status_code == 201, f"Expected 201, got {res1.status_code}"
    assert res1.json()["source_type"] == "youtube"

    # 2. Trailing slash root (must not be 307)
    res2 = await async_client.post(f"/notebooks/{nb_id}/sources/youtube/", json=payload2, headers=auth_headers)
    assert res2.status_code == 201, f"Expected 201 without redirect, got {res2.status_code}"
    assert res2.json()["source_type"] == "youtube"

    # 3. Non-trailing slash /api
    res3 = await async_client.post(f"/api/notebooks/{nb_id}/sources/youtube", json=payload3, headers=auth_headers)
    assert res3.status_code == 201, f"Expected 201 on /api, got {res3.status_code}"

    # 4. Trailing slash /api (must not be 307)
    res4 = await async_client.post(f"/api/notebooks/{nb_id}/sources/youtube/", json=payload4, headers=auth_headers)
    assert res4.status_code == 201, f"Expected 201 on /api/, got {res4.status_code}"


@pytest.mark.asyncio
async def test_notebooks_and_auth_trailing_slash_support(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Verifies that notebook and auth endpoints support trailing slashes without 307 redirects.
    """
    nb_id = user_a_notebook.id

    # GET /notebooks/{id}/
    res_nb = await async_client.get(f"/notebooks/{nb_id}/", headers=auth_headers)
    assert res_nb.status_code == 200

    # PATCH /notebooks/{id}/
    res_patch = await async_client.patch(f"/notebooks/{nb_id}/", json={"title": "Updated Title"}, headers=auth_headers)
    assert res_patch.status_code == 200
    assert res_patch.json()["title"] == "Updated Title"

    # GET /auth/me/
    res_me = await async_client.get("/auth/me/", headers=auth_headers)
    assert res_me.status_code == 200

    # GET /api/auth/me/
    res_api_me = await async_client.get("/api/auth/me/", headers=auth_headers)
    assert res_api_me.status_code == 200


# ==============================================================================
# 2. Universal /api Route Parity Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_universal_api_parity_notebooks(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Verifies that /api/notebooks endpoints have full parity with /notebooks.
    """
    # 1. GET /api/notebooks
    res_list = await async_client.get("/api/notebooks", headers=auth_headers)
    assert res_list.status_code == 200, f"Expected 200, got {res_list.status_code}"
    notebooks = res_list.json()
    assert any(nb["id"] == user_a_notebook.id for nb in notebooks)

    # 2. POST /api/notebooks
    res_create = await async_client.post(
        "/api/notebooks",
        json={"title": "Created via /api"},
        headers=auth_headers,
    )
    assert res_create.status_code == 201, f"Expected 201, got {res_create.status_code}"
    new_nb = res_create.json()
    assert new_nb["title"] == "Created via /api"

    # 3. GET /api/notebooks/{id}
    res_get = await async_client.get(f"/api/notebooks/{new_nb['id']}", headers=auth_headers)
    assert res_get.status_code == 200
    assert res_get.json()["id"] == new_nb["id"]

    # 4. PATCH /api/notebooks/{id}
    res_patch = await async_client.patch(
        f"/api/notebooks/{new_nb['id']}",
        json={"title": "Updated via /api"},
        headers=auth_headers,
    )
    assert res_patch.status_code == 200
    assert res_patch.json()["title"] == "Updated via /api"

    # 5. DELETE /api/notebooks/{id}
    res_del = await async_client.delete(f"/api/notebooks/{new_nb['id']}", headers=auth_headers)
    assert res_del.status_code == 200
    assert res_del.json()["status"] == "deleting"


@pytest.mark.asyncio
async def test_universal_api_parity_auth_me(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a: User,
):
    """
    Verifies GET /api/auth/me returns 200 with user profile.
    """
    res = await async_client.get("/api/auth/me", headers=auth_headers)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}"
    profile = res.json()
    assert profile["id"] == user_a.id
    assert profile["email"] == user_a.email
    assert profile["is_active"] is True


@pytest.mark.asyncio
async def test_universal_api_parity_sources(
    async_client: AsyncClient,
    auth_headers: dict,
    auth_headers_b: dict,
    user_a_source: Source,
):
    """
    Verifies GET and DELETE on /api/sources/{id} with tenant protection.
    """
    src_id = user_a_source.id

    # 1. GET /api/sources/{id} by owner
    res_get = await async_client.get(f"/api/sources/{src_id}", headers=auth_headers)
    assert res_get.status_code == 200
    assert res_get.json()["id"] == src_id

    # 2. Anti-enumeration: GET /api/sources/{id} by foreign tenant User B
    res_cross = await async_client.get(f"/api/sources/{src_id}", headers=auth_headers_b)
    assert res_cross.status_code == 404
    assert res_cross.json()["detail"] == "Source not found"

    # 3. DELETE /api/sources/{id} by owner
    res_del = await async_client.delete(f"/api/sources/{src_id}", headers=auth_headers)
    assert res_del.status_code == 200
    assert res_del.json()["status"] == "deleting"

    # 4. Subsequent GET returns 404
    res_subsequent = await async_client.get(f"/api/sources/{src_id}", headers=auth_headers)
    assert res_subsequent.status_code == 404


# ==============================================================================
# 3. YouTube Ingestion Endpoint Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_youtube_ingestion_valid_url(
    async_client: AsyncClient,
    auth_headers: dict,
    db_session,
    user_a_notebook: Notebook,
    user_a: User,
):
    """
    Verifies valid YouTube source creation:
    - 201 Created
    - Source record populated with canonical URL and status='processing'
    """
    nb_id = user_a_notebook.id
    payload = {
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "title": "Quantum Physics Lecture",
    }
    res = await async_client.post(
        f"/notebooks/{nb_id}/sources/youtube",
        json=payload,
        headers=auth_headers,
    )
    assert res.status_code == 201, f"Expected 201, got {res.status_code}: {res.text}"
    data = res.json()
    assert data["source_type"] == "youtube"
    assert data["status"] == "processing"
    assert data["title"] == "Quantum Physics Lecture"
    assert data["notebook_id"] == nb_id
    assert data["storage_key_or_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    # Verify DB record
    stmt = select(Source).where(Source.id == data["id"])
    db_src = (await db_session.execute(stmt)).scalar_one_or_none()
    assert db_src is not None
    assert db_src.user_id == user_a.id
    assert db_src.source_type == "youtube"


@pytest.mark.asyncio
async def test_youtube_ingestion_invalid_url_formats(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Verifies 400 Bad Request on invalid YouTube URL patterns.
    """
    nb_id = user_a_notebook.id
    invalid_urls = [
        "not_a_url",
        "https://vimeo.com/76979871",
        "https://youtube.com/invalid",
        "https://youtube.com/watch?v=short",  # <11 chars video ID
    ]
    for url in invalid_urls:
        res = await async_client.post(
            f"/notebooks/{nb_id}/sources/youtube",
            json={"url": url, "title": "Invalid"},
            headers=auth_headers,
        )
        assert res.status_code == 400, f"Expected 400 for '{url}', got {res.status_code}"
        assert "Invalid YouTube URL format" in res.json()["detail"]


@pytest.mark.asyncio
async def test_youtube_ingestion_cross_tenant_anti_enumeration(
    async_client: AsyncClient,
    auth_headers_b: dict,
    user_a_notebook: Notebook,
):
    """
    SEC-01 / Anti-Enumeration:
    User B attempting to add YouTube source to User A's notebook must return 404 (NOT 403).
    """
    payload = {"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
    res = await async_client.post(
        f"/notebooks/{user_a_notebook.id}/sources/youtube",
        json=payload,
        headers=auth_headers_b,
    )
    assert res.status_code == 404, f"Expected 404, got {res.status_code}"
    assert res.json()["detail"] == "Notebook not found"


# ==============================================================================
# 4. Session Resume Citations & Injected Chunk IDs Tests
# ==============================================================================

@pytest.mark.asyncio
async def test_session_resume_citations_persistence(
    async_client: AsyncClient,
    auth_headers: dict,
    auth_headers_b: dict,
    db_session,
    user_a_notebook: Notebook,
):
    """
    Verifies that GET /notebooks/{id}/messages and GET /api/notebooks/{id}/messages
    return citations and injected_chunk_ids in the response payload.
    """
    nb_id = user_a_notebook.id

    # 1. Seed message with citations and injected chunk IDs directly in database
    test_citations = [
        {
            "marker_id": 1,
            "source_id": "src-uuid-1",
            "source_title": "Physics Notes.pdf",
            "source_type": "pdf",
            "page_number": 3,
            "bboxes": [[0.1, 0.2, 0.8, 0.25]],
            "deep_link": "users/.../lec1.pdf#page=3",
            "quote": "Wave-particle duality is observed in all quantum entities.",
        }
    ]
    test_chunk_ids = ["src-uuid-1_p0003_c001", "src-uuid-1_p0003_c002"]

    msg = Message(
        id=str(uuid.uuid4()),
        notebook_id=nb_id,
        role="assistant",
        content="According to the lecture, wave-particle duality holds true [[cite:1]].",
        citations_json=json.dumps(test_citations),
        injected_chunk_ids_json=json.dumps(test_chunk_ids),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(msg)
    await db_session.commit()

    # 2. Retrieve history via root route
    res_root = await async_client.get(f"/notebooks/{nb_id}/messages", headers=auth_headers)
    assert res_root.status_code == 200
    msgs_root = res_root.json()
    assert len(msgs_root) >= 1
    found = next(m for m in msgs_root if m["id"] == msg.id)
    assert "citations" in found, "citations field missing from MessageRead"
    assert "injected_chunk_ids" in found, "injected_chunk_ids field missing from MessageRead"
    assert len(found["citations"]) == 1
    assert found["citations"][0]["quote"] == "Wave-particle duality is observed in all quantum entities."
    assert found["injected_chunk_ids"] == test_chunk_ids

    # 3. Retrieve history via /api route
    res_api = await async_client.get(f"/api/notebooks/{nb_id}/messages", headers=auth_headers)
    assert res_api.status_code == 200
    msgs_api = res_api.json()
    found_api = next(m for m in msgs_api if m["id"] == msg.id)
    assert found_api["citations"] == found["citations"]
    assert found_api["injected_chunk_ids"] == test_chunk_ids

    # 4. Anti-enumeration: User B accessing User A messages receives 404
    res_cross = await async_client.get(f"/notebooks/{nb_id}/messages", headers=auth_headers_b)
    assert res_cross.status_code == 404


# ==============================================================================
# 5. Account Deletion Sweeper Deferral Test
# ==============================================================================

@pytest.mark.asyncio
async def test_account_deletion_triggers_sweeper_deferral(
    async_client: AsyncClient,
    auth_headers: dict,
    db_session,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Verifies that DELETE /users/me and DELETE /api/users/me:
    1. Sets User.is_active = False.
    2. Marks all user notebooks and sources as status='deleting'.
    3. Triggers defer_cleanup_notebook for each of user's notebooks.
    4. Invalidates subsequent requests with 401.
    """
    # 1. Create a second notebook for User A to verify multiple deferrals
    nb2 = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Second Notebook",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(nb2)
    await db_session.commit()

    expected_notebook_ids = {user_a_notebook.id, nb2.id}

    # 2. Patch defer_cleanup_notebook to record invocations
    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        res = await async_client.delete("/users/me", headers=auth_headers)
        assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
        assert res.json()["status"] == "deleting"

        # Assert defer_cleanup_notebook was called for every notebook owned by User A
        deferred_nb_ids = {
            call.kwargs.get("notebook_id") or call.args[0]
            for call in mock_defer.call_args_list
        }
        assert expected_notebook_ids.issubset(deferred_nb_ids), (
            f"Expected {expected_notebook_ids} to be deferred, got {deferred_nb_ids}"
        )

    # 3. Assert database state
    db_session.expire_all()
    user_res = (await db_session.execute(select(User).where(User.id == user_a.id))).scalar_one()
    assert user_res.is_active is False

    nb_res = (await db_session.execute(select(Notebook).where(Notebook.user_id == user_a.id))).scalars().all()
    assert len(nb_res) >= 2
    assert all(nb.status == "deleting" for nb in nb_res)

    # 4. Subsequent requests with user token fail with 401
    res_subsequent = await async_client.get("/auth/me", headers=auth_headers)
    assert res_subsequent.status_code == 401


# ==============================================================================
# 6. Hardening & Adversarial Regression Guards (Iteration 2)
# ==============================================================================

@pytest.mark.asyncio
async def test_youtube_ingestion_hostile_protocols_and_boundaries(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Regression Guard: Verifies that hostile protocols (ftp, javascript, data),
    third-party domains embedding YouTube URLs, and oversized video IDs
    are strictly rejected with HTTP 400 Bad Request.
    """
    nb_id = user_a_notebook.id
    malicious_inputs = [
        "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
        "javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ",
        "data:text/html;youtube.com/watch?v=dQw4w9WgXcQ",
        "https://attacker.com/evil?q=youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=twelvechar12",
        "https://www.youtube.com/watch?v=" + "A" * 1000,
        "https://www.youtube.com/watch?not_v=dQw4w9WgXcQ",
    ]
    for bad_url in malicious_inputs:
        res = await async_client.post(
            f"/api/notebooks/{nb_id}/sources/youtube",
            json={"url": bad_url, "title": "Hostile Ingestion Probe"},
            headers=auth_headers,
        )
        assert res.status_code in (400, 422), (
            f"Vulnerability regression: bad URL accepted with {res.status_code}: {bad_url}"
        )


@pytest.mark.asyncio
async def test_session_resume_malformed_json_crash_resilience(
    async_client: AsyncClient,
    auth_headers: dict,
    db_session,
    user_a_notebook: Notebook,
):
    """
    Regression Guard: Verifies that corrupt or type-mismatched JSON in Message
    does NOT crash GET /notebooks/{id}/messages with HTTP 500.
    """
    nb_id = user_a_notebook.id
    corrupt_cases = [
        ("[{\"valid\": 1}]", "[1, 2, 3]"),
        ("[null, 42, \"str\"]", "[\"chunk_1\"]"),
        ("{\"dict_not_list\": true}", "[]"),
        ("12345", "12345"),
        ("{invalid json syntax", "{invalid json syntax"),
    ]
    for cit_json, chk_json in corrupt_cases:
        msg = Message(
            id=str(uuid.uuid4()),
            notebook_id=nb_id,
            role="assistant",
            content="Corrupted history test",
            citations_json=cit_json,
            injected_chunk_ids_json=chk_json,
            created_at=datetime.now(timezone.utc),
        )
        db_session.add(msg)
    await db_session.commit()

    res = await async_client.get(f"/api/notebooks/{nb_id}/messages", headers=auth_headers)
    assert res.status_code == 200, f"Session resume crashed with {res.status_code}: {res.text}"


@pytest.mark.asyncio
async def test_fuzz_trailing_slash_query_params_regression(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Regression Guard: Trailing slash with query parameters does not trigger 307.
    """
    nb_id = user_a_notebook.id
    for url in [
        f"/notebooks/{nb_id}/sources/?page=1&limit=10",
        f"/api/notebooks/{nb_id}/sources/?page=1&limit=10",
    ]:
        res = await async_client.get(url, headers=auth_headers)
        assert res.status_code == 200
        assert res.status_code not in (307, 308)
