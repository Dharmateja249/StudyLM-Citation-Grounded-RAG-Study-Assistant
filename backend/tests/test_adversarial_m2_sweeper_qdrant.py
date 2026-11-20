"""
Adversarial Verification Suite: Sweeper Deadline & Qdrant Deletion Failure Handling
Author: challenger_m2_r2_1
Target Specifications: STOR-02, STOR-06, STOR-07

Adversarially probes:
1. Sweeper Deadline Decoupling with Old Notebook (48 hours old):
   - Calling execute_cleanup_notebook without force_deadline (and started_at_epoch=None)
     performs standard cascading deletion.
   - Does NOT trip the 4-hour force-purge backstop on run 1 (result['status'] == 'completed').
   - Notebook with multiple child sources sweeps each child through Phase 1 & 2 before
     deleting notebook row.
   - Notebook created 48h ago with 0 child sources cleans up cleanly without tripping backstop.
2. 4-Hour Safety Deadline Force-Purge Backstop:
   - Calling execute_cleanup_notebook with started_at_epoch = time.time() - 15000 (> 4 hours)
     triggers safety backstop (result['status'] == 'deadline_recovered').
   - Calling execute_cleanup_notebook with force_deadline=True triggers backstop regardless
     of started_at_epoch.
   - Deadline boundary precision: 10s before deadline (14390s) does NOT trip backstop;
     1s past deadline (14401s) trips backstop.
   - Backstop purges tenant vectors, child sources, and notebook row from DB.
3. Qdrant Deletion Failure and Retryable Exception Handling:
   - In _do_delete_source / execute_delete_source, when delete_tenant_vectors raises an exception:
     a) Raises RetryableStorageError (and is subclass of RetryableTaskError).
     b) Leaves source.status == 'deleting' in database.
     c) Does NOT delete the Source SQL row.
     d) Does NOT delete the R2 binary.
   - If source was initially 'ready', status transitions to 'deleting' and commits before raising.
   - Sweeper integration: When child source raises RetryableStorageError during sweep,
     execute_cleanup_notebook catches it, leaves source row intact, halts notebook finalization,
     and returns status == 'in_progress' with remaining_sources == 1.
   - Subsequent retry after Qdrant recovery successfully completes deletion.
"""

import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import List
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from qdrant_client import QdrantClient, models as qmodels
from sqlmodel import select

from app.models import Notebook, Source, User, Message
from app.services.qdrant_service import delete_tenant_vectors, upsert_chunk_points
from app.services.storage_service import get_storage_service
from app.tasks.cleanup_tasks import (
    execute_delete_source,
    execute_cleanup_notebook,
    _do_delete_source,
    _do_cleanup_notebook,
    RetryableStorageError,
    RetryableTaskError,
    RetryableQdrantError,
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
# Suite 1: Sweeper Deadline Decoupling (48-Hour-Old Notebook Probes)
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_sweeper_48h_old_notebook_does_not_trip_deadline_backstop(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    mock_embedding_vector: List[float],
    user_a: User,
):
    """
    Mission Probe 1:
    Create a notebook created 48 hours ago with 2 child sources.
    Call execute_cleanup_notebook with default arguments (started_at_epoch=None, force_deadline=False).
    Assert:
    - Standard cascading deletion completes cleanly (status == 'completed').
    - Status is NOT 'deadline_recovered' (the 4-hour force-purge was NOT tripped).
    - sources_deleted == 2.
    - All child sources and the notebook are deleted from the database.
    - R2 binaries for child sources are purged from mock_storage.
    """
    # 1. Create notebook created 48 hours in the past
    now = datetime.now(timezone.utc)
    created_48h_ago = now - timedelta(hours=48)
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Ancient Notebook 48h Old",
        status="deleting",
        created_at=created_48h_ago,
    )
    db_session.add(notebook)
    await db_session.flush()

    # 2. Add 2 child sources with stored files and Qdrant vectors
    s1_id = str(uuid.uuid4())
    s1_key = mock_storage.build_scoped_key(user_a.id, notebook.id, s1_id, "doc1.pdf")
    await mock_storage.upload_file(b"doc1 content", s1_key)

    s1 = Source(
        id=s1_id,
        user_id=user_a.id,
        notebook_id=notebook.id,
        title="Child 1",
        source_type="pdf",
        storage_key_or_url=s1_key,
        status="deleting",
        created_at=created_48h_ago,
    )

    s2_id = str(uuid.uuid4())
    s2_key = mock_storage.build_scoped_key(user_a.id, notebook.id, s2_id, "doc2.pdf")
    await mock_storage.upload_file(b"doc2 content", s2_key)

    s2 = Source(
        id=s2_id,
        user_id=user_a.id,
        notebook_id=notebook.id,
        title="Child 2",
        source_type="pdf",
        storage_key_or_url=s2_key,
        status="deleting",
        created_at=created_48h_ago,
    )

    db_session.add_all([s1, s2])
    await db_session.commit()

    # Insert Qdrant vector points
    p1 = qmodels.PointStruct(
        id=1001,
        vector=mock_embedding_vector,
        payload={"user_id": user_a.id, "notebook_id": notebook.id, "source_id": s1_id, "text": "t1"},
    )
    p2 = qmodels.PointStruct(
        id=1002,
        vector=mock_embedding_vector,
        payload={"user_id": user_a.id, "notebook_id": notebook.id, "source_id": s2_id, "text": "t2"},
    )
    upsert_chunk_points(mock_qdrant, "studylm_chunks", [p1, p2])

    # 3. Call execute_cleanup_notebook WITHOUT started_at_epoch and WITHOUT force_deadline
    res = await execute_cleanup_notebook(
        notebook_id=notebook.id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
        started_at_epoch=None,
        force_deadline=False,
    )

    # 4. Assert: Standard cascading deletion executed, NOT deadline recovery
    assert res["status"] == "completed", f"Expected 'completed', got {res['status']}"
    assert res.get("status") != "deadline_recovered", "CRITICAL BUG: Force deadline backstop was prematurely triggered!"
    assert res["sources_deleted"] == 2

    # 5. Verify database and storage states
    assert (await db_session.execute(select(Source).where(Source.notebook_id == notebook.id))).scalars().all() == []
    assert (await db_session.execute(select(Notebook).where(Notebook.id == notebook.id))).scalar_one_or_none() is None
    assert s1_key not in mock_storage.files
    assert s2_key not in mock_storage.files


@pytest.mark.asyncio
async def test_adversarial_sweeper_48h_old_notebook_zero_sources_clean_completion(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
):
    """
    Mission Probe 1 Variant:
    Notebook created 48h ago with 0 sources.
    Assert clean 'completed' without tripping backstop.
    """
    created_48h_ago = datetime.now(timezone.utc) - timedelta(hours=48)
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Empty Ancient Notebook",
        status="deleting",
        created_at=created_48h_ago,
    )
    db_session.add(notebook)
    await db_session.commit()

    res = await execute_cleanup_notebook(
        notebook_id=notebook.id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
    )

    assert res["status"] == "completed"
    assert res.get("status") != "deadline_recovered"
    assert res["sources_deleted"] == 0
    assert (await db_session.get(Notebook, notebook.id)) is None


# ==============================================================================
# Suite 2: 4-Hour Safety Deadline Force-Purge Backstop Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_sweeper_deadline_backstop_triggers_on_stuck_epoch(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    mock_embedding_vector: List[float],
    user_a: User,
):
    """
    Mission Probe 2A:
    Call execute_cleanup_notebook with started_at_epoch = time.time() - 15000 (> 4 hours ago).
    Assert:
    - Status is 'deadline_recovered'.
    - Forceful cleanup purges child sources and notebook row.
    - Vectors and R2 files are cleaned.
    """
    now = datetime.now(timezone.utc)
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Stuck Notebook 15000s",
        status="deleting",
        created_at=now - timedelta(hours=10),
    )
    db_session.add(notebook)
    await db_session.flush()

    s1_id = str(uuid.uuid4())
    s1_key = mock_storage.build_scoped_key(user_a.id, notebook.id, s1_id, "stuck.pdf")
    await mock_storage.upload_file(b"stuck data", s1_key)

    s1 = Source(
        id=s1_id,
        user_id=user_a.id,
        notebook_id=notebook.id,
        title="Stuck Child",
        source_type="pdf",
        storage_key_or_url=s1_key,
        status="deleting",
        created_at=now - timedelta(hours=10),
    )
    db_session.add(s1)
    await db_session.commit()

    # Vector
    point = qmodels.PointStruct(
        id=2001,
        vector=mock_embedding_vector,
        payload={"user_id": user_a.id, "notebook_id": notebook.id, "source_id": s1_id},
    )
    upsert_chunk_points(mock_qdrant, "studylm_chunks", [point])

    # Invoke sweeper with started_at_epoch = time.time() - 15000 (4.16 hours ago)
    res = await execute_cleanup_notebook(
        notebook_id=notebook.id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
        started_at_epoch=time.time() - 15000,
        force_deadline=False,
    )

    assert res["status"] == "deadline_recovered"
    assert res["sources_purged"] == 1
    assert (await db_session.get(Notebook, notebook.id)) is None
    assert (await db_session.get(Source, s1_id)) is None
    assert s1_key not in mock_storage.files


@pytest.mark.asyncio
async def test_adversarial_sweeper_force_deadline_flag_triggers_backstop_immediately(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
):
    """
    Mission Probe 2B:
    Call execute_cleanup_notebook with force_deadline=True, even with started_at_epoch=None or now.
    Assert safety backstop triggers immediately (status == 'deadline_recovered').
    """
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Immediate Force Purge Notebook",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(notebook)
    await db_session.commit()

    res = await execute_cleanup_notebook(
        notebook_id=notebook.id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
        started_at_epoch=time.time(),  # Started right now
        force_deadline=True,          # But force_deadline is explicitly True
    )

    assert res["status"] == "deadline_recovered"
    assert (await db_session.get(Notebook, notebook.id)) is None


@pytest.mark.asyncio
async def test_adversarial_sweeper_deadline_boundary_precision(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
):
    """
    Mission Probe 2C: Exact Boundary Precision Test:
    - 4 hours = 14400s
    - started_at_epoch = time.time() - 14390s (10s BEFORE deadline):
      elapsed < 14400 -> does NOT trip deadline (status == 'completed')
    - started_at_epoch = time.time() - 14401s (1s PAST deadline):
      elapsed >= 14400 -> TRIPS deadline (status == 'deadline_recovered')
    """
    # 1. Test 10s before deadline (sub-boundary)
    nb_sub = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Sub Boundary NB",
        status="deleting",
        created_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    db_session.add(nb_sub)
    await db_session.commit()

    res_sub = await execute_cleanup_notebook(
        notebook_id=nb_sub.id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
        started_at_epoch=time.time() - 14390,  # 14390 < 14400
    )
    assert res_sub["status"] == "completed", f"Expected standard completed, got {res_sub['status']}"

    # 2. Test 1s past deadline (super-boundary)
    nb_super = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Super Boundary NB",
        status="deleting",
        created_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    db_session.add(nb_super)
    await db_session.commit()

    res_super = await execute_cleanup_notebook(
        notebook_id=nb_super.id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
        started_at_epoch=time.time() - 14401,  # 14401 >= 14400
    )
    assert res_super["status"] == "deadline_recovered", f"Expected deadline_recovered, got {res_super['status']}"


# ==============================================================================
# Suite 3: Qdrant Deletion Failure and Retryable Handling Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_qdrant_vector_deletion_failure_preserves_row_and_status(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Mission Probe 3A:
    Probe Qdrant failure in _do_delete_source / execute_delete_source:
    - delete_tenant_vectors raises Exception.
    Assert:
    1. Raises RetryableStorageError (and isinstance check passes).
    2. Source row is NOT deleted from database.
    3. Source status is preserved as 'deleting'.
    4. R2 file binary is NOT deleted.
    """
    source_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "qdrant_test.pdf")
    await mock_storage.upload_file(b"valuable binary content", storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Qdrant Target Doc",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # Simulate Qdrant outage during vector deletion
    with patch(
        "app.services.qdrant_service.delete_tenant_vectors",
        side_effect=Exception("Qdrant gRPC 503 Unavailable / Connection Refused"),
    ):
        with pytest.raises(RetryableStorageError) as exc_info:
            await execute_delete_source(
                source_id=source_id,
                session=db_session,
                storage_service=mock_storage,
                qdrant_client=mock_qdrant,
            )

        # Assert exception hierarchy
        assert isinstance(exc_info.value, RetryableStorageError)
        assert isinstance(exc_info.value, RetryableTaskError)
        assert "Transient Qdrant failure" in str(exc_info.value)
        assert "503 Unavailable" in str(exc_info.value)

    # Assert SQL row was NOT deleted
    refreshed_source = (await db_session.execute(select(Source).where(Source.id == source_id))).scalar_one_or_none()
    assert refreshed_source is not None, "CRITICAL BUG: SQL row was purged despite Qdrant failure!"
    assert refreshed_source.status == "deleting", f"Expected 'deleting', got {refreshed_source.status}"

    # Assert R2 file was NOT purged (Phase 1B did not execute)
    assert storage_key in mock_storage.files, "CRITICAL BUG: R2 file was deleted despite Qdrant failure!"


@pytest.mark.asyncio
async def test_adversarial_qdrant_failure_transitions_ready_source_to_deleting(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Mission Probe 3B:
    Source initially has status='ready'.
    If execute_delete_source encounters Qdrant failure:
    - Status MUST be committed to 'deleting' in DB before raising RetryableStorageError.
    - SQL row remains in DB with status='deleting'.
    """
    source_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "ready_doc.pdf")
    await mock_storage.upload_file(b"data", storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Ready Doc",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="ready",  # Initially ready!
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    with patch(
        "app.services.qdrant_service.delete_tenant_vectors",
        side_effect=Exception("Qdrant Cluster Partition"),
    ):
        with pytest.raises(RetryableStorageError):
            await execute_delete_source(
                source_id=source_id,
                session=db_session,
                storage_service=mock_storage,
                qdrant_client=mock_qdrant,
            )

    # Verify status transitioned to 'deleting' and committed in DB
    refreshed = await db_session.get(Source, source_id)
    assert refreshed is not None
    assert refreshed.status == "deleting"


@pytest.mark.asyncio
async def test_adversarial_qdrant_failure_halts_notebook_sweeper_and_reschedules(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
):
    """
    Mission Probe 3C: Sweeper Integration:
    Notebook has 2 child sources. Source 1 succeeds, Source 2 fails with Qdrant error.
    Assert:
    - Sweeper catches exception during child deletion.
    - Child Source 2 remains in DB with status='deleting'.
    - Notebook row is NOT deleted from DB (status remains 'deleting').
    - Sweeper returns status='in_progress' with remaining_sources=1.
    """
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Sweeper Qdrant Failure NB",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(notebook)
    await db_session.flush()

    s1 = Source(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        notebook_id=notebook.id,
        title="Healthy Child",
        source_type="pdf",
        storage_key_or_url="users/test/healthy.pdf",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    s2 = Source(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        notebook_id=notebook.id,
        title="Unhealthy Child",
        source_type="pdf",
        storage_key_or_url="users/test/unhealthy.pdf",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([s1, s2])
    await db_session.commit()

    # Original delete function
    from app.services.qdrant_service import delete_tenant_vectors as real_del_vec

    def mock_del_vec(**kwargs):
        if kwargs.get("source_id") == s2.id:
            raise Exception("Simulated transient Qdrant error on child 2")
        return real_del_vec(**kwargs)

    with patch("app.services.qdrant_service.delete_tenant_vectors", side_effect=mock_del_vec):
        res = await execute_cleanup_notebook(
            notebook_id=notebook.id,
            session=db_session,
            storage_service=mock_storage,
            qdrant_client=mock_qdrant,
            started_at_epoch=time.time(),
        )

    # Sweeper must report in_progress
    assert res["status"] == "in_progress"
    assert res["remaining_sources"] == 1

    # Healthy child is deleted; Unhealthy child is preserved in DB
    assert (await db_session.get(Source, s1.id)) is None
    remaining_s2 = await db_session.get(Source, s2.id)
    assert remaining_s2 is not None
    assert remaining_s2.status == "deleting"

    # Notebook is preserved
    nb_check = await db_session.get(Notebook, notebook.id)
    assert nb_check is not None
    assert nb_check.status == "deleting"


@pytest.mark.asyncio
async def test_adversarial_qdrant_recovery_after_transient_failure(
    db_session,
    mock_storage,
    mock_qdrant: QdrantClient,
    user_a: User,
    user_a_notebook: Notebook,
):
    """
    Mission Probe 3D:
    Verifies retry recovery:
    Attempt 1: Qdrant fails -> raises RetryableStorageError, row preserved.
    Attempt 2: Qdrant succeeds -> row purged, status='deleted'.
    """
    source_id = str(uuid.uuid4())
    storage_key = mock_storage.build_scoped_key(user_a.id, user_a_notebook.id, source_id, "retry_doc.pdf")
    await mock_storage.upload_file(b"data", storage_key)

    source = Source(
        id=source_id,
        user_id=user_a.id,
        notebook_id=user_a_notebook.id,
        title="Retry Recover Doc",
        source_type="pdf",
        storage_key_or_url=storage_key,
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(source)
    await db_session.commit()

    # Attempt 1: Failure
    with patch("app.services.qdrant_service.delete_tenant_vectors", side_effect=Exception("Transient outage")):
        with pytest.raises(RetryableStorageError):
            await execute_delete_source(
                source_id=source_id,
                session=db_session,
                storage_service=mock_storage,
                qdrant_client=mock_qdrant,
            )

    assert (await db_session.get(Source, source_id)) is not None

    # Attempt 2: Qdrant recovered -> succeeds
    res = await execute_delete_source(
        source_id=source_id,
        session=db_session,
        storage_service=mock_storage,
        qdrant_client=mock_qdrant,
    )

    assert res["status"] == "deleted"
    assert (await db_session.get(Source, source_id)) is None
    assert storage_key not in mock_storage.files
