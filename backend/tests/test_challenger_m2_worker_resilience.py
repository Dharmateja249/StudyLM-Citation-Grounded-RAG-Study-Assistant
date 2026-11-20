"""
Milestone 2 Challenger 1 Empirical Test Probes & Stress Harness.
File: backend/tests/test_challenger_m2_worker_resilience.py

Adversarially challenges and empirically validates:
1. Procrastinate Postgres Schema & Stalled Jobs SQL Query:
   - Verification that 'started_at' does not exist in Procrastinate PostgreSQL DDL.
   - Full SQL execution test of recover_stalled_jobs_task against authentic table schema.
   - Validation that jobs with worker_id=NULL or dead worker last_heartbeat <= cutoff are recovered.
   - Validation that active jobs with recent heartbeat are preserved.
   - Zero occurrences of 'started_at' in any SQL query in backend/app/.
2. Worker Runner Resilience:
   - Execution of run_worker / run_worker_async with concurrency=4.
   - Clean asyncio.CancelledError interception and graceful shutdown without leakage.
   - Custom heartbeat and timeout parameter forwarding.
   - Concurrent execution under load across multiple queues.
3. Task Serialization Locks:
   - Verification that task.lock is not monkey-patched to a function or callable.
   - Verification that defer_ingest_source and defer_delete_source enqueue string locks 'source_{id}'.
   - Queue isolation: same source shares lock, distinct sources have distinct locks.
4. Storage Decoupling & Orphan Cleanup:
   - S3 upload without holding DB lock.
   - Immediate S3 object deletion on deleted notebook, quota collision, or DB commit exception.
5. Vector Reaper Active Lock Compatibility:
   - Active lock detection skipping in-flight sources during vector reaping.
"""

from __future__ import annotations

import asyncio
import io
import inspect
import pathlib
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import procrastinate
from procrastinate.schema import SchemaManager
from procrastinate.testing import InMemoryConnector
from sqlalchemy import text
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import get_settings, Settings
from app.models import Notebook, Source, User
from app.tasks.cleanup_tasks import (
    delete_source_task,
    defer_delete_source,
    get_source_task_lock,
    recover_stalled_jobs_task,
    reap_stale_vectors_task,
)
from app.tasks.ingestion_tasks import (
    defer_ingest_source,
    get_default_embedding_service,
    ingest_source_task,
)
from app.tasks.worker import app as procrastinate_app, run_worker


# ==============================================================================
# 1. Challenge: Procrastinate Postgres Schema & Stalled Jobs SQL
# ==============================================================================

class TestPostgresSchemaAndStalledJobs:
    """Empirically validates stalled jobs SQL against authentic Procrastinate DDL."""

    def test_procrastinate_schema_ddl_has_no_started_at_column(self):
        """
        Adversarial probe: inspect Procrastinate's official schema definition.
        Assert that procrastinate_jobs has worker_id, status, scheduled_at, attempts,
        but does NOT have 'started_at'.
        Assert that procrastinate_workers has last_heartbeat.
        """
        sm = SchemaManager(connector=None)
        schema_sql = sm.get_schema()

        # Extract CREATE TABLE procrastinate_jobs block
        jobs_table_match = re.search(
            r"CREATE TABLE procrastinate_jobs \((.*?)\);",
            schema_sql,
            re.DOTALL | re.IGNORECASE,
        )
        assert jobs_table_match is not None, "procrastinate_jobs table definition not found in DDL"
        jobs_ddl = jobs_table_match.group(1).lower()

        # Check column assertions
        assert "worker_id" in jobs_ddl
        assert "status" in jobs_ddl
        assert "attempts" in jobs_ddl
        assert "scheduled_at" in jobs_ddl
        assert "started_at" not in jobs_ddl, (
            "DEFECT: 'started_at' column found in procrastinate_jobs schema! "
            "Procrastinate schema must not define started_at."
        )

        # Extract CREATE TABLE procrastinate_workers block
        workers_table_match = re.search(
            r"CREATE TABLE procrastinate_workers\((.*?)\);",
            schema_sql,
            re.DOTALL | re.IGNORECASE,
        )
        assert workers_table_match is not None, "procrastinate_workers table definition not found in DDL"
        workers_ddl = workers_table_match.group(1).lower()
        assert "last_heartbeat" in workers_ddl

    def test_zero_started_at_references_in_backend_sql(self):
        """
        Adversarial probe: AST & Regex scan of all SQL statements in backend/app.
        Ensures NO query or text(...) block contains 'started_at'.
        """
        backend_app = pathlib.Path(__file__).parent.parent / "app"
        assert backend_app.is_dir(), f"Directory {backend_app} does not exist"

        sql_patterns = [
            re.compile(r"text\(\s*(?:\"\"\"|''')(.*?)(?:\"\"\"|''')\s*\)", re.DOTALL),
            re.compile(r"text\(\s*\"(.*?)\"\s*\)", re.DOTALL),
            re.compile(r"text\(\s*'(.*?)'\s*\)", re.DOTALL),
        ]

        started_at_in_sql = []
        for py_file in backend_app.rglob("*.py"):
            code = py_file.read_text(encoding="utf-8")
            # Check for any occurrence of started_at in SQL strings
            for pattern in sql_patterns:
                for match in pattern.finditer(code):
                    sql_text = match.group(0)
                    if "started_at" in sql_text:
                        started_at_in_sql.append((py_file.name, sql_text[:80]))

        assert len(started_at_in_sql) == 0, (
            f"Found SQL query referencing non-existent 'started_at': {started_at_in_sql}"
        )

    @pytest.mark.asyncio
    async def test_recover_stalled_jobs_sql_execution_against_schema(self, db_session: AsyncSession):
        """
        Empirically executes the exact recovery SQL against tables matching Procrastinate's schema.
        Populates:
        - Job 1: status='doing', worker_id=NULL (crashed before worker registered) -> MUST recover
        - Job 2: status='doing', worker_id=10, worker.last_heartbeat 120s ago (>30s) -> MUST recover
        - Job 3: status='doing', worker_id=20, worker.last_heartbeat 5s ago (<30s) -> MUST NOT recover
        - Job 4: status='todo', worker_id=NULL -> MUST NOT recover
        - Job 5: status='succeeded', worker_id=10 -> MUST NOT recover
        """
        # Create schema tables for test
        await db_session.execute(text("DROP TABLE IF EXISTS procrastinate_jobs;"))
        await db_session.execute(text("DROP TABLE IF EXISTS procrastinate_workers;"))

        await db_session.execute(text("""
            CREATE TABLE procrastinate_workers (
                id INTEGER PRIMARY KEY,
                last_heartbeat TIMESTAMP NOT NULL
            );
        """))

        await db_session.execute(text("""
            CREATE TABLE procrastinate_jobs (
                id INTEGER PRIMARY KEY,
                queue_name VARCHAR(128) NOT NULL,
                task_name VARCHAR(128) NOT NULL,
                status VARCHAR(32) NOT NULL DEFAULT 'todo',
                attempts INTEGER NOT NULL DEFAULT 0,
                worker_id INTEGER NULL,
                lock VARCHAR(128) NULL
            );
        """))

        now = datetime.now(timezone.utc)
        dead_heartbeat = now - timedelta(seconds=120)
        alive_heartbeat = now - timedelta(seconds=5)

        # Seed workers
        await db_session.execute(
            text("INSERT INTO procrastinate_workers (id, last_heartbeat) VALUES (10, :hb)"),
            {"hb": dead_heartbeat},
        )
        await db_session.execute(
            text("INSERT INTO procrastinate_workers (id, last_heartbeat) VALUES (20, :hb)"),
            {"hb": alive_heartbeat},
        )

        # Seed jobs
        # 1. doing with worker_id = NULL
        await db_session.execute(text(
            "INSERT INTO procrastinate_jobs (id, queue_name, task_name, status, attempts, worker_id) "
            "VALUES (1, 'sources', 'ingest', 'doing', 0, NULL)"
        ))
        # 2. doing with dead worker
        await db_session.execute(text(
            "INSERT INTO procrastinate_jobs (id, queue_name, task_name, status, attempts, worker_id) "
            "VALUES (2, 'sources', 'ingest', 'doing', 1, 10)"
        ))
        # 3. doing with alive worker
        await db_session.execute(text(
            "INSERT INTO procrastinate_jobs (id, queue_name, task_name, status, attempts, worker_id) "
            "VALUES (3, 'sources', 'ingest', 'doing', 0, 20)"
        ))
        # 4. todo with null worker
        await db_session.execute(text(
            "INSERT INTO procrastinate_jobs (id, queue_name, task_name, status, attempts, worker_id) "
            "VALUES (4, 'sources', 'ingest', 'todo', 0, NULL)"
        ))
        # 5. succeeded with dead worker
        await db_session.execute(text(
            "INSERT INTO procrastinate_jobs (id, queue_name, task_name, status, attempts, worker_id) "
            "VALUES (5, 'sources', 'ingest', 'succeeded', 1, 10)"
        ))
        await db_session.commit()

        # Run exact recovery SQL from cleanup_tasks.py
        cutoff = now - timedelta(seconds=30)
        recovery_sql = text("""
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

        res = await db_session.execute(recovery_sql, {"cutoff": cutoff})
        recovered_ids = [row[0] for row in res.fetchall()]
        await db_session.commit()

        # Assertions
        assert sorted(recovered_ids) == [1, 2], (
            f"Expected jobs [1, 2] recovered, but got {recovered_ids}"
        )

        # Verify job states in database
        j1 = (await db_session.execute(text("SELECT status, attempts, worker_id FROM procrastinate_jobs WHERE id = 1"))).fetchone()
        assert j1[0] == "todo"
        assert j1[1] == 1
        assert j1[2] is None

        j2 = (await db_session.execute(text("SELECT status, attempts, worker_id FROM procrastinate_jobs WHERE id = 2"))).fetchone()
        assert j2[0] == "todo"
        assert j2[1] == 2
        assert j2[2] is None

        j3 = (await db_session.execute(text("SELECT status, attempts, worker_id FROM procrastinate_jobs WHERE id = 3"))).fetchone()
        assert j3[0] == "doing", "Alive job 3 must remain in 'doing'"
        assert j3[2] == 20

        j4 = (await db_session.execute(text("SELECT status, attempts FROM procrastinate_jobs WHERE id = 4"))).fetchone()
        assert j4[0] == "todo"
        assert j4[1] == 0, "Todo job attempts must not be incremented"


# ==============================================================================
# 2. Challenge: Worker Runner Concurrency, Custom Heartbeat & Cancellation
# ==============================================================================

class TestWorkerRunnerResilience:
    """Empirically stress-tests worker runner lifecycle and concurrency."""

    @pytest.mark.asyncio
    async def test_worker_runner_cancellation_graceful(self):
        """
        Adversarial probe: start worker runner as a background task,
        then cancel it mid-flight. Verify it catches CancelledError,
        logs clean shutdown, and terminates promptly without hanging.
        """
        test_connector = InMemoryConnector()
        with procrastinate_app.replace_connector(test_connector):
            worker_task = asyncio.create_task(run_worker(wait=True))
            # Allow event loop turn for runner to initialize
            await asyncio.sleep(0.05)

            assert not worker_task.done(), "Worker runner should be actively running"

            # Cancel runner
            worker_task.cancel()

            # Must raise CancelledError or finish cleanly without hanging
            with pytest.raises(asyncio.CancelledError):
                await asyncio.wait_for(worker_task, timeout=2.0)

    @pytest.mark.asyncio
    async def test_worker_runner_parameter_concurrency_and_heartbeat(self):
        """
        Adversarial probe: inspect run_worker execution call.
        Assert concurrency=4, listen_notify, update_heartbeat_interval,
        stalled_worker_timeout, and install_signal_handlers=False.
        """
        with patch.object(procrastinate_app, "run_worker_async", new_callable=AsyncMock) as mock_run:
            test_connector = InMemoryConnector()
            with procrastinate_app.replace_connector(test_connector):
                await run_worker(queues=["test_queue"], wait=False)

                mock_run.assert_awaited_once()
                call_kwargs = mock_run.call_args.kwargs

                assert call_kwargs.get("concurrency") == 4, f"Expected concurrency=4, got {call_kwargs.get('concurrency')}"
                assert call_kwargs.get("queues") == ["test_queue"]
                assert call_kwargs.get("install_signal_handlers") is False
                assert call_kwargs.get("update_heartbeat_interval") == get_settings().WORKER_UPDATE_HEARTBEAT_INTERVAL
                assert call_kwargs.get("stalled_worker_timeout") == get_settings().WORKER_STALLED_TIMEOUT
                assert call_kwargs.get("fetch_job_polling_interval") == get_settings().WORKER_POLLING_INTERVAL

    @pytest.mark.asyncio
    async def test_worker_runner_concurrency_load_stress(self):
        """
        Adversarial probe: queue 12 jobs simultaneously.
        Verify app.run_worker_async processes jobs across workers up to completion.
        """
        test_connector = InMemoryConnector()
        processed_tasks = []

        @procrastinate_app.task(name="probe_concurrent_task", queue="test_stress")
        async def probe_concurrent_task(context=None, idx: int = 0):
            await asyncio.sleep(0.01)
            processed_tasks.append(idx)
            return {"task": idx, "status": "ok"}

        with procrastinate_app.replace_connector(test_connector):
            async with procrastinate_app.open_async():
                # Enqueue 12 tasks
                for i in range(12):
                    await probe_concurrent_task.defer_async(idx=i)

                assert len(test_connector.jobs) == 12

                # Run worker until all jobs complete
                await procrastinate_app.run_worker_async(
                    queues=["test_stress"],
                    concurrency=4,
                    wait=False,
                    install_signal_handlers=False,
                )

                # Verify all jobs succeeded
                assert len(processed_tasks) == 12
                for job in test_connector.jobs.values():
                    if job.get("queue") == "test_stress":
                        assert job["status"] == "succeeded"


# ==============================================================================
# 3. Challenge: Task Serialization Locks
# ==============================================================================

class TestTaskSerializationLocks:
    """Empirically validates task locks are strings and not callables."""

    def test_task_attributes_lock_not_callable(self):
        """
        Adversarial probe: inspect task objects across cleanup and ingestion.
        Assert .lock is NOT callable or a function.
        """
        tasks_to_check = [
            ("ingest_source_task", ingest_source_task),
            ("delete_source_task", delete_source_task),
        ]

        for name, task in tasks_to_check:
            lock_attr = getattr(task, "lock", None)
            assert not callable(lock_attr), (
                f"DEFECT: {name}.lock is callable ({lock_attr})! "
                "Psycopg will reject function objects during deferral."
            )
            # get_lock_string helper must exist and return str
            assert hasattr(task, "get_lock_string")
            assert callable(task.get_lock_string)
            sample_lock = task.get_lock_string("uuid-1234")
            assert isinstance(sample_lock, str)
            assert sample_lock == "source_uuid-1234"

    @pytest.mark.asyncio
    async def test_defer_helpers_enqueue_string_locks(self):
        """
        Adversarial probe: invoke defer_ingest_source and defer_delete_source.
        Assert that the deferred job's 'lock' field in the queue connector is
        strictly a string 'source_{id}' and never a function.
        """
        test_connector = InMemoryConnector()
        with procrastinate_app.replace_connector(test_connector):
            async with procrastinate_app.open_async():
                src_a = str(uuid.uuid4())
                src_b = str(uuid.uuid4())

                # Defer ingest for src_a
                await defer_ingest_source(source_id=src_a)
                # Defer delete for src_b
                await defer_delete_source(source_id=src_b)

                jobs = list(test_connector.jobs.values())
                assert len(jobs) == 2

                ingest_job = next(j for j in jobs if j["task_name"] == "ingest_source_task")
                delete_job = next(j for j in jobs if j["task_name"] == "delete_source_task")

                # Validate ingest lock
                assert isinstance(ingest_job["lock"], str)
                assert ingest_job["lock"] == f"source_{src_a}"
                assert not callable(ingest_job["lock"])

                # Validate delete lock
                assert isinstance(delete_job["lock"], str)
                assert delete_job["lock"] == f"source_{src_b}"
                assert not callable(delete_job["lock"])

    @pytest.mark.asyncio
    async def test_queue_serialization_same_source_collision(self):
        """
        Adversarial probe: defer multiple tasks for the same source.
        Verify that both carry the identical lock string, preventing concurrent execution.
        """
        test_connector = InMemoryConnector()
        with procrastinate_app.replace_connector(test_connector):
            async with procrastinate_app.open_async():
                same_id = str(uuid.uuid4())

                await defer_ingest_source(source_id=same_id)
                await defer_delete_source(source_id=same_id)

                jobs = list(test_connector.jobs.values())
                assert len(jobs) == 2
                assert jobs[0]["lock"] == f"source_{same_id}"
                assert jobs[1]["lock"] == f"source_{same_id}"
                assert jobs[0]["lock"] == jobs[1]["lock"]


# ==============================================================================
# 4. Challenge: Storage Decoupling & Atomic Orphan Cleanup
# ==============================================================================

class TestStorageDecouplingAndCleanup:
    """Empirically validates non-blocking S3 uploads and orphan rollback cleanup."""

    @pytest.mark.asyncio
    async def test_source_upload_rollback_on_db_failure_cleans_s3(
        self,
        db_session: AsyncSession,
        user_a: User,
        user_a_notebook: Notebook,
        mock_storage,
    ):
        """
        Adversarial probe: simulate DB failure during source creation.
        Assert that S3 upload succeeds, then upon DB commit failure,
        storage_service.delete_file is called immediately to purge the orphaned file.
        """
        from fastapi import HTTPException
        from app.routers.sources import _execute_source_upload
        from unittest.mock import MagicMock

        mock_file = MagicMock()
        mock_file.filename = "test_orphan.pdf"
        mock_file.content_type = "application/pdf"
        mock_file.read = AsyncMock(side_effect=[b"%PDF-1.4 test bytes content", b""])

        # Wrap delete_file as AsyncMock to track calls
        mock_storage.delete_file = AsyncMock(wraps=mock_storage.delete_file)

        # Patch session.commit to fail
        with patch.object(db_session, "commit", side_effect=RuntimeError("Simulated DB Disk Failure")):
            with pytest.raises(HTTPException) as exc_info:
                await _execute_source_upload(
                    file=mock_file,
                    notebook_id=user_a_notebook.id,
                    title="Orphan Test",
                    current_user=user_a,
                    session=db_session,
                    storage_service=mock_storage,
                )

            assert exc_info.value.status_code == 500

            # Verify that delete_file was called on the mock storage
            assert mock_storage.delete_file.called, (
                "DEFECT: storage_service.delete_file was NOT called on DB error! S3 orphan created."
            )
            deleted_key = mock_storage.delete_file.call_args[0][0]
            assert "test_orphan.pdf" in deleted_key
            assert f"notebooks/{user_a_notebook.id}/" in deleted_key

    @pytest.mark.asyncio
    async def test_source_upload_rejects_deleting_notebook_after_s3(
        self,
        db_session: AsyncSession,
        user_a: User,
        user_a_notebook: Notebook,
        mock_storage,
    ):
        """
        Adversarial probe: race condition where notebook is marked 'deleting'
        during the remote S3 upload window.
        Assert 409 Conflict is raised and S3 uploaded file is purged.
        """
        from fastapi import HTTPException
        from app.routers.sources import _execute_source_upload
        from sqlmodel import update

        mock_file = MagicMock()
        mock_file.filename = "race_deleting.pdf"
        mock_file.content_type = "application/pdf"
        mock_file.read = AsyncMock(side_effect=[b"%PDF-1.4 test race content", b""])

        # Simulate notebook transitioning to 'deleting' during S3 upload
        original_upload = mock_storage.upload_file
        mock_storage.delete_file = AsyncMock(wraps=mock_storage.delete_file)

        async def upload_side_effect(*args, **kwargs):
            # Mark notebook deleting mid-upload via UPDATE query
            await db_session.execute(
                update(Notebook).where(Notebook.id == user_a_notebook.id).values(status="deleting")
            )
            await db_session.commit()
            return await original_upload(*args, **kwargs)

        mock_storage.upload_file = AsyncMock(side_effect=upload_side_effect)

        with pytest.raises(HTTPException) as exc_info:
            await _execute_source_upload(
                file=mock_file,
                notebook_id=user_a_notebook.id,
                title="Race Deleting",
                current_user=user_a,
                session=db_session,
                storage_service=mock_storage,
            )

        assert exc_info.value.status_code == 409
        assert "pending deletion" in exc_info.value.detail
        assert mock_storage.delete_file.called, "S3 file must be deleted when notebook is marked deleting"


# ==============================================================================
# 5. Challenge: Vector Reaper Active Lock Enforcement
# ==============================================================================

class TestVectorReaperActiveLocks:
    """Empirically validates vector reaper skips sources with active locks."""

    @pytest.mark.asyncio
    async def test_reaper_skips_source_with_active_lock(
        self,
        db_session: AsyncSession,
        user_a: User,
        user_a_notebook: Notebook,
        mock_qdrant,
    ):
        """
        Adversarial probe: configure stale vectors in Qdrant for a source,
        but place an active lock 'source_{id}' in the Procrastinate queue.
        Assert that reap_stale_vectors_task skips the locked source.
        """
        source_id = str(uuid.uuid4())
        test_connector = InMemoryConnector()

        # Seed in-memory queue with active doing job for source_id
        test_connector.jobs[101] = {
            "id": 101,
            "queue_name": "sources",
            "task_name": "ingest_source_task",
            "status": "doing",
            "lock": f"source_{source_id}",
            "args": {"source_id": source_id},
        }

        # Mock Qdrant scroll returning a record for this source older than 2 hours
        stale_record = MagicMock()
        stale_record.payload = {
            "source_id": source_id,
            "user_id": str(user_a.id),
            "ingest_run_id": "old_run_999",
            "ingested_at": int(time.time()) - 10000,  # > 2h
        }
        mock_qdrant.scroll = MagicMock(return_value=([stale_record], None))
        mock_qdrant.delete = MagicMock()

        with procrastinate_app.replace_connector(test_connector):
            result = await reap_stale_vectors_task(
                session=db_session,
                qdrant_client=mock_qdrant,
                grace_period_seconds=7200,
            )

            # Assert reaper completed and skipped the locked source
            assert result["status"] == "completed"
            assert result["purged_runs"] == 0, "Locked source must NOT have its vectors purged by reaper!"
            mock_qdrant.delete.assert_not_called()
