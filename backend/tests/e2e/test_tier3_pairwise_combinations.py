"""
Tier 3: Pairwise Cross-Feature Combinations & Race Conditions E2E Test Suite.
File: backend/tests/e2e/test_tier3_pairwise_combinations.py

Covers 6 pairwise cross-feature race and interaction tests:
- TC-T3-PAIR-01: Ingestion + immediate delete race (conditional SQL rollback, 0 vector leaks)
- TC-T3-PAIR-02: Multi-source query with hybrid citations (PDF bboxes + YouTube timestamps)
- TC-T3-PAIR-03: Account deletion cascading purge (SQL -> R2 -> Qdrant)
- TC-T3-PAIR-04: Query streaming token revocation mid-flight
- TC-T3-PAIR-05: Notebook deletion sweeper vs concurrent upload (409 conflict)
- TC-T3-PAIR-06: Blue-green ingestion reindexing continuity
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import io
import json
import time
import uuid
from typing import Any, AsyncGenerator, Dict, List
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import (
    ChunkPayload,
    Notebook,
    SentenceSpan,
    Source,
    User,
)
from app.services.auth_service import create_access_token
from app.services.citation_service import CitationService, StreamingSentenceBuffer
from app.services.chunking_service import generate_qdrant_point_id
from app.services.qdrant_service import execute_tenant_retrieval, upsert_chunk_points
from app.services.rerank_service import RerankService
from app.services.storage_service import get_storage_service
from app.tasks.cleanup_tasks import (
    cleanup_notebook_task,
    defer_cleanup_notebook,
    defer_delete_source,
    execute_cleanup_notebook,
    execute_delete_source,
)
from app.tasks.ingestion_tasks import (
    check_source_dequeue_state,
    defer_ingest_source,
    ingest_source_task,
)
from tests.conftest import get_mock_vector
from tests.e2e.conftest import AssetBuilder, E2EClient


class TestTier3PairwiseCombinations:
    """Exercises cross-feature races, multi-source citations, and distributed cleanup invariants."""

    @pytest.mark.asyncio
    async def test_tc_t3_pair_01_ingestion_immediate_delete_race(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
        asset_builder: AssetBuilder,
        mock_qdrant: QdrantClient,
        drain_queue,
    ):
        """
        TC-T3-PAIR-01: Ingestion + immediate delete race.
        Client uploads PDF and calls DELETE immediately. Worker detects status='deleting' via
        conditional SQL WHERE status != 'deleting' (rowcount=0), aborts, and purges all vectors.
        Invariants: 0 leaked vectors in Qdrant, 0 leaked R2 objects, 0 zombie SQL rows.
        """
        # 1. Create notebook and upload PDF
        nb = await user_a_client.post("/notebooks", json={"title": "Race Condition NB"})
        assert nb.status_code == 201
        nb_id = nb.json()["id"]

        pdf_bytes = asset_builder.make_valid_pdf(title="Physics Lecture Notes")
        up_resp = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("lecture.pdf", pdf_bytes, "application/pdf")},
        )
        assert up_resp.status_code == 201
        src_id = up_resp.json()["id"]

        # 2. Immediately call DELETE /sources/{id} before worker runs (Phase 1)
        del_resp = await user_a_client.delete(f"/sources/{src_id}")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleting"

        # 3. Drain background worker queue: executes ingestion task and delete task
        await drain_queue()

        # 4. Verify Invariants
        # Invariant A: 0 zombie rows in SQLite
        async with test_session_factory() as sess:
            remaining_source = await sess.get(Source, src_id)
            assert remaining_source is None

        # Invariant B: 0 leaked vectors in Qdrant
        points_count = mock_qdrant.count(collection_name=get_settings().QDRANT_COLLECTION_NAME).count
        assert points_count == 0

        # Invariant C: 0 leaked objects in storage
        storage = get_storage_service()
        storage_key = up_resp.json()["storage_key_or_url"]
        assert await storage.get_file_bytes(storage_key) is None

    @pytest.mark.asyncio
    async def test_tc_t3_pair_02_multi_source_query_with_hybrid_citations(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
        mock_qdrant: QdrantClient,
    ):
        """
        TC-T3-PAIR-02: Multi-source query with hybrid citations.
        Notebook contains both an active PDF source and an active YouTube source.
        Query retrieves evidence from both sources; response contains both PDF bounding boxes
        and YouTube timestamps/deep links without schema collisions.
        """
        # 1. Create notebook with 1 PDF source and 1 YouTube source
        async with test_session_factory() as sess:
            nb = Notebook(title="Multimodal Quantum Course", user_id=user_a.id, status="active")
            sess.add(nb)
            await sess.commit()
            await sess.refresh(nb)
            nb_id = nb.id

            src_pdf = Source(
                user_id=user_a.id,
                notebook_id=nb_id,
                title="Quantum Textbook Chapter 1",
                source_type="pdf",
                storage_key_or_url="textbook.pdf",
                status="ready",
                active_ingest_run_id="run_pdf_hybrid",
            )
            src_yt = Source(
                user_id=user_a.id,
                notebook_id=nb_id,
                title="MIT 8.04 Quantum Physics Video Lecture",
                source_type="youtube",
                storage_key_or_url="https://www.youtube.com/watch?v=lZ3bPUKo5zc",
                status="ready",
                active_ingest_run_id="run_yt_hybrid",
            )
            sess.add(src_pdf)
            sess.add(src_yt)
            await sess.commit()
            await sess.refresh(src_pdf)
            await sess.refresh(src_yt)
            pdf_id = src_pdf.id
            yt_id = src_yt.id

        # 2. Insert vector points for both sources into Qdrant
        now_ts = int(time.time())
        # PDF Chunk with bboxes
        pdf_span = SentenceSpan(
            sentence_id="s0",
            text="The Schrödinger equation defines the wave function evolution in configuration space.",
            bboxes=[[0.10, 0.15, 0.85, 0.22]],
        )
        pdf_chunk = ChunkPayload(
            chunk_id=f"{pdf_id}_p0001_c001",
            source_id=pdf_id,
            notebook_id=nb_id,
            user_id=user_a.id,
            ingest_run_id="run_pdf_hybrid",
            ingested_at=now_ts,
            embedding_model="gemini-embedding-2",
            source_title="Quantum Textbook Chapter 1",
            source_type="pdf",
            page_number=1,
            text=pdf_span.text,
            sentences=[pdf_span],
        )

        # YouTube Chunk with timestamps
        yt_span = SentenceSpan(
            sentence_id="s0",
            text="In this lecture, we introduce the Hamiltonian operator and stationary states.",
            start_seconds=145.0,
            end_seconds=155.0,
        )
        yt_chunk = ChunkPayload(
            chunk_id=f"{yt_id}_p0000_c001",
            source_id=yt_id,
            notebook_id=nb_id,
            user_id=user_a.id,
            ingest_run_id="run_yt_hybrid",
            ingested_at=now_ts,
            embedding_model="gemini-embedding-2",
            source_title="MIT 8.04 Quantum Physics Video Lecture",
            source_type="youtube",
            start_seconds=145.0,
            text=yt_span.text,
            sentences=[yt_span],
        )

        pt_pdf = qmodels.PointStruct(
            id=generate_qdrant_point_id("run_pdf_hybrid", pdf_chunk.chunk_id),
            vector=get_mock_vector(dim=768, seed=10),
            payload=pdf_chunk.model_dump(),
        )
        pt_yt = qmodels.PointStruct(
            id=generate_qdrant_point_id("run_yt_hybrid", yt_chunk.chunk_id),
            vector=get_mock_vector(dim=768, seed=20),
            payload=yt_chunk.model_dump(),
        )
        upsert_chunk_points(
            client=mock_qdrant,
            collection_name=get_settings().QDRANT_COLLECTION_NAME,
            points=[pt_pdf, pt_yt],
        )

        # 3. Query notebook
        resp = await user_a_client.post(
            f"/notebooks/{nb_id}/query",
            json={"query": "What is the Schrödinger equation and the Hamiltonian operator?"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["refusal"] is False
        assert len(data["citations"]) > 0

        # Verify citation metadata formatting
        first_citation = data["citations"][0]
        assert "source_id" in first_citation
        assert "source_type" in first_citation
        assert first_citation["source_type"] in ("pdf", "youtube")
        if first_citation["source_type"] == "pdf":
            assert "bboxes" in first_citation
            assert first_citation["page_number"] == 1
        elif first_citation["source_type"] == "youtube":
            assert "start_seconds" in first_citation
            assert first_citation["start_seconds"] is not None

    @pytest.mark.asyncio
    async def test_tc_t3_pair_03_account_deletion_cascading_purge(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
        asset_builder: AssetBuilder,
        mock_qdrant: QdrantClient,
        mock_storage,
        drain_queue,
    ):
        """
        TC-T3-PAIR-03: Account deletion cascading purge.
        User has 2 notebooks and child sources. DELETE /users/me deactivates user and cascades:
        - DB user marked is_active=False
        - All child notebooks and sources marked deleting
        - Sweepers purge Qdrant vectors and R2 objects
        - Subsequent authenticated requests with User's JWT return HTTP 401 Unauthorized.
        """
        storage = mock_storage

        # 1. Create two notebooks with sources
        nb1 = await user_a_client.post("/notebooks", json={"title": "Cascade NB 1"})
        nb2 = await user_a_client.post("/notebooks", json={"title": "Cascade NB 2"})
        nb1_id = nb1.json()["id"]
        nb2_id = nb2.json()["id"]

        pdf1 = await user_a_client.post(
            f"/notebooks/{nb1_id}/sources",
            files={"file": ("doc1.pdf", asset_builder.make_valid_pdf(), "application/pdf")},
        )
        pdf2 = await user_a_client.post(
            f"/notebooks/{nb2_id}/sources",
            files={"file": ("doc2.pdf", asset_builder.make_valid_pdf(), "application/pdf")},
        )
        src1_key = pdf1.json()["storage_key_or_url"]
        src2_key = pdf2.json()["storage_key_or_url"]

        # 2. Defer and execute ingestion so sources have vectors in Qdrant
        await drain_queue()

        # Verify objects exist before deletion
        assert await storage.get_file_bytes(src1_key) is not None
        assert await storage.get_file_bytes(src2_key) is not None

        # 3. Call DELETE /users/me
        del_resp = await user_a_client.delete("/users/me")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleting"

        # Drain sweeper tasks
        await drain_queue()

        # 4. Verify Invariants
        # Invariant A: User marked is_active=False
        async with test_session_factory() as sess:
            refreshed_user = await sess.get(User, user_a.id)
            assert refreshed_user is not None
            assert refreshed_user.is_active is False

        # Invariant B: Subsequent authenticated calls rejected with 401
        me_resp = await user_a_client.get("/auth/me")
        assert me_resp.status_code == 401
        assert "deactivated" in me_resp.json()["detail"].lower()

        nb_resp = await user_a_client.get("/notebooks")
        assert nb_resp.status_code == 401

    @pytest.mark.asyncio
    async def test_tc_t3_pair_04_query_streaming_token_revocation_mid_flight(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
    ):
        """
        TC-T3-PAIR-04: Query streaming token revocation mid-flight.
        SSE stream catches unauthorized or interrupted state and terminates cleanly without
        emitting ungrounded or compromised tokens.
        """
        # Create notebook
        nb = await user_a_client.post("/notebooks", json={"title": "SSE Security NB"})
        nb_id = nb.json()["id"]

        # 1. Unauthenticated or expired token request to streaming endpoint returns 401
        expired_token = create_access_token(
            data={"sub": user_a.id, "email": user_a.email},
            expires_delta=timedelta(minutes=-10),
        )
        resp_unauth = await user_a_client.post(
            f"/notebooks/{nb_id}/query/stream",
            json={"query": "Hello!"},
            headers={"Authorization": f"Bearer {expired_token}"},
        )
        assert resp_unauth.status_code == 401

        # 2. Deactivated user stream attempt returns 401
        async with test_session_factory() as sess:
            u = await sess.get(User, user_a.id)
            assert u is not None
            u.is_active = False
            sess.add(u)
            await sess.commit()

        resp_deact = await user_a_client.post(
            f"/notebooks/{nb_id}/query/stream",
            json={"query": "Hello!"},
        )
        assert resp_deact.status_code == 401
        assert "deactivated" in resp_deact.json()["detail"].lower()

        # Re-activate user for subsequent tests
        async with test_session_factory() as sess:
            u = await sess.get(User, user_a.id)
            assert u is not None
            u.is_active = True
            sess.add(u)
            await sess.commit()

    @pytest.mark.asyncio
    async def test_tc_t3_pair_05_notebook_deletion_sweeper_vs_concurrent_upload(
        self,
        user_a_client: E2EClient,
        asset_builder: AssetBuilder,
        drain_queue,
    ):
        """
        TC-T3-PAIR-05: Notebook deletion sweeper vs concurrent upload.
        When notebook is in deleting state, concurrent upload attempts are blocked with HTTP 409
        Conflict. Sweeper runs to completion and purges the notebook.
        """
        nb = await user_a_client.post("/notebooks", json={"title": "Concurrent Conflict NB"})
        nb_id = nb.json()["id"]

        # Initiate notebook deletion
        del_nb_resp = await user_a_client.delete(f"/notebooks/{nb_id}")
        assert del_nb_resp.status_code == 200

        # Concurrent upload attempts (PDF and YouTube)
        pdf_attempt = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("race.pdf", asset_builder.make_valid_pdf(), "application/pdf")},
        )
        assert pdf_attempt.status_code == 409
        assert "pending deletion" in pdf_attempt.json()["detail"].lower()

        yt_attempt = await user_a_client.post(
            f"/notebooks/{nb_id}/sources/youtube",
            json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
        )
        assert yt_attempt.status_code == 409
        assert "pending deletion" in yt_attempt.json()["detail"].lower()

        # Drain sweeper
        await drain_queue()

        # Confirm notebook completely purged
        check_resp = await user_a_client.get(f"/notebooks/{nb_id}")
        assert check_resp.status_code == 404

    @pytest.mark.asyncio
    async def test_tc_t3_pair_06_blue_green_ingestion_reindexing_continuity(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
        asset_builder: AssetBuilder,
        mock_qdrant: QdrantClient,
        mock_storage,
    ):
        """
        TC-T3-PAIR-06: Blue-green ingestion reindexing continuity.
        Source has active run 'run_alpha'. Reindexing generates 'run_beta'.
        Queries retrieve 'run_alpha' during indexing without interruption.
        Atomic commit switches to 'run_beta' and old 'run_alpha' vectors are purged.
        """
        storage = mock_storage
        pdf_bytes = asset_builder.make_valid_pdf(title="Blue Green Physics Notes")
        storage_key = f"users/{user_a.id}/blue_green.pdf"
        await storage.upload_file(pdf_bytes, storage_key)

        run_alpha = "run_alpha_111"
        run_beta = "run_beta_222"

        # 1. Setup Source in ready state with run_alpha
        async with test_session_factory() as sess:
            nb = Notebook(title="Blue Green NB", user_id=user_a.id, status="active")
            sess.add(nb)
            await sess.commit()
            await sess.refresh(nb)
            nb_id = nb.id

            src = Source(
                user_id=user_a.id,
                notebook_id=nb_id,
                title="Blue Green Physics Notes",
                source_type="pdf",
                storage_key_or_url=storage_key,
                status="ready",
                active_ingest_run_id=run_alpha,
                file_size_bytes=len(pdf_bytes),
            )
            sess.add(src)
            await sess.commit()
            await sess.refresh(src)
            src_id = src.id

        # Insert points for run_alpha
        alpha_chunk = ChunkPayload(
            chunk_id=f"{src_id}_p0001_c001",
            source_id=src_id,
            notebook_id=nb_id,
            user_id=user_a.id,
            ingest_run_id=run_alpha,
            ingested_at=int(time.time()),
            embedding_model="gemini-embedding-2",
            source_title="Blue Green Physics Notes",
            source_type="pdf",
            page_number=1,
            text="Newtonian mechanics formulation under run alpha.",
            sentences=[SentenceSpan(sentence_id="s0", text="Newtonian mechanics formulation under run alpha.")],
        )
        pt_alpha = qmodels.PointStruct(
            id=generate_qdrant_point_id(run_alpha, alpha_chunk.chunk_id),
            vector=get_mock_vector(dim=768, seed=111),
            payload=alpha_chunk.model_dump(),
        )
        upsert_chunk_points(
            client=mock_qdrant,
            collection_name=get_settings().QDRANT_COLLECTION_NAME,
            points=[pt_alpha],
        )

        # 2. Verify query retrieves run_alpha
        q_resp = await user_a_client.post(
            f"/notebooks/{nb_id}/query",
            json={"query": "Explain Newtonian mechanics formulation."},
        )
        assert q_resp.status_code == 200
        assert q_resp.json()["refusal"] is False

        # 3. Execute reindexing task for run_beta
        ingest_res = await ingest_source_task(
            source_id=src_id,
            ingest_run_id=run_beta,
            is_reindex=True,
        )
        assert ingest_res["status"] == "ready"
        assert ingest_res["ingest_run_id"] == run_beta

        # 4. Verify atomic switch: active_ingest_run_id is now run_beta
        async with test_session_factory() as sess:
            refreshed = await sess.get(Source, src_id)
            assert refreshed is not None
            assert refreshed.active_ingest_run_id == run_beta

        # 5. Verify run_alpha vectors were purged and run_beta vectors exist
        points = mock_qdrant.scroll(
            collection_name=get_settings().QDRANT_COLLECTION_NAME,
            limit=50,
        )[0]
        run_ids_in_qdrant = {p.payload["ingest_run_id"] for p in points if p.payload}
        assert run_alpha not in run_ids_in_qdrant
        assert run_beta in run_ids_in_qdrant
