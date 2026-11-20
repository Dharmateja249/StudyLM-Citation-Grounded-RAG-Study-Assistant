"""
Milestone 1 Empirical Routing, Trailing Slash, Parity & Ingestion Fuzzing Suite
File: backend/tests/test_challenger_m1_retry_fuzz.py
Role: Empirical Challenger 1 (Milestone 1 Retry)

Empirically verifies:
1. Trailing slash permutations across all HTTP methods (GET, POST, PATCH, DELETE).
2. Query parameters on trailing vs non-trailing slash endpoints.
3. Universal /api route parity across all resource endpoints.
4. YouTube ingestion edge cases:
   - Legitimate URL permutations.
   - Non-YouTube domains & invalid video ID lengths (400 Bad Request).
   - Adversarial URL protocol spoofing & embedded URL attacks (ftp://, javascript:, attacker.com).
   - Title fuzzing (XSS, SQL payloads, Unicode/emoji, fallbacks).
   - 20-source quota and deleting notebook guards.
5. Session resume citation & chunk ID deserialization crash resilience:
   - Valid citation serialization.
   - Corrupt / non-dict / non-string JSON data crash resistance (asserts zero 500 errors).
6. Account deletion edge cases.
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
# Suite 1: Trailing Slash Permutations & HTTP Method Matrix
# ==============================================================================

@pytest.mark.asyncio
async def test_fuzz_trailing_slash_matrix_all_methods(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
    user_a_source: Source,
):
    """
    Empirically verifies that trailing slashes do NOT trigger HTTP 307/308 redirects
    or HTTP 405 Method Not Allowed across all core endpoints and methods.
    """
    nb_id = user_a_notebook.id
    src_id = user_a_source.id

    probe_matrix = [
        # Auth / User endpoints
        ("GET", "/auth/me", 200, None),
        ("GET", "/auth/me/", 200, None),
        ("GET", "/api/auth/me", 200, None),
        ("GET", "/api/auth/me/", 200, None),

        # Notebook list & create
        ("GET", "/notebooks", 200, None),
        ("GET", "/notebooks/", 200, None),
        ("GET", "/api/notebooks", 200, None),
        ("GET", "/api/notebooks/", 200, None),

        # Notebook detail & update
        ("GET", f"/notebooks/{nb_id}", 200, None),
        ("GET", f"/notebooks/{nb_id}/", 200, None),
        ("GET", f"/api/notebooks/{nb_id}", 200, None),
        ("GET", f"/api/notebooks/{nb_id}/", 200, None),
        ("PATCH", f"/notebooks/{nb_id}", 200, {"title": "Updated Title A"}),
        ("PATCH", f"/notebooks/{nb_id}/", 200, {"title": "Updated Title B"}),
        ("PATCH", f"/api/notebooks/{nb_id}", 200, {"title": "Updated Title C"}),
        ("PATCH", f"/api/notebooks/{nb_id}/", 200, {"title": "Updated Title D"}),

        # Notebook sources listing
        ("GET", f"/notebooks/{nb_id}/sources", 200, None),
        ("GET", f"/notebooks/{nb_id}/sources/", 200, None),
        ("GET", f"/api/notebooks/{nb_id}/sources", 200, None),
        ("GET", f"/api/notebooks/{nb_id}/sources/", 200, None),

        # Notebook messages
        ("GET", f"/notebooks/{nb_id}/messages", 200, None),
        ("GET", f"/notebooks/{nb_id}/messages/", 200, None),
        ("GET", f"/api/notebooks/{nb_id}/messages", 200, None),
        ("GET", f"/api/notebooks/{nb_id}/messages/", 200, None),
        ("POST", f"/notebooks/{nb_id}/messages", 201, {"role": "user", "content": "Hello A"}),
        ("POST", f"/notebooks/{nb_id}/messages/", 201, {"role": "user", "content": "Hello B"}),
        ("POST", f"/api/notebooks/{nb_id}/messages", 201, {"role": "user", "content": "Hello C"}),
        ("POST", f"/api/notebooks/{nb_id}/messages/", 201, {"role": "user", "content": "Hello D"}),

        # YouTube source creation
        ("POST", f"/notebooks/{nb_id}/sources/youtube", 201, {"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Vid 1"}),
        ("POST", f"/notebooks/{nb_id}/sources/youtube/", 201, {"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Vid 2"}),
        ("POST", f"/api/notebooks/{nb_id}/sources/youtube", 201, {"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Vid 3"}),
        ("POST", f"/api/notebooks/{nb_id}/sources/youtube/", 201, {"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Vid 4"}),

        # Source detail & presigned-url
        ("GET", f"/sources/{src_id}", 200, None),
        ("GET", f"/sources/{src_id}/", 200, None),
        ("GET", f"/api/sources/{src_id}", 200, None),
        ("GET", f"/api/sources/{src_id}/", 200, None),
        ("GET", f"/sources/{src_id}/presigned-url", 200, None),
        ("GET", f"/sources/{src_id}/presigned-url/", 200, None),
        ("GET", f"/api/sources/{src_id}/presigned-url", 200, None),
        ("GET", f"/api/sources/{src_id}/presigned-url/", 200, None),
    ]

    for method, url, expected_status, payload in probe_matrix:
        kwargs = {"headers": auth_headers}
        if payload is not None:
            kwargs["json"] = payload

        res = await async_client.request(method, url, **kwargs)

        assert res.status_code != 307, (
            f"Adversarial Failure: HTTP 307 Temporary Redirect returned for {method} {url}!"
        )
        assert res.status_code != 308, (
            f"Adversarial Failure: HTTP 308 Permanent Redirect returned for {method} {url}!"
        )
        assert res.status_code != 405, (
            f"Adversarial Failure: HTTP 405 Method Not Allowed returned for {method} {url}!"
        )
        assert res.status_code == expected_status, (
            f"Failed on {method} {url}: expected {expected_status}, got {res.status_code} ({res.text})"
        )


@pytest.mark.asyncio
async def test_fuzz_trailing_slash_with_query_parameters(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Adversarially probes trailing slash interactions with query string parameters.
    Query parameters must not cause 307 redirects or route matching breaks.
    """
    nb_id = user_a_notebook.id

    query_variants = [
        f"/notebooks/{nb_id}/sources?page=1&limit=10",
        f"/notebooks/{nb_id}/sources/?page=1&limit=10",
        f"/api/notebooks/{nb_id}/sources?page=1&limit=10",
        f"/api/notebooks/{nb_id}/sources/?page=1&limit=10",
        f"/notebooks/{nb_id}/sources?search=quantum&active=true",
        f"/notebooks/{nb_id}/sources/?search=quantum&active=true",
        f"/api/notebooks/{nb_id}/sources?search=quantum&active=true",
        f"/api/notebooks/{nb_id}/sources/?search=quantum&active=true",
    ]

    for url in query_variants:
        res = await async_client.get(url, headers=auth_headers)
        assert res.status_code == 200, (
            f"Query param probe failed on {url}: expected 200, got {res.status_code} ({res.text})"
        )
        assert res.status_code not in (307, 308), f"Redirect returned for {url}"


# ==============================================================================
# Suite 2: Universal /api Parity Verification
# ==============================================================================

@pytest.mark.asyncio
async def test_universal_api_parity_full_contract(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
    user_a_source: Source,
):
    """
    Verifies 100% contract parity between root endpoints and /api prefixed endpoints:
    Status codes, schemas, data content, and error states.
    """
    nb_id = user_a_notebook.id
    src_id = user_a_source.id

    # 1. GET /auth/me vs GET /api/auth/me
    res_root = await async_client.get("/auth/me", headers=auth_headers)
    res_api = await async_client.get("/api/auth/me", headers=auth_headers)
    assert res_root.status_code == 200
    assert res_api.status_code == 200
    assert res_root.json() == res_api.json()

    # 2. GET /notebooks vs GET /api/notebooks
    res_nb_root = await async_client.get("/notebooks", headers=auth_headers)
    res_nb_api = await async_client.get("/api/notebooks", headers=auth_headers)
    assert res_nb_root.status_code == 200
    assert res_nb_api.status_code == 200
    assert len(res_nb_root.json()) == len(res_nb_api.json())

    # 3. GET /notebooks/{id}/sources vs GET /api/notebooks/{id}/sources
    res_src_root = await async_client.get(f"/notebooks/{nb_id}/sources", headers=auth_headers)
    res_src_api = await async_client.get(f"/api/notebooks/{nb_id}/sources", headers=auth_headers)
    assert res_src_root.status_code == 200
    assert res_src_api.status_code == 200
    assert len(res_src_root.json()) == len(res_src_api.json())

    # 4. GET /sources/{id} vs GET /api/sources/{id}
    res_s_root = await async_client.get(f"/sources/{src_id}", headers=auth_headers)
    res_s_api = await async_client.get(f"/api/sources/{src_id}", headers=auth_headers)
    assert res_s_root.status_code == 200
    assert res_s_api.status_code == 200
    assert res_s_root.json()["id"] == res_s_api.json()["id"]

    # 5. Unauthenticated rejection parity (401)
    res_unauth_root = await async_client.get(f"/notebooks/{nb_id}")
    res_unauth_api = await async_client.get(f"/api/notebooks/{nb_id}")
    assert res_unauth_root.status_code == 401
    assert res_unauth_api.status_code == 401

    # 6. Nonexistent endpoint parity (404, not 500)
    res_nonexist_root = await async_client.get("/nonexistent-endpoint-xyz", headers=auth_headers)
    res_nonexist_api = await async_client.get("/api/nonexistent-endpoint-xyz", headers=auth_headers)
    assert res_nonexist_root.status_code == 404
    assert res_nonexist_api.status_code == 404


# ==============================================================================
# Suite 3: YouTube Ingestion Fuzzing & Malicious Inputs
# ==============================================================================

@pytest.mark.asyncio
async def test_fuzz_youtube_valid_url_permutations(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Tests diverse legitimate YouTube URL formats, verifying canonical normalization.
    """
    nb_id = user_a_notebook.id
    canonical_expected = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    valid_url_formats = [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "http://youtu.be/dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "https://youtube.com/v/dQw4w9WgXcQ",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=45s",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOdP_8GztsuKi9nrraNbKKp4",
        "https://youtu.be/dQw4w9WgXcQ?t=1m30s",
    ]

    for url in valid_url_formats:
        res = await async_client.post(
            f"/api/notebooks/{nb_id}/sources/youtube",
            json={"url": url, "title": "Permutation Test"},
            headers=auth_headers,
        )
        assert res.status_code == 201, f"Valid format rejected ({res.status_code}): {url} -> {res.text}"
        data = res.json()
        assert data["storage_key_or_url"] == canonical_expected, (
            f"Expected canonical URL {canonical_expected}, got {data['storage_key_or_url']}"
        )
        assert data["source_type"] == "youtube"
        assert data["status"] == "processing"


@pytest.mark.asyncio
async def test_fuzz_youtube_malformed_and_foreign_domains(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Verifies that malformed URLs, foreign video domains, and boundary video ID lengths
    are correctly rejected with 400 Bad Request.
    """
    nb_id = user_a_notebook.id

    malformed_inputs = [
        "https://vimeo.com/76979871",
        "https://dailymotion.com/video/x7tgad0",
        "https://tiktok.com/@user/video/1234567890",
        "https://www.youtube.com/watch?v=",                 # Missing ID
        "https://www.youtube.com/watch?v=short",            # 5 chars
        "https://www.youtube.com/watch?v=tenchar123",       # 10 chars
        "https://www.youtube.com/watch?v=twelvechar12",     # 12 chars
        "https://youtu.be/",                                # Missing short ID
        "https://youtu.be/tooShort",                        # 8 chars
        "not_a_url_at_all",
        "http://",
        "https://youtube.com",
        "   ",
        "https://www.youtube.com/watch?not_v=dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=" + "A" * 50000,   # Oversized ID
    ]

    for bad_url in malformed_inputs:
        res = await async_client.post(
            f"/api/notebooks/{nb_id}/sources/youtube",
            json={"url": bad_url, "title": "Malformed Probe"},
            headers=auth_headers,
        )
        assert res.status_code in (400, 422), (
            f"Expected 400/422 for malformed URL, got {res.status_code}: {bad_url[:50]}"
        )
        assert res.status_code != 500, f"500 triggered by: {bad_url[:50]}"


@pytest.mark.asyncio
async def test_fuzz_youtube_protocol_and_embedded_url_injection(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    ADVERSARIAL VULNERABILITY PROBE:
    Tests whether arbitrary protocol schemes (ftp://, javascript:, data:)
    or URLs embedding youtube.com in query strings are rejected with 400 Bad Request.
    
    Current Bug: YOUTUBE_URL_REGEX.search() accepts any protocol prefix or arbitrary
    host containing youtube.com/watch?v=... anywhere in the string, returning 201 Created!
    """
    nb_id = user_a_notebook.id

    hostile_protocol_inputs = [
        "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
        "javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ",
        "data:text/html;youtube.com/watch?v=dQw4w9WgXcQ",
        "https://attacker.com/evil?q=youtube.com/watch?v=dQw4w9WgXcQ",
    ]

    for bad_url in hostile_protocol_inputs:
        res = await async_client.post(
            f"/api/notebooks/{nb_id}/sources/youtube",
            json={"url": bad_url, "title": "Hostile Protocol Ingestion Probe"},
            headers=auth_headers,
        )
        # Empirical Assertion: Hostile protocols and foreign domains must be rejected with 400 Bad Request
        assert res.status_code in (400, 422), (
            f"VULNERABILITY: Hostile protocol or embedded URL accepted as valid YouTube source! "
            f"Got HTTP {res.status_code} for input: {bad_url}"
        )


@pytest.mark.asyncio
async def test_fuzz_youtube_titles_and_fallbacks(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Stress tests title inputs for YouTube ingestion:
    - Hostile XSS tags
    - Unicode, right-to-left, emojis
    - Massive 4000-char titles
    - Missing / empty / whitespace titles (falls back to default title)
    """
    nb_id = user_a_notebook.id
    valid_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    title_probes = [
        ("<script>alert('XSS')</script>", "<script>alert('XSS')</script>"),
        ("'; DROP TABLE source; --", "'; DROP TABLE source; --"),
        ("🎓 Quantum Computing & ML 🧠: 日本語, العربية \u202eRTL", "🎓 Quantum Computing & ML 🧠: 日本語, العربية \u202eRTL"),
        ("A" * 4000, "A" * 4000),
        ("", "YouTube Video dQw4w9WgXcQ"),          # Empty string -> fallback
        ("   ", "YouTube Video dQw4w9WgXcQ"),       # Whitespace -> fallback
        (None, "YouTube Video dQw4w9WgXcQ"),        # None -> fallback
    ]

    for title_input, expected_title_content in title_probes:
        payload = {"url": valid_url}
        if title_input is not None:
            payload["title"] = title_input

        res = await async_client.post(
            f"/notebooks/{nb_id}/sources/youtube",
            json=payload,
            headers=auth_headers,
        )
        assert res.status_code == 201, f"Failed on title probe: {title_input} -> {res.text}"
        data = res.json()
        assert data["title"] == expected_title_content


@pytest.mark.asyncio
async def test_youtube_ingestion_quota_and_state_guards(
    async_client: AsyncClient,
    auth_headers: dict,
    db_session,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Verifies that YouTube ingestion respects:
    1. 20-source quota guard (HTTP 400).
    2. Deleting notebook guard (HTTP 409).
    """
    nb_id = user_a_notebook.id

    # 1. Fill notebook to 20 sources
    sources = [
        Source(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            notebook_id=nb_id,
            title=f"Source {i}",
            source_type="pdf",
            storage_key_or_url=f"users/{user_a.id}/s{i}.pdf",
            status="ready",
        )
        for i in range(20)
    ]
    db_session.add_all(sources)
    await db_session.commit()

    # Ingestion attempt #21 must fail with 400
    res_quota = await async_client.post(
        f"/notebooks/{nb_id}/sources/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Quota Breaker"},
        headers=auth_headers,
    )
    assert res_quota.status_code == 400, f"Expected 400 quota limit, got {res_quota.status_code}"
    assert "limit reached" in res_quota.json()["detail"].lower()

    # 2. Deleting notebook guard: create a deleting notebook
    deleting_nb = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Deleting Notebook",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(deleting_nb)
    await db_session.commit()

    res_del = await async_client.post(
        f"/notebooks/{deleting_nb.id}/sources/youtube",
        json={"url": "https://youtu.be/dQw4w9WgXcQ", "title": "Post into Deleting"},
        headers=auth_headers,
    )
    assert res_del.status_code == 409, f"Expected 409 Conflict, got {res_del.status_code}"


# ==============================================================================
# Suite 4: Session Resume Citation & Chunk ID Deserialization Resilience
# ==============================================================================

@pytest.mark.asyncio
async def test_session_resume_valid_citations_persistence(
    async_client: AsyncClient,
    auth_headers: dict,
    db_session,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Verifies that well-formed citations and chunk IDs serialize properly on /messages.
    """
    nb_id = user_a_notebook.id
    valid_citations = [
        {"source_id": "src-1", "page": 1, "snippet": "Newton's second law", "bbox": [0.1, 0.2, 0.3, 0.4]},
        {"source_id": "src-2", "page": 3, "snippet": "Conservation of energy"},
    ]
    valid_chunks = ["chunk_001", "chunk_002"]

    msg = Message(
        id=str(uuid.uuid4()),
        notebook_id=nb_id,
        role="assistant",
        content="Here is physics explanation [[cite:1]].",
        citations_json=json.dumps(valid_citations),
        injected_chunk_ids_json=json.dumps(valid_chunks),
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(msg)
    await db_session.commit()

    res = await async_client.get(f"/api/notebooks/{nb_id}/messages", headers=auth_headers)
    assert res.status_code == 200
    messages = res.json()
    assert len(messages) >= 1
    target = next(m for m in messages if m["id"] == msg.id)
    assert target["citations"] == valid_citations
    assert target["injected_chunk_ids"] == valid_chunks


@pytest.mark.asyncio
async def test_session_resume_corrupt_citations_and_chunk_ids_crash_resilience(
    async_client: AsyncClient,
    auth_headers: dict,
    db_session,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    ADVERSARIAL CRASH RESILIENCE PROBE:
    Empirically tests that corrupt, malformed, non-list, or type-mismatched JSON in
    Message.citations_json or Message.injected_chunk_ids_json does NOT crash the API
    with HTTP 500 Internal Server Error when querying conversation history.
    
    Current Bug: Message.citations and Message.injected_chunk_ids properties do not
    sanitize or type-assert elements before returning. When MessageRead validates
    citations: Optional[List[dict]] and injected_chunk_ids: Optional[List[str]],
    pydantic ValidationError is raised unhandled, crashing GET /messages with HTTP 500!
    """
    nb_id = user_a_notebook.id

    corrupt_entries = [
        ("[{\"valid\": 1}]", "[1, 2, 3]", "Non-string integer chunk IDs in JSON array"),
        ("[null, 42, \"not_a_dict\"]", "[\"chunk_1\"]", "Non-dict items in citations JSON array"),
        ("{\"dict_instead_of_list\": true}", "[]", "Dict instead of list for citations_json"),
        ("12345", "12345", "Primitives instead of list"),
        ("{broken json syntax", "{broken json syntax", "Syntax error in JSON"),
    ]

    for bad_cit, bad_chk, desc in corrupt_entries:
        msg = Message(
            id=str(uuid.uuid4()),
            notebook_id=nb_id,
            role="assistant",
            content=f"Corrupt test: {desc}",
            citations_json=bad_cit,
            injected_chunk_ids_json=bad_chk,
            created_at=datetime.now(timezone.utc),
        )
        db_session.add(msg)
    await db_session.commit()

    # Empirical Assertion: Endpoint must return 200 OK and not crash with 500 Internal Server Error
    res = await async_client.get(f"/api/notebooks/{nb_id}/messages", headers=auth_headers)
    assert res.status_code == 200, (
        f"CRITICAL VULNERABILITY: GET /notebooks/{nb_id}/messages crashed with HTTP {res.status_code}! "
        f"Detail: {res.text}"
    )


# ==============================================================================
# Suite 5: Account Deletion Edge Cases
# ==============================================================================

@pytest.mark.asyncio
async def test_account_deletion_with_zero_notebooks(
    async_client: AsyncClient,
    test_session_factory,
    test_settings,
):
    """
    Tests DELETE /api/users/me when user has zero notebooks.
    Must succeed cleanly without crashing.
    """
    from tests.conftest import create_token_for_user

    async with test_session_factory() as s:
        empty_user = User(
            id=str(uuid.uuid4()),
            google_id="google-empty-user",
            email="empty_user@example.com",
            name="Empty User",
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        s.add(empty_user)
        await s.commit()

    token = create_token_for_user(empty_user.id, test_settings)
    headers = {"Authorization": f"Bearer {token}"}

    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        res = await async_client.delete("/api/users/me/", headers=headers)
        assert res.status_code == 200, f"Expected 200 on /api/users/me/, got {res.status_code}"
        assert res.json()["status"] == "deleting"
        mock_defer.assert_not_called()
