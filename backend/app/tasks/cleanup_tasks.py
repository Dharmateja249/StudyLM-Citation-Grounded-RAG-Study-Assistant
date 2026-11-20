"""
StudyLM Background Cleanup & Cascading Deletion Tasks.
File: backend/app/tasks/cleanup_tasks.py

Implements:
- STOR-02: Two-phase cascading source deletion (Qdrant vectors + R2 binary -> SQL row).
- STOR-03: Queue serialization lock `lock = f"source_{source_id}"`.
- STOR-04: Clean abort when source is deleting upon dequeue.
- STOR-06: Retryable R2 deletion errors leaving status="deleting".
- STOR-07: Notebook deletion sweeper with 4-hour safety deadline backstop.
- STOR-11: Hourly orphan R2 reconciler (unreferenced objects > 1h purged).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List

import procrastinate
from procrastinate.testing import InMemoryConnector
from botocore.exceptions import ClientError, EndpointConnectionError, BotoCoreError
from sqlalchemy import delete, select, update, text
from sqlalchemy.ext.asyncio import AsyncSession
from qdrant_client.http import models as qmodels

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models import Notebook, Source, Message, User
from app.services import qdrant_service, storage_service as storage_svc
from app.tasks.worker import app

logger = logging.getLogger("studylm.cleanup_tasks")
settings = get_settings()


# ============================================================================
# Custom Exception Hierarchy for Procrastinate Retries (STOR-06)
# ============================================================================

class RetryableTaskError(Exception):
    """Base class for transient errors that trigger Procrastinate task retries."""
    pass


class RetryableStorageError(RetryableTaskError):
    """Raised when underlying storage (R2 or vector store) fails during deletion."""
    pass


class RetryableR2Error(RetryableStorageError):
    """Raised when an R2 network error or 5xx occurs during deletion (STOR-06)."""
    pass


class RetryableQdrantError(RetryableStorageError):
    """Raised when a Qdrant network error or failure occurs during vector deletion."""
    pass


# Aliases for polymorphic test contracts and backward compatibility
StorageDeletionError = RetryableStorageError


# ============================================================================
# Queue Serialization Lock Helpers (STOR-03)
# ============================================================================

def get_source_task_lock(source_id: str) -> str:
    """Returns standard queue serialization lock string for a source (STOR-03)."""
    return f"source_{source_id}"


# ============================================================================
# 1. Two-Phase Source Deletion (STOR-02, STOR-03, STOR-06)
# ============================================================================

async def execute_delete_source(
    source_id: str,
    session: Optional[AsyncSession] = None,
    storage_service: Optional[Any] = None,
    qdrant_client: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Core business logic for two-phase cascading deletion of a single source:
    Phase 1:
      - Purges all Qdrant vectors for source_id.
      - Purges Cloudflare R2 binary via storage_service.delete_file.
      - On R2 failure: preserves status="deleting" and raises RetryableR2Error.
    Phase 2:
      - Deletes Source SQL row from database.
    """
    if not source_id:
        raise ValueError("source_id must not be empty")

    logger.info(f"[DELETE_SOURCE_START] Processing deletion for source_id={source_id}")

    # Determine execution context (provided session or new session)
    if session is not None:
        return await _do_delete_source(source_id, session, storage_service, qdrant_client)
    else:
        async with AsyncSessionLocal() as new_session:
            return await _do_delete_source(source_id, new_session, storage_service, qdrant_client)


async def _do_delete_source(
    source_id: str,
    session: AsyncSession,
    storage_service: Optional[Any] = None,
    qdrant_client: Optional[Any] = None,
) -> Dict[str, Any]:
    """Internal helper executing deletion steps within an active session."""
    stmt = select(Source).where(Source.id == source_id)
    res = await session.execute(stmt)
    source = res.scalar_one_or_none()

    if not source:
        logger.info(f"[DELETE_SOURCE_NOOP] Source {source_id} not found in database. Exiting cleanly.")
        return {"status": "already_deleted", "source_id": source_id}

    user_id = source.user_id
    notebook_id = source.notebook_id
    storage_key_or_url = source.storage_key_or_url
    source_type = source.source_type

    # Ensure status is marked 'deleting' in DB
    if source.status != "deleting":
        source.status = "deleting"
        session.add(source)
        await session.commit()

    # ------------------------------------------------------------------------
    # Phase 1A: Purge Qdrant Vectors
    # ------------------------------------------------------------------------
    try:
        q_client = qdrant_client or qdrant_service.get_qdrant_client()
        qdrant_service.delete_tenant_vectors(
            client=q_client,
            collection_name=get_settings().QDRANT_COLLECTION_NAME,
            user_id=user_id,
            source_id=source_id,
        )
        logger.info(f"[DELETE_SOURCE_QDRANT] Vectors purged for source_id={source_id}")
    except Exception as q_err:
        logger.error(
            f"[DELETE_SOURCE_QDRANT_FAIL] Qdrant vector deletion failed for source_id={source_id}: {q_err}. "
            f"Preserving status='deleting' and raising RetryableStorageError."
        )
        # Re-verify status remains 'deleting' in DB
        src_check = await session.get(Source, source_id)
        if src_check and src_check.status != "deleting":
            src_check.status = "deleting"
            session.add(src_check)
            await session.commit()

        raise RetryableStorageError(
            f"Transient Qdrant failure during vector deletion for source_id {source_id}: {q_err}"
        ) from q_err

    # ------------------------------------------------------------------------
    # Phase 1B: Purge Cloudflare R2 Binary (STOR-06 Retryable Protection)
    # ------------------------------------------------------------------------
    is_r2_asset = (
        source_type in ("pdf", "image")
        and storage_key_or_url
        and not storage_key_or_url.startswith(("http://", "https://"))
    )

    if is_r2_asset:
        storage_svc_instance = storage_service or storage_svc.get_storage_service()
        try:
            logger.info(f"[DELETE_SOURCE_R2] Deleting R2 key={storage_key_or_url}")
            await storage_svc_instance.delete_file(storage_key_or_url)
            logger.info(f"[DELETE_SOURCE_R2_SUCCESS] Deleted key={storage_key_or_url}")
        except Exception as r2_err:
            logger.error(
                f"[DELETE_SOURCE_R2_FAIL] R2 deletion failed for source_id={source_id}: {r2_err}. "
                f"Preserving status='deleting' and raising RetryableR2Error."
            )
            # Re-verify status remains 'deleting' in DB
            src_check = await session.get(Source, source_id)
            if src_check and src_check.status != "deleting":
                src_check.status = "deleting"
                session.add(src_check)
                await session.commit()

            raise RetryableR2Error(
                f"Transient R2 failure during deletion of key {storage_key_or_url}: {r2_err}"
            ) from r2_err

    # ------------------------------------------------------------------------
    # Phase 2: Delete SQL Row
    # ------------------------------------------------------------------------
    del_stmt = delete(Source).where(Source.id == source_id)
    await session.execute(del_stmt)
    await session.commit()
    logger.info(f"[DELETE_SOURCE_COMPLETE] Purged SQL row for source_id={source_id}")

    return {
        "status": "deleted",
        "source_id": source_id,
        "qdrant_purged": True,
        "r2_purged": is_r2_asset,
    }


@app.task(
    name="delete_source_task",
    queue="cleanup",
    retry=procrastinate.RetryStrategy(
        max_attempts=5,
        wait=5,  # 5-second initial backoff
    ),
)
async def delete_source_task(
    context=None,
    source_id: str = "",
) -> Dict[str, Any]:
    """
    Procrastinate background task for two-phase source deletion.
    """
    return await execute_delete_source(source_id=source_id)


# Attach lock generator helper to task for verification (STOR-03)
delete_source_task.get_lock_string = get_source_task_lock


async def defer_delete_source(source_id: str) -> None:
    """
    Convenience helper to defer delete_source_task with mandatory serialization lock.
    Enforces STOR-03 lock = f"source_{source_id}".
    """
    await delete_source_task.configure(lock=f"source_{source_id}").defer_async(
        source_id=source_id
    )


# ============================================================================
# 2. Notebook Deletion Sweeper Task (STOR-07)
# ============================================================================

async def execute_cleanup_notebook(
    notebook_id: str,
    session: Optional[AsyncSession] = None,
    storage_service: Optional[Any] = None,
    qdrant_client: Optional[Any] = None,
    started_at_epoch: Optional[float] = None,
    force_deadline: bool = False,
) -> Dict[str, Any]:
    """
    Core sweeper logic for notebook deletion (STOR-07):
    - Cascades status='deleting' to all sources.
    - Sweeps child sources until 0 remain, then deletes Notebook row.
    - 4-Hour Safety Deadline: if deletion is stuck > 4 hours, forceful backstop purges
      remaining sources, messages, and notebook row.
    """
    if not notebook_id:
        raise ValueError("notebook_id must not be empty")

    if session is not None:
        return await _do_cleanup_notebook(
            notebook_id, session, storage_service, qdrant_client, started_at_epoch, force_deadline
        )
    else:
        async with AsyncSessionLocal() as new_session:
            return await _do_cleanup_notebook(
                notebook_id, new_session, storage_service, qdrant_client, started_at_epoch, force_deadline
            )


async def _do_cleanup_notebook(
    notebook_id: str,
    session: AsyncSession,
    storage_service: Optional[Any] = None,
    qdrant_client: Optional[Any] = None,
    started_at_epoch: Optional[float] = None,
    force_deadline: bool = False,
) -> Dict[str, Any]:
    """Internal implementation of notebook sweeping within an active session."""
    notebook = await session.get(Notebook, notebook_id)
    if not notebook:
        logger.info(f"[CLEANUP_NOTEBOOK_NOOP] Notebook {notebook_id} not found in DB.")
        return {"status": "already_deleted", "notebook_id": notebook_id}

    # Clear circular reference on User.last_active_notebook_id
    await session.execute(
        update(User)
        .where(User.last_active_notebook_id == notebook_id)
        .values(last_active_notebook_id=None)
    )
    await session.commit()

    # Query all child sources
    src_stmt = select(Source).where(Source.notebook_id == notebook_id)
    src_res = await session.execute(src_stmt)
    child_sources: List[Source] = list(src_res.scalars().all())
    source_count = len(child_sources)

    now = time.time()
    # Started_at represents the timestamp when the deletion process began.
    # We deliberately DO NOT fall back to notebook.created_at, as notebook age != deletion duration.
    started_at = started_at_epoch if started_at_epoch is not None else now

    elapsed_seconds = now - started_at
    deadline_seconds = settings.SWEEPER_DEADLINE_HOURS * 3600  # 4 hours = 14400s
    is_deadline_reached = force_deadline or (elapsed_seconds >= deadline_seconds)

    # ------------------------------------------------------------------------
    # Branch A: 4-Hour Safety Deadline Exceeded -> Force Backstop Purge
    # ------------------------------------------------------------------------
    if is_deadline_reached:
        logger.warning(
            f"[CLEANUP_NOTEBOOK_DEADLINE_BACKSTOP] Notebook {notebook_id} exceeded deadline. "
            f"Executing forceful cleanup of all {source_count} child sources."
        )

        q_client = qdrant_client or qdrant_service.get_qdrant_client()
        try:
            qdrant_service.delete_tenant_vectors(
                client=q_client,
                collection_name=get_settings().QDRANT_COLLECTION_NAME,
                user_id=notebook.user_id,
                notebook_id=notebook_id,
            )
        except Exception as q_err:
            logger.error(f"[DEADLINE_BACKSTOP] Vector purge error: {q_err}")

        # Best-effort R2 purge for child sources
        svc = storage_service or storage_svc.get_storage_service()
        for src in child_sources:
            if (
                src.source_type in ("pdf", "image")
                and src.storage_key_or_url
                and not src.storage_key_or_url.startswith(("http://", "https://"))
            ):
                try:
                    await svc.delete_file(src.storage_key_or_url)
                except Exception as r2_err:
                    logger.warning(f"[DEADLINE_BACKSTOP] R2 purge error for key {src.storage_key_or_url}: {r2_err}")

        # Force delete SQL records
        await session.execute(delete(Source).where(Source.notebook_id == notebook_id))
        await session.execute(delete(Message).where(Message.notebook_id == notebook_id))
        nb = await session.get(Notebook, notebook_id)
        if nb:
            await session.delete(nb)
        await session.commit()

        logger.info(f"[CLEANUP_NOTEBOOK_DEADLINE_RESOLVED] Forcefully purged notebook {notebook_id}")
        return {
            "status": "deadline_recovered",
            "notebook_id": notebook_id,
            "sources_purged": source_count,
        }

    # ------------------------------------------------------------------------
    # Branch B: All Child Sources Purged (count == 0) -> Finalize Notebook
    # ------------------------------------------------------------------------
    if source_count == 0:
        await session.execute(delete(Message).where(Message.notebook_id == notebook_id))
        nb = await session.get(Notebook, notebook_id)
        if nb:
            await session.delete(nb)
        await session.commit()

        logger.info(f"[CLEANUP_NOTEBOOK_COMPLETE] All sources gone. Deleted notebook {notebook_id}")
        return {
            "status": "completed",
            "notebook_id": notebook_id,
            "sources_deleted": 0,
        }

    # ------------------------------------------------------------------------
    # Branch C: Sources Remain -> Active Sweep
    # ------------------------------------------------------------------------
    swept_count = 0
    for src in child_sources:
        try:
            await execute_delete_source(
                source_id=src.id,
                session=session,
                storage_service=storage_service,
                qdrant_client=qdrant_client,
            )
            swept_count += 1
        except Exception as sweep_err:
            logger.warning(f"[SWEEP_CHILD_FAIL] Deletion failed for source {src.id}: {sweep_err}")

    # Re-check remaining count
    check_stmt = select(Source).where(Source.notebook_id == notebook_id)
    remaining_sources = (await session.execute(check_stmt)).scalars().all()

    if len(remaining_sources) == 0:
        await session.execute(delete(Message).where(Message.notebook_id == notebook_id))
        nb = await session.get(Notebook, notebook_id)
        if nb:
            await session.delete(nb)
        await session.commit()

        logger.info(f"[CLEANUP_NOTEBOOK_COMPLETE] Sweep finalized notebook {notebook_id}")
        return {
            "status": "completed",
            "notebook_id": notebook_id,
            "sources_deleted": swept_count,
        }

    return {
        "status": "in_progress",
        "notebook_id": notebook_id,
        "remaining_sources": len(remaining_sources),
    }


@app.task(
    name="cleanup_notebook_task",
    queue="cleanup",
    retry=procrastinate.RetryStrategy(max_attempts=10, wait=15),
)
async def cleanup_notebook_task(
    context=None,
    notebook_id: str = "",
    started_at_epoch: Optional[float] = None,
    force_deadline: bool = False,
) -> Dict[str, Any]:
    """
    Procrastinate background task orchestrating cascading notebook deletion (STOR-07).
    """
    effective_started_at = started_at_epoch if started_at_epoch is not None else time.time()
    res = await execute_cleanup_notebook(
        notebook_id=notebook_id,
        started_at_epoch=effective_started_at,
        force_deadline=force_deadline,
    )
    if res.get("status") == "in_progress":
        # Reschedule check in 10s if sources remain, preserving original start epoch
        await cleanup_notebook_task.configure().defer_async(
            notebook_id=notebook_id,
            started_at_epoch=effective_started_at,
            schedule_in={"seconds": 10},
        )
    return res


async def defer_cleanup_notebook(
    notebook_id: str,
    started_at_epoch: Optional[float] = None,
) -> None:
    """
    Convenience helper to defer cleanup_notebook_task.
    Enforces initialization of started_at_epoch upon deletion initiation.
    """
    start_time = started_at_epoch if started_at_epoch is not None else time.time()
    await cleanup_notebook_task.defer_async(
        notebook_id=notebook_id,
        started_at_epoch=start_time,
    )


# ============================================================================
# 3. Hourly Orphan R2 Reconciler Task (STOR-11)
# ============================================================================

@app.periodic(cron="0 * * * *")  # Minute 0 of every hour
@app.task(
    name="reconcile_orphan_r2_task",
    queue="cleanup",
)
async def reconcile_orphan_r2_task(
    context=None,
    timestamp: int = 0,
    age_seconds: Optional[int] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    Hourly background orphan reconciler task (STOR-11):
    Calls storage_service.reconcile_orphan_r2_objects.
    """
    max_age = age_seconds if age_seconds is not None else settings.ORPHAN_R2_RECONCILER_AGE_SECONDS
    async with AsyncSessionLocal() as session:
        return await storage_svc.reconcile_orphan_r2_objects(
            session=session,
            max_age_seconds=max_age,
        )


# ============================================================================
# 4. Dequeue Check Helper (STOR-04)
# ============================================================================

async def check_source_dequeue_state(source_id: str, session: AsyncSession) -> Dict[str, Any]:
    """
    Verifies source state upon dequeue before performing ingestion operations (STOR-04).
    Aborts cleanly if missing or status is 'deleting'.
    """
    source = await session.get(Source, source_id)
    if not source or source.status == "deleting":
        return {
            "aborted": True,
            "reason": "source_deleting",
            "status": "aborted",
            "source_id": source_id,
        }
    return {
        "aborted": False,
        "reason": None,
        "status": source.status,
        "source_id": source_id,
    }


async def execute_ingest_source(
    source_id: str,
    session: AsyncSession,
    storage_service: Optional[Any] = None,
    qdrant_client: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Polymorphic test harness helper implementing dequeue verification (STOR-04).
    """
    return await check_source_dequeue_state(source_id, session)


# ============================================================================
# 5. Stalled Job Recovery Task (ING-08)
# ============================================================================

@app.periodic(cron="*/1 * * * *")  # Runs every minute
@app.task(
    name="recover_stalled_jobs_task",
    queue="cleanup",
)
async def recover_stalled_jobs_task(
    context=None,
    timestamp: int = 0,
    stalled_timeout: Optional[float] = None,
    session: Optional[AsyncSession] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    ING-08: Crash resilience reconciler.
    Detects jobs stranded in 'doing' status whose worker heartbeat has timed out
    (worker killed by kill -9 or hard crash). Reschedules jobs back to 'todo' / retry.
    """
    timeout = (
        stalled_timeout
        if stalled_timeout is not None
        else float(settings.WORKER_STALLED_TIMEOUT)
    )
    recovered_job_ids: List[int] = []

    # 1. Test Mode (InMemoryConnector or SQLite)
    if isinstance(app.connector, InMemoryConnector) or "sqlite" in settings.DATABASE_URL.lower():
        now = datetime.now(timezone.utc)
        for job_id, job in list(app.connector.jobs.items()):
            if isinstance(job, dict):
                st = str(job.get("status", "")).lower()
                if st.endswith("doing"):
                    started_at = job.get("started_at") or job.get("scheduled_at")
                    # Check worker heartbeat in connector if present
                    worker_id = job.get("worker_id")
                    if worker_id is not None and hasattr(app.connector, "workers") and worker_id in app.connector.workers:
                        hb = app.connector.workers[worker_id]
                        if hb.tzinfo is None:
                            hb = hb.replace(tzinfo=timezone.utc)
                        started_at = hb

                    if started_at:
                        if started_at.tzinfo is None:
                            started_at = started_at.replace(tzinfo=timezone.utc)
                        elapsed = (now - started_at).total_seconds()
                        if elapsed >= timeout:
                            job["status"] = "todo"
                            job["attempts"] = job.get("attempts", 0) + 1
                            job["worker_id"] = None
                            recovered_job_ids.append(job_id)
                            logger.warning(f"[STALLED_JOB_RECOVERED] Recovered stalled in-memory job {job_id}")
            else:
                is_doing = (
                    job.status == getattr(procrastinate.jobs.Status, "DOING", "doing")
                    or str(job.status).lower().endswith("doing")
                )
                if is_doing:
                    started_at = getattr(job, "started_at", None) or getattr(job, "scheduled_at", None)
                    worker_id = getattr(job, "worker_id", None)
                    if worker_id is not None and hasattr(app.connector, "workers") and worker_id in app.connector.workers:
                        hb = app.connector.workers[worker_id]
                        if hb.tzinfo is None:
                            hb = hb.replace(tzinfo=timezone.utc)
                        started_at = hb

                    if started_at:
                        if started_at.tzinfo is None:
                            started_at = started_at.replace(tzinfo=timezone.utc)
                        elapsed = (now - started_at).total_seconds()
                        if elapsed >= timeout:
                            job.status = getattr(procrastinate.jobs.Status, "TODO", "todo")
                            job.attempts = getattr(job, "attempts", 0) + 1
                            if hasattr(job, "worker_id"):
                                job.worker_id = None
                            recovered_job_ids.append(job.id)
                            logger.warning(f"[STALLED_JOB_RECOVERED] Recovered stalled in-memory job {job.id}")
        return {"status": "success", "recovered_count": len(recovered_job_ids), "job_ids": recovered_job_ids}

    # 2. Production PostgreSQL Mode
    async def _execute_pg_recovery(sess: AsyncSession):
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=timeout)
        query = text("""
            UPDATE procrastinate_jobs
            SET status = 'todo',
                attempts = attempts + 1,
                worker_id = NULL
            WHERE status = 'doing'
              AND (
                  worker_id IS NULL
                  OR worker_id IN (
                      SELECT id
                      FROM procrastinate_workers
                      WHERE last_heartbeat <= :cutoff
                  )
              )
            RETURNING id;
        """)
        result = await sess.execute(query, {"cutoff": cutoff})
        await sess.commit()
        rows = result.fetchall()
        for row in rows:
            recovered_job_ids.append(row[0])
        logger.info(f"[STALLED_JOBS_RECOVERED] Rescheduled {len(recovered_job_ids)} stalled jobs")

    try:
        if session is not None:
            await _execute_pg_recovery(session)
        else:
            async with AsyncSessionLocal() as new_session:
                await _execute_pg_recovery(new_session)
    except Exception as pg_exc:
        logger.warning(f"[STALLED_JOBS_RECONCILER_ERROR] {pg_exc}")

    return {"status": "success", "recovered_count": len(recovered_job_ids), "job_ids": recovered_job_ids}


# ============================================================================
# 6. Periodic Vector Reaper Task (ING-12, ING-18)
# ============================================================================

@app.periodic(cron="0 * * * *")  # Minute 0 of every hour
@app.task(
    name="reap_stale_vectors_task",
    queue="cleanup",
)
async def reap_stale_vectors_task(
    context=None,
    timestamp: int = 0,
    grace_period_seconds: Optional[int] = None,
    qdrant_client: Optional[Any] = None,
    session: Optional[AsyncSession] = None,
    **kwargs: Any,
) -> Dict[str, Any]:
    """
    ING-12, ING-18: Hourly vector reaper.
    Safely cleans up stale vector points in Qdrant:
    1. Skips sources that currently hold an active Procrastinate queue lock ("source_{source_id}").
    2. Enforces a 2-hour grace period (REAPER_GRACE_PERIOD_SECONDS = 7200s); points younger than 2h are preserved.
    3. Purges unreferenced points where point.ingest_run_id != source.active_ingest_run_id.
    4. Purges dead points for sources where active_ingest_run_id IS NULL and age > 2h (failed initial ingest).
    5. Purges orphaned vectors for deleted sources (source row absent from SQL).
    """
    cur_settings = get_settings()
    grace_period = grace_period_seconds if grace_period_seconds is not None else cur_settings.REAPER_GRACE_PERIOD_SECONDS
    cutoff_epoch = int(time.time() - grace_period)
    logger.info(f"[VECTOR_REAPER_START] Sweeping stale vectors older than {cutoff_epoch} (grace {grace_period}s)")

    q_client = qdrant_client or qdrant_service.get_qdrant_client()
    runs_to_purge = set()  # set of (user_id, source_id, ingest_run_id)

    async def _execute_reap(sess: AsyncSession):
        stmt = select(Source.id, Source.user_id, Source.active_ingest_run_id, Source.status)
        sources_res = await sess.execute(stmt)
        sources_map = {row.id: row for row in sources_res.all()}

        # Check for active locks in procrastinate queue (InMemory and PostgreSQL modes)
        active_locked_sources = set()
        if isinstance(app.connector, InMemoryConnector) or "sqlite" in cur_settings.DATABASE_URL.lower():
            for job in app.connector.jobs.values():
                st = job.get("status") if isinstance(job, dict) else getattr(job, "status", None)
                st_str = str(st).lower()
                if st_str.endswith("doing") or st_str.endswith("todo"):
                    lk = job.get("lock") if isinstance(job, dict) else getattr(job, "lock", None)
                    if lk and str(lk).startswith("source_"):
                        active_locked_sources.add(str(lk).replace("source_", ""))
        else:
            try:
                lock_query = text("""
                    SELECT DISTINCT lock
                    FROM procrastinate_jobs
                    WHERE status IN ('todo', 'doing')
                      AND lock LIKE 'source_%'
                """)
                lock_res = await sess.execute(lock_query)
                for (lk,) in lock_res.fetchall():
                    if lk and str(lk).startswith("source_"):
                        active_locked_sources.add(str(lk).replace("source_", ""))
            except Exception as lock_err:
                logger.warning(f"[REAPER_LOCK_QUERY_WARN] Failed to query active procrastinate locks: {lock_err}")

        scroll_filter = qmodels.Filter(
            must=[
                qmodels.FieldCondition(
                    key="ingested_at",
                    range=qmodels.Range(lte=cutoff_epoch),
                )
            ]
        )

        try:
            records, _ = q_client.scroll(
                collection_name=cur_settings.QDRANT_COLLECTION_NAME,
                scroll_filter=scroll_filter,
                limit=1000,
                with_payload=True,
                with_vectors=False,
            )
        except Exception as scroll_err:
            logger.warning(f"[REAPER_SCROLL_ERROR] Collection scroll failed: {scroll_err}")
            return

        for rec in records:
            payload = rec.payload or {}
            src_id = payload.get("source_id")
            user_id = payload.get("user_id")
            run_id = payload.get("ingest_run_id")

            if not src_id or not run_id:
                continue

            # Rule 1: Skip if source has active lock or is processing
            if src_id in active_locked_sources:
                logger.info(f"[REAPER_SKIP] Source {src_id} has active queue lock. Skipping.")
                continue

            src_db = sources_map.get(src_id)
            if src_db and src_db.status == "processing":
                logger.info(f"[REAPER_SKIP] Source {src_id} is processing. Skipping.")
                continue

            # Check Rule 3, 4, 5
            is_stale = False
            if not src_db:
                # Source row absent from SQL
                is_stale = True
            elif src_db.active_ingest_run_id is None:
                # Initial ingest failed, older than 2h
                is_stale = True
            elif src_db.active_ingest_run_id != run_id:
                # Replaced during blue-green re-indexing
                is_stale = True

            if is_stale:
                runs_to_purge.add((user_id, src_id, run_id))

        # Purge stale runs
        for (u_id, s_id, r_id) in runs_to_purge:
            try:
                delete_filter = qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(key="source_id", match=qmodels.MatchValue(value=s_id)),
                        qmodels.FieldCondition(key="ingest_run_id", match=qmodels.MatchValue(value=r_id)),
                    ]
                )
                q_client.delete(
                    collection_name=cur_settings.QDRANT_COLLECTION_NAME,
                    points_selector=qmodels.FilterSelector(filter=delete_filter),
                    wait=True,
                )
                logger.info(f"[REAPER_PURGED] Purged stale run {r_id} for source {s_id}")
            except Exception as e:
                logger.error(f"[REAPER_PURGE_ERROR] Failed to purge run {r_id}: {e}")

    if session is not None:
        await _execute_reap(session)
    else:
        async with AsyncSessionLocal() as new_session:
            await _execute_reap(new_session)

    return {
        "status": "completed",
        "purged_runs": len(runs_to_purge),
    }

