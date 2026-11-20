"""
Tier 4: Real-World Application Scenarios E2E Test Suite.
File: backend/tests/e2e/test_tier4_real_world_scenarios.py

Covers 4 multi-step end-to-end user workflows:
- TC-T4-E2E-01: Full Student Study Session Workflow (register -> create notebook -> upload PDF & YouTube -> drain queue -> query grounded Q&A -> SSE stream follow-up -> delete source -> verify cleanup)
- TC-T4-E2E-02: Multi-Tenant Academic Lab Isolation Workflow (Alice & Bob independent workspaces, cross-access 404s, 0 vector leakage)
- TC-T4-E2E-03: Research Session Resume & Document Summarization Workflow (upload -> summarize -> range stream -> presigned url -> reload session)
- TC-T4-E2E-04: Quota Saturation & Recovery Workflow (fill 20 sources -> 21st rejected with 400 -> delete 2 -> upload 2 succeeds)
"""

from __future__ import annotations

import asyncio
import io
import json
import time
import uuid
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import (
    ChunkPayload,
    Notebook,
    SentenceSpan,
    Source,
    User,
)
from app.services.chunking_service import generate_qdrant_point_id
from app.services.moderation_service import EducationalCheckResult
from app.services.qdrant_service import upsert_chunk_points
from app.services.youtube_service import YouTubeService
from tests.conftest import get_mock_vector
from tests.e2e.conftest import AssetBuilder, E2EClient


class TestTier4RealWorldScenarios:
    """Simulates realistic end-to-end student and researcher operational journeys."""

    @pytest.mark.asyncio
    async def test_tc_t4_e2e_01_full_student_study_session_workflow(
        self,
        async_client: AsyncClient,
        test_session_factory: async_sessionmaker,
        asset_builder: AssetBuilder,
        mock_qdrant: QdrantClient,
        mock_storage,
        drain_queue,
    ):
        """
        TC-T4-E2E-01: Full Student Study Session Workflow.
        1. Student authenticates via Google OAuth (POST /auth/google).
        2. Creates notebook 'Quantum Mechanics 101'.
        3. Uploads syllabus PDF lecture material.
        4. Ingests video lecture from YouTube.
        5. Background worker processes both sources to status='ready'.
        6. Student lists sources (GET /notebooks/{id}/sources).
        7. Student submits query: 'What is the Schrödinger equation and its physical interpretation?'
        8. Receives grounded answer with citations.
        9. Student asks conversational follow-up via SSE stream.
        10. Student deletes syllabus PDF; verifies cleanup and remaining video source.
        """
        # Step 1: Authentication via Google OAuth
        auth_token = "mock_google_token_student42_student42@mit.edu_Alice Student"
        login_resp = await async_client.post("/auth/google", json={"id_token": auth_token})
        assert login_resp.status_code == 200
        auth_data = login_resp.json()
        student_jwt = auth_data["access_token"]
        student_id = auth_data["user"]["id"]
        client = E2EClient(async_client, token=student_jwt)

        # Step 2: Create notebook
        nb_resp = await client.post("/notebooks", json={"title": "Quantum Mechanics 101"})
        assert nb_resp.status_code == 201
        nb_id = nb_resp.json()["id"]

        # Step 3: Upload course syllabus PDF
        pdf_bytes = asset_builder.make_valid_pdf(
            title="Quantum Mechanics Syllabus",
            text="The Schrödinger equation describes wave function mechanics. Energy eigenvalues are quantized.",
        )
        pdf_resp = await client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("syllabus.pdf", pdf_bytes, "application/pdf")},
        )
        assert pdf_resp.status_code == 201
        pdf_id = pdf_resp.json()["id"]

        # Step 4: Ingest YouTube video lecture
        with patch.object(
            YouTubeService,
            "check_educational_relevance",
            new_callable=AsyncMock,
            return_value=EducationalCheckResult(
                is_educational=True,
                reason="MIT Quantum Physics Lecture",
                confidence=0.98,
            ),
        ), patch.object(
            YouTubeService,
            "fetch_raw_transcript",
            return_value=asset_builder.sample_youtube_transcript(),
        ):
            yt_resp = await client.post(
                f"/notebooks/{nb_id}/sources/youtube",
                json={
                    "url": "https://www.youtube.com/watch?v=lZ3bPUKo5zc",
                    "title": "MIT 8.04 Quantum Physics Lecture 1",
                },
            )
            assert yt_resp.status_code == 201
            yt_id = yt_resp.json()["id"]

            # Step 5: Drain background worker queue
            await drain_queue()

        # Step 6: List sources and verify both are status='ready'
        sources_resp = await client.get(f"/notebooks/{nb_id}/sources")
        assert sources_resp.status_code == 200
        sources = sources_resp.json()
        assert len(sources) == 2
        statuses = {s["id"]: s["status"] for s in sources}
        assert statuses[pdf_id] == "ready"
        assert statuses[yt_id] == "ready"

        # Step 7: Submit grounded Q&A query
        query_resp = await client.post(
            f"/notebooks/{nb_id}/query",
            json={"query": "What is the Schrödinger equation and energy eigenvalues?"},
        )
        assert query_resp.status_code == 200
        query_data = query_resp.json()
        assert query_data["refusal"] is False
        assert len(query_data["answer"]) > 0

        # Step 8: Multi-turn conversational follow-up via SSE Stream
        stream_resp = await client.post(
            f"/notebooks/{nb_id}/query/stream",
            json={"query": "Can you elaborate on this?"},
        )
        assert stream_resp.status_code == 200
        assert "text/event-stream" in stream_resp.headers["content-type"]
        assert "event:" in stream_resp.text

        # Step 9: Delete syllabus PDF (Phase 1)
        del_resp = await client.delete(f"/sources/{pdf_id}")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleting"

        # Step 10: Drain deletion worker task and verify state
        await drain_queue()

        # PDF source is completely removed from list
        updated_sources_resp = await client.get(f"/notebooks/{nb_id}/sources")
        assert updated_sources_resp.status_code == 200
        updated_sources = updated_sources_resp.json()
        assert len(updated_sources) == 1
        assert updated_sources[0]["id"] == yt_id

        # Verify PDF cannot be accessed
        pdf_check = await client.get(f"/sources/{pdf_id}")
        assert pdf_check.status_code == 404

    @pytest.mark.asyncio
    async def test_tc_t4_e2e_02_multitenant_academic_lab_isolation_workflow(
        self,
        async_client: AsyncClient,
        test_session_factory: async_sessionmaker,
        asset_builder: AssetBuilder,
        mock_qdrant: QdrantClient,
        drain_queue,
    ):
        """
        TC-T4-E2E-02: Multi-Tenant Academic Lab Isolation Workflow.
        Alice and Bob operate in isolated workspaces:
        - Bob cannot GET, query, or upload to Alice's notebooks (HTTP 404 anti-enumeration).
        - Bob's queries have 0 vector leakage from Alice's confidential documents.
        - Alice's account deletion does not impact Bob's workspace or queries.
        """
        # 1. Register Alice and Bob
        alice_login = await async_client.post(
            "/auth/google",
            json={"id_token": "mock_google_token_alice1_alice@lab.edu_Alice Principal"},
        )
        alice_client = E2EClient(async_client, token=alice_login.json()["access_token"])

        bob_login = await async_client.post(
            "/auth/google",
            json={"id_token": "mock_google_token_bob2_bob@lab.edu_Bob Researcher"},
        )
        bob_client = E2EClient(async_client, token=bob_login.json()["access_token"])

        # 2. Alice creates confidential notebook; Bob creates literature review notebook
        alice_nb = (await alice_client.post("/notebooks", json={"title": "Proprietary Lab Findings"})).json()
        bob_nb = (await bob_client.post("/notebooks", json={"title": "Public Literature Review"})).json()
        alice_nb_id = alice_nb["id"]
        bob_nb_id = bob_nb["id"]

        # 3. Alice uploads confidential PDF; Bob uploads public review PDF
        alice_pdf = asset_builder.make_valid_pdf(
            title="Confidential Compound Patent",
            text="Compound-X99 exhibits 99.8% inhibition in catalytic binding trials.",
        )
        bob_pdf = asset_builder.make_valid_pdf(
            title="Public Domain Biochemistry",
            text="Enzyme kinetics follow standard Michaelis-Menten hyperbolic curves.",
        )
        await alice_client.post(
            f"/notebooks/{alice_nb_id}/sources",
            files={"file": ("compound.pdf", alice_pdf, "application/pdf")},
        )
        await bob_client.post(
            f"/notebooks/{bob_nb_id}/sources",
            files={"file": ("review.pdf", bob_pdf, "application/pdf")},
        )

        # 4. Drain queue to ingest both sources
        await drain_queue()

        # 5. Cross-Tenant Defense: Bob attempts unauthorized access to Alice's notebook
        # A: Bob GET Alice notebook -> 404 (SEC-01 anti-enumeration)
        get_res = await bob_client.get(f"/notebooks/{alice_nb_id}")
        assert get_res.status_code == 404

        # B: Bob POST query Alice notebook -> 404
        query_res = await bob_client.post(
            f"/notebooks/{alice_nb_id}/query",
            json={"query": "What is Compound-X99?"},
        )
        assert query_res.status_code == 404

        # C: Bob POST upload to Alice notebook -> 404
        upload_res = await bob_client.post(
            f"/notebooks/{alice_nb_id}/sources",
            files={"file": ("leak.pdf", asset_builder.make_valid_pdf(), "application/pdf")},
        )
        assert upload_res.status_code == 404

        # 6. Bob queries his own notebook: verify 0 vector leakage from Alice's document
        bob_q_res = await bob_client.post(
            f"/notebooks/{bob_nb_id}/query",
            json={"query": "What are the properties of Compound-X99?"},
        )
        assert bob_q_res.status_code == 200
        # Should refuse or answer based ONLY on Michaelis-Menten, with 0 mentions of Compound-X99
        assert "Compound-X99" not in bob_q_res.json()["answer"]

        # 7. Alice deletes her account
        del_alice = await alice_client.delete("/users/me")
        assert del_alice.status_code == 200
        await drain_queue()

        # 8. Bob's notebook and queries remain 100% functional
        bob_check = await bob_client.get(f"/notebooks/{bob_nb_id}")
        assert bob_check.status_code == 200
        assert bob_check.json()["title"] == "Public Literature Review"

        bob_valid_q = await bob_client.post(
            f"/notebooks/{bob_nb_id}/query",
            json={"query": "Explain Michaelis-Menten kinetics."},
        )
        assert bob_valid_q.status_code == 200
        assert bob_valid_q.json()["refusal"] is False

    @pytest.mark.asyncio
    async def test_tc_t4_e2e_03_research_session_resume_and_summarization_workflow(
        self,
        user_a_client: E2EClient,
        asset_builder: AssetBuilder,
        drain_queue,
    ):
        """
        TC-T4-E2E-03: Research Session Resume & Document Summarization Workflow.
        1. Authenticated user creates notebook.
        2. Uploads multi-page academic PDF.
        3. Triggers token-driven summarization (POST /sources/{id}/summarize).
        4. Performs HTTP 206 partial content streaming byte range requests.
        5. Requests 15-minute presigned download URL.
        6. Resumes session via GET /auth/me and inspects message history.
        """
        # 1. Create notebook
        nb_resp = await user_a_client.post("/notebooks", json={"title": "Distributed Consensus Systems"})
        assert nb_resp.status_code == 201
        nb_id = nb_resp.json()["id"]

        # 2. Upload multi-page research paper PDF
        pdf_bytes = asset_builder.make_multipage_pdf(
            pages=4,
            title="Paxos and Raft Consensus Comparison",
        )
        up_resp = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("consensus.pdf", pdf_bytes, "application/pdf")},
        )
        assert up_resp.status_code == 201
        src_id = up_resp.json()["id"]

        # Ingest
        await drain_queue()

        # 3. Document summarization
        sum_resp = await user_a_client.post(f"/sources/{src_id}/summarize")
        assert sum_resp.status_code == 200
        sum_data = sum_resp.json()
        assert "summary" in sum_data
        assert sum_data["strategy"] in ("full_context", "hierarchical_outline")
        assert len(sum_data["summary"]) > 0

        # 4. HTTP 206 Partial Content byte range requests
        # Request first 512 bytes
        range_resp = await user_a_client.get(
            f"/sources/{src_id}/stream",
            headers={"Range": "bytes=0-511"},
        )
        assert range_resp.status_code == 206
        assert len(range_resp.content) == 512
        assert "bytes 0-511/" in range_resp.headers["Content-Range"]
        assert range_resp.headers["Accept-Ranges"] == "bytes"

        # 5. Presigned download URL
        ps_resp = await user_a_client.get(f"/sources/{src_id}/presigned-url")
        assert ps_resp.status_code == 200
        assert "presigned_url" in ps_resp.json()
        assert ps_resp.json()["expires_in"] == 900

        # 6. Post a chat message and simulate session reload
        msg_resp = await user_a_client.post(
            f"/notebooks/{nb_id}/messages",
            json={"role": "user", "content": "What is the difference between Paxos and Raft?"},
        )
        assert msg_resp.status_code == 201

        # Reload session: GET /auth/me reflects active notebook
        me_resp = await user_a_client.get("/auth/me")
        assert me_resp.status_code == 200
        assert me_resp.json()["last_active_notebook_id"] == nb_id

        # Reload messages
        history_resp = await user_a_client.get(f"/notebooks/{nb_id}/messages")
        assert history_resp.status_code == 200
        history = history_resp.json()
        assert len(history) >= 1
        assert "Paxos" in history[0]["content"]

    @pytest.mark.asyncio
    async def test_tc_t4_e2e_04_quota_saturation_boundary_and_recovery_workflow(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
        asset_builder: AssetBuilder,
        drain_queue,
    ):
        """
        TC-T4-E2E-04: Quota Saturation, Boundary Enforcement, and Cleanup Recovery Workflow.
        1. User creates notebook.
        2. Fills notebook to 20-source quota.
        3. 21st PDF and YouTube uploads are blocked with HTTP 400 Bad Request.
        4. User deletes 2 sources via DELETE /sources/{id}.
        5. Worker executes two-phase deletion.
        6. User uploads 2 new sources: both succeed (201 Created).
        7. Invariant: Source count remains strictly within quota <= 20.
        """
        nb = await user_a_client.post("/notebooks", json={"title": "Quota Saturation Seminar"})
        nb_id = nb.json()["id"]

        source_ids: List[str] = []

        # 1. Populate 20 sources in DB
        async with test_session_factory() as sess:
            for i in range(20):
                s_id = f"quota_rec_{i:02d}_{uuid.uuid4().hex[:6]}"
                s = Source(
                    id=s_id,
                    user_id=user_a.id,
                    notebook_id=nb_id,
                    title=f"Source Doc {i + 1}",
                    source_type="pdf",
                    storage_key_or_url=f"users/{user_a.id}/doc_{i}.pdf",
                    status="ready",
                )
                sess.add(s)
                source_ids.append(s_id)
            await sess.commit()

        # 2. Verify 20 sources listed
        list_resp = await user_a_client.get(f"/notebooks/{nb_id}/sources")
        assert list_resp.status_code == 200
        assert len(list_resp.json()) == 20

        # 3. 21st upload attempts are blocked with HTTP 400
        # A: PDF upload
        pdf_overflow = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("overflow.pdf", asset_builder.make_valid_pdf(), "application/pdf")},
        )
        assert pdf_overflow.status_code == 400
        assert "source limit reached" in pdf_overflow.json()["detail"].lower()

        # B: YouTube upload
        yt_overflow = await user_a_client.post(
            f"/notebooks/{nb_id}/sources/youtube",
            json={"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
        )
        assert yt_overflow.status_code == 400
        assert "source limit reached" in yt_overflow.json()["detail"].lower()

        # 4. User deletes 2 sources
        del1 = await user_a_client.delete(f"/sources/{source_ids[0]}")
        del2 = await user_a_client.delete(f"/sources/{source_ids[1]}")
        assert del1.status_code == 200
        assert del2.status_code == 200

        # Drain deletion workers
        await drain_queue()

        # 5. Verify source count is now 18
        after_del_resp = await user_a_client.get(f"/notebooks/{nb_id}/sources")
        assert after_del_resp.status_code == 200
        assert len(after_del_resp.json()) == 18

        # 6. Upload 2 new sources: both succeed
        up1 = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("recovery_1.pdf", asset_builder.make_valid_pdf(), "application/pdf")},
        )
        assert up1.status_code == 201

        up2 = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("recovery_2.pdf", asset_builder.make_valid_pdf(), "application/pdf")},
        )
        assert up2.status_code == 201

        # 7. Invariant: Source count is back at exactly 20 (and <= 20)
        final_list = await user_a_client.get(f"/notebooks/{nb_id}/sources")
        assert final_list.status_code == 200
        assert len(final_list.json()) == 20
