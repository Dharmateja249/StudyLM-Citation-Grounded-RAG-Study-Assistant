"""
StudyLM FastAPI Application Entrypoint
File: backend/app/main.py
"""

import sys
import asyncio

if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        pass

from contextlib import asynccontextmanager
import logging
from typing import Optional
# pyrefly: ignore[missing-import]
from fastapi import FastAPI, APIRouter
# pyrefly: ignore[missing-import]
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db, close_db
from app.routers import auth, notebooks, sources, query
from app.tasks.worker import app as procrastinate_app, run_worker

logger = logging.getLogger("studylm.main")
settings = get_settings()

worker_task: Optional[asyncio.Task] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager for startup and shutdown hooks."""
    global worker_task
    # 1. Startup: initialize database tables if not created
    await init_db()

    # 2. Startup: open Procrastinate connection pool via async context manager
    async with procrastinate_app.open_async():
        if settings.ENVIRONMENT != "testing":
            async def _supervised_worker():
                while True:
                    try:
                        logger.info("Starting Procrastinate background worker...")
                        await run_worker()
                    except asyncio.CancelledError:
                        logger.info("Procrastinate worker cancelled cleanly.")
                        break
                    except Exception as exc:
                        logger.warning(f"Procrastinate worker exited: {exc}. Restarting in 2 seconds...")
                        await asyncio.sleep(2)

            worker_task = asyncio.create_task(_supervised_worker())
            logger.info("Supervised Procrastinate background worker initiated successfully")

        try:
            yield
        finally:
            # 3. Shutdown: cancel and await background worker before pool closes
            if worker_task and not worker_task.done():
                worker_task.cancel()
                try:
                    await worker_task
                except asyncio.CancelledError:
                    pass

    # 4. Shutdown: dispose of database connection pools
    await close_db()


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="StudyLM: Multimodal, citation-grounded knowledge assistant API",
    version="0.1.0",
    debug=settings.DEBUG,
    lifespan=lifespan,
)

# CORS Middleware configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Universal API router for /api prefix
api_router = APIRouter(prefix="/api")
api_router.include_router(auth.router)
api_router.include_router(auth.users_router)
api_router.include_router(notebooks.router)
api_router.include_router(sources.router)
api_router.include_router(query.router)

# Register Routers at root level
app.include_router(auth.router)
app.include_router(auth.users_router)
app.include_router(notebooks.router)
app.include_router(sources.router)
app.include_router(query.router)

# Register Universal /api Router
app.include_router(api_router)


@app.get("/health", tags=["system"])
async def health_check():
    """Health check probe endpoint."""
    return {"status": "ok", "environment": settings.ENVIRONMENT}


@app.get("/", tags=["system"])
async def root():
    """Root info endpoint."""
    return {"name": settings.PROJECT_NAME, "status": "running"}
