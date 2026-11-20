"""
Milestone 2 Adversarial Verification Suite: Stream Memory & Task Enqueueing Probes
Author: challenger_m2_r2_2
Target Specifications: STOR-04, STOR-07, 50MB Stream Limits & io.BytesIO Memory Management

Adversarial Verification Vectors:
1. Notebook Deletion Task Enqueueing (DELETE /notebooks/{id}):
   - defer_cleanup_notebook is triggered with started_at_epoch upon DELETE.
   - started_at_epoch is a float timestamp representing deletion initiation.
   - Database notebook status and all child source statuses atomically transition to 'deleting'.
   - current_user.last_active_notebook_id is disassociated if pointing to target notebook.
   - Anti-enumeration & idempotency: second DELETE returns 404 and does NOT re-enqueue task.
   - Tenant isolation: foreign tenant DELETE returns 404 and does NOT enqueue task.
   - Task broker resilience: broker deferral failure does not crash response or invalidate DB transition.

2. Sweeper Task & Deadline Epoch Propagation:
   - defer_cleanup_notebook helper defaults started_at_epoch to current epoch if omitted.
   - cleanup_notebook_task preserves original started_at_epoch across rescheduling in_progress runs.
   - Sweeper decouples notebook.created_at age from deletion duration.

3. Stream Memory & Dynamic Byte Counter (read_and_validate_file_stream):
   - Exact boundary enforcement: max_size succeeds; max_size + 1 byte raises HTTP 413.
   - Short-circuit streaming: reader aborts immediately when max_size exceeded without reading remaining payload.
   - Zero-byte rejection: empty file raises HTTP 400.
   - Lifecycle & Memory Leak Proof: io.BytesIO.close() is guaranteed across success, 413, 400, and unexpected I/O errors.
"""

import asyncio
import io
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from unittest.mock import patch, MagicMock, AsyncMock

import pytest
from fastapi import HTTPException, UploadFile, status
from httpx import AsyncClient
from sqlmodel import select

from app.config import get_settings
from app.models import Notebook, Source, User
from app.routers.sources import read_and_validate_file_stream
from app.services.storage_service import get_storage_service
from app.tasks.cleanup_tasks import (
    cleanup_notebook_task,
    defer_cleanup_notebook,
    execute_cleanup_notebook,
)


@pytest.fixture(autouse=True)
def setup_storage_override(app, mock_storage):
    """Ensure mock_storage is bound to get_storage_service dependency in FastAPI."""
    if not hasattr(mock_storage, "file_metadata"):
        mock_storage.file_metadata = {}
    if not hasattr(mock_storage, "build_storage_key"):
        mock_storage.build_storage_key = mock_storage.build_scoped_key

    app.dependency_overrides[get_storage_service] = lambda: mock_storage
    yield
    app.dependency_overrides.pop(get_storage_service, None)


# ==============================================================================
# 1. Notebook Deletion Task Enqueueing Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_delete_notebook_enqueues_defer_cleanup_with_epoch(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
):
    """
    Probe 1A:
    DELETE /notebooks/{id} must:
    1. Atomically set status='deleting' on Notebook.
    2. Atomically set status='deleting' on child Sources.
    3. Clear last_active_notebook_id on User.
    4. Enqueue defer_cleanup_notebook with notebook_id AND started_at_epoch.
    """
    # 1. Setup Notebook with 2 child sources and set user's last_active_notebook_id
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Adversarial Notebook To Delete",
        status="active",
        created_at=datetime.now(timezone.utc) - timedelta(days=2),
    )
    db_session.add(notebook)
    await db_session.flush()

    s1 = Source(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        notebook_id=notebook.id,
        title="Child Source 1",
        source_type="pdf",
        storage_key_or_url="users/test/s1.pdf",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    s2 = Source(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        notebook_id=notebook.id,
        title="Child Source 2",
        source_type="image",
        storage_key_or_url="users/test/s2.png",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([s1, s2])

    user_a.last_active_notebook_id = notebook.id
    db_session.add(user_a)
    await db_session.commit()

    before_time = time.time()

    # 2. Trigger DELETE with deferral spy
    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        resp = await async_client.delete(
            f"/notebooks/{notebook.id}",
            headers={"Authorization": f"Bearer {user_a_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "deleting"
        assert data["id"] == notebook.id

        # Verify defer_cleanup_notebook invocation
        mock_defer.assert_awaited_once()
        call_kwargs = mock_defer.call_args.kwargs
        assert call_kwargs["notebook_id"] == notebook.id
        assert "started_at_epoch" in call_kwargs

        started_at = call_kwargs["started_at_epoch"]
        assert isinstance(started_at, float)
        assert before_time <= started_at <= time.time() + 1.0

    # 3. Verify Database State Transitions
    nb_id = notebook.id
    u_id = user_a.id
    db_session.expire_all()
    nb_refreshed = await db_session.get(Notebook, nb_id)
    assert nb_refreshed.status == "deleting"

    child_sources = (
        await db_session.execute(select(Source).where(Source.notebook_id == nb_id))
    ).scalars().all()
    assert len(child_sources) == 2
    assert all(s.status == "deleting" for s in child_sources)

    user_refreshed = await db_session.get(User, u_id)
    assert user_refreshed.last_active_notebook_id is None



@pytest.mark.asyncio
async def test_adversarial_delete_notebook_idempotent_no_duplicate_enqueue(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
):
    """
    Probe 1B:
    Subsequent DELETE on an already deleting notebook must return 404 Not Found
    and NEVER re-enqueue defer_cleanup_notebook.
    """
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Already Deleting Notebook",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(notebook)
    await db_session.commit()

    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        resp = await async_client.delete(
            f"/notebooks/{notebook.id}",
            headers={"Authorization": f"Bearer {user_a_token}"},
        )
        assert resp.status_code == 404
        assert "notebook not found" in resp.json()["detail"].lower()
        mock_defer.assert_not_called()


@pytest.mark.asyncio
async def test_adversarial_delete_notebook_cross_tenant_isolation_no_enqueue(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_b: User,
    user_b_token: str,
):
    """
    Probe 1C:
    Foreign tenant (User B) attempting to delete User A's notebook gets 404
    and defer_cleanup_notebook is NEVER enqueued.
    """
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="User A Private Notebook",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(notebook)
    await db_session.commit()

    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        resp = await async_client.delete(
            f"/notebooks/{notebook.id}",
            headers={"Authorization": f"Bearer {user_b_token}"},
        )
        assert resp.status_code == 404
        assert "notebook not found" in resp.json()["detail"].lower()
        mock_defer.assert_not_called()

    # Notebook remains active
    nb_refreshed = (await db_session.execute(select(Notebook).where(Notebook.id == notebook.id))).scalar_one()
    assert nb_refreshed.status == "active"


@pytest.mark.asyncio
async def test_adversarial_delete_notebook_broker_failure_resilience(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
):
    """
    Probe 1D:
    If background task broker deferral fails (e.g., broker disconnect, test mock mode),
    the endpoint gracefully logs a warning, commits status='deleting', and returns 200.
    """
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Broker Failure Resilient Notebook",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(notebook)
    await db_session.commit()

    with patch(
        "app.tasks.cleanup_tasks.defer_cleanup_notebook",
        side_effect=RuntimeError("Procrastinate broker unreachable"),
    ):
        resp = await async_client.delete(
            f"/notebooks/{notebook.id}",
            headers={"Authorization": f"Bearer {user_a_token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleting"

    # Status in database must still be committed as 'deleting'
    nb_id = notebook.id
    db_session.expire_all()
    nb_refreshed = await db_session.get(Notebook, nb_id)
    assert nb_refreshed.status == "deleting"




# ==============================================================================
# 2. Sweeper Task Epoch Propagation & Scheduling Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_defer_cleanup_notebook_helper_defaults_epoch():
    """
    Probe 2A:
    defer_cleanup_notebook helper defaults started_at_epoch to current epoch if None.
    """
    t0 = time.time()
    with patch.object(cleanup_notebook_task, "defer_async", new_callable=AsyncMock) as mock_defer_async:
        await defer_cleanup_notebook(notebook_id="nb-123", started_at_epoch=None)
        mock_defer_async.assert_awaited_once()
        kwargs = mock_defer_async.call_args.kwargs
        assert kwargs["notebook_id"] == "nb-123"
        assert t0 <= kwargs["started_at_epoch"] <= time.time() + 1.0


@pytest.mark.asyncio
async def test_adversarial_defer_cleanup_notebook_helper_forwards_explicit_epoch():
    """
    Probe 2B:
    defer_cleanup_notebook forwards explicit started_at_epoch intact.
    """
    custom_epoch = 1700000000.123
    with patch.object(cleanup_notebook_task, "defer_async", new_callable=AsyncMock) as mock_defer_async:
        await defer_cleanup_notebook(notebook_id="nb-456", started_at_epoch=custom_epoch)
        mock_defer_async.assert_awaited_once()
        kwargs = mock_defer_async.call_args.kwargs
        assert kwargs["notebook_id"] == "nb-456"
        assert kwargs["started_at_epoch"] == custom_epoch


@pytest.mark.asyncio
async def test_adversarial_cleanup_notebook_task_preserves_epoch_on_reschedule():
    """
    Probe 2C:
    When cleanup_notebook_task gets status='in_progress', it MUST reschedule with
    the original effective_started_at, preventing the 4-hour sweeper deadline from
    being perpetually postponed.
    """
    initial_epoch = time.time() - 3600.0  # 1 hour ago
    fake_result = {"status": "in_progress", "notebook_id": "nb-resched", "remaining_sources": 3}

    with patch(
        "app.tasks.cleanup_tasks.execute_cleanup_notebook",
        new_callable=AsyncMock,
        return_value=fake_result,
    ) as mock_exec, patch.object(
        cleanup_notebook_task, "configure"
    ) as mock_configure:
        mock_configured_task = MagicMock()
        mock_configured_task.defer_async = AsyncMock()
        mock_configure.return_value = mock_configured_task

        res = await cleanup_notebook_task(
            notebook_id="nb-resched",
            started_at_epoch=initial_epoch,
        )

        assert res["status"] == "in_progress"
        mock_exec.assert_awaited_once_with(
            notebook_id="nb-resched",
            started_at_epoch=initial_epoch,
            force_deadline=False,
        )

        # Assert reschedule preserves initial_epoch
        mock_configured_task.defer_async.assert_awaited_once_with(
            notebook_id="nb-resched",
            started_at_epoch=initial_epoch,
            schedule_in={"seconds": 10},
        )


# ==============================================================================
# 3. Stream Memory & Dynamic Byte Counter Probes (read_and_validate_file_stream)
# ==============================================================================

class MockAsyncUploadFile:
    """Mock UploadFile simulating async chunk-based streaming."""

    def __init__(self, chunks: List[bytes]):
        self.chunks = list(chunks)
        self.read_index = 0
        self.total_chunks_read = 0

    async def read(self, chunk_size: int = -1) -> bytes:
        if self.read_index < len(self.chunks):
            chunk = self.chunks[self.read_index]
            self.read_index += 1
            self.total_chunks_read += 1
            return chunk
        return b""


@pytest.mark.asyncio
async def test_adversarial_stream_empty_file_raises_400():
    """
    Probe 3A:
    Empty stream (0 bytes) raises HTTP 400 Bad Request.
    """
    mock_file = MockAsyncUploadFile([])
    with pytest.raises(HTTPException) as exc_info:
        await read_and_validate_file_stream(mock_file, max_size_bytes=1024)

    assert exc_info.value.status_code == 400
    assert "cannot upload an empty file" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_adversarial_stream_exact_boundary_succeeds():
    """
    Probe 3B:
    Stream matching exact limit (max_size_bytes) succeeds without error.
    """
    max_size = 4096
    payload = b"A" * max_size
    mock_file = MockAsyncUploadFile([payload[:2048], payload[2048:]])

    result = await read_and_validate_file_stream(mock_file, max_size_bytes=max_size)
    assert len(result) == max_size
    assert result == payload


@pytest.mark.asyncio
async def test_adversarial_stream_boundary_plus_one_aborts_with_413():
    """
    Probe 3C:
    Stream with max_size_bytes + 1 byte aborts immediately with HTTP 413.
    """
    max_size = 4096
    mock_file = MockAsyncUploadFile([b"A" * 4096, b"B"])

    with pytest.raises(HTTPException) as exc_info:
        await read_and_validate_file_stream(mock_file, max_size_bytes=max_size)

    assert exc_info.value.status_code == 413
    assert "stream exceeded maximum allowed size" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_adversarial_stream_short_circuits_without_reading_remaining_payload():
    """
    Probe 3D:
    Adversarial Attack: Client streams massive 100MB payload to exhaust server memory.
    Reader must abort on the first chunk exceeding max_size and SHORT-CIRCUIT:
    it must NOT read the remaining chunks.
    """
    chunk_1mb = b"X" * (1024 * 1024)  # 1MB
    chunks = [chunk_1mb] * 100  # 100MB total

    mock_file = MockAsyncUploadFile(chunks)
    max_size = 50 * 1024 * 1024  # 50MB limit

    with pytest.raises(HTTPException) as exc_info:
        await read_and_validate_file_stream(mock_file, max_size_bytes=max_size)

    assert exc_info.value.status_code == 413
    # Exactly 51 chunks (51MB) read before aborting. The remaining 49 chunks are NEVER read!
    assert mock_file.total_chunks_read == 51, f"Expected 51 chunks read, got {mock_file.total_chunks_read}"


# ==============================================================================
# 4. Memory Leak & io.BytesIO Lifecycle Verification
# ==============================================================================

class TrackedBytesIO(io.BytesIO):
    """Spied BytesIO tracking whether .close() is called."""
    close_call_count = 0

    def close(self):
        TrackedBytesIO.close_call_count += 1
        super().close()


@pytest.mark.asyncio
async def test_adversarial_bytesio_buffer_closed_on_success():
    """
    Probe 4A:
    On successful stream read, buffer.close() is guaranteed to be called.
    """
    TrackedBytesIO.close_call_count = 0
    mock_file = MockAsyncUploadFile([b"chunk1", b"chunk2"])

    with patch("app.routers.sources.io.BytesIO", TrackedBytesIO):
        result = await read_and_validate_file_stream(mock_file, max_size_bytes=1024)

    assert result == b"chunk1chunk2"
    assert TrackedBytesIO.close_call_count >= 1, "BytesIO.close() was NOT called on success path!"


@pytest.mark.asyncio
async def test_adversarial_bytesio_buffer_closed_on_413_overflow():
    """
    Probe 4B:
    When 413 is raised due to size limit exceeded, buffer.close() is guaranteed to be called,
    preventing 50MB buffer retention.
    """
    TrackedBytesIO.close_call_count = 0
    mock_file = MockAsyncUploadFile([b"A" * 2048])

    with patch("app.routers.sources.io.BytesIO", TrackedBytesIO):
        with pytest.raises(HTTPException) as exc_info:
            await read_and_validate_file_stream(mock_file, max_size_bytes=1024)
        assert exc_info.value.status_code == 413

    assert TrackedBytesIO.close_call_count >= 1, "BytesIO.close() was NOT called on 413 path!"


@pytest.mark.asyncio
async def test_adversarial_bytesio_buffer_closed_on_400_empty():
    """
    Probe 4C:
    When 400 is raised on empty file, buffer.close() is guaranteed to be called.
    """
    TrackedBytesIO.close_call_count = 0
    mock_file = MockAsyncUploadFile([])

    with patch("app.routers.sources.io.BytesIO", TrackedBytesIO):
        with pytest.raises(HTTPException) as exc_info:
            await read_and_validate_file_stream(mock_file, max_size_bytes=1024)
        assert exc_info.value.status_code == 400

    assert TrackedBytesIO.close_call_count >= 1, "BytesIO.close() was NOT called on 400 path!"


@pytest.mark.asyncio
async def test_adversarial_bytesio_buffer_closed_on_io_abort_exception():
    """
    Probe 4D:
    When a network abort / socket error occurs during read, buffer.close() is
    guaranteed to be called, preventing memory leaks during connection drops.
    """
    TrackedBytesIO.close_call_count = 0

    class FailingUploadFile:
        async def read(self, chunk_size: int = -1):
            raise ConnectionResetError("Client disconnected mid-upload")

    with patch("app.routers.sources.io.BytesIO", TrackedBytesIO):
        with pytest.raises(ConnectionResetError):
            await read_and_validate_file_stream(FailingUploadFile(), max_size_bytes=1024)

    assert TrackedBytesIO.close_call_count >= 1, "BytesIO.close() was NOT called on exception abort!"
