"""
StudyLM Background Task Worker & Procrastinate App Configuration.
File: backend/app/tasks/worker.py

Provides:
- Procrastinate App singleton supporting PostgreSQL (production) and InMemoryConnector (testing).
- Worker process initialization, heartbeat (10s), and stalled job timeout (30s) configuration.
- Task import registration for cleanup and ingestion tasks.
"""

from __future__ import annotations

import asyncio
import logging
import sys
from typing import Optional, List

import procrastinate
from procrastinate.testing import InMemoryConnector

from app.config import get_settings

logger = logging.getLogger("studylm.worker")
settings = get_settings()


def create_procrastinate_app() -> procrastinate.App:
    """
    Initializes and configures the Procrastinate App instance.
    Uses InMemoryConnector during pytest/testing mode or SQLite environments.
    Uses PsycopgConnector in production PostgreSQL environments.
    """
    current_settings = get_settings()
    is_testing = (
        current_settings.ENVIRONMENT == "testing"
        or "sqlite" in current_settings.DATABASE_URL.lower()
    )

    if is_testing:
        logger.info("[WORKER_INIT] Initializing Procrastinate with InMemoryConnector (Test Mode)")
        connector = InMemoryConnector()
    else:
        logger.info("[WORKER_INIT] Initializing Procrastinate with PsycopgConnector on direct connection")
        connector = procrastinate.PsycopgConnector(
            conninfo=current_settings.effective_procrastinate_database_url
        )


    # Register both cleanup tasks and ingestion tasks import paths
    import_paths = [
        "app.tasks.cleanup_tasks",
        "app.tasks.ingestion_tasks",
    ]

    procrastinate_app = procrastinate.App(
        connector=connector,
        import_paths=import_paths,
    )
    return procrastinate_app


# Application singleton
app = create_procrastinate_app()


async def run_worker(queues: Optional[List[str]] = None, wait: bool = True) -> None:
    """
    Starts an asynchronous worker listening to specified queues.
    Configures concurrency (4), heartbeat interval (10s), timeout (30s), and polling interval (15s).
    """
    target_queues = queues or ["cleanup", "sources", "default"]
    logger.info(f"[WORKER_START] Starting worker on queues: {target_queues}")

    listen_notify = False if (sys.platform == "win32" or "neon" in settings.DATABASE_URL.lower()) else not isinstance(app.connector, InMemoryConnector)

    try:
        async with app.open_async():
            await app.run_worker_async(
                queues=target_queues,
                concurrency=4,
                wait=wait,
                listen_notify=listen_notify,
                update_heartbeat_interval=settings.WORKER_UPDATE_HEARTBEAT_INTERVAL,
                stalled_worker_timeout=settings.WORKER_STALLED_TIMEOUT,
                fetch_job_polling_interval=settings.WORKER_POLLING_INTERVAL,
                install_signal_handlers=False,
            )
    except asyncio.CancelledError:
        logger.info("[WORKER_STOP] Background worker cancelled gracefully")
        raise
    except Exception as exc:
        logger.error(f"[WORKER_ERROR] Background worker encountered error: {exc}", exc_info=True)
        raise
