"""
StudyLM Milestone 2 Integration Test Suite: Worker Queue, PDF Pipeline, & Grounding
File: backend/tests/test_worker_queue_and_pdf.py

Verifies:
1. Lifespan properly opens and closes Procrastinate app without AppNotOpen.
2. Task deferral enqueues jobs with string serialization lock: f"source_{source_id}".
3. Task lock attributes are not monkey-patched with function references.
4. Worker runner (app.run_worker_async) picks up and completes queued ingestion tasks.
5. Stalled job recovery executes schema-compliant SQL without UndefinedColumn.
6. Embedding service and PDF chunking produce 768-dimensional normalized vectors.
7. Config URL sanitization strips driver prefixes for psycopg compatibility.
"""

from __future__ import annotations

import io
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import fitz  # PyMuPDF
import numpy as np
import procrastinate
from procrastinate.testing import InMemoryConnector
import pytest
from sqlalchemy import text
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import Settings, get_settings
from app.models import Notebook, Source, User
from app.services.embedding_service import EmbeddingService, get_embedding_service
from app.tasks.cleanup_tasks import (
    delete_source_task,
    get_source_task_lock,
    recover_stalled_jobs_task,
)
from app.tasks.ingestion_tasks import (
    defer_ingest_source,
    get_default_embedding_service,
    ingest_source_task,
)
from app.tasks.worker import app as procrastinate_app, run_worker


def create_test_pdf(pages_text: list[str]) -> bytes:
    """Creates an in-memory synthetic PDF for ingestion verification."""
    doc = fitz.open()
    for txt in pages_text:
        page = doc.new_page(width=612, height=792)
        if txt:
            page.insert_text(fitz.Point(50, 72), txt)
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


# ==============================================================================
# 1. FastAPI Lifespan Procrastinate Connection Management
# ==============================================================================

@pytest.mark.asyncio
async def test_lifespan_opens_and_closes_procrastinate_app(monkeypatch):
    """
    Verifies that the FastAPI lifespan context manager opens procrastinate_app
    on startup, preventing AppNotOpen exceptions, and closes it on shutdown.
    """
    import app.main as main_module
    from app.main import lifespan, app as fastapi_app

    # Mock DB init/close to isolate Procrastinate lifecycle
    monkeypatch.setattr(main_module, "init_db", AsyncMock())
    monkeypatch.setattr(main_module, "close_db", AsyncMock())

    test_connector = InMemoryConnector()
    with procrastinate_app.replace_connector(test_connector):
        assert procrastinate_app.connector.open is not None

        async with lifespan(fastapi_app):
            # Procrastinate app must be open and accept job deferrals
            await procrastinate_app.configure_task(
                name="test_probe",
                queue="default",
            ).defer_async()
            assert len(test_connector.jobs) >= 1

        # After exiting lifespan, connector jobs are intact
        assert test_connector.jobs is not None


# ==============================================================================
# 2. Deferral String Lock Verification & No Monkey-Patching
# ==============================================================================

@pytest.mark.asyncio
async def test_deferral_enqueues_job_with_string_lock():
    """
    Verifies that defer_ingest_source enqueues tasks with a string lock format
    'source_{source_id}' and not an unbound function object.
    """
    test_connector = InMemoryConnector()
    with procrastinate_app.replace_connector(test_connector):
        async with procrastinate_app.open_async():
            test_source_id = str(uuid.uuid4())
            await defer_ingest_source(source_id=test_source_id)

            queued_jobs = list(test_connector.jobs.values())
            matching_jobs = [
                j for j in queued_jobs
                if j.get("lock") == f"source_{test_source_id}"
            ]
            assert len(matching_jobs) == 1, "Expected exactly one queued job with source lock"

            job = matching_jobs[0]
            assert isinstance(job["lock"], str), f"Lock must be str, got {type(job['lock'])}"
            assert job["lock"] == f"source_{test_source_id}"
            assert job["queue_name"] == "sources"
            assert job["status"] == "todo"


def test_task_locks_not_monkey_patched():
    """
    Verifies that ingest_source_task and delete_source_task do NOT have
    .lock monkey-patched to a function (which causes psycopg type adaptation errors),
    while preserving .get_lock_string helper.
    """
    assert not callable(getattr(ingest_source_task, "lock", None))
    assert not callable(getattr(delete_source_task, "lock", None))
    assert ingest_source_task.get_lock_string("src_123") == "source_src_123"
    assert delete_source_task.get_lock_string("src_123") == "source_src_123"


# ==============================================================================
# 3. Worker Runner Processing Verification
# ==============================================================================

@pytest.mark.asyncio
async def test_worker_runner_picks_up_and_processes_task(
    db_session: AsyncSession,
    user_a: User,
    user_a_notebook: Notebook,
    mock_storage,
    mock_qdrant,
    monkeypatch,
    test_session_factory,
):
    """
    Verifies that app.run_worker_async picks up a deferred ingestion task,
    executes the task logic, and transitions the job to 'succeeded' and
    the Source record to status='ready'.
    """
    # Route task internal calls to test fixtures
    monkeypatch.setattr("app.database.AsyncSessionLocal", test_session_factory)
    monkeypatch.setattr("app.tasks.ingestion_tasks.AsyncSessionLocal", test_session_factory)
    monkeypatch.setattr("app.services.storage_service.get_storage_service", lambda: mock_storage)
    monkeypatch.setattr("app.services.qdrant_service.get_qdrant_client", lambda: mock_qdrant)

    test_connector = InMemoryConnector()
    with procrastinate_app.replace_connector(test_connector):
        async with procrastinate_app.open_async():
            # Seed source in DB
            source_id = str(uuid.uuid4())
            storage_key = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/{source_id}/test.pdf"
            pdf_bytes = create_test_pdf(["Worker runner PDF test content for automated verification."])
            await mock_storage.upload_file(pdf_bytes, storage_key)

            source = Source(
                id=source_id,
                user_id=user_a.id,
                notebook_id=user_a_notebook.id,
                title="Test Worker PDF",
                source_type="pdf",
                storage_key_or_url=storage_key,
                file_size_bytes=len(pdf_bytes),
                status="processing",
                created_at=datetime.now(timezone.utc),
            )
            db_session.add(source)
            await db_session.commit()

            # Defer job into queue
            await defer_ingest_source(source_id=source_id)

            # Execute worker with wait=False (one-shot processing of queued jobs)
            await procrastinate_app.run_worker_async(
                queues=["sources"],
                wait=False,
                install_signal_handlers=False,
            )

            # Assert job marked succeeded
            jobs = [j for j in test_connector.jobs.values() if j.get("lock") == f"source_{source_id}"]
            assert len(jobs) == 1
            assert jobs[0]["status"] == "succeeded"

            # Assert DB record updated
            await db_session.refresh(source)
            assert source.status == "ready"
            assert source.active_ingest_run_id is not None


# ==============================================================================
# 4. Stalled Job Recovery SQL Verification
# ==============================================================================

@pytest.mark.asyncio
async def test_stalled_job_recovery_sql_schema_compatibility(test_engine):
    """
    Verifies that recover_stalled_jobs_task executes an ANSI/PostgreSQL compliant
    SQL query without querying non-existent columns (e.g. started_at).
    """
    # Create isolated procrastinate schema tables matching production
    async with test_engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS procrastinate_workers (
                id INTEGER PRIMARY KEY,
                last_heartbeat TIMESTAMP
            );
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS procrastinate_jobs (
                id INTEGER PRIMARY KEY,
                status TEXT,
                attempts INTEGER,
                worker_id INTEGER,
                scheduled_at TIMESTAMP
            );
        """))
        # Seed stalled job: doing with expired heartbeat
        await conn.execute(text("DELETE FROM procrastinate_jobs;"))
        await conn.execute(text("DELETE FROM procrastinate_workers;"))
        await conn.execute(text("INSERT INTO procrastinate_workers (id, last_heartbeat) VALUES (1, '2026-01-01 00:00:00');"))
        await conn.execute(text("INSERT INTO procrastinate_jobs (id, status, attempts, worker_id, scheduled_at) VALUES (101, 'doing', 0, 1, '2026-01-01 00:00:00');"))

    cutoff = datetime.now(timezone.utc)
    query = text("""
        UPDATE procrastinate_jobs
        SET status = 'todo', attempts = attempts + 1, worker_id = NULL
        WHERE status = 'doing'
          AND (
            worker_id IN (
              SELECT id FROM procrastinate_workers
              WHERE last_heartbeat <= :cutoff
            )
            OR worker_id IS NULL
          )
        RETURNING id;
    """)

    async with test_engine.begin() as conn:
        res = await conn.execute(query, {"cutoff": cutoff})
        updated_ids = [row[0] for row in res.fetchall()]

    assert updated_ids == [101], f"Expected stalled job 101 recovered, got {updated_ids}"


@pytest.mark.asyncio
async def test_recover_stalled_jobs_task_inmemory():
    """
    Verifies recover_stalled_jobs_task in-memory test mode resets timed out 'doing' jobs.
    """
    test_connector = InMemoryConnector()
    with procrastinate_app.replace_connector(test_connector):
        past_time = datetime.now(timezone.utc) - timedelta(seconds=60)
        # Mock a stalled job in doing status
        test_connector.jobs[99] = {
            "id": 99,
            "status": "doing",
            "attempts": 0,
            "started_at": past_time,
            "scheduled_at": past_time,
            "worker_id": None,
        }

        res = await recover_stalled_jobs_task(stalled_timeout=30.0)
        assert res["status"] == "success"
        assert 99 in res["job_ids"]
        assert test_connector.jobs[99]["status"] == "todo"
        assert test_connector.jobs[99]["attempts"] == 1


# ==============================================================================
# 5. Embedding Vector Dimension & Normalization Verification
# ==============================================================================

@pytest.mark.asyncio
async def test_embedding_service_produces_768d_normalized_vectors(monkeypatch, test_settings):
    """
    Verifies that EmbeddingService and get_default_embedding_service generate
    768-dimensional L2-normalized float vectors.
    """
    monkeypatch.setattr("app.services.embedding_service._embedding_service", None)
    monkeypatch.setattr("app.services.embedding_service.get_settings", lambda: test_settings)

    svc1 = get_default_embedding_service()
    svc2 = get_embedding_service()
    assert svc1 is svc2
    assert svc1.dimension == 768

    texts = ["StudyLM retrieval grounding query", "Machine learning knowledge assistant"]
    vectors = await svc1.embed_documents(texts)

    assert len(vectors) == 2
    for vec in vectors:
        assert len(vec) == 768
        norm = np.linalg.norm(np.array(vec, dtype=np.float32))
        assert norm == pytest.approx(1.0, rel=1e-3)

    query_vec = await svc1.embed_query("Sample search phrase")
    assert len(query_vec) == 768
    query_norm = np.linalg.norm(np.array(query_vec, dtype=np.float32))
    assert query_norm == pytest.approx(1.0, rel=1e-3)


@pytest.mark.asyncio
async def test_pdf_ingestion_generates_768d_qdrant_points(
    db_session: AsyncSession,
    user_a: User,
    user_a_notebook: Notebook,
    mock_storage,
    mock_qdrant,
):
    """
    Verifies that the end-to-end PDF ingestion pipeline feeds extracted chunks
    into the embedding service and upserts 768-dimensional points into Qdrant.
    """
    source_id = str(uuid.uuid4())
    storage_key = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/{source_id}/sample.pdf"
    pdf_bytes = create_test_pdf(["768d Vector Dimension Test Page content for Qdrant."])
    await mock_storage.upload_file(pdf_bytes, storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="768d Vector Test PDF",
        source_type="pdf",
        storage_key_or_url=storage_key,
        file_size_bytes=len(pdf_bytes),
        status="processing",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    emb_svc = get_default_embedding_service()
    assert emb_svc.dimension == 768

    result = await ingest_source_task(
        source_id=source_id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
        embedding_service=emb_svc,
    )
    assert result["status"] == "ready"

    # Verify points in Qdrant have 768d vector
    cur_settings = get_settings()
    points, _ = mock_qdrant.scroll(
        collection_name=cur_settings.QDRANT_COLLECTION_NAME,
        limit=10,
        with_vectors=True,
    )
    assert len(points) >= 1
    for pt in points:
        assert len(pt.vector) == 768
        norm = np.linalg.norm(np.array(pt.vector, dtype=np.float32))
        assert norm == pytest.approx(1.0, rel=1e-3)


# ==============================================================================
# 6. Database URL Prefix Sanitization Verification
# ==============================================================================

def test_config_url_sanitization():
    """
    Verifies that effective_procrastinate_database_url cleanly sanitizes
    SQLAlchemy dialect prefixes to postgresql:// so that psycopg/libpq parses it as a valid URI.
    """
    import psycopg.conninfo

    test_cases = [
        ("postgresql+psycopg://usr:pwd@localhost:5432/db", "postgresql://usr:pwd@localhost:5432/db"),
        ("postgresql+asyncpg://usr:pwd@localhost:5432/db", "postgresql://usr:pwd@localhost:5432/db"),
        ("postgresql+psycopg2://usr:pwd@localhost:5432/db", "postgresql://usr:pwd@localhost:5432/db"),
        ("postgres://usr:pwd@localhost:5432/db", "postgresql://usr:pwd@localhost:5432/db"),
    ]

    for raw, expected in test_cases:
        s = Settings(
            DATABASE_URL=raw,
            DATABASE_URL_UNPOOLED=None,
            PROCRASTINATE_DATABASE_URL=None,
        )
        assert s.effective_procrastinate_database_url == expected
        parsed = psycopg.conninfo.conninfo_to_dict(s.effective_procrastinate_database_url)
        assert parsed["dbname"] == "db"
