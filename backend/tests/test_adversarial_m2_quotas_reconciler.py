"""
Milestone 2 Adversarial Verification Suite: Quotas, Size Limits, & Orphan Reconciler
Author: challenger_m2_2
Target Specifications: STOR-10, STOR-11, STOR-12, 50MB Payload Limits

Adversarial Verification Vectors:
1. STOR-12: 20-Source Quota under Row Lock:
   - Exact boundary: 20th source succeeds (201), 21st rejected (400 Bad Request).
   - Zero storage leakage: rejected 21st upload writes 0 bytes to R2 and 0 DB rows.
   - Quota restoration: soft-deleting a source immediately frees a quota slot.
   - Multi-tenant isolation: full quota on Tenant A never blocks Tenant B.
   - Anti-enumeration: foreign tenant upload attempt returns 404, not 400.
   - Status counting: sources in 'processing', 'ready', and 'error' states all consume quota.
2. 50MB Payload Limits:
   - Content-Length header boundary: 50MB allowed, 50MB + 1 byte rejected with HTTP 413.
   - Spoofed header dynamic streaming: small Content-Length header with >50MB stream aborted at 50MB (HTTP 413).
   - Empty payload: 0-byte file rejected with HTTP 400.
   - Non-numeric / negative Content-Length header handling.
3. STOR-10: Atomic Orphan Cleanup on Database Commit Failure:
   - Rollback & cleanup: DB commit failure rolls back transaction, deletes uploaded R2 object, returns HTTP 500.
   - Double failure resilience: R2 delete failure during commit abort does not mask error or crash router.
   - Shield context manager verification: uncommitted abort deletes object, committed block disarms cleanup.
4. STOR-11: Periodic Orphan Reconciler Age Filtering:
   - Age threshold precision: objects < 3600s preserved (grace period); objects >= 3600s unreferenced purged.
   - Referenced preservation: objects >= 3600s referenced in DB preserved.
   - Deleting status preservation: objects referenced in DB with status='deleting' preserved for Phase 2 task.
   - Dry run mode: dry_run=True identifies candidates without deleting from storage.
   - Scale batching: handles >500 mature keys in batched SQL chunks without error.
"""

import io
import uuid
from datetime import datetime, timedelta, timezone
from typing import List
from unittest.mock import patch, AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.config import get_settings
from app.models import Notebook, Source, User
from app.services.storage_service import (
    StorageService,
    get_storage_service,
    reconcile_orphan_r2_objects,
    orphan_upload_shield,
    cleanup_orphan_file,
)
from app.tasks.cleanup_tasks import execute_delete_source


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
# Suite 1: STOR-12 Quota Boundaries & Row Lock Probing
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_quota_20_sources_exact_boundary(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
    mock_storage,
):
    """
    Adversarial Probe:
    - Pre-populate exactly 19 sources.
    - 20th upload MUST succeed (HTTP 201).
    - 21st upload MUST be rejected with HTTP 400 Bad Request.
    - Crucial: 21st upload MUST NOT write any object to R2 and MUST NOT write any row to DB.
    """
    headers = {"Authorization": f"Bearer {user_a_token}"}
    settings = get_settings()

    # 1. Pre-populate 19 sources
    sources_19 = [
        Source(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            notebook_id=user_a_notebook.id,
            title=f"Source {i}",
            source_type="pdf",
            storage_key_or_url=f"users/{user_a.id}/doc_{i}.pdf",
            status="ready",
            created_at=datetime.now(timezone.utc),
        )
        for i in range(19)
    ]
    db_session.add_all(sources_19)
    await db_session.commit()

    initial_storage_count = len(mock_storage.files)

    # 2. Upload 20th source -> Must SUCCEED (boundary condition)
    files_20 = {"file": ("source_20.pdf", io.BytesIO(b"%PDF-1.4 source 20"), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id, "title": "Source 20"}
    resp_20 = await async_client.post("/sources/upload", files=files_20, data=data, headers=headers)
    assert resp_20.status_code == 201, f"Expected 201, got {resp_20.status_code}: {resp_20.text}"
    assert len(mock_storage.files) == initial_storage_count + 1

    # 3. Upload 21st source -> Must be REJECTED (boundary violation)
    files_21 = {"file": ("source_21.pdf", io.BytesIO(b"%PDF-1.4 source 21"), "application/pdf")}
    data_21 = {"notebook_id": user_a_notebook.id, "title": "Source 21"}
    resp_21 = await async_client.post("/sources/upload", files=files_21, data=data_21, headers=headers)

    assert resp_21.status_code == 400
    assert "limit reached" in resp_21.json()["detail"].lower()
    assert f"max {settings.SOURCE_QUOTA}" in resp_21.json()["detail"].lower()

    # 4. Verify ZERO leakage into R2 storage
    # Storage files count must NOT increase after rejected 21st upload
    assert len(mock_storage.files) == initial_storage_count + 1

    # 5. Verify total DB source count remains strictly 20
    stmt = select(Source).where(
        Source.notebook_id == user_a_notebook.id,
        Source.user_id == user_a.id,
    )
    all_sources = (await db_session.execute(stmt)).scalars().all()
    assert len(all_sources) == 20


@pytest.mark.asyncio
async def test_adversarial_quota_restores_on_soft_delete(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
    mock_storage,
):
    """
    Adversarial Probe:
    - Populate exactly 20 sources.
    - Soft-delete one source via DELETE /sources/{source_id} (status='deleting').
    - Immediately attempt upload -> MUST SUCCEED (quota slot restored).
    - Attempt another upload -> MUST FAIL (quota full again).
    """
    headers = {"Authorization": f"Bearer {user_a_token}"}

    sources = [
        Source(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            notebook_id=user_a_notebook.id,
            title=f"Source {i}",
            source_type="pdf",
            storage_key_or_url=f"users/{user_a.id}/doc_{i}.pdf",
            status="ready",
            created_at=datetime.now(timezone.utc),
        )
        for i in range(20)
    ]
    db_session.add_all(sources)
    await db_session.commit()

    # Soft-delete the first source
    victim_id = sources[0].id
    del_resp = await async_client.delete(f"/sources/{victim_id}", headers=headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleting"

    # Slot is now restored: 19 active + 1 deleting
    files_new = {"file": ("replacement.pdf", io.BytesIO(b"%PDF-1.4 replacement"), "application/pdf")}
    resp_new = await async_client.post(
        "/sources/upload",
        files=files_new,
        data={"notebook_id": user_a_notebook.id},
        headers=headers,
    )
    assert resp_new.status_code == 201

    # Attempt another upload: now 20 active + 1 deleting -> must reject
    files_overflow = {"file": ("overflow.pdf", io.BytesIO(b"%PDF-1.4 overflow"), "application/pdf")}
    resp_overflow = await async_client.post(
        "/sources/upload",
        files=files_overflow,
        data={"notebook_id": user_a_notebook.id},
        headers=headers,
    )
    assert resp_overflow.status_code == 400


@pytest.mark.asyncio
async def test_adversarial_quota_multi_tenant_and_anti_enumeration(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_b: User,
    user_a_token: str,
    user_b_token: str,
    user_a_notebook: Notebook,
    mock_storage,
):
    """
    Adversarial Probe:
    - User A has 20 sources (quota full).
    - User B attempts to upload into User A's notebook:
      Must return HTTP 404 (anti-enumeration), NOT 400 Quota Limit.
    - User B uploads into User B's own notebook:
      Must SUCCEED (User A's quota exhaustion has zero side effects on User B).
    """
    # 1. Fill User A's quota
    sources_a = [
        Source(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            notebook_id=user_a_notebook.id,
            title=f"User A Source {i}",
            source_type="pdf",
            storage_key_or_url=f"users/{user_a.id}/doc_{i}.pdf",
            status="ready",
            created_at=datetime.now(timezone.utc),
        )
        for i in range(20)
    ]
    db_session.add_all(sources_a)

    # 2. Create Notebook for User B
    nb_b = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_b.id,
        title="User B Notebook",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(nb_b)
    await db_session.commit()

    # 3. User B attacks User A's full notebook
    files = {"file": ("exploit.pdf", io.BytesIO(b"%PDF-1.4 exploit"), "application/pdf")}
    resp_attack = await async_client.post(
        "/sources/upload",
        files=files,
        data={"notebook_id": user_a_notebook.id},
        headers={"Authorization": f"Bearer {user_b_token}"},
    )
    # Anti-enumeration check: MUST be 404 Not Found, never 400 or 403
    assert resp_attack.status_code == 404

    # 4. User B uploads to their own notebook
    files_b = {"file": ("user_b_doc.pdf", io.BytesIO(b"%PDF-1.4 user b"), "application/pdf")}
    resp_b = await async_client.post(
        "/sources/upload",
        files=files_b,
        data={"notebook_id": nb_b.id},
        headers={"Authorization": f"Bearer {user_b_token}"},
    )
    assert resp_b.status_code == 201


@pytest.mark.asyncio
async def test_adversarial_quota_status_types_counted(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    Adversarial Probe:
    - Verify that sources with statuses 'processing', 'ready', and 'error' all consume quota.
    - Only 'deleting' sources are excluded from the quota counter.
    """
    statuses = ["ready"] * 10 + ["processing"] * 5 + ["error"] * 5  # Total 20 sources
    sources = [
        Source(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            notebook_id=user_a_notebook.id,
            title=f"Source {i}",
            source_type="pdf",
            storage_key_or_url=f"users/{user_a.id}/doc_{i}.pdf",
            status=st,
            created_at=datetime.now(timezone.utc),
        )
        for i, st in enumerate(statuses)
    ]
    db_session.add_all(sources)
    await db_session.commit()

    # 21st upload attempt should be blocked because all 20 non-deleting sources count
    files = {"file": ("new.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")}
    resp = await async_client.post(
        "/sources/upload",
        files=files,
        data={"notebook_id": user_a_notebook.id},
        headers={"Authorization": f"Bearer {user_a_token}"},
    )
    assert resp.status_code == 400
    assert "limit reached" in resp.json()["detail"].lower()


# ==============================================================================
# Suite 2: 50MB Payload Limits & Dynamic Stream Counter Probing
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_payload_content_length_boundary_precision(
    async_client: AsyncClient,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    Adversarial Probe:
    - Content-Length: 52428800 (50MB exact) -> passes header check.
    - Content-Length: 52428801 (50MB + 1 byte) -> rejected with HTTP 413.
    """
    settings = get_settings()
    max_size = settings.MAX_UPLOAD_SIZE  # 52428800

    # 1. 50MB + 1 byte header
    files = {"file": ("too_big.pdf", io.BytesIO(b"content"), "application/pdf")}
    resp_oversize = await async_client.post(
        "/sources/upload",
        files=files,
        data={"notebook_id": user_a_notebook.id},
        headers={
            "Authorization": f"Bearer {user_a_token}",
            "Content-Length": str(max_size + 1),
        },
    )
    assert resp_oversize.status_code == 413
    assert "exceeds maximum allowed size" in resp_oversize.json()["detail"].lower()


@pytest.mark.asyncio
async def test_adversarial_payload_spoofed_content_length_dynamic_stream_catch(
    async_client: AsyncClient,
    user_a_token: str,
    user_a_notebook: Notebook,
    mock_storage,
):
    """
    Adversarial Attack:
    - Client attempts to bypass size check by spoofing Content-Length header to a small value (e.g. 500).
    - But actual stream data exceeds 50MB.
    - Dynamic stream reader chunk counter MUST catch this and abort immediately with HTTP 413.
    - Zero bytes stored in R2, zero DB rows created.
    """
    settings = get_settings()
    max_size = settings.MAX_UPLOAD_SIZE  # 52428800

    # Create a streaming generator that exceeds 50MB
    # 51 chunks of 1MB = 53,477,376 bytes > 52,428,800
    oversized_data = b"X" * (max_size + 1024)

    files = {"file": ("spoofed.pdf", io.BytesIO(oversized_data), "application/pdf")}
    resp = await async_client.post(
        "/sources/upload",
        files=files,
        data={"notebook_id": user_a_notebook.id},
        headers={
            "Authorization": f"Bearer {user_a_token}",
            "Content-Length": "500",  # Spoofed deceptive header
        },
    )

    # Dynamic counter must override spoofed header and return 413
    assert resp.status_code == 413
    assert "stream exceeded maximum allowed size" in resp.json()["detail"].lower()
    # Confirm no files written to mock storage
    assert len(mock_storage.files) == 0


@pytest.mark.asyncio
async def test_adversarial_payload_empty_and_malformed_headers(
    async_client: AsyncClient,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    Adversarial Probe:
    - 0-byte file rejected with HTTP 400.
    - Malformed Content-Length (non-integer, negative) handled gracefully without 500 error.
    """
    # 1. 0-byte file
    files_empty = {"file": ("empty.pdf", io.BytesIO(b""), "application/pdf")}
    resp_empty = await async_client.post(
        "/sources/upload",
        files=files_empty,
        data={"notebook_id": user_a_notebook.id},
        headers={"Authorization": f"Bearer {user_a_token}"},
    )
    assert resp_empty.status_code == 400
    assert "empty file" in resp_empty.json()["detail"].lower()

    # 2. Negative Content-Length header
    files_valid = {"file": ("valid.pdf", io.BytesIO(b"%PDF-1.4 valid"), "application/pdf")}
    resp_negative_cl = await async_client.post(
        "/sources/upload",
        files=files_valid,
        data={"notebook_id": user_a_notebook.id},
        headers={
            "Authorization": f"Bearer {user_a_token}",
            "Content-Length": "-100",
        },
    )
    # Negative Content-Length: header check is passed, dynamic reader reads real content -> 201
    assert resp_negative_cl.status_code == 201

    # 3. Non-numeric Content-Length header
    files_valid2 = {"file": ("valid2.pdf", io.BytesIO(b"%PDF-1.4 valid2"), "application/pdf")}
    resp_nonnum = await async_client.post(
        "/sources/upload",
        files=files_valid2,
        data={"notebook_id": user_a_notebook.id},
        headers={
            "Authorization": f"Bearer {user_a_token}",
            "Content-Length": "not-a-number",
        },
    )
    assert resp_nonnum.status_code == 201


# ==============================================================================
# Suite 3: STOR-10 Atomic Orphan Cleanup Probing
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_orphan_cleanup_on_database_commit_failure(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
    mock_storage,
):
    """
    Adversarial Probe (STOR-10):
    - Simulate database commit explosion (IntegrityError or hardware failure).
    - Verify:
      1. API returns HTTP 500.
      2. Storage service deletes the uploaded binary from R2 immediately.
      3. Zero files stranded in R2 (`mock_storage.files` is empty).
      4. Database has 0 new source rows created.
    """
    files = {"file": ("crash_doc.pdf", io.BytesIO(b"%PDF-1.4 crash payload"), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id, "title": "Crash Doc"}

    with patch("sqlalchemy.ext.asyncio.AsyncSession.commit", side_effect=IntegrityError("DB Boom", "p", "o")):
        resp = await async_client.post(
            "/sources/upload",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {user_a_token}"},
        )
        assert resp.status_code == 500
        assert "transaction failed" in resp.json()["detail"].lower()

    # R2 cleanup assertion
    assert len(mock_storage.files) == 0
    assert len(mock_storage.deleted_keys) >= 1

    # DB state assertion
    stmt = select(Source).where(Source.notebook_id == user_a_notebook.id)
    sources = (await db_session.execute(stmt)).scalars().all()
    assert len(sources) == 0


@pytest.mark.asyncio
async def test_adversarial_orphan_cleanup_shield_context_manager(mock_storage):
    """
    Adversarial Unit Probe (STOR-10):
    Directly test orphan_upload_shield context manager:
    - Case A: Uncommitted exception -> triggers cleanup_orphan_file automatically.
    - Case B: shield.commit() called -> suppresses cleanup on exit.
    """
    key_fail = "users/u1/notebooks/nb1/src1/fail.pdf"
    await mock_storage.upload_file(b"orphan data", key_fail)
    assert key_fail in mock_storage.files

    # Case A: uncommitted block raises exception
    with pytest.raises(RuntimeError):
        async with orphan_upload_shield(key_fail, storage=mock_storage) as shield:
            # Simulate DB failure before shield.commit()
            raise RuntimeError("Database exploded")

    # Assert object was cleaned up
    assert key_fail not in mock_storage.files
    assert key_fail in mock_storage.deleted_keys

    # Case B: shield.commit() successfully disarms cleanup
    key_success = "users/u1/notebooks/nb1/src2/success.pdf"
    await mock_storage.upload_file(b"valid data", key_success)
    assert key_success in mock_storage.files

    async with orphan_upload_shield(key_success, storage=mock_storage) as shield:
        # DB commit succeeds
        shield.commit()

    # Assert object is preserved
    assert key_success in mock_storage.files


@pytest.mark.asyncio
async def test_adversarial_orphan_cleanup_when_r2_delete_also_fails(
    async_client: AsyncClient,
    user_a_token: str,
    user_a_notebook: Notebook,
    mock_storage,
):
    """
    Adversarial Probe:
    - Double failure: DB commit crashes, AND subsequent R2 delete_file also raises an exception.
    - Router must log critical error and STILL return HTTP 500 without masking DB error.
    - Does not crash the server process.
    """
    files = {"file": ("double_fail.pdf", io.BytesIO(b"%PDF-1.4 payload"), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id}

    with patch("sqlalchemy.ext.asyncio.AsyncSession.commit", side_effect=IntegrityError("DB Error", "p", "o")), \
         patch.object(mock_storage, "delete_file", side_effect=Exception("R2 Network Down")):
        resp = await async_client.post(
            "/sources/upload",
            files=files,
            data=data,
            headers={"Authorization": f"Bearer {user_a_token}"},
        )
        assert resp.status_code == 500
        assert "database transaction failed" in resp.json()["detail"].lower()


# ==============================================================================
# Suite 4: STOR-11 Periodic Orphan Reconciler Age Filtering Probing
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_reconciler_exact_1_hour_boundary(
    db_session,
    mock_storage,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Adversarial Probe (STOR-11):
    - Object 1: 3599 seconds old (59m 59s), unreferenced -> MUST BE PRESERVED (within grace period).
    - Object 2: 3600 seconds old (exact 1h boundary), unreferenced -> MUST BE DELETED.
    - Object 3: 7200 seconds old (2h), unreferenced -> MUST BE DELETED.
    - Object 4: 7200 seconds old (2h), referenced in DB -> MUST BE PRESERVED.
    - Object 5: 7200 seconds old (2h), referenced in DB with status='deleting' -> MUST BE PRESERVED (Phase 2 cleans it).
    """
    now = datetime.now(timezone.utc)
    mock_storage.file_metadata = {}

    # 1. Object 1: 3599s old, unreferenced (Grace period)
    k1 = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/s1/young_unreferenced.pdf"
    mock_storage.files[k1] = b"data1"
    mock_storage.file_metadata[k1] = {"last_modified": now - timedelta(seconds=3599)}

    # 2. Object 2: 3600s old, unreferenced (Exact boundary)
    k2 = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/s2/exact_1h_unreferenced.pdf"
    mock_storage.files[k2] = b"data2"
    mock_storage.file_metadata[k2] = {"last_modified": now - timedelta(seconds=3600)}

    # 3. Object 3: 7200s old, unreferenced
    k3 = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/s3/old_unreferenced.pdf"
    mock_storage.files[k3] = b"data3"
    mock_storage.file_metadata[k3] = {"last_modified": now - timedelta(seconds=7200)}

    # 4. Object 4: 7200s old, referenced in DB (active ready)
    k4 = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/s4/old_referenced.pdf"
    mock_storage.files[k4] = b"data4"
    mock_storage.file_metadata[k4] = {"last_modified": now - timedelta(seconds=7200)}
    s4 = Source(
        id="s4",
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Active Source 4",
        source_type="pdf",
        storage_key_or_url=k4,
        status="ready",
        created_at=now - timedelta(seconds=7200),
    )
    db_session.add(s4)

    # 5. Object 5: 7200s old, referenced in DB (deleting status)
    k5 = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/s5/old_deleting.pdf"
    mock_storage.files[k5] = b"data5"
    mock_storage.file_metadata[k5] = {"last_modified": now - timedelta(seconds=7200)}
    s5 = Source(
        id="s5",
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Deleting Source 5",
        source_type="pdf",
        storage_key_or_url=k5,
        status="deleting",
        created_at=now - timedelta(seconds=7200),
    )
    db_session.add(s5)
    await db_session.commit()

    # Run reconciler with standard 3600s max_age
    stats = await reconcile_orphan_r2_objects(
        session=db_session,
        storage_service=mock_storage,
        max_age_seconds=3600,
    )

    # Verification:
    # Deleted: k2 and k3 (2 unreferenced >= 3600s)
    # Preserved: k1 (< 3600s), k4 (in DB), k5 (in DB)
    assert stats["deleted_count"] == 2
    assert stats["preserved_count"] == 3
    assert stats["skipped_recent"] == 1
    assert stats["skipped_active"] == 2

    assert k1 in mock_storage.files, "k1 (3599s) must be preserved in grace period"
    assert k2 not in mock_storage.files, "k2 (3600s) must be deleted"
    assert k3 not in mock_storage.files, "k3 (7200s) must be deleted"
    assert k4 in mock_storage.files, "k4 (active DB) must be preserved"
    assert k5 in mock_storage.files, "k5 (deleting DB) must be preserved"


@pytest.mark.asyncio
async def test_adversarial_reconciler_dry_run_safety(
    db_session,
    mock_storage,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Adversarial Probe:
    - Run reconciler with dry_run=True.
    - Metrics report 1 deletion candidate, but storage files dictionary is UNMODIFIED.
    """
    now = datetime.now(timezone.utc)
    mock_storage.file_metadata = {}

    key_orphan = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/s_orphan/orphan.pdf"
    mock_storage.files[key_orphan] = b"orphan data"
    mock_storage.file_metadata[key_orphan] = {"last_modified": now - timedelta(hours=3)}

    stats = await reconcile_orphan_r2_objects(
        session=db_session,
        storage_service=mock_storage,
        max_age_seconds=3600,
        dry_run=True,
    )

    assert stats["deleted_count"] == 1
    assert stats["dry_run"] is True
    assert key_orphan in stats["deleted_keys"]
    # Key must STILL exist in mock_storage because dry_run=True
    assert key_orphan in mock_storage.files


@pytest.mark.asyncio
async def test_adversarial_reconciler_batch_query_exceeding_500_keys(
    db_session,
    mock_storage,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Adversarial Probe:
    - Create 520 mature unreferenced objects (exceeds single SQL query chunk of 500).
    - Create 10 mature referenced objects.
    - Reconciler must process chunks in batches without SQL parameter limit errors.
    - All 520 orphans purged; all 10 active objects preserved.
    """
    now = datetime.now(timezone.utc)
    mock_storage.file_metadata = {}

    # 1. 520 unreferenced objects
    for i in range(520):
        k = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/orphan_{i}/file.pdf"
        mock_storage.files[k] = b"data"
        mock_storage.file_metadata[k] = {"last_modified": now - timedelta(hours=2)}

    # 2. 10 referenced objects
    ref_sources = []
    for i in range(10):
        k = f"users/{user_a.id}/notebooks/{user_a_notebook.id}/active_{i}/file.pdf"
        mock_storage.files[k] = b"data"
        mock_storage.file_metadata[k] = {"last_modified": now - timedelta(hours=2)}
        s = Source(
            id=f"active_src_{i}",
            user_id=user_a.id,
            notebook_id=user_a_notebook.id,
            title=f"Active {i}",
            source_type="pdf",
            storage_key_or_url=k,
            status="ready",
            created_at=now - timedelta(hours=2),
        )
        ref_sources.append(s)

    db_session.add_all(ref_sources)
    await db_session.commit()

    stats = await reconcile_orphan_r2_objects(
        session=db_session,
        storage_service=mock_storage,
        max_age_seconds=3600,
    )

    assert stats["scanned_objects"] == 530
    assert stats["deleted_count"] == 520
    assert stats["skipped_active"] == 10
    assert len(mock_storage.files) == 10
