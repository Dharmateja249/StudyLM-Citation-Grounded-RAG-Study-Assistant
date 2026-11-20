"""
StudyLM Sources Router
File: backend/app/routers/sources.py

Endpoints:
- POST /sources/upload & POST /notebooks/{notebook_id}/sources:
  Upload source document (PDF, image) with:
  * 50MB Content-Length header limit (HTTP 413)
  * Dynamic stream byte counter aborting at >50MB (HTTP 413)
  * Notebook status check rejecting deleting notebooks (HTTP 409 Conflict) [STOR-08]
  * 20-source quota lock under SELECT FOR UPDATE (HTTP 400 Bad Request) [STOR-12]
  * R2 object storage upload via storage_service [STOR-01]
  * Atomic orphan cleanup on database transaction failure [STOR-10]
  * Background ingestion task enqueuing with lock = f"source_{source.id}" [STOR-03]
- GET /sources/{source_id}:
  Fetch source details with anti-enumeration 404 defense [SEC-02, STOR-02]
- DELETE /sources/{source_id}:
  Two-phase deletion: marks status = 'deleting' and enqueues delete_source_task [STOR-02]
- GET /sources/{source_id}/stream:
  Streaming proxy supporting HTTP 206 Partial Content Range requests [STOR-09]
- GET /sources/{source_id}/presigned-url:
  Generate 15-minute presigned download URL [STOR-09]
"""

from __future__ import annotations

import io
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional
from typing import Any, Dict, List, Optional
from pydantic import BaseModel

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy import func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.config import get_settings
from app.database import IS_SQLITE, get_session
from app.models import Notebook, Source, SourceRead, User
from app.services.auth_service import get_current_user
from app.services.storage_service import StorageService, get_storage_service

logger = logging.getLogger("studylm.sources_router")

router = APIRouter(tags=["sources"])


class YouTubeSourceRequest(BaseModel):
    url: str
    title: Optional[str] = None


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def sanitize_filename(filename: Optional[str]) -> str:
    """Sanitize filename to prevent directory traversal and hostile characters."""
    if not filename:
        return "unnamed_source.pdf"
    base = os.path.basename(filename).replace("\\", "/").split("/")[-1].strip()
    clean = re.sub(r"[^a-zA-Z0-9_.-]", "_", base)
    return clean or "unnamed_source.pdf"


def detect_source_type(filename: str, content_type: Optional[str]) -> str:
    """Determine source type from filename extension or MIME type."""
    lower_fn = filename.lower()
    ct = (content_type or "").lower()
    if lower_fn.endswith(".pdf") or "pdf" in ct:
        return "pdf"
    if lower_fn.endswith((".png", ".jpg", ".jpeg", ".webp")) or "image" in ct:
        return "image"
    return "pdf"


async def read_and_validate_file_stream(file: UploadFile, max_size_bytes: int) -> bytes:
    """
    Dynamically read stream in chunks into an io.BytesIO buffer, counting bytes.
    Aborts immediately with HTTP 413 if stream exceeds max_size_bytes.
    Avoids duplicate list-to-bytes concatenation overhead and halves peak memory usage.
    """
    chunk_size = 1024 * 1024  # 1MB chunks
    bytes_read = 0
    buffer = io.BytesIO()

    try:
        while True:
            chunk = await file.read(chunk_size)
            if not chunk:
                break
            bytes_read += len(chunk)
            if bytes_read > max_size_bytes:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"File stream exceeded maximum allowed size of {max_size_bytes} bytes (50MB)",
                )
            buffer.write(chunk)

        if bytes_read == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot upload an empty file",
            )

        return buffer.getvalue()
    finally:
        buffer.close()


# -----------------------------------------------------------------------------
# Upload Endpoints
# -----------------------------------------------------------------------------

async def _execute_source_upload(
    target_notebook_id: str,
    request: Request,
    title: Optional[str],
    file: UploadFile,
    current_user: User,
    session: AsyncSession,
    storage_service: StorageService,
    background_tasks: Optional[BackgroundTasks] = None,
) -> Source:
    """
    Internal shared core handling source binary upload:
    - Enforces 50MB Content-Length header limit
    - Enforces 50MB streaming byte counter
    - Enforces 409 Conflict if notebook is deleting (STOR-08)
    - Enforces 20-source limit under row lock (STOR-12)
    - Uploads binary to R2 with scoped key (STOR-01)
    - Atomic rollback: cleans up R2 object on DB error (STOR-10)
    """
    settings = get_settings()

    if not target_notebook_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="notebook_id is required",
        )

    # 2. Content-Length Header Validation
    content_length_header = request.headers.get("content-length")
    if content_length_header:
        try:
            cl = int(content_length_header)
            if cl > settings.MAX_UPLOAD_SIZE:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Payload exceeds maximum allowed size of {settings.MAX_UPLOAD_SIZE} bytes (50MB)",
                )
        except ValueError:
            pass

    # 3. Dynamic Stream Byte Counter Validation
    file_bytes = await read_and_validate_file_stream(file, settings.MAX_UPLOAD_SIZE)

    # 4. Notebook Validation & Row-Level Quota Lock (STOR-08, STOR-12)
    nb_stmt = select(Notebook).where(
        Notebook.id == target_notebook_id,
        Notebook.user_id == current_user.id,
    )
    if not IS_SQLITE:
        nb_stmt = nb_stmt.with_for_update()

    nb_res = await session.execute(nb_stmt)
    notebook = nb_res.scalar_one_or_none()

    if not notebook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found",
        )

    # STOR-08: Reject upload if notebook is marked 'deleting'
    if notebook.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Notebook is pending deletion",
        )

    # STOR-12: Enforce 20-source quota
    count_stmt = select(func.count(Source.id)).where(
        Source.notebook_id == target_notebook_id,
        Source.user_id == current_user.id,
        Source.status != "deleting",
    )
    active_sources_count = (await session.execute(count_stmt)).scalar() or 0
    if active_sources_count >= settings.SOURCE_QUOTA:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Notebook source limit reached (max {settings.SOURCE_QUOTA})",
        )

    # 5. Build Scoped Storage Key & Upload to R2 (STOR-01)
    source_id = str(uuid.uuid4())
    safe_filename = sanitize_filename(file.filename)
    storage_key = storage_service.build_scoped_key(
        user_id=current_user.id,
        notebook_id=notebook.id,
        source_id=source_id,
        filename=safe_filename,
    )
    content_type = file.content_type or "application/pdf"

    await storage_service.upload_file(file_bytes, storage_key, content_type)

    # 6. Database Insert with Atomic Rollback & Orphan Cleanup (STOR-10)
    source_title = title.strip() if title else safe_filename
    source_type = detect_source_type(safe_filename, content_type)

    source = Source(
        id=source_id,
        user_id=current_user.id,
        notebook_id=notebook.id,
        title=source_title,
        source_type=source_type,
        storage_key_or_url=storage_key,
        file_size_bytes=len(file_bytes),
        status="processing",
        created_at=datetime.now(timezone.utc),
    )

    session.add(source)

    try:
        await session.commit()
        await session.refresh(source)
    except Exception as db_exc:
        # STOR-10: Immediate atomic cleanup on DB error
        await session.rollback()
        logger.error(f"DB commit failed for source {source_id}; cleaning up R2 key {storage_key}: {db_exc}")
        try:
            await storage_service.delete_file(storage_key)
        except Exception as clean_exc:
            logger.critical(f"Failed to delete orphaned R2 object {storage_key}: {clean_exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database transaction failed during source creation. Upload was aborted and cleaned up.",
        ) from db_exc

    # 7. Enqueue Ingestion Task (STOR-03)
    try:
        from app.tasks.cleanup_tasks import get_source_task_lock
        # Task queue defer hook if ingestion task is available
        logger.info(f"Source {source.id} created, queued with lock {get_source_task_lock(source.id)}")
        from app.tasks.ingestion_tasks import defer_ingest_source
        await defer_ingest_source(source.id)
    except Exception as queue_exc:
        logger.warning(f"Background ingestion queue notification info: {queue_exc}")

    if background_tasks is not None:
        async def _run_bg_ingest(src_id: str):
            try:
                from app.tasks.ingestion_tasks import ingest_source_task
                await ingest_source_task(source_id=src_id)
            except Exception as e:
                logger.error(f"Async background ingestion error for {src_id}: {e}")

        background_tasks.add_task(_run_bg_ingest, source.id)

    return source


@router.post(
    "/sources/upload",
    response_model=SourceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload source document to notebook",
)
@router.post(
    "/api/sources/upload",
    response_model=SourceRead,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def upload_source(
    request: Request,
    notebook_id: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    storage_service: StorageService = Depends(get_storage_service),
):
    if not notebook_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="notebook_id is required",
        )
    return await _execute_source_upload(
        target_notebook_id=notebook_id,
        request=request,
        title=title,
        file=file,
        current_user=current_user,
        session=session,
        storage_service=storage_service,
        background_tasks=background_tasks,
    )


@router.post(
    "/notebooks/{notebook_id}/sources",
    response_model=SourceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Upload source document to specific notebook",
)
@router.post(
    "/api/notebooks/{notebook_id}/sources",
    response_model=SourceRead,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def upload_notebook_source(
    notebook_id: str,
    request: Request,
    title: Optional[str] = Form(None),
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    storage_service: StorageService = Depends(get_storage_service),
):
    return await _execute_source_upload(
        target_notebook_id=notebook_id,
        request=request,
        title=title,
        file=file,
        current_user=current_user,
        session=session,
        storage_service=storage_service,
        background_tasks=background_tasks,
    )


@router.get(
    "/notebooks/{notebook_id}/sources",
    response_model=List[SourceRead],
    summary="List all active sources in a notebook",
)
@router.get(
    "/api/notebooks/{notebook_id}/sources",
    response_model=List[SourceRead],
    include_in_schema=False,
)
async def list_notebook_sources(
    notebook_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> List[SourceRead]:
    """
    List all active sources for the given notebook ID.
    Enforces anti-enumeration defense by returning 404 if the notebook does not exist or belongs to another user.
    """
    nb_stmt = select(Notebook).where(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id,
    )
    nb_res = await session.execute(nb_stmt)
    notebook = nb_res.scalar_one_or_none()
    if not notebook or notebook.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found",
        )

    stmt = (
        select(Source)
        .where(
            Source.notebook_id == notebook_id,
            Source.user_id == current_user.id,
            Source.status != "deleting",
        )
        .order_by(Source.created_at.desc())
    )
    res = await session.execute(stmt)
    return list(res.scalars().all())


@router.post(
    "/notebooks/{notebook_id}/sources/youtube",
    response_model=SourceRead,
    status_code=status.HTTP_201_CREATED,
    summary="Import YouTube video as source",
)
@router.post(
    "/api/notebooks/{notebook_id}/sources/youtube",
    response_model=SourceRead,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
async def create_youtube_source(
    notebook_id: str,
    payload: YouTubeSourceRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Source:
    """
    Imports YouTube video as a study source:
    - Verifies notebook ownership and active state (STOR-08)
    - Enforces 20-source quota under row lock (STOR-12)
    - Validates YouTube video URL format
    - Enqueues background ingestion & transcription
    """
    nb_stmt = select(Notebook).where(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id,
    )
    if not IS_SQLITE:
        nb_stmt = nb_stmt.with_for_update()

    nb_res = await session.execute(nb_stmt)
    notebook = nb_res.scalar_one_or_none()

    if not notebook:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found",
        )

    if notebook.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Notebook is pending deletion",
        )

    count_stmt = select(func.count(Source.id)).where(
        Source.notebook_id == notebook_id,
        Source.user_id == current_user.id,
        Source.status != "deleting",
    )
    active_sources_count = (await session.execute(count_stmt)).scalar() or 0
    if active_sources_count >= settings.SOURCE_QUOTA:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Notebook source limit reached (max {settings.SOURCE_QUOTA})",
        )

    from app.services.youtube_service import YouTubeService
    yt_svc = YouTubeService()
    try:
        video_id = yt_svc.extract_video_id(payload.url)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid YouTube URL format: {exc}",
        )

    source_id = str(uuid.uuid4())
    canonical_url = f"https://www.youtube.com/watch?v={video_id}"
    source_title = (payload.title or "").strip() or f"YouTube Video {video_id}"

    source = Source(
        id=source_id,
        user_id=current_user.id,
        notebook_id=notebook.id,
        title=source_title,
        source_type="youtube",
        storage_key_or_url=canonical_url,
        file_size_bytes=0,
        status="processing",
        created_at=datetime.now(timezone.utc),
    )
    session.add(source)
    await session.commit()
    await session.refresh(source)

    try:
        from app.tasks.ingestion_tasks import defer_ingest_source
        await defer_ingest_source(source_id)
    except Exception as queue_exc:
        logger.warning(f"Background ingestion queue notification info: {queue_exc}")

    async def _run_bg_ingest(src_id: str):
        try:
            from app.tasks.ingestion_tasks import ingest_source_task
            await ingest_source_task(source_id=src_id)
        except Exception as e:
            logger.error(f"Async background ingestion error for {src_id}: {e}")

    background_tasks.add_task(_run_bg_ingest, source.id)
    return source


# -----------------------------------------------------------------------------
# Read & Delete Endpoints
# -----------------------------------------------------------------------------

@router.get(
    "/sources/{source_id}",
    response_model=SourceRead,
    summary="Get source details by ID",
)
async def get_source(
    source_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """
    SEC-02, STOR-02:
    Anti-enumeration 404 defense. Returns 404 if source is not found,
    belongs to another user, or has status == 'deleting'.
    """
    stmt = select(Source).where(
        Source.id == source_id,
        Source.user_id == current_user.id,
    )
    res = await session.execute(stmt)
    source = res.scalar_one_or_none()

    if not source or source.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found",
        )

    return source


@router.delete(
    "/sources/{source_id}",
    summary="Initiate two-phase cascading source deletion",
)
async def delete_source(
    source_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """
    STOR-02: Two-Phase Cascading Source Deletion:
    Phase 1: Synchronously marks status = 'deleting' and commits.
    Phase 2: Enqueues delete_source_task(source_id) with lock = f"source_{source_id}".
    Subsequent reads immediately return 404.
    """
    stmt = select(Source).where(
        Source.id == source_id,
        Source.user_id == current_user.id,
    )
    res = await session.execute(stmt)
    source = res.scalar_one_or_none()

    if not source or source.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found",
        )

    source.status = "deleting"
    session.add(source)
    await session.commit()

    # Enqueue Phase 2 asynchronous purge task with queue serialization lock (STOR-03)
    try:
        from app.tasks.cleanup_tasks import defer_delete_source
        await defer_delete_source(source_id=source.id)
    except Exception as queue_exc:
        logger.warning(f"Background deletion task queue defer failed (test/mock mode): {queue_exc}")

    return {"status": "deleting", "id": source_id}


# -----------------------------------------------------------------------------
# Streaming & Presigned URL Endpoints (STOR-09)
# -----------------------------------------------------------------------------

@router.get(
    "/sources/{source_id}/stream",
    summary="Stream source binary supporting HTTP 206 Range requests",
)
async def stream_source(
    source_id: str,
    range: Optional[str] = Header(None, alias="Range"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    storage_service: StorageService = Depends(get_storage_service),
):
    """
    STOR-09:
    Supports HTTP Range requests (Range: bytes=start-end).
    Returns HTTP 206 Partial Content with Content-Range and Accept-Ranges: bytes.
    If no Range header provided, streams full binary with Accept-Ranges: bytes.
    """
    stmt = select(Source).where(
        Source.id == source_id,
        Source.user_id == current_user.id,
    )
    res = await session.execute(stmt)
    source = res.scalar_one_or_none()

    if not source or source.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found",
        )

    if source.source_type == "youtube":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot stream YouTube source as raw binary",
        )

    file_bytes = await storage_service.get_file_bytes(source.storage_key_or_url)
    if file_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source binary not found in storage",
        )

    total_size = len(file_bytes)
    content_type = "application/pdf" if source.source_type == "pdf" else "application/octet-stream"

    # Handle Range Request
    if range:
        clean_range = range.strip()
        match = re.match(r"^bytes=(\d*)-(\d*)$", clean_range)
        if not match:
            raise HTTPException(
                status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                headers={"Content-Range": f"bytes */{total_size}"},
                detail="Invalid Range header format",
            )

        start_str, end_str = match.groups()

        if total_size <= 0:
            raise HTTPException(
                status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                headers={"Content-Range": "bytes */0"},
                detail="File is empty",
            )

        try:
            if start_str and end_str:
                start = int(start_str)
                end = int(end_str)
            elif start_str:
                start = int(start_str)
                end = total_size - 1
            elif end_str:
                start = max(0, total_size - int(end_str))
                end = total_size - 1
            else:
                raise HTTPException(
                    status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                    headers={"Content-Range": f"bytes */{total_size}"},
                )
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                headers={"Content-Range": f"bytes */{total_size}"},
            )

        if start > end or start >= total_size or start < 0:
            raise HTTPException(
                status_code=status.HTTP_416_REQUESTED_RANGE_NOT_SATISFIABLE,
                headers={"Content-Range": f"bytes */{total_size}"},
                detail="Requested range not satisfiable",
            )

        end = min(end, total_size - 1)
        sliced_bytes = file_bytes[start : end + 1]

        headers = {
            "Content-Range": f"bytes {start}-{end}/{total_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(len(sliced_bytes)),
            "Content-Type": content_type,
        }
        return Response(content=sliced_bytes, status_code=status.HTTP_206_PARTIAL_CONTENT, headers=headers)

    # Full File Response
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(total_size),
        "Content-Type": content_type,
    }
    return Response(content=file_bytes, status_code=status.HTTP_200_OK, headers=headers)


@router.get(
    "/sources/{source_id}/presigned-url",
    summary="Generate 15-minute presigned download URL",
)
async def get_source_presigned_url(
    source_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    storage_service: StorageService = Depends(get_storage_service),
):
    """
    STOR-09:
    Generates a presigned Cloudflare R2 download URL expiring in 15 minutes (900 seconds).
    """
    stmt = select(Source).where(
        Source.id == source_id,
        Source.user_id == current_user.id,
    )
    res = await session.execute(stmt)
    source = res.scalar_one_or_none()

    if not source or source.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Source not found",
        )

    settings = get_settings()
    presigned_url = storage_service.generate_presigned_url(
        storage_key=source.storage_key_or_url,
        expires_in=settings.PRESIGNED_URL_EXPIRE_SECONDS,
    )

    return {
        "source_id": source.id,
        "presigned_url": presigned_url,
        "expires_in": settings.PRESIGNED_URL_EXPIRE_SECONDS,
    }
