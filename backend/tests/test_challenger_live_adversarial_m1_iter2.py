"""
Adversarial Stress & Boundary Challenge Suite for Milestone 1 Iteration 2 Gate
File: backend/tests/test_challenger_live_adversarial_m1_iter2.py
Role: Empirical Challenger 1

Adversarially probes:
1. YouTube URL Ingestion Deep Fuzzing:
   - Extreme hostile protocol schemes (ftp, javascript, data, file, blob, ws, gopher)
   - Domain spoofing, homoglyphs, and sub-path injection
   - Multiple parameter pollution (HPP) on 'v'
   - Non-standard path lengths for /shorts/, /embed/, /v/, and youtu.be
   - Strict 11-char regex boundary enforcement (length 10, 12, special symbols, control chars)
   - Legitimate uppercase and protocol-relative schemes
2. Session Resume Database Corruption & Drift Matrix:
   - Arbitrary corrupted combinations of citations_json and injected_chunk_ids_json
   - Mixed-type arrays (filtering non-dict citations and non-string chunk IDs)
   - Syntactically broken JSON and non-list structures
   - Verifying zero HTTP 500 errors and exact contract adherence
3. Cross-Tenant Anti-Enumeration & State Integrity:
   - User B accessing or creating YouTube sources in User A's notebook (must 404)
   - User B querying messages in User A's notebook (must 404)
"""

import json
import uuid
from datetime import datetime, timezone
import pytest
from httpx import AsyncClient

from app.models import Message, Notebook, Source, User


# ==============================================================================
# Suite 1: Deep YouTube URL Adversarial Fuzzing
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_youtube_hostile_schemes_deep(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Empirically probes exotic hostile protocol schemes.
    All must be rejected with 400 Bad Request or 422 Unprocessable Entity.
    """
    nb_id = user_a_notebook.id
    hostile_schemes = [
        "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
        "ftps://youtube.com/watch?v=dQw4w9WgXcQ",
        "javascript:alert(document.cookie)//youtube.com/watch?v=dQw4w9WgXcQ",
        "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==youtube.com/watch?v=dQw4w9WgXcQ",
        "file:///etc/passwd#youtube.com/watch?v=dQw4w9WgXcQ",
        "blob:https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "ws://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "wss://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "gopher://youtube.com/watch?v=dQw4w9WgXcQ",
        "view-source:https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "ldap://youtube.com/watch?v=dQw4w9WgXcQ",
    ]

    for bad_url in hostile_schemes:
        res = await async_client.post(
            f"/api/notebooks/{nb_id}/sources/youtube",
            json={"url": bad_url, "title": "Hostile Scheme Probe"},
            headers=auth_headers,
        )
        assert res.status_code in (400, 422), (
            f"Adversarial breach: Scheme allowed ({res.status_code}) for '{bad_url}'"
        )
        assert res.status_code != 500


@pytest.mark.asyncio
async def test_adversarial_youtube_domain_spoofing_and_homoglyphs(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Empirically probes subtle domain spoofing, subdomains, and foreign hosts.
    """
    nb_id = user_a_notebook.id
    spoofed_domains = [
        "https://youtube.com.attacker.com/watch?v=dQw4w9WgXcQ",
        "https://www.youtube.com.attacker.org/watch?v=dQw4w9WgXcQ",
        "https://evil-youtube.com/watch?v=dQw4w9WgXcQ",
        "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
        "https://attacker.com/embed/dQw4w9WgXcQ",
        "https://attacker.com?v=dQw4w9WgXcQ&url=youtube.com",
        "https://127.0.0.1/watch?v=dQw4w9WgXcQ",
        "https://localhost/watch?v=dQw4w9WgXcQ",
        "https://yоutube.com/watch?v=dQw4w9WgXcQ",  # Cyrillic 'о' homoglyph
    ]

    for bad_url in spoofed_domains:
        res = await async_client.post(
            f"/api/notebooks/{nb_id}/sources/youtube",
            json={"url": bad_url, "title": "Domain Spoofing Probe"},
            headers=auth_headers,
        )
        assert res.status_code in (400, 422), (
            f"Adversarial breach: Domain spoofing accepted ({res.status_code}) for '{bad_url}'"
        )


@pytest.mark.asyncio
async def test_adversarial_youtube_path_and_parameter_tampering(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Empirically probes HTTP parameter pollution (multiple 'v' params),
    path segment overflow, and path traversal attempts.
    """
    nb_id = user_a_notebook.id
    tampered_urls = [
        # Multiple conflicting 'v' parameters (HTTP parameter pollution)
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&v=another1234",
        "https://www.youtube.com/watch?v=firstID1234&v=dQw4w9WgXcQ",
        # Extra path segments
        "https://www.youtube.com/watch/extra?v=dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ/extra",
        "https://www.youtube.com/embed/dQw4w9WgXcQ/leak/test",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ/details",
        "https://youtu.be/dQw4w9WgXcQ/extra_segment",
        "https://youtu.be/../dQw4w9WgXcQ",
        # Video ID symbol corruption & boundaries
        "https://www.youtube.com/watch?v=dQw4w9WgXc!",  # 11 chars with '!'
        "https://www.youtube.com/watch?v=dQw4w9WgXc@",  # 11 chars with '@'
        "https://www.youtube.com/watch?v=dQw4w9WgXc#",  # 11 chars with '#'
        "https://www.youtube.com/watch?v=dQw4w9WgXc$",  # 11 chars with '$'
        "https://www.youtube.com/watch?v=dQw4w9WgXc ",  # trailing space
        "https://www.youtube.com/watch?v= dQw4w9WgXc",  # leading space
        "https://www.youtube.com/watch?v=1234567890",   # 10 chars
        "https://www.youtube.com/watch?v=123456789012", # 12 chars
        "https://youtu.be/1234567890",                  # 10 chars
        "https://youtu.be/123456789012",                # 12 chars
    ]

    for bad_url in tampered_urls:
        res = await async_client.post(
            f"/api/notebooks/{nb_id}/sources/youtube",
            json={"url": bad_url, "title": "Tampered URL Probe"},
            headers=auth_headers,
        )
        assert res.status_code in (400, 422), (
            f"Adversarial breach: Tampered URL accepted ({res.status_code}) for '{bad_url}'"
        )


@pytest.mark.asyncio
async def test_adversarial_youtube_legitimate_variants(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a_notebook: Notebook,
):
    """
    Verifies robust acceptance and normalization of legitimate variants:
    - Uppercase protocol & domain
    - Protocol-relative URLs
    - music.youtube.com, m.youtube.com
    - /shorts/ and /embed/
    """
    nb_id = user_a_notebook.id
    legit_variants = [
        "HTTPS://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ",
        "//www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ]

    canonical_expected = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

    for url in legit_variants:
        res = await async_client.post(
            f"/api/notebooks/{nb_id}/sources/youtube",
            json={"url": url, "title": "Legit Variant Probe"},
            headers=auth_headers,
        )
        assert res.status_code == 201, (
            f"Legitimate variant rejected ({res.status_code}): {url} -> {res.text}"
        )
        data = res.json()
        assert data["storage_key_or_url"] == canonical_expected
        assert data["source_type"] == "youtube"


# ==============================================================================
# Suite 2: Session Resume Corruption & Drift Resilience Matrix
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_session_resume_corruption_matrix(
    async_client: AsyncClient,
    auth_headers: dict,
    db_session,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Adversarially probes session resume under 10 diverse corruption scenarios:
    - Non-list primitives
    - Nested arrays and dicts
    - Mixed valid/invalid elements
    - None / NULL handling
    - Broken JSON syntax
    - Large corrupted payloads
    Asserts 100% zero HTTP 500 errors and strictly sanitized output types.
    """
    nb_id = user_a_notebook.id

    matrix = [
        # (citations_json, injected_chunk_ids_json, description)
        (None, None, "Both columns NULL"),
        ("", "", "Both columns empty string"),
        ("   ", "   ", "Both columns whitespace string"),
        ("true", "false", "Boolean literals in DB"),
        ("99999", "88888", "Integer literals in DB"),
        ("{\"key\": \"val\"}", "{\"chunk\": 1}", "JSON object instead of array"),
        ("{incomplete json...", "{another broken json", "Syntax errors"),
        ("[1, 2, \"not_a_dict\", null, false, {}]", "[100, 200, null, \"chunk_3\"]", "Mixed valid/invalid elements"),
        ("[[1, 2], [{\"nested\": 3}]]", "[[1, 2], {\"dict\": true}]", "Nested arrays"),
        (
            json.dumps([{"source_id": "src_1", "page": 1, "extra": "allowed"}] + ["corrupt_item"] * 50),
            json.dumps([1, 2, 3, "valid_chunk"] + [None] * 50),
            "Large array with majority corrupt entries",
        ),
    ]

    for cit_raw, chk_raw, desc in matrix:
        msg = Message(
            id=str(uuid.uuid4()),
            notebook_id=nb_id,
            role="assistant",
            content=f"Corruption probe: {desc}",
            citations_json=cit_raw,
            injected_chunk_ids_json=chk_raw,
            created_at=datetime.now(timezone.utc),
        )
        db_session.add(msg)
    await db_session.commit()

    # Query messages with trailing slash and query params
    res = await async_client.get(f"/api/notebooks/{nb_id}/messages/?limit=50", headers=auth_headers)
    assert res.status_code == 200, (
        f"CRITICAL VULNERABILITY: Session resume crashed ({res.status_code}) on corruption matrix! "
        f"Detail: {res.text}"
    )

    data = res.json()
    assert isinstance(data, list)
    assert len(data) >= len(matrix)

    for item in data:
        # Schema assertions: citations MUST be list of dicts, injected_chunk_ids MUST be list of strings
        assert isinstance(item["citations"], list), f"Expected list for citations, got {type(item['citations'])}"
        for c in item["citations"]:
            assert isinstance(c, dict), f"Found non-dict in citations: {c}"

        assert isinstance(item["injected_chunk_ids"], list), (
            f"Expected list for injected_chunk_ids, got {type(item['injected_chunk_ids'])}"
        )
        for chk in item["injected_chunk_ids"]:
            assert isinstance(chk, str), f"Found non-string in injected_chunk_ids: {chk}"


# ==============================================================================
# Suite 3: Multi-Tenant Anti-Enumeration & State Integrity
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_cross_tenant_isolation(
    async_client: AsyncClient,
    test_session_factory,
    test_settings,
    user_a_notebook: Notebook,
):
    """
    Verifies that User B cannot ingest YouTube sources into User A's notebook
    nor read User A's messages (SEC-05: 404 anti-enumeration).
    """
    from tests.conftest import create_token_for_user

    async with test_session_factory() as s:
        user_b = User(
            id=str(uuid.uuid4()),
            google_id="google-user-b",
            email="user_b@example.com",
            name="User B",
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        s.add(user_b)
        await s.commit()

    token_b = create_token_for_user(user_b.id, test_settings)
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # 1. User B attempts to POST YouTube source to User A's notebook
    res_post = await async_client.post(
        f"/api/notebooks/{user_a_notebook.id}/sources/youtube",
        json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "title": "Cross Tenant Ingest"},
        headers=headers_b,
    )
    assert res_post.status_code == 404, (
        f"Cross-tenant isolation failure: Expected 404, got {res_post.status_code}"
    )

    # 2. User B attempts to read User A's messages
    res_get = await async_client.get(
        f"/api/notebooks/{user_a_notebook.id}/messages",
        headers=headers_b,
    )
    assert res_get.status_code == 404, (
        f"Cross-tenant isolation failure: Expected 404, got {res_get.status_code}"
    )
