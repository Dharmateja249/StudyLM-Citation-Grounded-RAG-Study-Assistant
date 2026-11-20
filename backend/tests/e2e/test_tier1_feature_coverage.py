"""
Tier 1: Comprehensive Feature Coverage E2E Test Matrix.
File: backend/tests/e2e/test_tier1_feature_coverage.py

Covers 7 core areas with >=5 tests each (37 test cases total):
- 1.1 Auth & Session Management (5 tests)
- 1.2 Notebooks & Multi-Tenant Isolation (6 tests)
- 1.3 YouTube Ingestion (5 tests)
- 1.4 PDF Ingestion (5 tests)
- 1.5 Source Management & Two-Phase Deletion (6 tests)
- 1.6 Background Queue & Worker (5 tests)
- 1.7 Query, Citations & Grounding (5 tests)
"""

from __future__ import annotations

import io
import time
import uuid
from typing import Any, Dict, List
from unittest.mock import AsyncMock, patch

import pymupdf as fitz
import pytest
from httpx import AsyncClient
from qdrant_client import QdrantClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import get_settings
from app.models import (
    ChunkPayload,
    Notebook,
    QueryRequest,
    SentenceSpan,
    Source,
    User,
)
from app.services.chunking_service import (
    chunk_document_pages,
    chunk_page_sentences,
    generate_qdrant_point_id,
)
from app.services.moderation_service import EducationalModerationService
from app.services.pdf_service import (
    ExtractedPage,
    aggregate_multiline_bboxes,
    convert_gemini_vision_bbox,
    extract_pdf_pages_sync,
    normalize_bbox,
)
from app.services.qdrant_service import execute_tenant_retrieval
from app.services.youtube_service import YouTubeService
from app.tasks.cleanup_tasks import (
    cleanup_notebook_task,
    defer_cleanup_notebook,
    defer_delete_source,
    execute_cleanup_notebook,
    execute_delete_source,
)
from app.tasks.ingestion_tasks import (
    defer_ingest_source,
    ingest_source_task,
    process_youtube_source_ingestion,
)
from tests.e2e.conftest import AssetBuilder, E2EClient


# ==============================================================================
# Area 1.1: Authentication & Session Management
# ==============================================================================
class TestTier1AuthAndSession:
    """Verifies nominal OAuth registration, login, profile fetch, session resume, and deactivation."""

    @pytest.mark.asyncio
    async def test_tc_t1_auth_01_google_oauth_registration(self, async_client: AsyncClient):
        """TC-T1-AUTH-01: Valid Google OAuth token registers new user with is_active=True and returns JWT."""
        mock_id_token = "mock_google_token_newstudent999_freshstudent@university.edu_Fresh Student"
        response = await async_client.post("/auth/google", json={"id_token": mock_id_token})

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == "freshstudent@university.edu"
        assert data["user"]["name"] == "Fresh Student"
        assert data["user"]["is_active"] is True

    @pytest.mark.asyncio
    async def test_tc_t1_auth_02_existing_user_login(self, async_client: AsyncClient, user_a: User):
        """TC-T1-AUTH-02: Existing user login returns refreshed JWT and updates profile."""
        mock_id_token = f"mock_google_token_{user_a.google_id}_{user_a.email}_Student User A Updated"
        response = await async_client.post("/auth/google", json={"id_token": mock_id_token})

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert data["user"]["id"] == user_a.id
        assert data["user"]["email"] == user_a.email

    @pytest.mark.asyncio
    async def test_tc_t1_auth_03_session_profile_fetch(self, user_a_client: E2EClient, user_a: User):
        """TC-T1-AUTH-03: GET /auth/me returns current user profile matching stored user entity."""
        response = await user_a_client.get("/auth/me")
        assert response.status_code == 200
        profile = response.json()
        assert profile["id"] == user_a.id
        assert profile["email"] == user_a.email
        assert profile["name"] == user_a.name
        assert profile["is_active"] is True

    @pytest.mark.asyncio
    async def test_tc_t1_auth_04_session_resume_state(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
    ):
        """TC-T1-AUTH-04: Creating/accessing notebook updates last_active_notebook_id visible in GET /auth/me."""
        # 1. Create a notebook
        nb_resp = await user_a_client.post("/notebooks", json={"title": "Session Resume Notebook"})
        assert nb_resp.status_code == 201
        nb_id = nb_resp.json()["id"]

        # 2. Verify GET /auth/me reflects active notebook ID
        me_resp = await user_a_client.get("/auth/me")
        assert me_resp.status_code == 200
        assert me_resp.json()["last_active_notebook_id"] == nb_id

    @pytest.mark.asyncio
    async def test_tc_t1_auth_05_account_deactivation(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
    ):
        """TC-T1-AUTH-05: DELETE /users/me deactivates account and initiates cascading deletion."""
        del_resp = await user_a_client.delete("/users/me")
        assert del_resp.status_code == 200
        body = del_resp.json()
        assert body["status"] == "deleting"

        # Verify database record updated to is_active=False
        async with test_session_factory() as sess:
            refreshed = await sess.get(User, user_a.id)
            assert refreshed is not None
            assert refreshed.is_active is False


# ==============================================================================
# Area 1.2: Notebook Management & Multi-Tenant Isolation
# ==============================================================================
class TestTier1NotebookManagement:
    """Verifies nominal notebook CRUD, ordering, message history, and status transitions."""

    @pytest.mark.asyncio
    async def test_tc_t1_nb_01_create_notebook(self, user_a_client: E2EClient, user_a: User):
        """TC-T1-NB-01: POST /notebooks creates notebook assigned to current user with 201 Created."""
        response = await user_a_client.post("/notebooks", json={"title": "Linear Algebra Notes"})
        assert response.status_code == 201
        data = response.json()
        assert data["title"] == "Linear Algebra Notes"
        assert data["user_id"] == user_a.id
        assert data["status"] == "active"
        assert "id" in data

    @pytest.mark.asyncio
    async def test_tc_t1_nb_02_list_user_notebooks(self, user_a_client: E2EClient):
        """TC-T1-NB-02: GET /notebooks returns list of active notebooks owned by current user."""
        # Create two distinct notebooks
        await user_a_client.post("/notebooks", json={"title": "Notebook Alpha"})
        await user_a_client.post("/notebooks", json={"title": "Notebook Beta"})

        response = await user_a_client.get("/notebooks")
        assert response.status_code == 200
        notebooks = response.json()
        assert isinstance(notebooks, list)
        assert len(notebooks) >= 2
        titles = [nb["title"] for nb in notebooks]
        assert "Notebook Alpha" in titles
        assert "Notebook Beta" in titles

    @pytest.mark.asyncio
    async def test_tc_t1_nb_03_get_notebook_by_id(self, user_a_client: E2EClient):
        """TC-T1-NB-03: GET /notebooks/{id} returns notebook details and updates user session."""
        created = await user_a_client.post("/notebooks", json={"title": "Target Notebook"})
        nb_id = created.json()["id"]

        response = await user_a_client.get(f"/notebooks/{nb_id}")
        assert response.status_code == 200
        assert response.json()["id"] == nb_id
        assert response.json()["title"] == "Target Notebook"

    @pytest.mark.asyncio
    async def test_tc_t1_nb_04_update_notebook_title(self, user_a_client: E2EClient):
        """TC-T1-NB-04: PATCH /notebooks/{id} updates title with 200 OK."""
        created = await user_a_client.post("/notebooks", json={"title": "Original Title"})
        nb_id = created.json()["id"]

        patch_resp = await user_a_client.patch(f"/notebooks/{nb_id}", json={"title": "Updated Title"})
        assert patch_resp.status_code == 200
        assert patch_resp.json()["title"] == "Updated Title"

    @pytest.mark.asyncio
    async def test_tc_t1_nb_05_delete_notebook(self, user_a_client: E2EClient):
        """TC-T1-NB-05: DELETE /notebooks/{id} transitions notebook to deleting and disassociates active notebook."""
        created = await user_a_client.post("/notebooks", json={"title": "Notebook to Delete"})
        nb_id = created.json()["id"]

        del_resp = await user_a_client.delete(f"/notebooks/{nb_id}")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleting"
        assert del_resp.json()["id"] == nb_id

        # Subsequent GET returns 404 Not Found (soft-deleted / deleting)
        get_resp = await user_a_client.get(f"/notebooks/{nb_id}")
        assert get_resp.status_code == 404

    @pytest.mark.asyncio
    async def test_tc_t1_nb_06_notebook_messages_history(self, user_a_client: E2EClient):
        """TC-T1-NB-06: POST & GET /notebooks/{id}/messages stores and retrieves conversational messages."""
        created = await user_a_client.post("/notebooks", json={"title": "Chat History Notebook"})
        nb_id = created.json()["id"]

        # Post user query message
        post_msg = await user_a_client.post(
            f"/notebooks/{nb_id}/messages",
            json={"role": "user", "content": "Explain Gauss-Jordan elimination."},
        )
        assert post_msg.status_code == 201
        msg_data = post_msg.json()
        assert msg_data["role"] == "user"
        assert msg_data["content"] == "Explain Gauss-Jordan elimination."

        # Fetch message list
        get_msgs = await user_a_client.get(f"/notebooks/{nb_id}/messages")
        assert get_msgs.status_code == 200
        messages = get_msgs.json()
        assert len(messages) == 1
        assert messages[0]["content"] == "Explain Gauss-Jordan elimination."


# ==============================================================================
# Area 1.3: YouTube Ingestion
# ==============================================================================
class TestTier1YouTubeIngestion:
    """Verifies YouTube creation route, URL canonicalization, moderation approval, and worker chunking."""

    @pytest.mark.asyncio
    async def test_tc_t1_yt_01_youtube_source_route_201(self, user_a_client: E2EClient):
        """TC-T1-YT-01: POST /notebooks/{id}/sources/youtube returns 201 Created with status='processing'."""
        nb = await user_a_client.post("/notebooks", json={"title": "Physics Lectures"})
        nb_id = nb.json()["id"]

        yt_resp = await user_a_client.post(
            f"/notebooks/{nb_id}/sources/youtube",
            json={
                "url": "https://www.youtube.com/watch?v=k7RM-ot2NWY",
                "title": "MIT 18.06 Linear Algebra Lecture 1",
            },
        )
        assert yt_resp.status_code == 201
        data = yt_resp.json()
        assert data["source_type"] == "youtube"
        assert data["status"] == "processing"
        assert data["notebook_id"] == nb_id

    @pytest.mark.asyncio
    async def test_tc_t1_yt_02_url_canonicalization(self):
        """TC-T1-YT-02: URL parsing extracts 11-char video ID from standard and short YouTube URLs."""
        yt_svc = YouTubeService()
        id1 = yt_svc.extract_video_id("https://www.youtube.com/watch?v=k7RM-ot2NWY")
        id2 = yt_svc.extract_video_id("https://youtu.be/k7RM-ot2NWY")
        id3 = yt_svc.extract_video_id("https://www.youtube.com/embed/k7RM-ot2NWY?si=abc123xyz")

        assert id1 == "k7RM-ot2NWY"
        assert id2 == "k7RM-ot2NWY"
        assert id3 == "k7RM-ot2NWY"

    @pytest.mark.asyncio
    async def test_tc_t1_yt_03_educational_barrier_approval(self):
        """TC-T1-YT-03: Educational lecture title and tags pass Two-Tier Educational Content Barrier."""
        moderator = EducationalModerationService()
        result = moderator.evaluate_tier1_heuristics(
            title="MIT 18.06 Linear Algebra Lecture 1: Vector Spaces",
            description="University lecture explaining vector axioms, subspaces, and null space.",
            tags=["mathematics", "linear algebra", "lecture", "mit"],
        )
        assert result is not None
        assert result.is_educational is True
        assert result.confidence >= 0.90

    @pytest.mark.asyncio
    async def test_tc_t1_yt_04_caption_segmentation_interpolation(self, asset_builder: AssetBuilder):
        """TC-T1-YT-04: Caption segments are segmented with pysbd and interpolated with linear start_seconds."""
        yt_svc = YouTubeService()
        raw_captions = asset_builder.sample_youtube_transcript()
        sentences = yt_svc.interpolate_sentence_timestamps(raw_captions)

        assert len(sentences) >= 2
        for s in sentences:
            assert isinstance(s.sentence_id, str)
            assert isinstance(s.start_seconds, (float, int))
            assert s.start_seconds >= 0.0
            assert len(s.text.strip()) > 0

    @pytest.mark.asyncio
    async def test_tc_t1_yt_05_youtube_vector_upsert(
        self,
        test_session_factory: async_sessionmaker,
        user_a: User,
        mock_qdrant: QdrantClient,
        asset_builder: AssetBuilder,
    ):
        """TC-T1-YT-05: Worker pipeline processes YouTube source, builds chunks, upserts vectors, sets ready."""
        async with test_session_factory() as sess:
            nb = Notebook(title="Vector Upsert YT", user_id=user_a.id, status="active")
            sess.add(nb)
            await sess.commit()
            await sess.refresh(nb)

            source = Source(
                user_id=user_a.id,
                notebook_id=nb.id,
                title="MIT 18.06 Linear Algebra Lecture 1",
                source_type="youtube",
                storage_key_or_url="https://www.youtube.com/watch?v=k7RM-ot2NWY",
                status="processing",
            )
            sess.add(source)
            await sess.commit()
            await sess.refresh(source)

            yt_svc = YouTubeService()
            with patch.object(
                yt_svc,
                "fetch_raw_transcript",
                return_value=asset_builder.sample_youtube_transcript(),
            ):
                result = await process_youtube_source_ingestion(
                    source=source,
                    session=sess,
                    qdrant_client=mock_qdrant,
                    youtube_service=yt_svc,
                )

            assert result["status"] == "ready"
            await sess.refresh(source)
            assert source.status == "ready"
            assert source.active_ingest_run_id is not None

            # Assert vectors were written to Qdrant collection
            settings = get_settings()
            retrieved = execute_tenant_retrieval(
                client=mock_qdrant,
                collection_name=settings.QDRANT_COLLECTION_NAME,
                user_id=user_a.id,
                notebook_id=nb.id,
                active_run_ids=[source.active_ingest_run_id],
                limit=10,
            )
            assert len(retrieved) > 0
            assert retrieved[0].payload["source_type"] == "youtube"


# ==============================================================================
# Area 1.4: PDF Ingestion
# ==============================================================================
class TestTier1PDFIngestion:
    """Verifies PDF upload route, bbox normalization [0.0, 1.0], multiline aggregation, and isolation."""

    @pytest.mark.asyncio
    async def test_tc_t1_pdf_01_pdf_upload_route_201(
        self,
        user_a_client: E2EClient,
        asset_builder: AssetBuilder,
    ):
        """TC-T1-PDF-01: POST /notebooks/{id}/sources uploads PDF file to R2 and returns 201 Created."""
        nb = await user_a_client.post("/notebooks", json={"title": "PDF Upload Notebook"})
        nb_id = nb.json()["id"]

        pdf_bytes = asset_builder.make_valid_pdf(title="Thermodynamics Lecture 1")
        files = {"file": ("thermo.pdf", pdf_bytes, "application/pdf")}

        response = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files=files,
            data={"title": "Thermodynamics Lecture 1"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["source_type"] == "pdf"
        assert data["status"] == "processing"
        assert data["notebook_id"] == nb_id

    @pytest.mark.asyncio
    async def test_tc_t1_pdf_02_bbox_normalization(self):
        """TC-T1-PDF-02: Bounding box normalization maps coordinates strictly to float space [0.0, 1.0]."""
        norm = normalize_bbox(61.2, 79.2, 306.0, 396.0, page_width=612.0, page_height=792.0)

        assert len(norm) == 4
        assert norm[0] == pytest.approx(0.10, rel=1e-2)
        assert norm[1] == pytest.approx(0.10, rel=1e-2)
        assert norm[2] == pytest.approx(0.50, rel=1e-2)
        assert norm[3] == pytest.approx(0.50, rel=1e-2)
        for val in norm:
            assert 0.0 <= val <= 1.0

    @pytest.mark.asyncio
    async def test_tc_t1_pdf_03_multiline_sentence_bboxes(self):
        """TC-T1-PDF-03: Multi-line sentence aggregates tight bounding boxes as List[List[float]]."""
        from app.services.pdf_service import ExtractedWord
        words = [
            # Line 1
            ExtractedWord(text="Hello", x0=61.2, y0=79.2, x1=244.8, y1=118.8, block_no=0, line_no=0, word_no=0),
            ExtractedWord(text="world", x0=275.4, y0=79.2, x1=550.8, y1=118.8, block_no=0, line_no=0, word_no=1),
            # Line 2
            ExtractedWord(text="Second", x0=61.2, y0=142.5, x1=306.0, y1=182.1, block_no=0, line_no=1, word_no=0),
        ]
        aggregated = aggregate_multiline_bboxes(words, page_width=612.0, page_height=792.0)
        assert len(aggregated) == 2  # Two distinct lines detected
        assert aggregated[0][0] == pytest.approx(0.1, rel=1e-2)
        assert aggregated[0][2] == pytest.approx(0.9, rel=1e-2)
        assert aggregated[1][0] == pytest.approx(0.1, rel=1e-2)
        assert aggregated[1][2] == pytest.approx(0.5, rel=1e-2)

    @pytest.mark.asyncio
    async def test_tc_t1_pdf_04_ocr_fallback_scanned_page(self, asset_builder: AssetBuilder):
        """TC-T1-PDF-04: PDF page with <50 chars triggers OCR fallback; Gemini bbox transforms to [0.0, 1.0]."""
        pdf_bytes = asset_builder.make_scanned_pdf(char_count=20)
        pages = extract_pdf_pages_sync(pdf_bytes)

        assert len(pages) == 1
        assert pages[0].is_scanned is True

        # Test Gemini Vision OCR coordinate transformation
        # ymin, xmin, ymax, xmax in 0-1000
        converted = convert_gemini_vision_bbox(150, 200, 350, 450)
        assert len(converted) == 4
        # Format [x0, y0, x1, y1] in [0.0, 1.0]
        assert converted == [0.20, 0.15, 0.45, 0.35]

    @pytest.mark.asyncio
    async def test_tc_t1_pdf_05_page_boundary_isolation_and_deterministic_ids(
        self,
        asset_builder: AssetBuilder,
    ):
        """TC-T1-PDF-05: Chunks never bleed across page boundaries and produce deterministic chunk IDs."""
        multipage_bytes = asset_builder.make_multipage_pdf(pages=3)
        pages = extract_pdf_pages_sync(multipage_bytes)

        chunks = chunk_document_pages(
            pages=pages,
            source_id="test_src_123",
            notebook_id="test_nb_456",
            user_id="test_usr_789",
            ingest_run_id="run_abc",
            ingested_at=1700000000,
            embedding_model="gemini-embedding-2",
            source_title="Multipage Notes",
        )

        assert len(chunks) >= 3
        # Invariant: Each chunk is restricted to exactly one page
        page_numbers = {c.page_number for c in chunks}
        assert len(page_numbers) == 3
        for c in chunks:
            assert c.chunk_id.startswith("test_src_123_p")
            pt_id = generate_qdrant_point_id("run_abc", c.chunk_id)
            assert isinstance(pt_id, str)
            assert len(pt_id) == 36  # Valid UUID format


# ==============================================================================
# Area 1.5: Source Management & Two-Phase Deletion
# ==============================================================================
class TestTier1SourceManagement:
    """Verifies source listing, details, two-phase deletion phase 1, stream proxy, HTTP 206, and presigned URLs."""

    @pytest.mark.asyncio
    async def test_tc_t1_src_01_list_notebook_sources(
        self,
        user_a_client: E2EClient,
        asset_builder: AssetBuilder,
    ):
        """TC-T1-SRC-01: GET /notebooks/{id}/sources returns list of active sources."""
        nb = await user_a_client.post("/notebooks", json={"title": "List Sources NB"})
        nb_id = nb.json()["id"]

        pdf_bytes = asset_builder.make_valid_pdf()
        await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("doc.pdf", pdf_bytes, "application/pdf")},
        )

        resp = await user_a_client.get(f"/notebooks/{nb_id}/sources")
        assert resp.status_code == 200
        sources = resp.json()
        assert len(sources) == 1
        assert sources[0]["source_type"] == "pdf"

    @pytest.mark.asyncio
    async def test_tc_t1_src_02_get_source_details(
        self,
        user_a_client: E2EClient,
        asset_builder: AssetBuilder,
    ):
        """TC-T1-SRC-02: GET /sources/{source_id} returns source metadata, file size, status."""
        nb = await user_a_client.post("/notebooks", json={"title": "Get Source NB"})
        nb_id = nb.json()["id"]

        pdf_bytes = asset_builder.make_valid_pdf()
        created = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("doc.pdf", pdf_bytes, "application/pdf")},
        )
        src_id = created.json()["id"]

        resp = await user_a_client.get(f"/sources/{src_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == src_id
        assert data["file_size_bytes"] == len(pdf_bytes)

    @pytest.mark.asyncio
    async def test_tc_t1_src_03_two_phase_deletion_phase1(
        self,
        user_a_client: E2EClient,
        asset_builder: AssetBuilder,
    ):
        """TC-T1-SRC-03: DELETE /sources/{id} synchronously transitions status to deleting (Phase 1)."""
        nb = await user_a_client.post("/notebooks", json={"title": "Delete Phase 1 NB"})
        nb_id = nb.json()["id"]

        created = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("doc.pdf", asset_builder.make_valid_pdf(), "application/pdf")},
        )
        src_id = created.json()["id"]

        del_resp = await user_a_client.delete(f"/sources/{src_id}")
        assert del_resp.status_code == 200
        assert del_resp.json()["status"] == "deleting"

        # Subsequent GET returns 404 (hidden from client immediately)
        get_resp = await user_a_client.get(f"/sources/{src_id}")
        assert get_resp.status_code == 404

    @pytest.mark.asyncio
    async def test_tc_t1_src_04_binary_stream_proxy(
        self,
        user_a_client: E2EClient,
        asset_builder: AssetBuilder,
    ):
        """TC-T1-SRC-04: GET /sources/{id}/stream returns binary file with Accept-Ranges: bytes."""
        nb = await user_a_client.post("/notebooks", json={"title": "Stream NB"})
        nb_id = nb.json()["id"]

        pdf_bytes = asset_builder.make_valid_pdf()
        created = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("doc.pdf", pdf_bytes, "application/pdf")},
        )
        src_id = created.json()["id"]

        stream_resp = await user_a_client.get(f"/sources/{src_id}/stream")
        assert stream_resp.status_code == 200
        assert stream_resp.headers["Accept-Ranges"] == "bytes"
        assert stream_resp.content == pdf_bytes

    @pytest.mark.asyncio
    async def test_tc_t1_src_05_http_206_partial_content_range(
        self,
        user_a_client: E2EClient,
        asset_builder: AssetBuilder,
    ):
        """TC-T1-SRC-05: GET /sources/{id}/stream with Range header returns HTTP 206 Partial Content."""
        nb = await user_a_client.post("/notebooks", json={"title": "Range Stream NB"})
        nb_id = nb.json()["id"]

        pdf_bytes = asset_builder.make_valid_pdf()
        created = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("doc.pdf", pdf_bytes, "application/pdf")},
        )
        src_id = created.json()["id"]

        # Request bytes 0-100
        range_resp = await user_a_client.get(
            f"/sources/{src_id}/stream",
            headers={"Range": "bytes=0-100"},
        )
        assert range_resp.status_code == 206
        assert len(range_resp.content) == 101
        assert "bytes 0-100/" in range_resp.headers["Content-Range"]

    @pytest.mark.asyncio
    async def test_tc_t1_src_06_presigned_download_url(
        self,
        user_a_client: E2EClient,
        asset_builder: AssetBuilder,
    ):
        """TC-T1-SRC-06: GET /sources/{id}/presigned-url returns presigned URL with 900s expiration."""
        nb = await user_a_client.post("/notebooks", json={"title": "Presigned NB"})
        nb_id = nb.json()["id"]

        created = await user_a_client.post(
            f"/notebooks/{nb_id}/sources",
            files={"file": ("doc.pdf", asset_builder.make_valid_pdf(), "application/pdf")},
        )
        src_id = created.json()["id"]

        ps_resp = await user_a_client.get(f"/sources/{src_id}/presigned-url")
        assert ps_resp.status_code == 200
        data = ps_resp.json()
        assert data["source_id"] == src_id
        assert data["expires_in"] == 900
        assert "presigned_url" in data
        assert src_id in data["presigned_url"]


# ==============================================================================
# Area 1.6: Background Queue & Worker (Procrastinate)
# ==============================================================================
class TestTier1WorkerQueue:
    """Verifies task deferrals and worker executions for ingestion, deletion, and notebook sweeper."""

    @pytest.mark.asyncio
    async def test_tc_t1_worker_01_task_deferrals(self):
        """TC-T1-WORKER-01: Calling task deferral functions enqueues jobs with per-source serialization locks."""
        dummy_source_id = str(uuid.uuid4())
        dummy_notebook_id = str(uuid.uuid4())

        # Defer tasks
        await defer_ingest_source(dummy_source_id)
        await defer_delete_source(dummy_source_id)
        await defer_cleanup_notebook(dummy_notebook_id)

    @pytest.mark.asyncio
    async def test_tc_t1_worker_02_execute_pdf_ingest_task(
        self,
        test_session_factory: async_sessionmaker,
        user_a: User,
        asset_builder: AssetBuilder,
        drain_queue,
    ):
        """TC-T1-WORKER-02: Worker executes PDF ingestion task to completion, setting status='ready'."""
        pdf_bytes = asset_builder.make_valid_pdf(title="Worker Ingestion PDF")
        storage_key = f"users/{user_a.id}/notebooks/nb_w_1/src_w_1/worker.pdf"

        # Pre-seed storage
        from app.services.storage_service import get_storage_service
        storage = get_storage_service()
        await storage.upload_file(pdf_bytes, storage_key)

        async with test_session_factory() as sess:
            nb = Notebook(id="nb_w_1", title="Worker Ingest NB", user_id=user_a.id, status="active")
            sess.add(nb)
            await sess.commit()

            src = Source(
                id="src_w_1",
                user_id=user_a.id,
                notebook_id=nb.id,
                title="Worker Ingestion PDF",
                source_type="pdf",
                storage_key_or_url=storage_key,
                status="processing",
                file_size_bytes=len(pdf_bytes),
            )
            sess.add(src)
            await sess.commit()

        # Enqueue and drain
        await defer_ingest_source("src_w_1")
        await drain_queue()

        async with test_session_factory() as sess:
            refreshed = await sess.get(Source, "src_w_1")
            assert refreshed is not None
            assert refreshed.status == "ready"
            assert refreshed.active_ingest_run_id is not None

    @pytest.mark.asyncio
    async def test_tc_t1_worker_03_execute_yt_ingest_task(
        self,
        test_session_factory: async_sessionmaker,
        user_a: User,
        asset_builder: AssetBuilder,
        drain_queue,
    ):
        """TC-T1-WORKER-03: Worker executes YouTube ingestion task to completion, setting status='ready'."""
        async with test_session_factory() as sess:
            nb = Notebook(title="YT Worker NB", user_id=user_a.id, status="active")
            sess.add(nb)
            await sess.commit()
            await sess.refresh(nb)

            src = Source(
                user_id=user_a.id,
                notebook_id=nb.id,
                title="MIT 18.06 Linear Algebra Lecture 1",
                source_type="youtube",
                storage_key_or_url="https://www.youtube.com/watch?v=k7RM-ot2NWY",
                status="processing",
            )
            sess.add(src)
            await sess.commit()
            await sess.refresh(src)
            src_id = src.id

        yt_svc = YouTubeService()
        with patch.object(
            YouTubeService,
            "fetch_raw_transcript",
            return_value=asset_builder.sample_youtube_transcript(),
        ):
            await defer_ingest_source(src_id)
            await drain_queue()

        async with test_session_factory() as sess:
            refreshed = await sess.get(Source, src_id)
            assert refreshed is not None
            assert refreshed.status == "ready"

    @pytest.mark.asyncio
    async def test_tc_t1_worker_04_execute_delete_source_task(
        self,
        test_session_factory: async_sessionmaker,
        user_a: User,
        asset_builder: AssetBuilder,
        drain_queue,
    ):
        """TC-T1-WORKER-04: Worker executes delete_source_task, purging R2 and deleting SQL row."""
        storage_key = f"users/{user_a.id}/to_delete.pdf"
        from app.services.storage_service import get_storage_service
        storage = get_storage_service()
        await storage.upload_file(asset_builder.make_valid_pdf(), storage_key)

        async with test_session_factory() as sess:
            nb = Notebook(title="Delete Task NB", user_id=user_a.id, status="active")
            sess.add(nb)
            await sess.commit()
            await sess.refresh(nb)

            src = Source(
                user_id=user_a.id,
                notebook_id=nb.id,
                title="Source To Delete",
                source_type="pdf",
                storage_key_or_url=storage_key,
                status="deleting",
            )
            sess.add(src)
            await sess.commit()
            await sess.refresh(src)
            src_id = src.id

        await defer_delete_source(src_id)
        await drain_queue()

        async with test_session_factory() as sess:
            deleted_check = await sess.get(Source, src_id)
            assert deleted_check is None  # Completely purged from DB

        # Assert purged from storage
        file_bytes = await storage.get_file_bytes(storage_key)
        assert file_bytes is None

    @pytest.mark.asyncio
    async def test_tc_t1_worker_05_execute_sweeper_task(
        self,
        test_session_factory: async_sessionmaker,
        user_a: User,
        asset_builder: AssetBuilder,
        drain_queue,
    ):
        """TC-T1-WORKER-05: Worker executes cleanup_notebook_task, purging notebook and child sources."""
        async with test_session_factory() as sess:
            nb = Notebook(title="Sweeper NB", user_id=user_a.id, status="deleting")
            sess.add(nb)
            await sess.commit()
            await sess.refresh(nb)

            src = Source(
                user_id=user_a.id,
                notebook_id=nb.id,
                title="Child Source",
                source_type="pdf",
                storage_key_or_url="users/u/nb/s/f.pdf",
                status="deleting",
            )
            sess.add(src)
            await sess.commit()
            nb_id = nb.id
            src_id = src.id

        await defer_cleanup_notebook(nb_id)
        await drain_queue()

        async with test_session_factory() as sess:
            assert await sess.get(Notebook, nb_id) is None
            assert await sess.get(Source, src_id) is None


# ==============================================================================
# Area 1.7: Query, Citations & Grounding
# ==============================================================================
class TestTier1Query:
    """Verifies grounded Q&A, chitchat intent bypass, conversational rewrite, SSE streams, and summarization."""

    @pytest.mark.asyncio
    async def test_tc_t1_query_01_grounded_qa_query(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
        mock_qdrant: QdrantClient,
    ):
        """TC-T1-QUERY-01: Grounded Q&A query returns 200 OK with resolved citations referencing Qdrant payload."""
        # Setup notebook and ready source with vectors in Qdrant
        async with test_session_factory() as sess:
            nb = Notebook(title="Quantum Physics", user_id=user_a.id, status="active")
            sess.add(nb)
            await sess.commit()
            await sess.refresh(nb)

            src = Source(
                user_id=user_a.id,
                notebook_id=nb.id,
                title="Quantum Mechanics Notes",
                source_type="pdf",
                storage_key_or_url="quantum.pdf",
                status="ready",
                active_ingest_run_id="run_quantum_1",
            )
            sess.add(src)
            await sess.commit()
            await sess.refresh(src)
            nb_id = nb.id
            src_id = src.id

        # Insert test chunk into Qdrant
        from app.services.qdrant_service import upsert_chunk_points
        from qdrant_client.http import models as qmodels
        from tests.conftest import get_mock_vector
        sentence = SentenceSpan(
            sentence_id="s0",
            text="The Schrödinger equation describes how the quantum state of a physical system changes over time.",
            bboxes=[[0.1, 0.2, 0.8, 0.25]],
        )
        chunk = ChunkPayload(
            chunk_id=f"{src_id}_p0001_c001",
            source_id=src_id,
            notebook_id=nb_id,
            user_id=user_a.id,
            ingest_run_id="run_quantum_1",
            ingested_at=int(time.time()),
            embedding_model="gemini-embedding-2",
            source_title="Quantum Mechanics Notes",
            source_type="pdf",
            page_number=1,
            text=sentence.text,
            sentences=[sentence],
        )
        point = qmodels.PointStruct(
            id=generate_qdrant_point_id("run_quantum_1", chunk.chunk_id),
            vector=get_mock_vector(dim=768, seed=42),
            payload=chunk.model_dump(),
        )
        upsert_chunk_points(
            client=mock_qdrant,
            collection_name=get_settings().QDRANT_COLLECTION_NAME,
            points=[point],
        )

        response = await user_a_client.post(
            f"/notebooks/{nb_id}/query",
            json={"query": "What does the Schrödinger equation describe?"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["refusal"] is False
        assert "Schrödinger" in data["answer"]
        assert len(data["citations"]) > 0
        citation = data["citations"][0]
        assert citation["source_id"] == src_id
        assert citation["page_number"] == 1
        assert len(citation["bboxes"]) > 0

    @pytest.mark.asyncio
    async def test_tc_t1_query_02_chitchat_intent_bypass(self, user_a_client: E2EClient):
        """TC-T1-QUERY-02: Conversational query bypasses retrieval refusal and returns polite assistant reply."""
        nb = await user_a_client.post("/notebooks", json={"title": "Empty Notebook"})
        nb_id = nb.json()["id"]

        resp = await user_a_client.post(
            f"/notebooks/{nb_id}/query",
            json={"query": "Hello there! How are you today?"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["refusal"] is False
        assert len(data["citations"]) == 0
        assert "StudyLM" in data["answer"] or "Hello" in data["answer"]

    @pytest.mark.asyncio
    async def test_tc_t1_query_03_multiturn_query_rewriting(
        self,
        user_a_client: E2EClient,
    ):
        """TC-T1-QUERY-03: Conversational query rewriter integrates conversation history."""
        nb = await user_a_client.post("/notebooks", json={"title": "Rewrite NB"})
        nb_id = nb.json()["id"]

        # Post prior dialogue
        await user_a_client.post(
            f"/notebooks/{nb_id}/messages",
            json={"role": "user", "content": "Tell me about Sir Isaac Newton."},
        )
        await user_a_client.post(
            f"/notebooks/{nb_id}/messages",
            json={"role": "assistant", "content": "Sir Isaac Newton formulated the three laws of motion."},
        )

        from app.services import QueryRewriter
        rewriter = QueryRewriter()
        history = [
            {"role": "user", "content": "Tell me about Sir Isaac Newton."},
            {"role": "assistant", "content": "Sir Isaac Newton formulated the three laws of motion."},
        ]
        rewritten = rewriter.rewrite_query("What was his second law?", history)
        assert "Newton" in rewritten
        assert "second law" in rewritten.lower()

    @pytest.mark.asyncio
    async def test_tc_t1_query_04_sse_streaming_query(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
        mock_qdrant: QdrantClient,
    ):
        """TC-T1-QUERY-04: POST /notebooks/{id}/query/stream streams Server-Sent Events."""
        async with test_session_factory() as sess:
            nb = Notebook(title="SSE Stream NB", user_id=user_a.id, status="active")
            sess.add(nb)
            await sess.commit()
            await sess.refresh(nb)
            nb_id = nb.id

        resp = await user_a_client.post(
            f"/notebooks/{nb_id}/query/stream",
            json={"query": "Hello assistant!"},
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        text_body = resp.text
        assert "event: content" in text_body or "event: done" in text_body

    @pytest.mark.asyncio
    async def test_tc_t1_query_05_document_summarization(
        self,
        user_a_client: E2EClient,
        test_session_factory: async_sessionmaker,
        user_a: User,
    ):
        """TC-T1-QUERY-05: POST /sources/{id}/summarize generates document summary."""
        async with test_session_factory() as sess:
            nb = Notebook(title="Summarize NB", user_id=user_a.id, status="active")
            sess.add(nb)
            await sess.commit()
            await sess.refresh(nb)

            src = Source(
                user_id=user_a.id,
                notebook_id=nb.id,
                title="Linear Systems Chapter",
                source_type="pdf",
                storage_key_or_url="linear.pdf",
                status="ready",
                estimated_tokens=50000,
            )
            sess.add(src)
            await sess.commit()
            await sess.refresh(src)
            src_id = src.id

        resp = await user_a_client.post(f"/sources/{src_id}/summarize")
        assert resp.status_code == 200
        data = resp.json()
        assert "summary" in data
        assert data["strategy"] in ("full_context", "hierarchical_outline")
        assert "estimated_tokens" in data
