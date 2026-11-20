"""
StudyLM E2E Test Suite Conftest.
File: backend/tests/e2e/conftest.py

Provides:
- bind_e2e_infrastructure (autouse): Injects unified mock storage and in-memory Qdrant.
- drain_queue: Drains deferred Procrastinate jobs synchronously in-memory.
- asset_builder: Synthesizes valid PDFs, oversized payloads, corrupt files, and transcripts.
- E2EClient & persona clients (user_a_client, user_b_client, unauth_client).
"""

from __future__ import annotations

import io
from typing import Any, AsyncGenerator, Callable, Dict, List, Optional
from unittest.mock import patch, MagicMock

import fitz  # PyMuPDF
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient, Response
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.config import get_settings
from app.services.storage_service import get_storage_service
from app.services.qdrant_service import get_qdrant_client
import app.services.storage_service as storage_module
import app.services.qdrant_service as qdrant_module
import app.tasks.cleanup_tasks as cleanup_tasks_module
import app.tasks.ingestion_tasks as ingestion_tasks_module


# ==============================================================================
# 1. Global Mock Infrastructure Binding (autouse)
# ==============================================================================
@pytest.fixture(autouse=True)
def bind_e2e_infrastructure(
    app,
    test_session_factory,
    mock_storage,
    mock_qdrant: QdrantClient,
    monkeypatch: pytest.MonkeyPatch,
):
    """
    Guarantees that both FastAPI request dependency injection and background task
    workers share the identical in-memory storage, Qdrant database, and SQLite database session.
    """
    # Ensure storage helper compatibility
    if not hasattr(mock_storage, "file_metadata"):
        mock_storage.file_metadata = {}
    if not hasattr(mock_storage, "build_storage_key"):
        mock_storage.build_storage_key = mock_storage.build_scoped_key

    # 1. FastAPI dependency overrides
    app.dependency_overrides[get_storage_service] = lambda: mock_storage
    app.dependency_overrides[get_qdrant_client] = lambda: mock_qdrant

    # 2. Module monkeypatches for routers & background tasks
    monkeypatch.setattr(storage_module, "get_storage_service", lambda: mock_storage)
    monkeypatch.setattr(qdrant_module, "get_qdrant_client", lambda: mock_qdrant)

    # 3. Tasks module bindings
    monkeypatch.setattr(cleanup_tasks_module, "AsyncSessionLocal", test_session_factory)
    monkeypatch.setattr(cleanup_tasks_module.storage_svc, "get_storage_service", lambda: mock_storage)
    monkeypatch.setattr(cleanup_tasks_module.qdrant_service, "get_qdrant_client", lambda: mock_qdrant)
    monkeypatch.setattr(ingestion_tasks_module, "AsyncSessionLocal", test_session_factory)
    monkeypatch.setattr(ingestion_tasks_module.storage_svc, "get_storage_service", lambda: mock_storage)
    monkeypatch.setattr(ingestion_tasks_module.qdrant_service, "get_qdrant_client", lambda: mock_qdrant)

    return mock_storage, mock_qdrant


# ==============================================================================
# 2. Asynchronous Queue Drainer
# ==============================================================================
@pytest_asyncio.fixture
async def drain_queue(procrastinate_app):
    """
    Executes all deferred jobs in the in-memory Procrastinate queue until completion.
    Safe, non-blocking, and deterministic.
    """
    async def _drain(queues: Optional[List[str]] = None) -> None:
        target_queues = queues or ["cleanup", "sources", "default"]
        await procrastinate_app.run_worker_async(
            queues=target_queues,
            wait=False,
            install_signal_handlers=False,
        )

    return _drain


# ==============================================================================
# 3. Synthetic Asset Builder
# ==============================================================================
class AssetBuilder:
    """Generates synthetic valid and boundary test assets in-memory."""

    @staticmethod
    def make_valid_pdf(
        title: str = "Test Lecture",
        pages: int = 1,
        text: str = "StudyLM test content. Newton's second law states that force equals mass times acceleration.",
    ) -> bytes:
        doc = fitz.open()
        for p in range(pages):
            page = doc.new_page(width=612, height=792)
            page.insert_text(
                fitz.Point(50, 72),
                f"{title} - Page {p + 1}\n{text}\nConservation of energy applies universally.",
            )
        pdf_bytes = doc.tobytes()
        doc.close()
        return pdf_bytes

    @staticmethod
    def make_multipage_pdf(
        pages: int = 5,
        page_texts: Optional[List[str]] = None,
        title: str = "Multi-Page Course Packet",
    ) -> bytes:
        doc = fitz.open()
        for p in range(pages):
            page = doc.new_page(width=612, height=792)
            content = (
                page_texts[p]
                if page_texts and p < len(page_texts)
                else f"Section {p + 1}: Detailed academic analysis and mathematical formulation."
            )
            page.insert_text(fitz.Point(50, 72), f"{title} - Page {p + 1}\n{content}")
        pdf_bytes = doc.tobytes()
        doc.close()
        return pdf_bytes

    @staticmethod
    def make_scanned_pdf(char_count: int = 25) -> bytes:
        """Generates a PDF page with <50 chars to trigger OCR fallback."""
        doc = fitz.open()
        page = doc.new_page(width=612, height=792)
        # Less than SCANNED_PAGE_CHAR_THRESHOLD (50)
        short_text = "A" * min(char_count, 35)
        page.insert_text(fitz.Point(50, 72), short_text)
        pdf_bytes = doc.tobytes()
        doc.close()
        return pdf_bytes

    @staticmethod
    def make_oversized_bytes(size_bytes: int = 52428801) -> io.BytesIO:
        """Generates stream exceeding 50MB by 1 byte."""
        return io.BytesIO(b"A" * size_bytes)

    @staticmethod
    def make_corrupted_pdf() -> bytes:
        """Generates invalid PDF header and truncated EOF."""
        return b"%PDF-1.4 corrupt header without xref or trailer elements \x00\xff"

    @staticmethod
    def sample_youtube_transcript() -> List[Dict[str, Any]]:
        """Returns standard educational transcript segment dicts."""
        return [
            {
                "text": "Welcome to Linear Algebra Lecture 1 on vector spaces and subspaces.",
                "start": 0.0,
                "duration": 4.5,
            },
            {
                "text": "A vector space consists of vectors that satisfy addition and scalar multiplication axioms.",
                "start": 4.5,
                "duration": 5.0,
            },
            {
                "text": "Linear combinations form the fundamental basis of linear transformations.",
                "start": 9.5,
                "duration": 6.0,
            },
        ]


@pytest.fixture
def asset_builder() -> AssetBuilder:
    return AssetBuilder()


# ==============================================================================
# 4. E2E Opaque-Box HTTP Client & Persona Fixtures
# ==============================================================================
class E2EClient:
    """High-level opaque-box HTTP client for StudyLM E2E tests."""

    def __init__(self, async_client: AsyncClient, token: Optional[str] = None):
        self.client = async_client
        self.token = token

    @property
    def headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    async def get(self, path: str, **kwargs: Any) -> Response:
        h = {**self.headers, **kwargs.pop("headers", {})}
        return await self.client.get(path, headers=h, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> Response:
        h = {**self.headers, **kwargs.pop("headers", {})}
        return await self.client.post(path, headers=h, **kwargs)

    async def patch(self, path: str, **kwargs: Any) -> Response:
        h = {**self.headers, **kwargs.pop("headers", {})}
        return await self.client.patch(path, headers=h, **kwargs)

    async def delete(self, path: str, **kwargs: Any) -> Response:
        h = {**self.headers, **kwargs.pop("headers", {})}
        return await self.client.delete(path, headers=h, **kwargs)


@pytest_asyncio.fixture
async def user_a_client(async_client: AsyncClient, user_a_token: str) -> E2EClient:
    """Authenticated client for User A (Tenant A)."""
    return E2EClient(async_client, token=user_a_token)


@pytest_asyncio.fixture
async def user_b_client(async_client: AsyncClient, user_b_token: str) -> E2EClient:
    """Authenticated client for User B (Tenant B)."""
    return E2EClient(async_client, token=user_b_token)


@pytest_asyncio.fixture
async def unauth_client(async_client: AsyncClient) -> E2EClient:
    """Unauthenticated client with no bearer token."""
    return E2EClient(async_client, token=None)
