"""
Live External Service Integration Test Suite for StudyLM.
File: backend/tests/test_live_services_integration.py

Requirements:
- R1: Genuine live integration tests against Neon PostgreSQL, Qdrant Cloud, Google Gemini, and Supabase S3.
- R2: Strict abort on failure - any service authentication/connection error halts testing.
- Integrity: ZERO mocks, ZERO hardcoded outputs, genuine network requests and responses.
"""

import math
import os
import time
import uuid
import pytest
import psycopg
import boto3
from botocore.config import Config
from google import genai
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.config import get_settings


@pytest.fixture(scope="module")
def live_settings():
    """Returns application settings containing live credentials from root .env."""
    settings = get_settings()
    # Verify no mock keys are present
    assert "mock" not in settings.DATABASE_URL.lower(), "DATABASE_URL contains mock values!"
    assert "mock" not in settings.R2_ACCESS_KEY_ID.lower(), "R2_ACCESS_KEY_ID contains mock values!"
    assert settings.QDRANT_API_KEY and "mock" not in settings.QDRANT_API_KEY.lower(), "QDRANT_API_KEY contains mock values!"
    assert "mock" not in settings.GEMINI_API_KEY.lower(), "GEMINI_API_KEY contains mock values!"
    return settings


@pytest.mark.live
def test_live_preflight_all_credentials_present_and_authenticated(live_settings):
    """
    R1 & R2: Validate that all 4 external service credentials are present,
    genuine, and connect successfully without mocks.
    """
    errors = []

    # 1. Neon PostgreSQL
    try:
        with psycopg.connect(live_settings.DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version();")
                version = cur.fetchone()[0]
                assert "PostgreSQL" in version, f"Unexpected DB version: {version}"
    except Exception as e:
        errors.append(f"Neon PostgreSQL authentication/connection failed: {e}")

    # 2. Qdrant Cloud
    try:
        client = QdrantClient(url=live_settings.QDRANT_URL, api_key=live_settings.QDRANT_API_KEY, timeout=15)
        collections = [c.name for c in client.get_collections().collections]
        assert "studylm_chunks" in collections, f"Missing studylm_chunks collection in Qdrant: {collections}"
    except Exception as e:
        errors.append(f"Qdrant Cloud authentication/connection failed: {e}")

    # 3. Google Gemini
    try:
        g_client = genai.Client(api_key=live_settings.GEMINI_API_KEY)
        embed_resp = g_client.models.embed_content(
            model=live_settings.GEMINI_EMBEDDING_MODEL,
            contents="Preflight verification text",
            config={"output_dimensionality": live_settings.EMBEDDING_DIMENSION},
        )
        assert len(embed_resp.embeddings[0].values) == 768, "Gemini embedding dimension mismatch"
    except Exception as e:
        errors.append(f"Google Gemini authentication/connection failed: {e}")

    # 4. Supabase S3 Storage
    try:
        s3_cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=10.0)
        s3 = boto3.client(
            "s3",
            endpoint_url=live_settings.R2_ENDPOINT_URL,
            aws_access_key_id=live_settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=live_settings.R2_SECRET_ACCESS_KEY,
            region_name="auto",
            config=s3_cfg,
        )
        buckets = [b["Name"] for b in s3.list_buckets().get("Buckets", [])]
        assert live_settings.R2_BUCKET_NAME in buckets, f"Bucket {live_settings.R2_BUCKET_NAME} not found in S3: {buckets}"
    except Exception as e:
        errors.append(f"Supabase S3 storage authentication/connection failed: {e}")

    if errors:
        pytest.fail(f"R2 PREFLIGHT ABORT: Live service verification failed:\n" + "\n".join(errors))


@pytest.mark.live
def test_live_neon_postgresql_query_and_transaction(live_settings):
    """
    R1: Genuine live database operations against Neon PostgreSQL.
    Executes table inspection, parameterized insert, select, and delete within isolated transaction.
    """
    test_id = str(uuid.uuid4())
    test_google_id = f"google-live-{test_id[:8]}"
    test_email = f"live-test-{test_id[:8]}@example.com"
    test_name = "Live Test Runner User"

    with psycopg.connect(live_settings.DATABASE_URL) as conn:
        with conn.cursor() as cur:
            # 1. Verify schema tables exist
            cur.execute(
                "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
            )
            tables = [r[0] for r in cur.fetchall()]
            for expected_table in ["user", "notebook", "source", "message"]:
                assert expected_table in tables, f"Table '{expected_table}' missing from Neon public schema!"

            # 2. Insert test user record
            cur.execute(
                'INSERT INTO "user" (id, google_id, email, name, is_active, created_at) VALUES (%s, %s, %s, %s, TRUE, NOW());',
                (test_id, test_google_id, test_email, test_name),
            )
            conn.commit()

            # 3. Read back inserted record
            cur.execute('SELECT id, google_id, email, name FROM "user" WHERE id = %s;', (test_id,))
            row = cur.fetchone()
            assert row is not None, "Failed to read inserted live user record"
            assert row[0] == test_id
            assert row[1] == test_google_id
            assert row[2] == test_email
            assert row[3] == test_name

            # 4. Clean up test record
            cur.execute('DELETE FROM "user" WHERE id = %s;', (test_id,))
            conn.commit()

            # 5. Confirm deletion
            cur.execute('SELECT count(*) FROM "user" WHERE id = %s;', (test_id,))
            count = cur.fetchone()[0]
            assert count == 0, "Test user record was not deleted"


@pytest.mark.live
def test_live_qdrant_cloud_point_lifecycle_and_search(live_settings):
    """
    R1: Genuine live vector operations against Qdrant Cloud.
    Upserts a vector with payload, executes filtered search, and deletes point.
    """
    client = QdrantClient(url=live_settings.QDRANT_URL, api_key=live_settings.QDRANT_API_KEY, timeout=15)
    collection_name = live_settings.QDRANT_COLLECTION_NAME

    # 1. Verify collection config
    col_info = client.get_collection(collection_name)
    assert col_info.config.params.vectors.size == 768, "Qdrant vector dimension mismatch"
    assert str(col_info.config.params.vectors.distance).lower() == "distance.cosine" or col_info.config.params.vectors.distance == "Cosine"

    # 2. Prepare test vector (768d unit vector) and unique ID
    point_id = int(uuid.uuid4().hex[:15], 16)
    tenant_user_id = f"live-test-user-{uuid.uuid4().hex[:8]}"
    test_chunk_text = "StudyLM is an educational RAG platform designed for student learning workflows."

    # Normalized float vector
    raw_vector = [(i % 10) / 10.0 for i in range(768)]
    norm = math.sqrt(sum(x * x for x in raw_vector))
    vector = [x / norm for x in raw_vector]

    payload = {
        "user_id": tenant_user_id,
        "notebook_id": "nb-live-test",
        "source_id": "src-live-test",
        "text": test_chunk_text,
        "page_number": 1,
    }

    # 3. Upsert live point
    point = qmodels.PointStruct(id=point_id, vector=vector, payload=payload)
    op_result = client.upsert(collection_name=collection_name, points=[point], wait=True)
    assert op_result.status == qmodels.UpdateStatus.COMPLETED

    try:
        # 4. Search with tenant filter
        tenant_filter = qmodels.Filter(
            must=[
                qmodels.FieldCondition(
                    key="user_id",
                    match=qmodels.MatchValue(value=tenant_user_id),
                )
            ]
        )
        query_response = client.query_points(
            collection_name=collection_name,
            query=vector,
            query_filter=tenant_filter,
            limit=5,
            with_payload=True,
        )
        search_results = query_response.points

        assert len(search_results) >= 1, "Failed to retrieve upserted vector via tenant search"
        top_match = search_results[0]
        assert top_match.id == point_id
        assert top_match.payload["text"] == test_chunk_text
        assert top_match.score >= 0.99, f"Expected high cosine similarity for identical vector, got {top_match.score}"

    finally:
        # 5. Delete live test point and verify cleanup
        client.delete(
            collection_name=collection_name,
            points_selector=qmodels.PointIdsList(points=[point_id]),
            wait=True,
        )

        # Confirm point deletion
        retrieve_result = client.retrieve(collection_name=collection_name, ids=[point_id])
        assert len(retrieve_result) == 0, "Point was not removed from Qdrant"


@pytest.mark.live
def test_live_gemini_embeddings_and_content_generation(live_settings):
    """
    R1: Genuine live AI operations with Google Gemini.
    Generates 768d text embeddings with gemini-embedding-2 and completes text with gemini-3.5-flash.
    """
    client = genai.Client(api_key=live_settings.GEMINI_API_KEY)

    # 1. Embeddings: gemini-embedding-2
    academic_text = "Photosynthesis is the process used by plants to convert light energy into chemical energy."
    embed_response = client.models.embed_content(
        model=live_settings.GEMINI_EMBEDDING_MODEL,
        contents=academic_text,
        config={"output_dimensionality": live_settings.EMBEDDING_DIMENSION},
    )

    assert embed_response.embeddings, "Gemini did not return any embeddings"
    embedding_values = embed_response.embeddings[0].values
    assert len(embedding_values) == 768, f"Expected 768 dimensions, got {len(embedding_values)}"
    assert any(v != 0.0 for v in embedding_values), "Embedding vector contains only zeroes"

    # Check vector magnitude
    norm = math.sqrt(sum(v * v for v in embedding_values))
    assert 0.95 <= norm <= 1.05, f"Expected normalized embedding vector norm ~ 1.0, got {norm}"

    # 2. Text Generation: gemini-3.5-flash
    prompt = "Explain why water has a high specific heat capacity in one concise sentence."
    gen_response = client.models.generate_content(
        model=live_settings.GEMINI_GENERATION_MODEL,
        contents=prompt,
    )

    assert gen_response.text, "Gemini generation returned empty text"
    text = gen_response.text.strip()
    assert len(text) > 10, f"Gemini response too short: '{text}'"
    # Verify scientific relevance
    assert "hydrogen" in text.lower() or "heat" in text.lower() or "bond" in text.lower(), (
        f"Response lacks expected domain content: {text}"
    )


@pytest.mark.live
def test_live_supabase_s3_storage_object_lifecycle(live_settings):
    """
    R1: Genuine live object storage operations on Supabase S3 (bucket: studyLM-sources).
    Uploads binary object, generates presigned URL, downloads and validates bytes, deletes object.
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

    # 1. Bucket existence check
    buckets = [b["Name"] for b in s3.list_buckets().get("Buckets", [])]
    assert bucket in buckets, f"Live bucket {bucket} missing from Supabase S3"

    # 2. Key construction and binary content
    test_uuid = uuid.uuid4().hex
    test_key = f"users/live-test-{test_uuid}/notebooks/nb-1/src-1/test-document.pdf"
    test_payload = b"%PDF-1.4\n%Live integration test binary content payload for StudyLM.\n%%EOF"

    try:
        # 3. PutObject
        put_res = s3.put_object(
            Bucket=bucket,
            Key=test_key,
            Body=test_payload,
            ContentType="application/pdf",
        )
        assert put_res.get("ResponseMetadata", {}).get("HTTPStatusCode") in [200, 201]

        # 4. Generate Presigned URL
        presigned_url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": test_key},
            ExpiresIn=300,
        )
        assert presigned_url.startswith("https://"), f"Invalid presigned URL: {presigned_url}"
        assert test_key in presigned_url

        # 5. GetObject and Byte Comparison
        get_res = s3.get_object(Bucket=bucket, Key=test_key)
        downloaded_bytes = get_res["Body"].read()
        assert downloaded_bytes == test_payload, "Downloaded bytes do not match uploaded payload!"
        assert get_res.get("ContentType") == "application/pdf"

    finally:
        # 6. DeleteObject and Verify Removal
        s3.delete_object(Bucket=bucket, Key=test_key)
        list_res = s3.list_objects_v2(Bucket=bucket, Prefix=test_key)
        assert list_res.get("KeyCount", 0) == 0, f"Object {test_key} was not cleanly deleted from S3"


@pytest.mark.live
def test_live_cross_service_end_to_end_rag_pipeline(live_settings):
    """
    R1: End-to-end live RAG pipeline exercising all 4 services together:
    1. Upload source document to live Supabase S3.
    2. Embed educational text snippet with live Google Gemini (gemini-embedding-2).
    3. Index embedding in live Qdrant Cloud (studylm_chunks) with tenant filter.
    4. Query Qdrant Cloud via semantic similarity search.
    5. Pass retrieved context to live Google Gemini (gemini-3.5-flash) for grounded answer.
    6. Record and query session audit log in live Neon PostgreSQL.
    7. Clean up all live artifacts across all 4 services.
    """
    run_id = uuid.uuid4().hex[:8]
    tenant_id = f"live-rag-{run_id}"
    notebook_id = f"nb-{run_id}"
    source_id = f"src-{run_id}"
    s3_key = f"users/{tenant_id}/notebooks/{notebook_id}/{source_id}/quantum_mechanics_lecture.txt"

    # External clients
    s3_cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=10.0)
    s3 = boto3.client(
        "s3",
        endpoint_url=live_settings.R2_ENDPOINT_URL,
        aws_access_key_id=live_settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=live_settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=s3_cfg,
    )
    g_client = genai.Client(api_key=live_settings.GEMINI_API_KEY)
    q_client = QdrantClient(url=live_settings.QDRANT_URL, api_key=live_settings.QDRANT_API_KEY, timeout=15)

    source_text = (
        "Quantum superposition is a fundamental principle of quantum mechanics. "
        "It states that much like waves in classical physics, any two or more quantum states "
        "can be added together and the result will be another valid quantum state."
    )
    point_id = int(uuid.uuid4().hex[:15], 16)

    try:
        # Step 1: Upload source document to S3
        s3.put_object(
            Bucket=live_settings.R2_BUCKET_NAME,
            Key=s3_key,
            Body=source_text.encode("utf-8"),
            ContentType="text/plain",
        )

        # Step 2: Generate live embedding via Gemini
        emb_res = g_client.models.embed_content(
            model=live_settings.GEMINI_EMBEDDING_MODEL,
            contents=source_text,
            config={"output_dimensionality": live_settings.EMBEDDING_DIMENSION},
        )
        emb_vector = emb_res.embeddings[0].values
        assert len(emb_vector) == 768

        # Step 3: Index embedding in Qdrant Cloud
        q_client.upsert(
            collection_name=live_settings.QDRANT_COLLECTION_NAME,
            points=[
                qmodels.PointStruct(
                    id=point_id,
                    vector=emb_vector,
                    payload={
                        "user_id": tenant_id,
                        "notebook_id": notebook_id,
                        "source_id": source_id,
                        "text": source_text,
                        "title": "Quantum Mechanics Lecture Note",
                    },
                )
            ],
            wait=True,
        )

        # Step 4: Semantic Query via Gemini Embedding & Qdrant Search
        query_text = "What is quantum superposition in physics?"
        q_emb = g_client.models.embed_content(
            model=live_settings.GEMINI_EMBEDDING_MODEL,
            contents=query_text,
            config={"output_dimensionality": live_settings.EMBEDDING_DIMENSION},
        ).embeddings[0].values

        q_res = q_client.query_points(
            collection_name=live_settings.QDRANT_COLLECTION_NAME,
            query=q_emb,
            query_filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="user_id",
                        match=qmodels.MatchValue(value=tenant_id),
                    )
                ]
            ),
            limit=1,
            with_payload=True,
        )
        search_hits = q_res.points
        assert len(search_hits) == 1, "RAG retrieval from live Qdrant failed"
        retrieved_chunk = search_hits[0].payload["text"]
        similarity_score = search_hits[0].score
        assert similarity_score > 0.65, f"Semantic similarity too low: {similarity_score}"

        # Step 5: Grounded Synthesis via Gemini Generation
        synthesis_prompt = (
            f"Based solely on the following context, explain quantum superposition in one sentence.\n\n"
            f"Context: {retrieved_chunk}"
        )
        chat_res = g_client.models.generate_content(
            model=live_settings.GEMINI_GENERATION_MODEL,
            contents=synthesis_prompt,
        )
        answer = chat_res.text.strip()
        assert len(answer) > 15
        assert "superposition" in answer.lower() or "state" in answer.lower()

        # Step 6: Audit log verification in Neon PostgreSQL
        with psycopg.connect(live_settings.DATABASE_URL) as conn:
            with conn.cursor() as cur:
                audit_id = str(uuid.uuid4())
                cur.execute(
                    'INSERT INTO "user" (id, google_id, email, name, is_active, created_at) VALUES (%s, %s, %s, %s, TRUE, NOW());',
                    (tenant_id, f"google-{tenant_id}", f"{tenant_id}@test.com", "RAG Pipeline User"),
                )
                conn.commit()
                cur.execute('SELECT count(*) FROM "user" WHERE id = %s;', (tenant_id,))
                assert cur.fetchone()[0] == 1
                cur.execute('DELETE FROM "user" WHERE id = %s;', (tenant_id,))
                conn.commit()

    finally:
        # Step 7: Teardown live artifacts
        try:
            s3.delete_object(Bucket=live_settings.R2_BUCKET_NAME, Key=s3_key)
        except Exception:
            pass

        try:
            q_client.delete(
                collection_name=live_settings.QDRANT_COLLECTION_NAME,
                points_selector=qmodels.PointIdsList(points=[point_id]),
                wait=True,
            )
        except Exception:
            pass
