"""
Challenger 1: Live External Services Adversarial & Stress Verification Suite.
File: backend/tests/test_challenger_live_adversarial.py

Adversarially probes live external cloud services:
1. Neon PostgreSQL: Transaction rollback semantics and SQL injection defense under parameterized queries.
2. Qdrant Cloud: Multi-tenant vector search isolation and negative filter bounds.
3. Google Gemini AI: Strict 768-d embedding dimension, Euclidean norm magnitude ~1.0, and complex prompt synthesis.
4. Supabase S3: Nonexistent key NoSuchKey handling and binary upload checksum (MD5 & SHA256) bitwise fidelity.
5. Immediate Abort Protocol: Validating that invalid credentials trigger immediate, unswallowed exceptions.
"""

import hashlib
import math
import os
import uuid
import pytest
import psycopg
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from google import genai
from google.genai.errors import APIError
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from qdrant_client.http.exceptions import ResponseHandlingException, UnexpectedResponse

from app.config import get_settings


@pytest.fixture(scope="module")
def live_settings():
    """Retrieves live application settings from root .env and asserts non-mock."""
    settings = get_settings()
    assert "mock" not in settings.DATABASE_URL.lower(), "DATABASE_URL contains mock value"
    assert "mock" not in settings.R2_ACCESS_KEY_ID.lower(), "R2_ACCESS_KEY_ID contains mock value"
    assert settings.QDRANT_API_KEY and "mock" not in settings.QDRANT_API_KEY.lower(), "QDRANT_API_KEY contains mock value"
    assert "mock" not in settings.GEMINI_API_KEY.lower(), "GEMINI_API_KEY contains mock value"
    return settings


@pytest.mark.live
def test_neon_live_rollback_behavior(live_settings):
    """
    Adversarial Challenge: Verify that transactions rolling back due to manual abort or
    unhandled errors do NOT persist dirty data in live Neon PostgreSQL.
    """
    test_id = f"challenger-rollback-{uuid.uuid4().hex[:12]}"
    test_email = f"{test_id}@example.com"
    test_google_id = f"google-{test_id}"

    # Connect to live Neon
    with psycopg.connect(live_settings.DATABASE_URL) as conn:
        with conn.cursor() as cur:
            # 1. Start transaction and insert row
            cur.execute(
                'INSERT INTO "user" (id, google_id, email, name, is_active, created_at) '
                'VALUES (%s, %s, %s, %s, TRUE, NOW());',
                (test_id, test_google_id, test_email, "Rollback Test User"),
            )
            # Verify visible within the same uncommitted transaction
            cur.execute('SELECT count(*) FROM "user" WHERE id = %s;', (test_id,))
            assert cur.fetchone()[0] == 1, "Row should be visible in current transaction before rollback"

            # 2. Trigger rollback
            conn.rollback()

    # 3. Open a fresh connection and verify dirty read did not occur
    with psycopg.connect(live_settings.DATABASE_URL) as verify_conn:
        with verify_conn.cursor() as verify_cur:
            verify_cur.execute('SELECT count(*) FROM "user" WHERE id = %s;', (test_id,))
            assert verify_cur.fetchone()[0] == 0, "Dirty read failure: rolled-back record persisted in Neon DB!"


@pytest.mark.live
def test_neon_live_sql_injection_defense(live_settings):
    """
    Adversarial Challenge: Verify parameterized query defense on live Neon.
    Attacks include classic tautology injections, semicolon statements, and table dropping attempts.
    """
    run_tag = uuid.uuid4().hex[:8]
    injection_payloads = [
        ("inj-1", "' OR '1'='1", f"normal-{run_tag}@example.com"),
        ("inj-2", "evil-id", f"victim-{run_tag}@example.com'; DROP TABLE dummy_nonexistent; --"),
        ("inj-3", "Robert'); DROP TABLE \"user\";--", f"bobby.tables-{run_tag}@example.com"),
        ("inj-4", "admin'--", f"admin_probe-{run_tag}@example.com"),
    ]

    inserted_ids = []

    with psycopg.connect(live_settings.DATABASE_URL) as conn:
        with conn.cursor() as cur:
            try:
                for suffix, attack_id, attack_email in injection_payloads:
                    full_id = f"challenger-{suffix}-{run_tag}-{attack_id}"
                    name = f"Injected User {suffix}"

                    # Insert parameterized
                    cur.execute(
                        'INSERT INTO "user" (id, google_id, email, name, is_active, created_at) '
                        'VALUES (%s, %s, %s, %s, TRUE, NOW());',
                        (full_id, f"google-{suffix}-{run_tag}", attack_email, name),
                    )
                    inserted_ids.append(full_id)

                conn.commit()

                # Verify each attack string was stored as literal text without executing SQL syntax
                for full_id in inserted_ids:
                    cur.execute('SELECT id, name FROM "user" WHERE id = %s;', (full_id,))
                    row = cur.fetchone()
                    assert row is not None, f"Failed to retrieve record with attack payload ID: {full_id}"
                    assert row[0] == full_id

                # Tautology attack query check: searching with "' OR '1'='1" must NOT return all users
                cur.execute('SELECT count(*) FROM "user" WHERE id = %s;', ("' OR '1'='1",))
                tautology_count = cur.fetchone()[0]
                assert tautology_count == 0, "SQL Injection flaw: tautology query matched records!"

                # Confirm schema integrity: "user" and other tables still exist
                cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_name='user';")
                assert cur.fetchone()[0] == 1, "Critical: 'user' table was damaged by injection test!"

            finally:
                # Cleanup
                for full_id in inserted_ids:
                    cur.execute('DELETE FROM "user" WHERE id = %s;', (full_id,))
                conn.commit()


@pytest.mark.live
def test_qdrant_live_multi_tenant_isolation(live_settings):
    """
    Adversarial Challenge: Verify that Qdrant Cloud strictly isolates tenant vector spaces.
    A vector query for Tenant A must NEVER return points belonging to Tenant B,
    even when vector distance is near-zero (identical semantic embeddings).
    """
    client = QdrantClient(url=live_settings.QDRANT_URL, api_key=live_settings.QDRANT_API_KEY, timeout=15)
    collection_name = live_settings.QDRANT_COLLECTION_NAME

    # Unique tenant IDs
    run_id = uuid.uuid4().hex[:8]
    tenant_A = f"challenger-tenant-A-{run_id}"
    tenant_B = f"challenger-tenant-B-{run_id}"

    point_id_A = int(uuid.uuid4().hex[:15], 16)
    point_id_B = int(uuid.uuid4().hex[:15], 16)

    # Identical normalized test vector (to maximize cross-tenant collision risk if filter fails)
    raw_vec = [math.sin(i * 0.05) for i in range(768)]
    norm = math.sqrt(sum(x * x for x in raw_vec))
    test_vector = [x / norm for x in raw_vec]

    # Payload for Tenant A
    payload_A = {
        "user_id": tenant_A,
        "notebook_id": f"nb-A-{run_id}",
        "source_id": f"src-A-{run_id}",
        "text": "Confidential Study Notes of Tenant A regarding Advanced Cryptography.",
        "classified": True,
    }

    # Payload for Tenant B
    payload_B = {
        "user_id": tenant_B,
        "notebook_id": f"nb-B-{run_id}",
        "source_id": f"src-B-{run_id}",
        "text": "Confidential Study Notes of Tenant B regarding Quantum Computing.",
        "classified": True,
    }

    try:
        # Upsert both points to the live collection
        points = [
            qmodels.PointStruct(id=point_id_A, vector=test_vector, payload=payload_A),
            qmodels.PointStruct(id=point_id_B, vector=test_vector, payload=payload_B),
        ]
        op = client.upsert(collection_name=collection_name, points=points, wait=True)
        assert op.status == qmodels.UpdateStatus.COMPLETED

        # 1. Query with Tenant A Filter
        filter_A = qmodels.Filter(
            must=[qmodels.FieldCondition(key="user_id", match=qmodels.MatchValue(value=tenant_A))]
        )
        res_A = client.query_points(
            collection_name=collection_name,
            query=test_vector,
            query_filter=filter_A,
            limit=10,
            with_payload=True,
        )
        hits_A = res_A.points

        # Assert Tenant A retrieval properties
        assert len(hits_A) >= 1, "Tenant A failed to retrieve its own point"
        retrieved_ids_A = [h.id for h in hits_A]
        assert point_id_A in retrieved_ids_A, "Tenant A point missing from Tenant A query"
        assert point_id_B not in retrieved_ids_A, "CRITICAL: Cross-tenant data leak! Tenant B point retrieved in Tenant A query!"
        for hit in hits_A:
            assert hit.payload["user_id"] == tenant_A, f"Cross-tenant pollution: found user_id {hit.payload['user_id']}"

        # 2. Query with Tenant B Filter
        filter_B = qmodels.Filter(
            must=[qmodels.FieldCondition(key="user_id", match=qmodels.MatchValue(value=tenant_B))]
        )
        res_B = client.query_points(
            collection_name=collection_name,
            query=test_vector,
            query_filter=filter_B,
            limit=10,
            with_payload=True,
        )
        hits_B = res_B.points

        # Assert Tenant B retrieval properties
        assert len(hits_B) >= 1, "Tenant B failed to retrieve its own point"
        retrieved_ids_B = [h.id for h in hits_B]
        assert point_id_B in retrieved_ids_B, "Tenant B point missing from Tenant B query"
        assert point_id_A not in retrieved_ids_B, "CRITICAL: Cross-tenant data leak! Tenant A point retrieved in Tenant B query!"
        for hit in hits_B:
            assert hit.payload["user_id"] == tenant_B, f"Cross-tenant pollution: found user_id {hit.payload['user_id']}"

        # 3. Query with Nonexistent Tenant C Filter
        filter_C = qmodels.Filter(
            must=[qmodels.FieldCondition(key="user_id", match=qmodels.MatchValue(value=f"nonexistent-{run_id}"))]
        )
        res_C = client.query_points(
            collection_name=collection_name,
            query=test_vector,
            query_filter=filter_C,
            limit=10,
        )
        assert len(res_C.points) == 0, f"Expected 0 results for nonexistent tenant, got {len(res_C.points)}"

    finally:
        # Cleanup
        client.delete(
            collection_name=collection_name,
            points_selector=qmodels.PointIdsList(points=[point_id_A, point_id_B]),
            wait=True,
        )
        # Verify removal
        post_del = client.retrieve(collection_name=collection_name, ids=[point_id_A, point_id_B])
        assert len(post_del) == 0, "Failed to clean up test points from Qdrant Cloud"


@pytest.mark.live
def test_gemini_live_embedding_dimension_and_norm(live_settings):
    """
    Adversarial Challenge: Verify that Google Gemini embedding service produces
    strictly 768-dimensional normalized vectors (magnitude ~ 1.0) across varied texts:
    - empty/minimal string
    - academic literature
    - mathematical formulas and unicode symbols
    """
    client = genai.Client(api_key=live_settings.GEMINI_API_KEY)

    test_samples = [
        "Minimal input test.",
        "The Schrödinger equation describes the wave function of a quantum-mechanical system: i*hbar*d/dt|psi> = H|psi>.",
        "Συνάρτηση κύματος και κβαντική μηχανική. ∮ E · dA = Q_encl / ε_0.",
        "Long technical text: " + ("Vector spaces over finite fields exhibit modular arithmetic properties. " * 10),
    ]

    for sample in test_samples:
        response = client.models.embed_content(
            model=live_settings.GEMINI_EMBEDDING_MODEL,
            contents=sample,
            config={"output_dimensionality": live_settings.EMBEDDING_DIMENSION},
        )
        assert response.embeddings, "Gemini returned empty embedding response"
        values = response.embeddings[0].values

        # 1. Dimension must strictly equal 768
        assert len(values) == 768, f"Dimension mismatch: expected 768, got {len(values)}"

        # 2. Values must be non-trivial floats (not all zero, no NaN, no Inf)
        for v in values:
            assert not math.isnan(v), "Embedding vector contains NaN"
            assert not math.isinf(v), "Embedding vector contains Inf"
        assert any(v != 0.0 for v in values), "Embedding vector is all zeroes"

        # 3. Normalized vector Euclidean norm must be ~1.0
        norm = math.sqrt(sum(v * v for v in values))
        assert 0.95 <= norm <= 1.05, f"Vector Euclidean norm out of expected unit range: {norm}"


@pytest.mark.live
def test_gemini_live_complex_synthesis(live_settings):
    """
    Adversarial Challenge: Verify that Google Gemini text generation
    can solve a multi-constraint reasoning task cleanly without hallucination or error.
    Tests primary model and respects configured fallback models if Free Tier per-model daily quota is saturated.
    """
    client = genai.Client(api_key=live_settings.GEMINI_API_KEY)

    prompt = (
        "Task: Explain distributed consensus in the Raft algorithm under three strict constraints:\n"
        "1. Use an analogy of a student study group electing a class leader.\n"
        "2. Mention leader election, log replication, and heartbeats.\n"
        "3. Provide the output in strictly under 50 words.\n"
        "Output explanation only:"
    )

    models_to_try = [live_settings.GEMINI_GENERATION_MODEL, "gemini-3.5-flash-lite", "gemini-flash-lite-latest"]
    response = None
    last_error = None

    for model_name in models_to_try:
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
            )
            if response and response.text:
                break
        except Exception as e:
            last_error = e
            if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                continue
            raise

    if not response or not response.text:
        raise AssertionError(f"All generation models failed or exhausted quota: {last_error}")

    text = response.text.strip()
    word_count = len(text.split())

    # Verify quality and domain content
    assert word_count > 5, "Response is unnaturally truncated"
    lower_text = text.lower()
    assert "leader" in lower_text or "elect" in lower_text, "Missing leader concept"
    assert "heartbeat" in lower_text or "log" in lower_text or "note" in lower_text, "Missing Raft mechanism concept"


@pytest.mark.live
def test_supabase_s3_live_nonexistent_key_error(live_settings):
    """
    Adversarial Challenge: Verify that requesting nonexistent keys on live Supabase S3
    raises NoSuchKey ClientError rather than silently returning empty bodies or crashing.
    """
    s3_cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=10.0)
    s3 = boto3.client(
        "s3",
        endpoint_url=live_settings.R2_ENDPOINT_URL,
        aws_access_key_id=live_settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=live_settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=s3_cfg,
    )
    bucket = live_settings.R2_BUCKET_NAME

    nonexistent_key = f"challenger-adversarial-tests/nonexistent-key-{uuid.uuid4().hex}.bin"

    # 1. get_object should raise NoSuchKey or 404 ClientError
    with pytest.raises(ClientError) as exc_info:
        s3.get_object(Bucket=bucket, Key=nonexistent_key)

    error_code = exc_info.value.response.get("Error", {}).get("Code", "")
    assert error_code in ["NoSuchKey", "404", "NotFound"], f"Unexpected error code for missing key: {error_code}"

    # 2. head_object should raise 404 ClientError
    with pytest.raises(ClientError) as head_exc_info:
        s3.head_object(Bucket=bucket, Key=nonexistent_key)

    head_error_code = head_exc_info.value.response.get("Error", {}).get("Code", "")
    assert head_error_code in ["NoSuchKey", "404", "NotFound"], f"Unexpected head_object error code: {head_error_code}"


@pytest.mark.live
def test_supabase_s3_live_binary_checksum_fidelity(live_settings):
    """
    Adversarial Challenge: Upload a 64KB pseudo-random binary payload to live Supabase S3.
    Download it and assert byte-level fidelity using both MD5 and SHA256 checksum comparisons.
    """
    s3_cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=10.0)
    s3 = boto3.client(
        "s3",
        endpoint_url=live_settings.R2_ENDPOINT_URL,
        aws_access_key_id=live_settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=live_settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=s3_cfg,
    )
    bucket = live_settings.R2_BUCKET_NAME

    # 64 KB of pseudo-random binary data
    payload_size = 65536
    binary_data = os.urandom(payload_size)

    # Compute expected hashes
    expected_md5 = hashlib.md5(binary_data).hexdigest()
    expected_sha256 = hashlib.sha256(binary_data).hexdigest()

    test_key = f"challenger-adversarial-tests/checksum-{uuid.uuid4().hex}.bin"

    try:
        # Put binary object
        put_resp = s3.put_object(
            Bucket=bucket,
            Key=test_key,
            Body=binary_data,
            ContentType="application/octet-stream",
        )
        assert put_resp.get("ResponseMetadata", {}).get("HTTPStatusCode") in [200, 201]

        # Download binary object
        get_resp = s3.get_object(Bucket=bucket, Key=test_key)
        downloaded_bytes = get_resp["Body"].read()

        # Check lengths
        assert len(downloaded_bytes) == payload_size, f"Byte size mismatch: expected {payload_size}, got {len(downloaded_bytes)}"

        # Compute downloaded hashes
        actual_md5 = hashlib.md5(downloaded_bytes).hexdigest()
        actual_sha256 = hashlib.sha256(downloaded_bytes).hexdigest()

        # Assert strict bitwise equality
        assert actual_md5 == expected_md5, f"MD5 checksum corruption: {actual_md5} != {expected_md5}"
        assert actual_sha256 == expected_sha256, f"SHA256 checksum corruption: {actual_sha256} != {expected_sha256}"
        assert downloaded_bytes == binary_data, "Direct byte-for-byte comparison failed!"

    finally:
        # Cleanup
        s3.delete_object(Bucket=bucket, Key=test_key)
        list_res = s3.list_objects_v2(Bucket=bucket, Prefix=test_key)
        assert list_res.get("KeyCount", 0) == 0, f"Failed to delete test object {test_key}"


@pytest.mark.live
def test_live_immediate_abort_on_invalid_credentials(live_settings):
    """
    R2 Requirement: Immediate Abort Protocol.
    Adversarial Challenge: Verify that providing invalid credentials or bad connection strings
    to ANY of the 4 live services causes an immediate, clean exception halt without swallowing errors.
    """
    # 1. Invalid Neon Connection String
    bad_neon_url = "postgresql://bad_user_challenger:wrong_pass@ep-raspy-unit-bdz2cl18-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require"
    with pytest.raises(psycopg.Error) as db_exc:
        with psycopg.connect(bad_neon_url, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
    assert "password authentication failed" in str(db_exc.value).lower() or "authentication" in str(db_exc.value).lower() or "role" in str(db_exc.value).lower()

    # 2. Invalid Qdrant API Key
    bad_qdrant_client = QdrantClient(
        url=live_settings.QDRANT_URL,
        api_key="bad-invalid-api-key-challenger-9999",
        timeout=5,
    )
    with pytest.raises((ResponseHandlingException, UnexpectedResponse, Exception)) as qd_exc:
        bad_qdrant_client.get_collections()
    # Confirm error reflects unauthorized / forbidden / invalid
    assert any(term in str(qd_exc.value).lower() for term in ["forbidden", "unauthorized", "401", "403", "invalid", "bearer"]), (
        f"Unexpected Qdrant error: {qd_exc.value}"
    )

    # 3. Invalid Google Gemini API Key
    bad_gemini_client = genai.Client(api_key="AIzaSy_FAKE_CHALLENGER_KEY_INVALID_0000000000")
    with pytest.raises((APIError, Exception)) as gem_exc:
        bad_gemini_client.models.embed_content(
            model=live_settings.GEMINI_EMBEDDING_MODEL,
            contents="Trigger key failure",
        )
    assert any(term in str(gem_exc.value).lower() for term in ["api_key_invalid", "invalid", "unauthenticated", "400", "403", "401"]), (
        f"Unexpected Gemini error: {gem_exc.value}"
    )

    # 4. Invalid Supabase S3 Secret Key
    s3_cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5.0)
    bad_s3 = boto3.client(
        "s3",
        endpoint_url=live_settings.R2_ENDPOINT_URL,
        aws_access_key_id="invalid_access_key_challenger",
        aws_secret_access_key="invalid_secret_key_challenger",
        region_name="auto",
        config=s3_cfg,
    )
    with pytest.raises(ClientError) as s3_exc:
        bad_s3.list_objects_v2(Bucket=live_settings.R2_BUCKET_NAME)
    s3_err_code = s3_exc.value.response.get("Error", {}).get("Code", "")
    assert s3_err_code in ["SignatureDoesNotMatch", "InvalidAccessKeyId", "AccessDenied", "403"], (
        f"Unexpected S3 error code: {s3_err_code}"
    )
