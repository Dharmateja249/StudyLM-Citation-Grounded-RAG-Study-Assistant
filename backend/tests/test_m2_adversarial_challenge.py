"""
Milestone 2 Adversarial Stress Testing & Verification Suite
File: backend/tests/test_m2_adversarial_challenge.py

Empirical Challenger 2 Verification:
1. S3 Upload Decoupling & DB Transaction Release:
   - Challenge database connection release before S3 upload (ensure transaction is rolled back/closed during network transfer).
   - Challenge concurrency during slow S3 network transfer.
2. Zero-Orphan Guarantee:
   - S3 object deletion on database commit failure (STOR-10).
   - S3 object deletion on quota exceeded race condition (STOR-12).
   - S3 object deletion on concurrent notebook deletion (STOR-08).
   - Zero S3 interaction on preliminary validation rejection.
3. Embedding Service 768d Dimension & L2 Unit Normalization:
   - Output vectors strictly 768-dimensional across multilingual, emoji, empty, and edge-case text inputs.
   - Unit L2 norm (norm == 1.0) mathematically asserted.
   - Raw unnormalized Gemini API vectors are scaled to unit L2 length.
   - No DummyEmbeddingService in production; get_default_embedding_service() produces genuine EmbeddingService.
   - Startup Qdrant collection dimension mismatch detection (CIT-09).
4. Ingestion Task Blue-Green Run Isolation & Error Cleanup:
   - Failed run points are purged from Qdrant on ingestion crash.
"""

from __future__ import annotations

import asyncio
import io
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest
import pytest_asyncio
from fastapi import HTTPException, UploadFile
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import Settings, get_settings
from app.models import Notebook, Source, User
from app.routers.sources import _execute_source_upload
from app.services.embedding_service import EmbeddingService, get_embedding_service
from app.tasks.ingestion_tasks import (
    defer_ingest_source,
    get_default_embedding_service,
    ingest_source_task,
)
from tests.conftest import MockStorageService


# ==============================================================================
# Helpers
# ==============================================================================

def make_upload_file(filename: str, content: bytes, content_type: str = "application/pdf") -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers={"content-type": content_type},
    )


class MockFastAPIRequest:
    """Mock FastAPI Request object with customizable headers."""
    def __init__(self, headers: Dict[str, str] = None):
        self.headers = headers or {}


# ==============================================================================
# Category 1: S3 Upload Decoupling & Transaction Isolation Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_challenge_db_transaction_released_during_s3_upload(
    db_session: AsyncSession,
    user_a: User,
    user_a_notebook: Notebook,
    mock_storage: MockStorageService,
):
    """
    CHALLENGE: Verify that the DB transaction opened during preliminary quota
    check is explicitly rolled back/closed BEFORE streaming bytes to remote S3.
    """
    transaction_states_during_upload: List[bool] = []
    original_upload_file = mock_storage.upload_file

    async def spy_upload_file(file_bytes: bytes, storage_key: str, content_type: str = "application/pdf"):
        # Inspect whether the session is currently in a transaction during S3 upload
        in_tx = db_session.in_transaction()
        transaction_states_during_upload.append(in_tx)
        # Simulate network latency to remote S3 / Cloudflare R2
        await asyncio.sleep(0.05)
        return await original_upload_file(file_bytes, storage_key, content_type)

    mock_storage.upload_file = spy_upload_file

    pdf_content = b"%PDF-1.4 empirical challenge content for S3 decoupling"
    file = make_upload_file("probe.pdf", pdf_content)
    req = MockFastAPIRequest({"content-length": str(len(pdf_content))})

    source = await _execute_source_upload(
        target_notebook_id=user_a_notebook.id,
        request=req,
        title="Decoupled Source",
        file=file,
        current_user=user_a,
        session=db_session,
        storage_service=mock_storage,
    )

    assert source is not None
    assert source.status == "processing"
    # S3 upload must have occurred while NO transaction was active
    assert len(transaction_states_during_upload) == 1
    assert transaction_states_during_upload[0] is False, (
        "FAIL: db_session.in_transaction() was True during S3 upload! "
        "The database connection/lock was NOT released prior to network transfer."
    )


@pytest.mark.asyncio
async def test_challenge_concurrency_during_slow_s3_upload(
    test_session_factory,
    user_a: User,
    user_a_notebook: Notebook,
    mock_storage: MockStorageService,
):
    """
    CHALLENGE: A slow 200ms remote S3 upload must NOT block concurrent database
    reads or updates on the same notebook from other sessions.
    """
    s3_upload_started = asyncio.Event()
    s3_upload_allow_finish = asyncio.Event()

    async def slow_upload(file_bytes: bytes, storage_key: str, content_type: str = "application/pdf"):
        s3_upload_started.set()
        await s3_upload_allow_finish.wait()
        return storage_key

    mock_storage.upload_file = slow_upload

    async with test_session_factory() as session_1:
        pdf_content = b"%PDF-1.4 concurrent transfer test"
        file = make_upload_file("concurrent.pdf", pdf_content)
        req = MockFastAPIRequest({"content-length": str(len(pdf_content))})

        # Launch upload in background task
        upload_task = asyncio.create_task(
            _execute_source_upload(
                target_notebook_id=user_a_notebook.id,
                request=req,
                title="Concurrent Upload",
                file=file,
                current_user=user_a,
                session=session_1,
                storage_service=mock_storage,
            )
        )

        # Wait until S3 upload is in-flight
        await s3_upload_started.wait()

        # Concurrent session attempts to update notebook title
        async with test_session_factory() as session_2:
            nb = await session_2.get(Notebook, user_a_notebook.id)
            assert nb is not None
            nb.title = "Updated While S3 Uploading"
            session_2.add(nb)
            # This commit must succeed immediately without deadlock or locking contention
            await asyncio.wait_for(session_2.commit(), timeout=1.0)

        # Allow S3 upload to finish
        s3_upload_allow_finish.set()
        completed_source = await asyncio.wait_for(upload_task, timeout=2.0)
        assert completed_source is not None
        assert completed_source.title == "Concurrent Upload"


# ==============================================================================
# Category 2: Zero-Orphan Guarantee Empirical Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_challenge_zero_orphan_on_database_commit_failure(
    db_session: AsyncSession,
    user_a: User,
    user_a_notebook: Notebook,
    mock_storage: MockStorageService,
):
    """
    CHALLENGE: If session.commit() raises an unexpected database failure after
    S3 upload completes, the uploaded file in S3 MUST be immediately deleted (STOR-10).
    """
    uploaded_keys = []
    original_upload = mock_storage.upload_file

    async def tracking_upload(b, k, ct="application/pdf"):
        uploaded_keys.append(k)
        return await original_upload(b, k, ct)

    mock_storage.upload_file = tracking_upload

    pdf_content = b"%PDF-1.4 orphan failure test"
    file = make_upload_file("orphan_fail.pdf", pdf_content)
    req = MockFastAPIRequest({"content-length": str(len(pdf_content))})

    # Simulate database crash during commit
    with patch.object(db_session, "commit", side_effect=SQLAlchemyError("Simulated DB connection crash")):
        with pytest.raises(HTTPException) as exc_info:
            await _execute_source_upload(
                target_notebook_id=user_a_notebook.id,
                request=req,
                title="Orphan Test",
                file=file,
                current_user=user_a,
                session=db_session,
                storage_service=mock_storage,
            )
        assert exc_info.value.status_code == 500

    # ZERO-ORPHAN ASSERTIONS:
    assert len(uploaded_keys) == 1
    leaked_key = uploaded_keys[0]
    # S3 file MUST be deleted
    assert leaked_key in mock_storage.deleted_keys, f"S3 key {leaked_key} was not deleted on DB failure!"
    assert leaked_key not in mock_storage.files, f"S3 key {leaked_key} still exists in storage!"

    # Ensure no source row was persisted
    res = await db_session.execute(select(Source).where(Source.storage_key_or_url == leaked_key))
    assert res.scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_challenge_zero_orphan_on_quota_violation_race(
    test_session_factory,
    user_a: User,
    user_a_notebook: Notebook,
    mock_storage: MockStorageService,
):
    """
    CHALLENGE: If concurrent uploads cause the 20-source quota to be reached
    while S3 upload is in-flight, the re-check under lock MUST abort and
    delete the uploaded S3 file immediately (STOR-12).
    """
    s3_upload_started = asyncio.Event()
    s3_upload_allow_finish = asyncio.Event()
    uploaded_keys = []
    original_upload = mock_storage.upload_file

    async def gating_upload(file_bytes: bytes, storage_key: str, content_type: str = "application/pdf"):
        uploaded_keys.append(storage_key)
        res = await original_upload(file_bytes, storage_key, content_type)
        s3_upload_started.set()
        await s3_upload_allow_finish.wait()
        return res

    mock_storage.upload_file = gating_upload

    # Pre-populate 19 sources
    async with test_session_factory() as session_setup:
        for i in range(19):
            src = Source(
                id=str(uuid.uuid4()),
                user_id=user_a.id,
                notebook_id=user_a_notebook.id,
                title=f"Source {i}",
                source_type="pdf",
                storage_key_or_url=f"keys/{i}",
                status="ready",
                created_at=datetime.now(timezone.utc),
            )
            session_setup.add(src)
        await session_setup.commit()

    async with test_session_factory() as session_upload:
        pdf_content = b"%PDF-1.4 quota race test"
        file = make_upload_file("quota_race.pdf", pdf_content)
        req = MockFastAPIRequest({"content-length": str(len(pdf_content))})

        upload_task = asyncio.create_task(
            _execute_source_upload(
                target_notebook_id=user_a_notebook.id,
                request=req,
                title="Race Source 20th",
                file=file,
                current_user=user_a,
                session=session_upload,
                storage_service=mock_storage,
            )
        )

        await s3_upload_started.wait()

        # Another transaction sneaks in the 20th source before upload finishes
        async with test_session_factory() as session_sneak:
            sneak_src = Source(
                id=str(uuid.uuid4()),
                user_id=user_a.id,
                notebook_id=user_a_notebook.id,
                title="Sneak 20th Source",
                source_type="pdf",
                storage_key_or_url="keys/sneak_20",
                status="ready",
                created_at=datetime.now(timezone.utc),
            )
            session_sneak.add(sneak_src)
            await session_sneak.commit()

        # Let the in-flight upload finish S3 transfer and re-acquire lock
        s3_upload_allow_finish.set()

        with pytest.raises(HTTPException) as exc_info:
            await upload_task
        assert exc_info.value.status_code == 400
        assert "Notebook source limit reached" in exc_info.value.detail

    # ZERO-ORPHAN ASSERTIONS:
    assert len(uploaded_keys) == 1
    rejected_key = uploaded_keys[0]
    assert rejected_key in mock_storage.deleted_keys, "S3 file was not deleted upon quota violation!"
    assert rejected_key not in mock_storage.files, "S3 file still orphaned in storage!"


@pytest.mark.asyncio
async def test_challenge_zero_orphan_on_notebook_deleted_mid_flight(
    test_session_factory,
    user_a: User,
    user_a_notebook: Notebook,
    mock_storage: MockStorageService,
):
    """
    CHALLENGE: If a notebook is marked 'deleting' while an S3 upload is in-flight,
    the post-upload lock check MUST reject the upload with 409 Conflict and
    delete the newly uploaded S3 object (STOR-08).
    """
    s3_upload_started = asyncio.Event()
    s3_upload_allow_finish = asyncio.Event()
    uploaded_keys = []
    original_upload = mock_storage.upload_file

    async def gating_upload(file_bytes: bytes, storage_key: str, content_type: str = "application/pdf"):
        uploaded_keys.append(storage_key)
        res = await original_upload(file_bytes, storage_key, content_type)
        s3_upload_started.set()
        await s3_upload_allow_finish.wait()
        return res

    mock_storage.upload_file = gating_upload

    async with test_session_factory() as session_upload:
        pdf_content = b"%PDF-1.4 delete mid flight test"
        file = make_upload_file("del_mid_flight.pdf", pdf_content)
        req = MockFastAPIRequest({"content-length": str(len(pdf_content))})

        upload_task = asyncio.create_task(
            _execute_source_upload(
                target_notebook_id=user_a_notebook.id,
                request=req,
                title="Mid Flight Delete",
                file=file,
                current_user=user_a,
                session=session_upload,
                storage_service=mock_storage,
            )
        )

        await s3_upload_started.wait()

        # Concurrent deletion marks notebook as deleting
        async with test_session_factory() as session_del:
            nb = await session_del.get(Notebook, user_a_notebook.id)
            assert nb is not None
            nb.status = "deleting"
            session_del.add(nb)
            await session_del.commit()

        s3_upload_allow_finish.set()

        with pytest.raises(HTTPException) as exc_info:
            await upload_task
        assert exc_info.value.status_code == 409
        assert "pending deletion" in exc_info.value.detail

    # ZERO-ORPHAN ASSERTIONS:
    assert len(uploaded_keys) == 1
    rejected_key = uploaded_keys[0]
    assert rejected_key in mock_storage.deleted_keys, "S3 file was not deleted upon notebook deletion!"
    assert rejected_key not in mock_storage.files, "S3 file remains orphaned in storage!"


@pytest.mark.asyncio
async def test_challenge_preliminary_rejections_never_call_s3_upload(
    db_session: AsyncSession,
    user_a: User,
    mock_storage: MockStorageService,
):
    """
    CHALLENGE: Preliminary check failures (payload > 50MB, non-existent notebook)
    must fail fast and NEVER invoke S3 upload.
    """
    mock_storage.upload_file = AsyncMock()

    # Case 1: Payload > 50MB header
    huge_bytes = b"header check"
    req_too_big = MockFastAPIRequest({"content-length": str(51 * 1024 * 1024)})
    file_too_big = make_upload_file("big.pdf", huge_bytes)

    with pytest.raises(HTTPException) as exc_info:
        await _execute_source_upload(
            target_notebook_id=str(uuid.uuid4()),
            request=req_too_big,
            title="Too Big",
            file=file_too_big,
            current_user=user_a,
            session=db_session,
            storage_service=mock_storage,
        )
    assert exc_info.value.status_code == 413
    mock_storage.upload_file.assert_not_called()

    # Case 2: Non-existent notebook
    small_bytes = b"%PDF-1.4 valid"
    req_ok = MockFastAPIRequest({"content-length": str(len(small_bytes))})
    file_ok = make_upload_file("small.pdf", small_bytes)

    with pytest.raises(HTTPException) as exc_info:
        await _execute_source_upload(
            target_notebook_id=str(uuid.uuid4()),
            request=req_ok,
            title="Non Existent",
            file=file_ok,
            current_user=user_a,
            session=db_session,
            storage_service=mock_storage,
        )
    assert exc_info.value.status_code == 404
    mock_storage.upload_file.assert_not_called()


# ==============================================================================
# Category 3: Embedding Service 768d Dimension & L2 Unit Normalization Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_challenge_embedding_vectors_768d_and_unit_l2_norm(test_settings):
    """
    CHALLENGE: Vectors returned by EmbeddingService must have exact length 768
    and unit L2 norm (|v|_2 == 1.0) across all input distributions.
    """
    svc = EmbeddingService(dimension=768)
    assert svc.dimension == 768

    test_inputs = [
        "Simple English query",
        "Machine Learning knowledge retrieval and semantic search",
        "深度学习与向量检索系统",  # Chinese
        "تعلم الآلة والبحث الدلالي",  # Arabic
        "मशीन लर्निंग और न्यूरल नेटवर्क",  # Hindi
        "Машинное обучение и поиск векторов",  # Russian
        "🧠 📚 🚀 🔬 💡 💻",  # Emojis
        "def quicksort(arr): return arr if len(arr) <= 1 else ...",  # Code snippet
        "a" * 1000,  # Long repeated text
        "SingleWord",
        "  \t\n  Padded with leading and trailing whitespaces  \r\n  ",
    ]

    # Test batch embedding
    vectors = await svc.embed_documents(test_inputs)
    assert len(vectors) == len(test_inputs)

    for i, vec in enumerate(vectors):
        assert len(vec) == 768, f"Input '{test_inputs[i]}' returned vector of length {len(vec)}, expected 768!"
        v_arr = np.array(vec, dtype=np.float64)
        l2_norm = float(np.linalg.norm(v_arr))
        assert np.isclose(l2_norm, 1.0, atol=1e-5), (
            f"Input '{test_inputs[i]}' produced non-unit L2 norm: {l2_norm}"
        )

    # Test single query embedding
    query_vec = await svc.embed_query("Standalone search query string")
    assert len(query_vec) == 768
    q_norm = float(np.linalg.norm(np.array(query_vec, dtype=np.float64)))
    assert np.isclose(q_norm, 1.0, atol=1e-5)

    # Test empty list returns empty list
    empty_vecs = await svc.embed_documents([])
    assert empty_vecs == []


@pytest.mark.asyncio
async def test_challenge_gemini_api_unnormalized_vectors_scaled_to_unit_l2():
    """
    CHALLENGE: When the upstream Gemini API returns raw, unnormalized vector floats,
    EmbeddingService MUST normalize them to unit length (|v|_2 == 1.0) and exactly 768d.
    """
    svc = EmbeddingService(
        api_key="real-gemini-key-simulated",
        model_name="models/gemini-embedding-2",
        dimension=768,
    )
    # Force settings environment to production to exercise Gemini API code path
    prod_settings = Settings(
        ENVIRONMENT="production",
        GEMINI_API_KEY="real-gemini-key-simulated",
        GEMINI_EMBEDDING_MODEL="models/gemini-embedding-2",
        EMBEDDING_DIMENSION=768,
    )
    svc.settings = prod_settings

    # Construct mock Gemini client returning unnormalized raw vectors
    class MockEmbedding:
        def __init__(self, values):
            self.values = values

    class MockEmbedContentResult:
        def __init__(self, embeddings):
            self.embeddings = embeddings

    # Create unnormalized 768d raw vector with norm ~50.0
    raw_vector_1 = (np.ones(768, dtype=np.float32) * 1.8).tolist()
    raw_vector_2 = (np.random.RandomState(42).randn(768) * 10.0).tolist()

    mock_client = MagicMock()
    mock_client.models.embed_content.return_value = MockEmbedContentResult([
        MockEmbedding(raw_vector_1),
        MockEmbedding(raw_vector_2),
    ])

    with patch("google.genai.Client", return_value=mock_client):
        embeddings = await svc.embed_documents(["Document text 1", "Document text 2"])

    assert len(embeddings) == 2
    for vec in embeddings:
        assert len(vec) == 768
        norm = float(np.linalg.norm(np.array(vec, dtype=np.float64)))
        assert np.isclose(norm, 1.0, atol=1e-5), f"Raw vector was not scaled to unit L2 norm! Got {norm}"


def test_challenge_no_dummy_embedding_service_in_production(monkeypatch):
    """
    CHALLENGE: Verify that DummyEmbeddingService is NEVER returned in production:
    1. No class named DummyEmbeddingService exists in app.services.embedding_service.
    2. get_default_embedding_service() returns genuine EmbeddingService.
    3. Production environment returns real EmbeddingService configured with gemini-embedding-2.
    """
    import app.services.embedding_service as emb_module

    # 1. Assert no DummyEmbeddingService class exists in the module
    assert not hasattr(emb_module, "DummyEmbeddingService"), (
        "FAIL: DummyEmbeddingService class exists in embedding_service module!"
    )

    # 2. Assert get_default_embedding_service returns genuine EmbeddingService instance
    default_svc = get_default_embedding_service()
    assert isinstance(default_svc, EmbeddingService)
    assert type(default_svc).__name__ == "EmbeddingService"
    assert default_svc.dimension == 768

    # 3. In production environment, get_embedding_service() returns production EmbeddingService
    monkeypatch.setattr(emb_module, "_embedding_service", None)
    prod_settings = Settings(
        ENVIRONMENT="production",
        GEMINI_API_KEY="AIzaSyProductionKeyTest",
        GEMINI_EMBEDDING_MODEL="models/gemini-embedding-2",
        EMBEDDING_DIMENSION=768,
    )
    monkeypatch.setattr(emb_module, "get_settings", lambda: prod_settings)

    prod_svc = get_embedding_service()
    assert isinstance(prod_svc, EmbeddingService)
    assert type(prod_svc).__name__ == "EmbeddingService"
    assert prod_svc.dimension == 768
    assert prod_svc.model_name == "models/gemini-embedding-2"
    assert prod_svc.api_key == "AIzaSyProductionKeyTest"


def test_challenge_startup_vector_dimension_mismatch_raises_error():
    """
    CHALLENGE: Startup validation (CIT-09) must strictly raise ValueError if
    Qdrant collection has a vector size mismatch (e.g. 1536 vs 768).
    """
    svc = EmbeddingService(dimension=768)

    # Mock Qdrant client returning dimension 1536
    mock_client = MagicMock(spec=QdrantClient)
    mock_collection_info = MagicMock()
    mock_collection_info.config.params.vectors.size = 1536
    mock_client.get_collection.return_value = mock_collection_info

    with pytest.raises(ValueError) as exc_info:
        svc.validate_embedding_dimension(mock_client, "studylm_vectors")
    assert "Vector dimension mismatch at startup" in str(exc_info.value)
    assert "Collection 'studylm_vectors' has size 1536, but configured embedding model requires 768" in str(exc_info.value)

    # When dimension matches (768), returns True
    mock_collection_info.config.params.vectors.size = 768
    assert svc.validate_embedding_dimension(mock_client, "studylm_vectors") is True


# ==============================================================================
# Category 4: Ingestion Pipeline Blue-Green Run Isolation & Error Cleanup Probe
# ==============================================================================

@pytest.mark.asyncio
async def test_challenge_ingestion_purges_points_on_failure(
    db_session: AsyncSession,
    user_a: User,
    user_a_notebook: Notebook,
    mock_storage: MockStorageService,
    mock_qdrant,
):
    """
    CHALLENGE: If an ingestion task fails after upserting points into Qdrant,
    the failed run's points MUST be purged immediately so no orphan vectors remain.
    """
    source_id = str(uuid.uuid4())
    storage_key = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/{source_id}/fail_doc.pdf"

    # Minimal valid PDF
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(fitz.Point(50, 72), "Text that gets embedded before failure")
    pdf_bytes = doc.tobytes()
    doc.close()

    await mock_storage.upload_file(pdf_bytes, storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Failure Ingestion PDF",
        source_type="pdf",
        storage_key_or_url=storage_key,
        file_size_bytes=len(pdf_bytes),
        status="processing",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    emb_svc = get_default_embedding_service()
    failed_run_id = "test-failed-run-uuid"

    # Simulate crash right during Qdrant upsert or post-upsert SQL
    original_upsert = mock_qdrant.upsert

    def crashing_upsert(collection_name, points, wait=True):
        # Perform upsert first so points actually enter Qdrant
        original_upsert(collection_name=collection_name, points=points, wait=wait)
        # Then simulate failure during processing
        raise RuntimeError("Simulated mid-pipeline ingestion crash after upsert")

    mock_qdrant.upsert = crashing_upsert

    with pytest.raises(RuntimeError):
        await ingest_source_task(
            source_id=source_id,
            ingest_run_id=failed_run_id,
            session=db_session,
            storage_service=mock_storage,
            qdrant_client=mock_qdrant,
            embedding_service=emb_svc,
        )

    # Verify points were purged for the failed run
    cur_settings = get_settings()
    points, _ = mock_qdrant.scroll(
        collection_name=cur_settings.QDRANT_COLLECTION_NAME,
        limit=100,
        with_payload=True,
    )
    run_points = [p for p in points if p.payload.get("ingest_run_id") == failed_run_id]
    assert len(run_points) == 0, f"Found {len(run_points)} orphaned points for failed run {failed_run_id}!"

    # Verify source was transitioned to error status
    updated_source = await db_session.get(Source, source_id)
    assert updated_source.status == "error"
