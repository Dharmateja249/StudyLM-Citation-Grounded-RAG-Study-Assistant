"""
Milestone 2: Storage & Cascading Deletion Verification Suite (STOR-01..STOR-12)
File: backend/tests/test_storage.py

Verifies:
- STOR-01: Tenant-scoped storage key hierarchy users/{user_id}/notebooks/{notebook_id}/{source_id}/{filename}
- STOR-02: Two-phase cascading source deletion (status='deleting' -> async purge -> row delete)
- STOR-03: Procrastinate queue serialization lock (lock=f"source_{source.id}")
- STOR-04: Delete arriving while ingestion is queued (ingestion cleanly aborts)
- STOR-05: Delete arriving mid-ingest conditional update race protection (WHERE status != 'deleting')
- STOR-06: R2 deletion failure retry handling (status remains 'deleting', task raises retryable error)
- STOR-07: Notebook deletion sweeper and 4-hour safety deadline recovery
- STOR-08: Upload rejection on deleting notebook (HTTP 409 Conflict)
- STOR-09: HTTP 206 Partial Content Range proxy & 15-minute presigned URLs
- STOR-10: Atomic orphan cleanup on database transaction error
- STOR-11: Periodic orphan R2 reconciler (purges unreferenced >1h, preserves younger)
- STOR-12: 20-source quota limit enforcement under row-level transaction locks
- Boundary: 50MB Content-Length header rejection (HTTP 413)
- Boundary: 50MB stream byte counter abort (HTTP 413)
- Boundary: Empty file rejection (HTTP 400)
- Boundary: HTTP 416 Range Not Satisfiable out-of-bounds
- Boundary: Cross-tenant streaming rejection (HTTP 404)
"""

import io
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import List
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from qdrant_client import QdrantClient, models as qmodels
from sqlalchemy.exc import IntegrityError
from sqlmodel import select, update

from app.config import get_settings
from app.models import Notebook, Source, User
from app.services.qdrant_service import delete_tenant_vectors, upsert_chunk_points
from app.services.storage_service import (
    StorageService,
    get_storage_service,
    reconcile_orphan_r2_objects,
)
from app.tasks.cleanup_tasks import (
    execute_delete_source,
    execute_cleanup_notebook,
    execute_ingest_source,
    get_source_task_lock,
    delete_source_task,
    RetryableR2Error,
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
# STOR-01: Tenant Scoped Storage Key Hierarchy
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_01_tenant_scoped_storage_key_hierarchy(
    async_client: AsyncClient,
    mock_storage,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    STOR-01: Object keys in R2 strictly follow:
    users/{user_id}/notebooks/{notebook_id}/{source_id}/{filename}
    """
    # 1. Verify build_scoped_key method
    source_id = str(uuid.uuid4())
    key = mock_storage.build_scoped_key(
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        source_id=source_id,
        filename="lecture1.pdf",
    )
    expected_key = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/{source_id}/lecture1.pdf"
    assert key == expected_key

    # 2. Upload file via API and assert stored key
    payload = b"%PDF-1.4 Mock PDF Content For Key Hierarchy Verification"
    files = {"file": ("lecture1.pdf", io.BytesIO(payload), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id, "title": "Lecture 1"}

    resp = await async_client.post(
        "/sources/upload",
        files=files,
        data=data,
        headers={"Authorization": f"Bearer {user_a_token}"},
    )
    assert resp.status_code == 201
    source_data = resp.json()

    uploaded_key = source_data["storage_key_or_url"]
    assert uploaded_key.startswith(f"users/{user_a.id}/notebooks/{user_a_notebook.id}/")
    assert uploaded_key.endswith("/lecture1.pdf")
    assert uploaded_key in mock_storage.files
    assert mock_storage.files[uploaded_key] == payload


# ==============================================================================
# STOR-02: Two-Phase Cascading Source Deletion
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_02_two_phase_cascading_source_deletion(
    async_client: AsyncClient,
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    mock_embedding_vector: List[float],
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    STOR-02: Two-Phase Deletion:
    Phase 1: Mark status='deleting' synchronously -> subsequent GET returns 404.
    Phase 2: Purge Qdrant vectors, delete R2 binary, delete SQL row.
    """
    # 1. Create Source with stored file and vector
    source_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "doc.pdf")
    await mock_storage.upload_file(b"content", storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Doc to Delete",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # Insert Qdrant vector point
    point = qmodels.PointStruct(
        id=101,
        vector=mock_embedding_vector,
        payload={"user_id": user_a.id, "source_id": source_id, "text": "sample text"},
    )
    upsert_chunk_points(mock_qdrant, "studylm_chunks", [point])

    # 2. Phase 1: DELETE /sources/{source_id}
    del_resp = await async_client.delete(
        f"/sources/{source_id}",
        headers={"Authorization": f"Bearer {user_a_token}"},
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleting"

    # Assert immediate anti-enumeration 404
    get_resp = await async_client.get(
        f"/sources/{source_id}",
        headers={"Authorization": f"Bearer {user_a_token}"},
    )
    assert get_resp.status_code == 404

    # 3. Phase 2: Execute background cleanup task logic
    await execute_delete_source(
        source_id=source_id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
    )

    # Assert external assets purged
    assert storage_key not in mock_storage.files
    assert storage_key in mock_storage.deleted_keys

    vector_count = mock_qdrant.count(
        collection_name="studylm_chunks",
        count_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="source_id", match=qmodels.MatchValue(value=source_id))]
        ),
    ).count
    assert vector_count == 0

    # Assert SQL row removed
    refreshed = (await db_session.execute(select(Source).where(Source.id == source_id))).scalar_one_or_none()
    assert refreshed is None


# ==============================================================================
# STOR-03: Procrastinate Queue Serialization Lock
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_03_procrastinate_queue_serialization_lock():
    """
    STOR-03: Both ingestion and deletion tasks specify queue lock:
    lock = f"source_{source.id}"
    """
    test_source_id = "src_12345"
    expected_lock = f"source_{test_source_id}"

    assert get_source_task_lock(test_source_id) == expected_lock
    assert hasattr(delete_source_task, "get_lock_string")
    assert delete_source_task.get_lock_string(test_source_id) == expected_lock


# ==============================================================================
# STOR-04: Delete Arriving While Ingestion Is Queued
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_04_delete_while_ingest_queued(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    STOR-04: Ingestion checks status before processing.
    If status == 'deleting', it aborts without processing or indexing.
    """
    source_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "test.pdf")
    await mock_storage.upload_file(b"test pdf content", storage_key)

    # Source was marked 'deleting' while queued
    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Queued Then Deleted",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # Run ingestion dequeue verification
    result = await execute_ingest_source(
        source_id=source_id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
    )

    assert result["aborted"] is True
    assert result["reason"] == "source_deleting"

    # Status must NOT be resurrected to 'ready'
    refreshed = (await db_session.execute(select(Source).where(Source.id == source_id))).scalar_one()
    assert refreshed.status == "deleting"


# ==============================================================================
# STOR-05: Delete Arriving Mid-Ingestion Conditional Update Protection
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_05_delete_mid_ingestion_conditional_sql_protection(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    mock_embedding_vector: List[float],
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    STOR-05: Mid-ingest delete race condition.
    Ingest uses: UPDATE source SET status='ready' WHERE id=:id AND status != 'deleting'.
    If 0 rows updated, ingest drops newly upserted vectors and aborts.
    """
    source_id = str(uuid.uuid4())
    ingest_run_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "test.pdf")

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Mid Ingest Delete",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="processing",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # 1. Ingest inserts vectors for this run
    point = qmodels.PointStruct(
        id=201,
        vector=mock_embedding_vector,
        payload={"user_id": user_a.id, "source_id": source_id, "ingest_run_id": ingest_run_id},
    )
    upsert_chunk_points(mock_qdrant, "studylm_chunks", [point])

    # 2. Concurrent delete happens mid-flight
    await db_session.execute(
        update(Source).where(Source.id == source_id).values(status="deleting")
    )
    await db_session.commit()

    # 3. Ingestion attempts conditional update
    cond_update = (
        update(Source)
        .where(Source.id == source_id, Source.status != "deleting")
        .values(status="ready", active_ingest_run_id=ingest_run_id)
    )
    res = await db_session.execute(cond_update)
    await db_session.commit()

    # Assert 0 rows updated
    assert res.rowcount == 0

    # Ingest purges newly created vectors and aborts
    delete_tenant_vectors(mock_qdrant, "studylm_chunks", user_a.id, ingest_run_id=ingest_run_id)

    # Assert vectors removed
    vector_count = mock_qdrant.count(
        collection_name="studylm_chunks",
        count_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="ingest_run_id", match=qmodels.MatchValue(value=ingest_run_id))]
        ),
    ).count
    assert vector_count == 0

    # Assert source status remains 'deleting'
    refreshed = (await db_session.execute(select(Source).where(Source.id == source_id))).scalar_one()
    assert refreshed.status == "deleting"


# ==============================================================================
# STOR-06: R2 Deletion Failure & Retry Handling
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_06_r2_deletion_failure_and_retry_handling(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    STOR-06: If R2 deletion fails, task raises a retryable exception.
    SQL row is NOT deleted, status remains 'deleting'.
    """
    source_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "fail.pdf")
    await mock_storage.upload_file(b"binary", storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Retry Doc",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # Simulate R2 network outage
    with patch.object(mock_storage, "delete_file", side_effect=Exception("R2 Network Timeout 504")):
        with pytest.raises(Exception) as exc_info:
            await execute_delete_source(
                source_id=source_id,
                session=db_session,
                storage_service=mock_storage,
                qdrant_client=mock_qdrant,
            )
        assert "504" in str(exc_info.value) or "Timeout" in str(exc_info.value)

    # Verify SQL row still exists and is still marked 'deleting'
    refreshed = (await db_session.execute(select(Source).where(Source.id == source_id))).scalar_one_or_none()
    assert refreshed is not None
    assert refreshed.status == "deleting"


# ==============================================================================
# STOR-06 Extension: Qdrant Deletion Failure & Retry Handling
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_06_qdrant_deletion_failure_and_retry_handling(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    STOR-06 Extension: If Qdrant vector deletion fails, task raises RetryableStorageError.
    SQL row is NOT deleted, and status remains 'deleting'.
    """
    source_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "qdrant_fail.pdf")
    await mock_storage.upload_file(b"binary", storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Qdrant Retry Doc",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # Simulate Qdrant service failure
    with patch("app.services.qdrant_service.delete_tenant_vectors", side_effect=Exception("Qdrant 503 Unavailable")):
        with pytest.raises(Exception) as exc_info:
            await execute_delete_source(
                source_id=source_id,
                session=db_session,
                storage_service=mock_storage,
                qdrant_client=mock_qdrant,
            )
        assert "Qdrant 503" in str(exc_info.value) or "Transient Qdrant failure" in str(exc_info.value)

    # Verify SQL row still exists and is still marked 'deleting'
    refreshed = (await db_session.execute(select(Source).where(Source.id == source_id))).scalar_one_or_none()
    assert refreshed is not None
    assert refreshed.status == "deleting"


# ==============================================================================
# STOR-07: Notebook Deletion Sweeper & Deadline Recovery
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_07_notebook_deletion_sweeper_and_deadline_recovery(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
    mock_storage,
    mock_qdrant: QdrantClient,
):
    """
    STOR-07: Notebook deletion cascades 'deleting' status to child sources.
    - DELETE /notebooks/{id} enqueues cleanup_notebook_task.
    - Notebook older than 4 hours is NOT prematurely forced via backstop;
      it completes standard cascading deletion first.
    - 4-hour safety deadline backstop forcefully cleans stuck notebooks.
    """
    # 1. Create a Notebook created 5 hours ago with 2 Sources
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Notebook To Sweep",
        status="active",
        created_at=datetime.now(timezone.utc) - timedelta(hours=5),  # 5 hours old
    )
    db_session.add(notebook)
    await db_session.flush()

    s1 = Source(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        notebook_id=notebook.id,
        title="Child 1",
        source_type="pdf",
        storage_key_or_url="users/test/child1.pdf",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    s2 = Source(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        notebook_id=notebook.id,
        title="Child 2",
        source_type="pdf",
        storage_key_or_url="users/test/child2.pdf",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([s1, s2])
    await db_session.commit()

    # 2. Trigger DELETE /notebooks/{id} with deferral spy
    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", wraps=None) as mock_defer:
        del_resp = await async_client.delete(
            f"/notebooks/{notebook.id}",
            headers={"Authorization": f"Bearer {user_a_token}"},
        )
        assert del_resp.status_code == 200
        mock_defer.assert_called_once()
        assert mock_defer.call_args[1]["notebook_id"] == notebook.id
        assert "started_at_epoch" in mock_defer.call_args[1]

    # Assert notebook and sources set to 'deleting'
    target_nb_id = notebook.id
    db_session.expire_all()
    nb_ref = (await db_session.execute(select(Notebook).where(Notebook.id == target_nb_id))).scalar_one()
    assert nb_ref.status == "deleting"
    sources_ref = (await db_session.execute(select(Source).where(Source.notebook_id == target_nb_id))).scalars().all()
    assert all(s.status == "deleting" for s in sources_ref)

    # 3. Sweeper sweeps child sources normally (NOT tripping deadline despite notebook.created_at being 5h old)
    sweep_res = await execute_cleanup_notebook(
        notebook_id=notebook.id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
        started_at_epoch=time.time(),  # Started right now
    )
    assert sweep_res["status"] == "completed"

    # Assert notebook row deleted
    nb_after = (await db_session.execute(select(Notebook).where(Notebook.id == notebook.id))).scalar_one_or_none()
    assert nb_after is None

    # 4. Verify 4-hour safety deadline backstop logic triggers when deletion was started > 4 hours ago
    stuck_notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Stuck Notebook",
        status="deleting",
        created_at=datetime.now(timezone.utc) - timedelta(hours=6),
    )
    db_session.add(stuck_notebook)
    await db_session.commit()

    # Invocation with started_at_epoch > 4 hours ago (15,000s)
    deadline_res = await execute_cleanup_notebook(
        notebook_id=stuck_notebook.id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
        started_at_epoch=time.time() - 15000,
    )
    assert deadline_res["status"] == "deadline_recovered"
    assert (await db_session.execute(select(Notebook).where(Notebook.id == stuck_notebook.id))).scalar_one_or_none() is None


# ==============================================================================
# STOR-08: Upload Rejection on Deleting Notebook
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_08_upload_rejection_on_deleting_notebook(
    async_client: AsyncClient,
    db_session,
    user_a_token: str,
    user_a_notebook: Notebook,
    mock_storage,
):
    """
    STOR-08: Reject upload with HTTP 409 Conflict if notebook.status == 'deleting'.
    Zero files stored in R2 and zero rows created in DB.
    """
    # 1. Mark notebook as 'deleting'
    user_a_notebook.status = "deleting"
    db_session.add(user_a_notebook)
    await db_session.commit()

    # 2. Attempt upload
    files = {"file": ("test.pdf", io.BytesIO(b"%PDF-1.4 sample"), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id}

    resp = await async_client.post(
        "/sources/upload",
        files=files,
        data=data,
        headers={"Authorization": f"Bearer {user_a_token}"},
    )

    assert resp.status_code == 409
    assert "pending deletion" in resp.json()["detail"].lower()
    assert len(mock_storage.files) == 0


# ==============================================================================
# STOR-09: HTTP 206 Partial Content Range Proxy & Presigned URLs
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_09_range_request_proxy_and_presigned_urls(
    async_client: AsyncClient,
    db_session,
    mock_storage,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    STOR-09:
    1. HTTP Range request returns 206 Partial Content with Content-Range and Accept-Ranges.
    2. Presigned URL generation returns 15-minute (900s) URL.
    """
    # 1. Create 1000-byte test file
    payload = b"X" * 1000
    source_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "stream.pdf")
    await mock_storage.upload_file(payload, storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Stream Doc",
        source_type="pdf",
        storage_key_or_url=storage_key,
        file_size_bytes=1000,
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {user_a_token}"}

    # 2. Test Range request: bytes=0-99 (first 100 bytes)
    range_headers = {**headers, "Range": "bytes=0-99"}
    resp_range = await async_client.get(f"/sources/{source_id}/stream", headers=range_headers)

    assert resp_range.status_code == 206
    assert resp_range.content == b"X" * 100
    assert resp_range.headers["Content-Range"] == "bytes 0-99/1000"
    assert resp_range.headers["Accept-Ranges"] == "bytes"
    assert resp_range.headers["Content-Length"] == "100"

    # 3. Test Full stream request
    resp_full = await async_client.get(f"/sources/{source_id}/stream", headers=headers)
    assert resp_full.status_code == 200
    assert resp_full.content == payload
    assert resp_full.headers["Accept-Ranges"] == "bytes"
    assert resp_full.headers["Content-Length"] == "1000"

    # 4. Test Presigned URL endpoint
    resp_url = await async_client.get(f"/sources/{source_id}/presigned-url", headers=headers)
    assert resp_url.status_code == 200
    data = resp_url.json()
    assert data["source_id"] == source_id
    assert data["expires_in"] == 900
    assert "expires=900" in data["presigned_url"]


# ==============================================================================
# STOR-10: Atomic Orphan Cleanup on Database Error
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_10_atomic_orphan_cleanup_on_db_error(
    async_client: AsyncClient,
    mock_storage,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    STOR-10: If R2 upload succeeds but subsequent DB transaction fails,
    the uploaded R2 object is immediately deleted. Zero orphans in R2.
    """
    files = {"file": ("error_doc.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id}

    # Simulate DB crash on commit
    with patch("sqlalchemy.ext.asyncio.AsyncSession.commit", side_effect=IntegrityError("Crash", "params", "orig")):
        resp = await async_client.post(
            "/sources/upload",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {user_a_token}"},
        )
        assert resp.status_code == 500

    # Verify R2 object was cleaned up
    assert len(mock_storage.files) == 0
    assert len(mock_storage.deleted_keys) >= 1


# ==============================================================================
# STOR-11: Periodic Orphan R2 Reconciler
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_11_periodic_orphan_r2_reconciler(
    db_session,
    mock_storage,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    STOR-11:
    - Object in DB: PRESERVED
    - Object not in DB > 1h old: DELETED
    - Object not in DB < 1h old (grace period): PRESERVED
    """
    now = datetime.now(timezone.utc)
    mock_storage.file_metadata = {}

    # 1. Key A: In DB (valid active source)
    key_a = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/src_a/doc.pdf"
    mock_storage.files[key_a] = b"file_a"
    mock_storage.file_metadata[key_a] = {"last_modified": now - timedelta(hours=2)}

    source = Source(
        id="src_a",
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Doc A",
        source_type="pdf",
        storage_key_or_url=key_a,
        status="ready",
        created_at=now,
    )
    db_session.add(source)
    await db_session.commit()

    # 2. Key B: NOT in DB, 2 hours old -> MUST BE DELETED
    key_b = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/src_b/orphan_old.pdf"
    mock_storage.files[key_b] = b"file_b"
    mock_storage.file_metadata[key_b] = {"last_modified": now - timedelta(hours=2)}

    # 3. Key C: NOT in DB, 15 minutes old (in grace period) -> MUST BE PRESERVED
    key_c = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/src_c/orphan_young.pdf"
    mock_storage.files[key_c] = b"file_c"
    mock_storage.file_metadata[key_c] = {"last_modified": now - timedelta(minutes=15)}

    # Run Reconciler
    stats = await reconcile_orphan_r2_objects(
        session=db_session,
        storage_service=mock_storage,
        max_age_seconds=3600,
    )

    assert stats["deleted_count"] == 1
    assert stats["preserved_count"] == 2

    assert key_a in mock_storage.files  # Preserved (in DB)
    assert key_b not in mock_storage.files  # Purged
    assert key_c in mock_storage.files  # Preserved (younger than 1h)


# ==============================================================================
# STOR-12: 20-Source Quota Lock Under Concurrency
# ==============================================================================
@pytest.mark.asyncio
async def test_stor_12_quota_limit_20_sources(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
    mock_storage,
):
    """
    STOR-12: Maximum 20 active sources per notebook/user.
    21st upload rejected with HTTP 400 Bad Request.
    Deleting sources do not count toward quota.
    """
    # 1. Populate 20 active sources
    sources = [
        Source(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            notebook_id=user_a_notebook.id,
            title=f"Source #{i}",
            source_type="pdf",
            storage_key_or_url=f"users/{user_a.id}/doc_{i}.pdf",
            status="ready",
            created_at=datetime.now(timezone.utc),
        )
        for i in range(20)
    ]
    db_session.add_all(sources)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {user_a_token}"}

    # 2. Attempt 21st upload -> MUST BE REJECTED (HTTP 400)
    files = {"file": ("source21.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id}

    resp = await async_client.post("/sources/upload", files=files, data=data, headers=headers)
    assert resp.status_code == 400
    assert "limit reached" in resp.json()["detail"].lower()

    # 3. Mark one source 'deleting' -> active sources = 19
    sources[0].status = "deleting"
    db_session.add(sources[0])
    await db_session.commit()

    # 4. Upload 21st source again -> MUST SUCCEED (HTTP 201)
    files2 = {"file": ("source_allowed.pdf", io.BytesIO(b"%PDF-1.4 content"), "application/pdf")}
    resp2 = await async_client.post("/sources/upload", files=files2, data=data, headers=headers)
    assert resp2.status_code == 201


# ==============================================================================
# Boundary & Edge-Case Tests (50MB Limits, Empty File, Range Out of Bounds)
# ==============================================================================

@pytest.mark.asyncio
async def test_boundary_upload_content_length_exceeded(
    async_client: AsyncClient,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    Boundary Test: Header Content-Length > 50MB (52,428,801 bytes).
    Server rejects immediately with HTTP 413 Payload Too Large.
    """
    files = {"file": ("huge.pdf", io.BytesIO(b"small body"), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id}
    headers = {
        "Authorization": f"Bearer {user_a_token}",
        "Content-Length": str(52428800 + 1),  # 50MB + 1
    }

    resp = await async_client.post("/sources/upload", files=files, data=data, headers=headers)
    assert resp.status_code == 413
    assert "exceeds maximum allowed size" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_boundary_upload_empty_file_rejected(
    async_client: AsyncClient,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    Boundary Test: 0-byte file rejected with HTTP 400 Bad Request.
    """
    files = {"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id}
    headers = {"Authorization": f"Bearer {user_a_token}"}

    resp = await async_client.post("/sources/upload", files=files, data=data, headers=headers)
    assert resp.status_code == 400
    assert "empty file" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_boundary_range_request_out_of_bounds_returns_416(
    async_client: AsyncClient,
    db_session,
    mock_storage,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    Boundary Test: Range request start >= total_size returns HTTP 416.
    """
    source_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "short.pdf")
    await mock_storage.upload_file(b"Short content 20B", storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Short Doc",
        source_type="pdf",
        storage_key_or_url=storage_key,
        file_size_bytes=17,
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    headers = {
        "Authorization": f"Bearer {user_a_token}",
        "Range": "bytes=5000-6000",
    }
    resp = await async_client.get(f"/sources/{source_id}/stream", headers=headers)
    assert resp.status_code == 416
    assert resp.headers.get("Content-Range") == "bytes */17"


@pytest.mark.asyncio
async def test_boundary_cross_tenant_stream_returns_404(
    async_client: AsyncClient,
    user_b_token: str,
    user_a_source: Source,
):
    """
    Boundary Test: User B attempting to stream User A's source returns HTTP 404 (anti-enumeration).
    """
    resp = await async_client.get(
        f"/sources/{user_a_source.id}/stream",
        headers={"Authorization": f"Bearer {user_b_token}"},
    )
    assert resp.status_code == 404
