"""
StudyLM Background Tasks Package.
File: backend/app/tasks/__init__.py
"""

from app.tasks.worker import app, run_worker
from app.tasks.cleanup_tasks import (
    delete_source_task,
    execute_delete_source,
    defer_delete_source,
    cleanup_notebook_task,
    execute_cleanup_notebook,
    defer_cleanup_notebook,
    reconcile_orphan_r2_task,
    recover_stalled_jobs_task,
    reap_stale_vectors_task,
    check_source_dequeue_state,
    execute_ingest_source,
    get_source_task_lock,
    RetryableTaskError,
    RetryableStorageError,
    RetryableR2Error,
    RetryableQdrantError,
    StorageDeletionError,
)
from app.tasks.ingestion_tasks import (
    ingest_source_task,
    defer_ingest_source,
    process_youtube_source_ingestion,
)

__all__ = [
    "app",
    "run_worker",
    "delete_source_task",
    "execute_delete_source",
    "defer_delete_source",
    "cleanup_notebook_task",
    "execute_cleanup_notebook",
    "defer_cleanup_notebook",
    "reconcile_orphan_r2_task",
    "recover_stalled_jobs_task",
    "reap_stale_vectors_task",
    "check_source_dequeue_state",
    "execute_ingest_source",
    "get_source_task_lock",
    "RetryableTaskError",
    "RetryableStorageError",
    "RetryableR2Error",
    "RetryableQdrantError",
    "StorageDeletionError",
    "ingest_source_task",
    "defer_ingest_source",
    "process_youtube_source_ingestion",
]
