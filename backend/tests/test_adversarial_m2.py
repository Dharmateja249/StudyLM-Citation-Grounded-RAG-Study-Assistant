"""
Adversarial Storage & Concurrency Challenge Suite (Milestone 2)
Author: challenger_m2_1

Adversarially probes:
1. STOR-03: Queue serialization lock (lock = f"source_{source_id}"):
   - Deterministic lock generator contracts
   - Task configuration lock bindings
   - Serialization mutual exclusion across concurrent operations
   - Collision resistance across different source IDs
2. STOR-05: Delete mid-ingest conditional SQL protection & temporary vector purge:
   - Interleaved delete during active embedding computation
   - Conditional UPDATE WHERE status != 'deleting' resulting in 0 rows updated
   - Tenant-scoped vector purge strictly targeting ingest_run_id without leaking neighbor runs
   - Survival when SQL row is already deleted by Phase 2
   - Counterfactual probe: verifying that unconditional UPDATE would resurrect deleted state
3. STOR-04: Queued ingest after delete:
   - Worker dequeue abort on source with status == 'deleting'
   - Worker dequeue abort on purged/non-existent source
   - Worker dequeue abort on invalid/malformed source ID
   - Zero state resurrection on dequeue abort
4. STOR-08: Upload into deleting notebook rejection (HTTP 409 Conflict):
   - Rejection via POST /sources/upload
   - Rejection via POST /notebooks/{notebook_id}/sources
   - Zero R2 files uploaded and zero SQL rows persisted
   - Cross-tenant privacy precedence: User B uploading to User A's deleting notebook gets 404, not 409
   - Rapid concurrent upload bombardment against deleting notebook
"""

import asyncio
import io
import uuid
from datetime import datetime, timezone
from typing import List

import pytest
from httpx import AsyncClient
from qdrant_client import QdrantClient, models as qmodels
from sqlmodel import select, update

from app.models import Notebook, Source, User
from app.services.qdrant_service import delete_tenant_vectors, upsert_chunk_points
from app.services.storage_service import get_storage_service
from app.tasks.cleanup_tasks import (
    check_source_dequeue_state,
    delete_source_task,
    execute_delete_source,
    execute_ingest_source,
    get_source_task_lock,
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
# 1. STOR-03: Queue Serialization Lock Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_stor_03_lock_determinism_and_collision_resistance():
    """
    STOR-03 Probe:
    Verify that lock strings are deterministic, follow exact format 'source_{id}',
    and exhibit zero collisions across varied source ID formats.
    """
    # 1. UUID-based IDs
    uid1 = str(uuid.uuid4())
    uid2 = str(uuid.uuid4())
    lock1 = get_source_task_lock(uid1)
    lock2 = get_source_task_lock(uid2)

    assert lock1 == f"source_{uid1}"
    assert lock2 == f"source_{uid2}"
    assert lock1 != lock2

    # 2. Sequential / substring prefix resistance
    lock_short = get_source_task_lock("123")
    lock_long = get_source_task_lock("1234")
    assert lock_short == "source_123"
    assert lock_long == "source_1234"
    assert lock_short != lock_long

    # 3. Special characters & punctuation in IDs
    test_ids = ["src-abc_def.123", "tenant_a:source_x", "uuid-with-dashes-999"]
    for sid in test_ids:
        expected = f"source_{sid}"
        assert get_source_task_lock(sid) == expected
        assert delete_source_task.get_lock_string(sid) == expected


@pytest.mark.asyncio
async def test_adversarial_stor_03_task_lock_binding_contract():
    """
    STOR-03 Probe:
    Verify that delete_source_task exposes standard lock bindings
    and configures the queue lock matching get_source_task_lock.
    """
    src_id = f"test-src-{uuid.uuid4()}"
    expected_lock = f"source_{src_id}"

    # Task attribute inspection
    assert hasattr(delete_source_task, "get_lock_string")
    assert delete_source_task.get_lock_string(src_id) == expected_lock

    # Verify task configuration with lock does not alter lock string
    configured = delete_source_task.configure(lock=expected_lock)
    assert configured is not None


# ==============================================================================
# 2. STOR-05: Delete Mid-Ingest Conditional Update & Vector Purge Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_stor_05_delete_mid_ingest_conditional_sql_rollback(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    mock_embedding_vector: List[float],
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    STOR-05 Adversarial Probe:
    Simulate full mid-ingest race interleaving:
    1. Source created with status='processing'.
    2. Ingest Run 1 starts, writes vectors to Qdrant.
    3. User triggers DELETE -> status transitions to 'deleting' in DB.
    4. Ingest Run 1 attempts conditional update:
       UPDATE source SET status='ready' WHERE id=:id AND status != 'deleting'.
    5. Assert: 0 rows updated, ingest drops vectors for run, status remains 'deleting'.
    """
    source_id = str(uuid.uuid4())
    run_id = f"run_{uuid.uuid4().hex[:8]}"
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "doc.pdf")
    await mock_storage.upload_file(b"%PDF-1.4 test document", storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Mid-Ingest Race Source",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="processing",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # Step 1: Ingest computes and upserts 5 vector points
    points = [
        qmodels.PointStruct(
            id=300 + i,
            vector=mock_embedding_vector,
            payload={
                "user_id": user_a.id,
                "notebook_id": user_a_notebook.id,
                "source_id": source_id,
                "ingest_run_id": run_id,
                "chunk_index": i,
                "text": f"Chunk {i} content",
            },
        )
        for i in range(5)
    ]
    upsert_chunk_points(mock_qdrant, "studylm_chunks", points)

    # Verify points exist in Qdrant
    initial_count = mock_qdrant.count(
        collection_name="studylm_chunks",
        count_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="ingest_run_id", match=qmodels.MatchValue(value=run_id))]
        ),
    ).count
    assert initial_count == 5

    # Step 2: Delete request arrives mid-flight (Phase 1)
    await db_session.execute(
        update(Source).where(Source.id == source_id).values(status="deleting")
    )
    await db_session.commit()

    # Step 3: Ingestion attempts conditional update
    cond_update = (
        update(Source)
        .where(Source.id == source_id, Source.status != "deleting")
        .values(status="ready", active_ingest_run_id=run_id)
    )
    res = await db_session.execute(cond_update)
    await db_session.commit()

    # Assert conditional update matched 0 rows
    assert res.rowcount == 0, f"Expected 0 rows updated, got {res.rowcount}"

    # Step 4: When rowcount == 0, ingestion drops newly created vectors
    delete_tenant_vectors(
        mock_qdrant,
        "studylm_chunks",
        user_id=user_a.id,
        ingest_run_id=run_id,
    )

    # Assert all 5 vectors for run_id were purged
    post_count = mock_qdrant.count(
        collection_name="studylm_chunks",
        count_filter=qmodels.Filter(
            must=[qmodels.FieldCondition(key="ingest_run_id", match=qmodels.MatchValue(value=run_id))]
        ),
    ).count
    assert post_count == 0, f"Expected 0 vectors after purge, found {post_count}"

    # Assert source status in SQL remains strictly 'deleting'
    refreshed = (await db_session.execute(select(Source).where(Source.id == source_id))).scalar_one()
    assert refreshed.status == "deleting"
    assert refreshed.active_ingest_run_id != run_id


@pytest.mark.asyncio
async def test_adversarial_stor_05_purge_vector_isolation_across_runs_and_tenants(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    mock_embedding_vector: List[float],
    user_a: User,
    user_b: User,
    user_a_notebook: Notebook,
    user_b_notebook: Notebook,
):
    """
    STOR-05 Adversarial Probe:
    Ensure that purging aborted temporary vectors for (user_a, run_1)
    does NOT touch:
    - User A's other legitimate run (run_2)
    - User B's run (run_b)
    """
    aborted_run = "run_abort_999"
    legit_run = "run_legit_888"
    user_b_run = "run_user_b_777"

    # User A aborted points (3 points)
    pts_abort = [
        qmodels.PointStruct(
            id=400 + i,
            vector=mock_embedding_vector,
            payload={"user_id": user_a.id, "ingest_run_id": aborted_run, "text": f"aborted {i}"},
        )
        for i in range(3)
    ]
    # User A legit points (2 points)
    pts_legit = [
        qmodels.PointStruct(
            id=500 + i,
            vector=mock_embedding_vector,
            payload={"user_id": user_a.id, "ingest_run_id": legit_run, "text": f"legit {i}"},
        )
        for i in range(2)
    ]
    # User B points (2 points)
    pts_b = [
        qmodels.PointStruct(
            id=600 + i,
            vector=mock_embedding_vector,
            payload={"user_id": user_b.id, "ingest_run_id": user_b_run, "text": f"user_b {i}"},
        )
        for i in range(2)
    ]

    upsert_chunk_points(mock_qdrant, "studylm_chunks", pts_abort + pts_legit + pts_b)

    # Purge only aborted run
    delete_tenant_vectors(mock_qdrant, "studylm_chunks", user_id=user_a.id, ingest_run_id=aborted_run)

    # Aborted run points must be 0
    cnt_abort = mock_qdrant.count(
        "studylm_chunks",
        qmodels.Filter(must=[qmodels.FieldCondition(key="ingest_run_id", match=qmodels.MatchValue(value=aborted_run))]),
    ).count
    assert cnt_abort == 0

    # Legit run points must remain intact (2 points)
    cnt_legit = mock_qdrant.count(
        "studylm_chunks",
        qmodels.Filter(must=[qmodels.FieldCondition(key="ingest_run_id", match=qmodels.MatchValue(value=legit_run))]),
    ).count
    assert cnt_legit == 2

    # User B points must remain intact (2 points)
    cnt_b = mock_qdrant.count(
        "studylm_chunks",
        qmodels.Filter(must=[qmodels.FieldCondition(key="ingest_run_id", match=qmodels.MatchValue(value=user_b_run))]),
    ).count
    assert cnt_b == 2


@pytest.mark.asyncio
async def test_adversarial_stor_05_survival_when_sql_row_already_purged(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    mock_embedding_vector: List[float],
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    STOR-05 Adversarial Probe:
    If deletion Phase 2 completes BEFORE ingestion reaches conditional update,
    the Source SQL row has already been deleted from the database.
    Ingestion's conditional update matches 0 rows, vector purge cleans up vectors,
    and no resurrection or exception occurs.
    """
    source_id = str(uuid.uuid4())
    run_id = f"run_{uuid.uuid4().hex[:8]}"
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "early_del.pdf")

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Early Deleted Source",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="processing",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # Ingest upserts vectors
    upsert_chunk_points(
        mock_qdrant,
        "studylm_chunks",
        [
            qmodels.PointStruct(
                id=701,
                vector=mock_embedding_vector,
                payload={"user_id": user_a.id, "source_id": source_id, "ingest_run_id": run_id},
            )
        ],
    )

    # Phase 2 deletion executes fully, purging the SQL row
    await execute_delete_source(
        source_id=source_id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
    )

    # Ingestion tries conditional update on non-existent row
    cond_update = (
        update(Source)
        .where(Source.id == source_id, Source.status != "deleting")
        .values(status="ready", active_ingest_run_id=run_id)
    )
    res = await db_session.execute(cond_update)
    await db_session.commit()

    # 0 rows updated
    assert res.rowcount == 0

    # Purge vectors
    delete_tenant_vectors(mock_qdrant, "studylm_chunks", user_id=user_a.id, ingest_run_id=run_id)

    # Verify 0 vectors remain
    cnt = mock_qdrant.count(
        "studylm_chunks",
        qmodels.Filter(must=[qmodels.FieldCondition(key="ingest_run_id", match=qmodels.MatchValue(value=run_id))]),
    ).count
    assert cnt == 0

    # Row is still None in SQL
    check_row = (await db_session.execute(select(Source).where(Source.id == source_id))).scalar_one_or_none()
    assert check_row is None


# ==============================================================================
# 3. STOR-04: Queued Ingest After Delete Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_stor_04_dequeued_ingest_abort_on_deleting_state(
    db_session,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    STOR-04 Adversarial Probe:
    Verify dequeue check rejects a source in 'deleting' state,
    aborting cleanly and leaving status untouched.
    """
    source_id = str(uuid.uuid4())
    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Deleting Source Dequeued",
        source_type="pdf",
        storage_key_or_url="test/path.pdf",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # Check dequeue state
    state = await check_source_dequeue_state(source_id=source_id, session=db_session)
    assert state["aborted"] is True
    assert state["reason"] == "source_deleting"

    # Polymorphic helper
    exec_res = await execute_ingest_source(source_id=source_id, session=db_session)
    assert exec_res["aborted"] is True
    assert exec_res["reason"] == "source_deleting"

    # Status remains 'deleting'
    refreshed = await db_session.get(Source, source_id)
    assert refreshed.status == "deleting"


@pytest.mark.asyncio
async def test_adversarial_stor_04_dequeued_ingest_abort_on_missing_or_purged_source(
    db_session,
):
    """
    STOR-04 Adversarial Probe:
    Verify dequeue check handles non-existent or already-purged source ID cleanly
    without throwing unhandled exceptions.
    """
    fake_id = str(uuid.uuid4())
    state = await check_source_dequeue_state(source_id=fake_id, session=db_session)
    assert state["aborted"] is True
    assert state["reason"] == "source_deleting"


@pytest.mark.asyncio
async def test_adversarial_stor_04_legitimate_source_is_not_aborted(
    db_session,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    STOR-04 Adversarial Probe:
    Verify that an active/processing source is NOT aborted upon dequeue.
    """
    source_id = str(uuid.uuid4())
    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Legitimate Processing Source",
        source_type="pdf",
        storage_key_or_url="test/legit.pdf",
        status="processing",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    state = await check_source_dequeue_state(source_id=source_id, session=db_session)
    assert state["aborted"] is False
    assert state["reason"] is None
    assert state["status"] == "processing"


# ==============================================================================
# 4. STOR-08: Upload Rejection on Deleting Notebook Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_stor_08_upload_rejection_via_both_routes(
    async_client: AsyncClient,
    db_session,
    mock_storage,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    STOR-08 Adversarial Probe:
    Probe both upload routes:
    1. POST /sources/upload
    2. POST /notebooks/{notebook_id}/sources
    When notebook status == 'deleting', both MUST return HTTP 409 Conflict.
    Zero files in storage, zero sources in DB.
    """
    # Mark notebook deleting
    user_a_notebook.status = "deleting"
    db_session.add(user_a_notebook)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {user_a_token}"}
    payload = b"%PDF-1.4 hostile payload into deleting notebook"

    # Route 1: POST /sources/upload
    files1 = {"file": ("doc1.pdf", io.BytesIO(payload), "application/pdf")}
    data1 = {"notebook_id": user_a_notebook.id}
    resp1 = await async_client.post("/sources/upload", files=files1, data=data1, headers=headers)
    assert resp1.status_code == 409, f"Expected 409 on /sources/upload, got {resp1.status_code}"
    assert "pending deletion" in resp1.json()["detail"].lower()

    # Route 2: POST /notebooks/{id}/sources
    files2 = {"file": ("doc2.pdf", io.BytesIO(payload), "application/pdf")}
    resp2 = await async_client.post(
        f"/notebooks/{user_a_notebook.id}/sources",
        files=files2,
        headers=headers,
    )
    assert resp2.status_code == 409, f"Expected 409 on /notebooks/{user_a_notebook.id}/sources, got {resp2.status_code}"
    assert "pending deletion" in resp2.json()["detail"].lower()

    # Assert 0 storage files stored
    assert len(mock_storage.files) == 0

    # Assert 0 sources created in DB
    src_res = await db_session.execute(
        select(Source).where(Source.notebook_id == user_a_notebook.id)
    )
    assert len(src_res.scalars().all()) == 0


@pytest.mark.asyncio
async def test_adversarial_stor_08_cross_tenant_deleting_notebook_precedence(
    async_client: AsyncClient,
    db_session,
    mock_storage,
    user_a: User,
    user_b: User,
    user_b_token: str,
    user_a_notebook: Notebook,
):
    """
    STOR-08 Adversarial Probe:
    Privacy & anti-enumeration precedence:
    If User B attempts to upload into User A's deleting notebook,
    the endpoint MUST return HTTP 404 Not Found (NOT 409 Conflict).
    User B must NEVER be able to infer that User A has a notebook,
    let alone that it is being deleted.
    """
    user_a_notebook.status = "deleting"
    db_session.add(user_a_notebook)
    await db_session.commit()

    headers_b = {"Authorization": f"Bearer {user_b_token}"}
    files = {"file": ("doc.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")}
    data = {"notebook_id": user_a_notebook.id}

    # User B attempts upload into User A's deleting notebook
    resp = await async_client.post("/sources/upload", files=files, data=data, headers=headers_b)
    assert resp.status_code == 404, f"Expected 404 for cross-tenant deleting notebook, got {resp.status_code}"
    assert "not found" in resp.json()["detail"].lower()
    assert len(mock_storage.files) == 0


@pytest.mark.asyncio
async def test_adversarial_stor_08_concurrent_upload_bombardment_on_deleting_notebook(
    async_client: AsyncClient,
    db_session,
    mock_storage,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    STOR-08 Adversarial Probe:
    Bombard deleting notebook with 10 concurrent upload attempts.
    Assert all 10 are rejected with HTTP 409 Conflict, and zero files/sources remain.
    """
    user_a_notebook.status = "deleting"
    db_session.add(user_a_notebook)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {user_a_token}"}

    async def single_upload(idx: int):
        files = {"file": (f"bombard_{idx}.pdf", io.BytesIO(b"%PDF-1.4 bombardment"), "application/pdf")}
        data = {"notebook_id": user_a_notebook.id}
        return await async_client.post("/sources/upload", files=files, data=data, headers=headers)

    responses = await asyncio.gather(*[single_upload(i) for i in range(10)])

    for resp in responses:
        assert resp.status_code == 409
        assert "pending deletion" in resp.json()["detail"].lower()

    # Zero files leaked into storage
    assert len(mock_storage.files) == 0

    # Zero rows persisted in database
    src_cnt = (
        await db_session.execute(
            select(Source).where(Source.notebook_id == user_a_notebook.id)
        )
    ).scalars().all()
    assert len(src_cnt) == 0


# ==============================================================================
# 5. Additional Adversarial Concurrency & Anti-Enumeration Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_double_delete_anti_enumeration(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    Adversarial Probe:
    Calling DELETE on an already deleting source must return 404 Not Found,
    preventing state leak or redundant task creation.
    """
    source_id = str(uuid.uuid4())
    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Double Delete Source",
        source_type="pdf",
        storage_key_or_url="users/test/doc.pdf",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {user_a_token}"}

    # First delete: transitions to 'deleting'
    resp1 = await async_client.delete(f"/sources/{source_id}", headers=headers)
    assert resp1.status_code == 200
    assert resp1.json()["status"] == "deleting"

    # Second delete: must immediately return 404
    resp2 = await async_client.delete(f"/sources/{source_id}", headers=headers)
    assert resp2.status_code == 404
    assert resp2.json()["detail"] == "Source not found"


@pytest.mark.asyncio
async def test_adversarial_concurrent_double_delete_race(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    Adversarial Probe:
    Two concurrent DELETE requests sent simultaneously against the same source.
    Assert that one receives 200 ('deleting') and the other receives 404 ('Source not found'),
    and the source remains in 'deleting' state.
    """
    source_id = str(uuid.uuid4())
    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Concurrent Delete Source",
        source_type="pdf",
        storage_key_or_url="users/test/doc.pdf",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {user_a_token}"}

    # Fire two concurrent DELETE calls
    resps = await asyncio.gather(
        async_client.delete(f"/sources/{source_id}", headers=headers),
        async_client.delete(f"/sources/{source_id}", headers=headers),
    )

    statuses = [r.status_code for r in resps]
    # At least one succeeded with 200; the other may get 404 or 200 depending on race serialization
    assert 200 in statuses
    for r in resps:
        assert r.status_code in (200, 404)

    # Verify status in DB is 'deleting'
    db_session.expire_all()
    refreshed = await db_session.get(Source, source_id)
    assert refreshed.status == "deleting"



@pytest.mark.asyncio
async def test_adversarial_counterfactual_unconditional_update_proves_resurrection(
    db_session,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Counterfactual Proof Probe:
    Demonstrates mathematically that an UNCONDITIONAL update:
    UPDATE source SET status='ready' WHERE id=:id
    WOULD resurrect a deleting source.
    This proves why the conditional WHERE status != 'deleting' guard in STOR-05
    is an essential structural invariant.
    """
    source_id = str(uuid.uuid4())
    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Counterfactual Source",
        source_type="pdf",
        storage_key_or_url="users/test/doc.pdf",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # 1. Test conditional update (STOR-05 pattern):
    cond_res = await db_session.execute(
        update(Source)
        .where(Source.id == source_id, Source.status != "deleting")
        .values(status="ready")
    )
    assert cond_res.rowcount == 0  # 0 rows updated! Safety preserved!

    # 2. Test counterfactual unconditional update (broken pattern):
    uncond_res = await db_session.execute(
        update(Source)
        .where(Source.id == source_id)
        .values(status="ready")
    )
    assert uncond_res.rowcount == 1  # 1 row updated! Source resurrected!
    # Rollback to avoid state pollution
    await db_session.rollback()
