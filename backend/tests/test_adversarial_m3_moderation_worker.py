"""
Milestone 3 Adversarial & Empirical Probe Suite:
Educational Moderation Barrier, Worker Crash Recovery (kill -9),
Blue-Green Run Isolation, and Vector Reaper Grace Period.
File: backend/tests/test_adversarial_m3_moderation_worker.py
"""

from __future__ import annotations

import asyncio
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import procrastinate
from procrastinate.testing import InMemoryConnector
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

# Monkeypatch procrastinate.App.periodic to allow importing cleanup_tasks
# while capturing the fact that the original decorator in cleanup_tasks is inverted
original_periodic = procrastinate.App.periodic


def _safe_periodic(self, *args, **kwargs):
    def decorator(target):
        # Target may be a raw function or a Task due to decorator order inversion in cleanup_tasks.py
        return target
    return decorator


procrastinate.App.periodic = _safe_periodic

from app.config import get_settings
from app.models import EducationalCheckResult, Notebook, SentenceSpan, Source, User
from app.services.moderation_service import EducationalModerationService, get_moderation_service
from app.services.youtube_service import (
    YouTubeNonEducationalContentError,
    YouTubeService,
    YouTubeTranscriptUnavailableError,
)
from app.services.qdrant_service import (
    delete_tenant_vectors,
    execute_tenant_retrieval,
    upsert_chunk_points,
)
from app.tasks.cleanup_tasks import (
    get_source_task_lock,
    reap_stale_vectors_task,
    recover_stalled_jobs_task,
)
from app.tasks.ingestion_tasks import (
    defer_ingest_source,
    ingest_source_task,
    process_youtube_source_ingestion,
)
from app.tasks.worker import app as procrastinate_app


# ==============================================================================
# SECTION 1: Codebase Defect Verification (Procrastinate Decorator Inversion)
# ==============================================================================

def test_verify_procrastinate_decorator_inversion_root_cause():
    """
    Empirical probe demonstrating why importing cleanup_tasks without monkeypatching
    crashes with AttributeError: 'function' object has no attribute 'name'.
    In Procrastinate, @app.periodic registers a Task object (which has .name).
    When @app.task is placed ABOVE @app.periodic, @app.periodic is evaluated first
    and receives the raw function, which lacks .name.
    """
    dummy_app = procrastinate.App(connector=InMemoryConnector())
    
    # Try the order used in cleanup_tasks.py:
    # @app.task
    # @app.periodic
    def dummy_func():
        pass

    with pytest.raises(AttributeError) as exc_info:
        # Applying @dummy_app.periodic first to a raw function:
        decorator = original_periodic(dummy_app, cron="0 * * * *")
        decorator(dummy_func)  # FAILS because dummy_func has no .name attribute!

    assert "'function' object has no attribute 'name'" in str(exc_info.value)


# ==============================================================================
# SECTION 2: Educational Moderation Barrier (ING-19 Empirical Probes)
# ==============================================================================

class TestEducationalModerationBarrier:
    """Empirical adversarial test harness for Two-Tier Educational Content Barrier."""

    @pytest.fixture(autouse=True)
    def setup_moderator(self):
        self.settings = get_settings()
        self.moderator = EducationalModerationService()

    # --------------------------------------------------------------------------
    # Tier 1 Heuristics: Educational Passes
    # --------------------------------------------------------------------------
    @pytest.mark.parametrize(
        "title,description,tags",
        [
            (
                "MIT 18.06 Linear Algebra Lecture 1: Vector Spaces",
                "Full university lecture covering vector space axioms and linear independence.",
                ["math", "lecture", "linear algebra"],
            ),
            (
                "Stanford CS229 Machine Learning Course Tutorial Chapter 2",
                "Syllabus and derivation of cost functions in gradient descent textbook chapter.",
                ["tutorial", "course", "computer science"],
            ),
            (
                "Physics Seminar: Quantum Mechanics Proof and Derivation",
                "Academic workshop discussing mathematical concepts and derivations.",
                ["physics", "proof", "derivation"],
            ),
        ],
    )
    def test_tier1_educational_clear_pass(self, title, description, tags):
        """Educational videos matching >=2 anchor keywords and 0 negative flags pass in Tier 1."""
        result = self.moderator.evaluate_tier1_heuristics(title, description, tags)
        assert result is not None
        assert result.is_educational is True
        assert result.confidence >= 0.90
        assert "academic/educational indicators" in result.reason.lower()

    # --------------------------------------------------------------------------
    # Tier 1 Heuristics: Non-Educational Rejection
    # --------------------------------------------------------------------------
    @pytest.mark.parametrize(
        "title,description,tags",
        [
            (
                "Taylor Swift - Summer Love (Official Music Video)",
                "Stream the new hit single official music video everywhere now!",
                ["music", "official music video"],
            ),
            (
                "Top 10 Fortnite Gameplay Highlights Ep 42",
                "Best victory royale gameplay moments and funny fails.",
                ["gaming", "gameplay"],
            ),
            (
                "I Spent 24 Hours in a Box Prank Vlog",
                "Crazy prank on my friends in this weekend vlog challenge.",
                ["vlog", "prank"],
            ),
            (
                "Insane 50,000 Calorie Fast Food Mukbang Challenge",
                "Eating all the burgers in one sitting mukbang.",
                ["mukbang", "food"],
            ),
            (
                "Avengers Secret Wars Official Trailer Teaser 4K",
                "Watch the exclusive trailer teaser preview in theaters.",
                ["trailer", "teaser"],
            ),
        ],
    )
    def test_tier1_non_educational_clear_rejection(self, title, description, tags):
        """Non-educational videos matching negative entertainment flags are rejected in Tier 1."""
        result = self.moderator.evaluate_tier1_heuristics(title, description, tags)
        assert result is not None
        assert result.is_educational is False
        assert result.confidence >= 0.90
        assert "entertainment indicators" in result.reason.lower()

    # --------------------------------------------------------------------------
    # Tier 1 Ambiguity: Escalates to Tier 2 LLM Classifier
    # --------------------------------------------------------------------------
    @pytest.mark.parametrize(
        "title,description,tags",
        [
            (
                "Quantum Computing Overview",  # Only 0-1 explicit keywords
                "General discussion on qubits and superposition.",
                [],
            ),
            (
                "Italian Pasta Making Tutorial",  # 1 keyword ("tutorial") but cooking topic
                "Learn how to roll pasta from scratch with nonna.",
                ["cooking"],
            ),
            (
                "Physics Parody Music Video",  # 1 positive ("physics") + 1 negative ("music video")
                "A fun song about gravity and relativity.",
                ["music video", "physics"],
            ),
        ],
    )
    def test_tier1_ambiguous_escalates_to_tier2(self, title, description, tags):
        """Ambiguous content or mixed signals return None from Tier 1, escalating to Tier 2."""
        result = self.moderator.evaluate_tier1_heuristics(title, description, tags)
        assert result is None, f"Expected None for ambiguous content, got {result}"

    # --------------------------------------------------------------------------
    # Tier 2 LLM Classifier: Fast Zero-Shot Classification
    # --------------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_tier2_llm_approved(self):
        """Tier 2 approves academic content when LLM returns is_educational=true."""
        mock_gemini = AsyncMock()
        mock_response = MagicMock()
        mock_response.text = '{"is_educational": true, "confidence": 0.98, "reason": "Academic physics lecture"}'
        mock_gemini.aio.models.generate_content.return_value = mock_response

        moderator = EducationalModerationService(gemini_client=mock_gemini)
        result = await moderator.evaluate_tier2_llm_classifier("Quantum Computing Overview")

        assert result.is_educational is True
        assert result.confidence == 0.98
        assert result.reason == "Academic physics lecture"

    @pytest.mark.asyncio
    async def test_tier2_llm_rejected(self):
        """Tier 2 rejects non-academic content when LLM returns is_educational=false."""
        mock_gemini = AsyncMock()
        mock_response = MagicMock()
        mock_response.text = '{"is_educational": false, "confidence": 0.95, "reason": "Culinary entertainment"}'
        mock_gemini.aio.models.generate_content.return_value = mock_response

        moderator = EducationalModerationService(gemini_client=mock_gemini)
        result = await moderator.evaluate_tier2_llm_classifier("Italian Pasta Making Tutorial")

        assert result.is_educational is False
        assert result.confidence == 0.95
        assert "Culinary entertainment" in result.reason

    @pytest.mark.asyncio
    async def test_tier2_llm_markdown_code_block_stripping(self):
        """Tier 2 cleanly strips ```json markdown fences returned by LLMs."""
        mock_gemini = AsyncMock()
        mock_response = MagicMock()
        mock_response.text = "```json\n{\"is_educational\": true, \"confidence\": 0.92, \"reason\": \"Tutorial\"}\n```"
        mock_gemini.aio.models.generate_content.return_value = mock_response

        moderator = EducationalModerationService(gemini_client=mock_gemini)
        result = await moderator.evaluate_tier2_llm_classifier("Calculus Basics")

        assert result.is_educational is True
        assert result.confidence == 0.92

    @pytest.mark.asyncio
    async def test_tier2_llm_failure_conservative_reject(self):
        """If LLM call raises exception or returns invalid output, fail conservatively."""
        mock_gemini = AsyncMock()
        mock_gemini.aio.models.generate_content.side_effect = RuntimeError("503 Service Unavailable")

        moderator = EducationalModerationService(gemini_client=mock_gemini)
        result = await moderator.evaluate_tier2_llm_classifier("Dubious Title")

        assert result.is_educational is False
        assert result.confidence == 0.60
        assert "LLM classifier evaluation failed" in result.reason

    # --------------------------------------------------------------------------
    # Privacy Shielding & Zero Persistence Verification
    # --------------------------------------------------------------------------
    @pytest.mark.asyncio
    async def test_rejection_complete_suppression_and_zero_persistence(self, db_session: AsyncSession, test_user, test_notebook):
        """
        Adversarial probe:
        When a non-educational video is ingested:
        1. status = 'error'
        2. error_code = 'ERR_NON_EDUCATIONAL_CONTENT'
        3. error_message = exact required message
        4. title = '[Suppressed: Non-Educational Content]'
        5. summary is None
        6. zero transcript fetching / persistence
        7. zero vectors inserted into Qdrant
        """
        source = Source(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            notebook_id=test_notebook.id,
            title="Katy Perry - Roar (Official Music Video)",
            source_type="youtube",
            storage_key_or_url="https://www.youtube.com/watch?v=CevxZvSJLk8",
            status="processing",
            summary="Initial unmoderated summary",
        )
        db_session.add(source)
        await db_session.commit()

        yt_service = YouTubeService()
        mock_qdrant = MagicMock()
        mock_embed = AsyncMock()

        # Spy on fetch_raw_transcript to assert it is NEVER called
        with patch.object(
            yt_service,
            "get_video_metadata",
            return_value={
                "title": "Katy Perry - Roar (Official Music Video)",
                "description": "Music video pop star",
                "tags": ["official music video"],
            },
        ):
            with patch.object(yt_service, "fetch_raw_transcript") as mock_transcript:
                res = await process_youtube_source_ingestion(
                    source=source,
                    session=db_session,
                    qdrant_client=mock_qdrant,
                    embedding_service=mock_embed,
                    youtube_service=yt_service,
                )

        # Assert pipeline returned error immediately
        assert res["status"] == "error"
        assert res["error_code"] == "ERR_NON_EDUCATIONAL_CONTENT"
        assert res["error_message"] == (
            "Upload educational related video, this video does not have educational content please recheck the link"
        )

        # Reload source from database
        await db_session.refresh(source)
        assert source.status == "error"
        assert source.error_code == "ERR_NON_EDUCATIONAL_CONTENT"
        assert source.error_message == (
            "Upload educational related video, this video does not have educational content please recheck the link"
        )
        # CRITICAL ASSERTIONS: COMPLETE TITLE MASKING & SUMMARY NULLIFICATION
        assert source.title == "[Suppressed: Non-Educational Content]"
        assert source.summary is None

        # ZERO TRANSCRIPT PERSISTENCE
        assert mock_transcript.call_count == 0, "Transcript must NEVER be fetched for rejected videos!"

        # ZERO VECTOR PERSISTENCE
        assert mock_embed.embed_documents.call_count == 0
        assert mock_qdrant.upsert.call_count == 0


# ==============================================================================
# SECTION 3: Worker Crash Recovery (kill -9) & Resilience (ING-08)
# ==============================================================================

class TestWorkerCrashRecovery:
    """Empirical probe for kill -9 worker stalled job recovery within 30s."""

    @pytest.fixture(autouse=True)
    def setup_in_memory_connector(self):
        old_connector = procrastinate_app.connector
        in_mem = InMemoryConnector()
        procrastinate_app.connector = in_mem
        yield in_mem
        procrastinate_app.connector = old_connector

    @pytest.mark.asyncio
    async def test_stalled_job_recovery_above_30s_timeout(self, setup_in_memory_connector):
        """
        Jobs stranded in 'doing' whose worker died (kill -9) with started_at > 30s ago
        are recovered and reset back to 'todo' with incremented attempts.
        """
        connector = setup_in_memory_connector

        class MockJob:
            def __init__(self, jid, status, started_at, attempts=0):
                self.id = jid
                self.status = status
                self.started_at = started_at
                self.attempts = attempts

        past_time = datetime.now(timezone.utc) - timedelta(seconds=35)
        connector.jobs[101] = MockJob(101, procrastinate.jobs.Status.DOING, past_time, attempts=0)

        # Run recovery task with 30s timeout
        result = await recover_stalled_jobs_task(stalled_timeout=30.0)

        assert result["status"] == "success"
        assert 101 in result["job_ids"]
        # Verify job is back in TODO
        assert connector.jobs[101].status == procrastinate.jobs.Status.TODO
        assert connector.jobs[101].attempts == 1

    @pytest.mark.asyncio
    async def test_active_job_within_30s_is_not_recovered(self, setup_in_memory_connector):
        """
        Jobs in 'doing' whose worker is actively working (started_at < 30s ago)
        must NOT be prematurely recovered.
        """
        connector = setup_in_memory_connector

        class MockJob:
            def __init__(self, jid, status, started_at, attempts=0):
                self.id = jid
                self.status = status
                self.started_at = started_at
                self.attempts = attempts

        recent_time = datetime.now(timezone.utc) - timedelta(seconds=15)
        connector.jobs[202] = MockJob(202, procrastinate.jobs.Status.DOING, recent_time, attempts=0)

        result = await recover_stalled_jobs_task(stalled_timeout=30.0)

        assert result["status"] == "success"
        assert 202 not in result["job_ids"]
        # Remains in DOING
        assert connector.jobs[202].status == procrastinate.jobs.Status.DOING


# ==============================================================================
# SECTION 4: Blue-Green Run Isolation & Search Continuity (ING-10, ING-11)
# ==============================================================================

class TestBlueGreenRunIsolation:
    """Empirical probe for Blue-Green vector indexing and retrieval isolation."""

    @pytest.mark.asyncio
    async def test_search_sees_only_active_run_vectors(self, mock_qdrant, test_user, test_notebook):
        """
        During ingestion, points belonging to an uncommitted ingest_run_id
        must be completely invisible to retrieval queries filtering by active_run_id.
        """
        active_run_id = "run_blue_active"
        uncommitted_run_id = "run_green_uncommitted"

        # Point for active run
        pt_active = qmodels.PointStruct(
            id=str(uuid.uuid4()),
            vector=[0.1] * 768,
            payload={
                "user_id": test_user.id,
                "notebook_id": test_notebook.id,
                "source_id": "src_bg_test",
                "ingest_run_id": active_run_id,
                "text": "Active committed lecture notes on quantum mechanics.",
                "sentences": [],
            },
        )
        # Point for green in-flight run
        pt_green = qmodels.PointStruct(
            id=str(uuid.uuid4()),
            vector=[0.1] * 768,
            payload={
                "user_id": test_user.id,
                "notebook_id": test_notebook.id,
                "source_id": "src_bg_test",
                "ingest_run_id": uncommitted_run_id,
                "text": "Uncommitted draft chunk.",
                "sentences": [],
            },
        )
        upsert_chunk_points(mock_qdrant, "studylm_chunks", [pt_active, pt_green])

        # Execute tenant retrieval strictly scoped to active_run_id
        results = execute_tenant_retrieval(
            client=mock_qdrant,
            collection_name="studylm_chunks",
            user_id=test_user.id,
            active_run_ids=[active_run_id],
        )

        assert len(results) == 1
        assert results[0].payload["ingest_run_id"] == active_run_id
        assert "Active committed lecture notes" in results[0].payload["text"]

    @pytest.mark.asyncio
    async def test_reindex_failure_preserves_active_run_and_search_online(self, db_session: AsyncSession, mock_storage, test_user, test_notebook):
        """
        ING-11: When re-indexing fails, existing source remains status='ready',
        reindexing is cleared to False, and original active_ingest_run_id is preserved.
        """
        orig_run_id = "run_original_committed"
        source = Source(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            notebook_id=test_notebook.id,
            title="Stable Document",
            source_type="pdf",
            storage_key_or_url="corrupted_file.pdf",
            status="ready",
            reindexing=True,
            active_ingest_run_id=orig_run_id,
        )
        db_session.add(source)
        await db_session.commit()

        # Ingestion fails due to corrupt PDF
        with pytest.raises(Exception):
            await ingest_source_task(
                source_id=source.id,
                is_reindex=True,
                storage_service=mock_storage,
                session=db_session,
            )

        await db_session.refresh(source)
        # Verify status is NOT set to 'error'! Search stays online!
        assert source.status == "ready"
        assert source.reindexing is False
        assert source.active_ingest_run_id == orig_run_id


# ==============================================================================
# SECTION 5: Vector Reaper Grace Period & Active Locks (ING-12, ING-18)
# ==============================================================================

class TestVectorReaperGracePeriod:
    """Empirical probe for 2-hour grace period and locked source skipping."""

    @pytest.mark.asyncio
    async def test_reaper_preserves_recent_points_under_2_hours(self, mock_qdrant, db_session: AsyncSession, test_user):
        """Points younger than 2 hours (7200s) are preserved regardless of reference state."""
        now_ts = int(time.time())
        # Point 1 hour old (3600s < 7200s)
        pt_recent = qmodels.PointStruct(
            id=str(uuid.uuid4()),
            vector=[0.1] * 768,
            payload={
                "user_id": test_user.id,
                "source_id": "src_unreferenced_recent",
                "ingest_run_id": "run_young_orphan",
                "ingested_at": now_ts - 3600,
            },
        )
        upsert_chunk_points(mock_qdrant, "studylm_chunks", [pt_recent])

        reap_res = await reap_stale_vectors_task(
            grace_period_seconds=7200,
            qdrant_client=mock_qdrant,
            session=db_session,
        )

        assert reap_res["status"] == "completed"
        records, _ = mock_qdrant.scroll(collection_name="studylm_chunks", limit=100)
        assert any(r.payload.get("ingest_run_id") == "run_young_orphan" for r in records), (
            "Point younger than 2-hour grace period must NOT be reaped!"
        )

    @pytest.mark.asyncio
    async def test_reaper_skips_active_locked_and_processing_sources(self, mock_qdrant, db_session: AsyncSession, test_user, test_notebook):
        """Points older than 2 hours are skipped if the source holds an active queue lock or is processing."""
        now_ts = int(time.time())
        old_ts = now_ts - 10000  # ~2.7 hours old

        source_proc = Source(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            notebook_id=test_notebook.id,
            title="In-Flight Source",
            source_type="pdf",
            storage_key_or_url="key_inflight",
            status="processing",  # Actively processing!
        )
        db_session.add(source_proc)
        await db_session.commit()

        pt_inflight = qmodels.PointStruct(
            id=str(uuid.uuid4()),
            vector=[0.1] * 768,
            payload={
                "user_id": test_user.id,
                "source_id": source_proc.id,
                "ingest_run_id": "run_processing_old",
                "ingested_at": old_ts,
            },
        )
        upsert_chunk_points(mock_qdrant, "studylm_chunks", [pt_inflight])

        reap_res = await reap_stale_vectors_task(
            grace_period_seconds=7200,
            qdrant_client=mock_qdrant,
            session=db_session,
        )

        assert reap_res["status"] == "completed"
        records, _ = mock_qdrant.scroll(collection_name="studylm_chunks", limit=100)
        assert any(r.payload.get("ingest_run_id") == "run_processing_old" for r in records), (
            "Point belonging to processing source must be skipped by reaper!"
        )

    @pytest.mark.asyncio
    async def test_reaper_purges_stale_unreferenced_runs_older_than_2_hours(self, mock_qdrant, db_session: AsyncSession, test_user, test_notebook):
        """Points older than 2 hours that are unreferenced (replaced or failed) are cleanly purged."""
        now_ts = int(time.time())
        old_ts = now_ts - 10000

        source_ready = Source(
            id=str(uuid.uuid4()),
            user_id=test_user.id,
            notebook_id=test_notebook.id,
            title="Updated Source",
            source_type="pdf",
            storage_key_or_url="key_ready",
            status="ready",
            active_ingest_run_id="run_current_active",
        )
        db_session.add(source_ready)
        await db_session.commit()

        # Point for active run (keep)
        pt_active = qmodels.PointStruct(
            id=str(uuid.uuid4()),
            vector=[0.1] * 768,
            payload={
                "user_id": test_user.id,
                "source_id": source_ready.id,
                "ingest_run_id": "run_current_active",
                "ingested_at": old_ts,
            },
        )
        # Point for stale replaced run (purge)
        pt_stale_run = qmodels.PointStruct(
            id=str(uuid.uuid4()),
            vector=[0.1] * 768,
            payload={
                "user_id": test_user.id,
                "source_id": source_ready.id,
                "ingest_run_id": "run_old_superseded",
                "ingested_at": old_ts,
            },
        )
        upsert_chunk_points(mock_qdrant, "studylm_chunks", [pt_active, pt_stale_run])

        reap_res = await reap_stale_vectors_task(
            grace_period_seconds=7200,
            qdrant_client=mock_qdrant,
            session=db_session,
        )

        assert reap_res["status"] == "completed"
        records, _ = mock_qdrant.scroll(collection_name="studylm_chunks", limit=100)
        remaining_runs = {r.payload.get("ingest_run_id") for r in records}
        assert "run_current_active" in remaining_runs, "Active run must be retained!"
        assert "run_old_superseded" not in remaining_runs, "Stale superseded run >2h must be purged!"
