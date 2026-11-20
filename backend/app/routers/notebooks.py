"""
Notebooks Router:
- POST /notebooks: Create notebook for authenticated user
- GET /notebooks: List active notebooks for authenticated user
- GET /notebooks/{id}: Get notebook details (returns 404 for other tenants) [SEC-01]
- PATCH /notebooks/{id}: Update notebook title
- DELETE /notebooks/{id}: Initiate notebook deletion (returns 404 for other tenants)
- GET /notebooks/{id}/messages: Get conversation history for session resume [SEC-05]
- POST /notebooks/{id}/messages: Add conversation message
"""

import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, field_validator
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import User, Notebook, Source, Message
from app.services.auth_service import get_current_user

logger = logging.getLogger("studylm.notebooks_router")
router = APIRouter(prefix="/notebooks", tags=["notebooks"])


# Schemas
class NotebookCreate(BaseModel):
    title: Optional[str] = "Untitled Notebook"


class NotebookUpdate(BaseModel):
    title: Optional[str] = None


class NotebookRead(BaseModel):
    id: str
    user_id: str
    title: str
    status: str
    created_at: datetime


class MessageCreate(BaseModel):
    role: str  # "user" | "assistant"
    content: str
    citations: Optional[List[Dict[str, Any]]] = None
    injected_chunk_ids: Optional[List[str]] = None


class MessageRead(BaseModel):
    id: str
    notebook_id: str
    role: str
    content: str
    created_at: datetime
    citations: Optional[List[dict]] = None
    injected_chunk_ids: Optional[List[str]] = None

    @field_validator("citations", mode="before")
    @classmethod
    def sanitize_citations(cls, v):
        if not isinstance(v, list):
            return []
        return [x for x in v if isinstance(x, dict)]

    @field_validator("injected_chunk_ids", mode="before")
    @classmethod
    def sanitize_injected_chunk_ids(cls, v):
        if not isinstance(v, list):
            return []
        return [str(x) for x in v if x is not None]


@router.post("", response_model=NotebookRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=NotebookRead, status_code=status.HTTP_201_CREATED)
async def create_notebook(
    payload: NotebookCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """
    Creates a new notebook owned by the authenticated user and updates
    last_active_notebook_id.
    """
    notebook = Notebook(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        title=payload.title.strip() if payload.title else "Untitled Notebook",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    session.add(notebook)
    await session.flush()
    current_user.last_active_notebook_id = notebook.id
    session.add(current_user)

    await session.commit()
    await session.refresh(notebook)

    return NotebookRead(
        id=notebook.id,
        user_id=notebook.user_id,
        title=notebook.title,
        status=notebook.status,
        created_at=notebook.created_at,
    )


@router.get("", response_model=List[NotebookRead])
@router.get("/", response_model=List[NotebookRead])
async def list_notebooks(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """
    Lists active notebooks owned by current user.
    """
    statement = (
        select(Notebook)
        .where(
            Notebook.user_id == current_user.id,
            Notebook.status != "deleting"
        )
        .order_by(Notebook.created_at.desc())
    )
    result = await session.execute(statement)
    notebooks = result.scalars().all()
    return [
        NotebookRead(
            id=nb.id,
            user_id=nb.user_id,
            title=nb.title,
            status=nb.status,
            created_at=nb.created_at,
        )
        for nb in notebooks
    ]


@router.get("/{notebook_id}", response_model=NotebookRead)
@router.get("/{notebook_id}/", response_model=NotebookRead, include_in_schema=False)
async def get_notebook(
    notebook_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """
    SEC-01: Scoped strictly by current_user.id.
    Access to another user's notebook returns HTTP 404 Not Found (NOT 403).
    """
    statement = select(Notebook).where(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id
    )
    result = await session.execute(statement)
    notebook = result.scalar_one_or_none()

    if not notebook or notebook.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found"
        )

    # Update last_active_notebook_id on access
    if current_user.last_active_notebook_id != notebook.id:
        current_user.last_active_notebook_id = notebook.id
        session.add(current_user)
        await session.commit()

    return NotebookRead(
        id=notebook.id,
        user_id=notebook.user_id,
        title=notebook.title,
        status=notebook.status,
        created_at=notebook.created_at,
    )


@router.patch("/{notebook_id}", response_model=NotebookRead)
@router.patch("/{notebook_id}/", response_model=NotebookRead, include_in_schema=False)
async def update_notebook(
    notebook_id: str,
    payload: NotebookUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """
    SEC-01: Unauthorized update returns HTTP 404 Not Found.
    """
    statement = select(Notebook).where(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id
    )
    result = await session.execute(statement)
    notebook = result.scalar_one_or_none()

    if not notebook or notebook.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found"
        )

    if payload.title is not None:
        notebook.title = payload.title.strip()
        session.add(notebook)
        await session.commit()
        await session.refresh(notebook)

    return NotebookRead(
        id=notebook.id,
        user_id=notebook.user_id,
        title=notebook.title,
        status=notebook.status,
        created_at=notebook.created_at,
    )


@router.delete("/{notebook_id}")
@router.delete("/{notebook_id}/", include_in_schema=False)
async def delete_notebook(
    notebook_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """
    SEC-01: Unauthorized delete returns HTTP 404 Not Found.
    Marks notebook and child sources as deleting.
    """
    statement = select(Notebook).where(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id
    )
    result = await session.execute(statement)
    notebook = result.scalar_one_or_none()

    if not notebook or notebook.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found"
        )

    notebook.status = "deleting"
    session.add(notebook)

    await session.execute(
        update(Source)
        .where(Source.notebook_id == notebook_id)
        .values(status="deleting")
    )

    if current_user.last_active_notebook_id == notebook_id:
        current_user.last_active_notebook_id = None
        session.add(current_user)

    await session.commit()

    # Enqueue background cascading sweeper task (STOR-07)
    try:
        from app.tasks.cleanup_tasks import defer_cleanup_notebook
        await defer_cleanup_notebook(
            notebook_id=notebook.id,
            started_at_epoch=time.time(),
        )
    except Exception as queue_exc:
        logger.warning(f"Background notebook cleanup queue defer failed (test/mock mode): {queue_exc}")

    return {"status": "deleting", "id": notebook_id}


# Message History / Session Resume Endpoints (SEC-05)
@router.get("/{notebook_id}/messages", response_model=List[MessageRead])
@router.get("/{notebook_id}/messages/", response_model=List[MessageRead], include_in_schema=False)
async def get_notebook_messages(
    notebook_id: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """
    SEC-05: Returns conversation history in chronological order.
    Returns 404 if notebook not owned by caller.
    """
    nb_stmt = select(Notebook).where(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id
    )
    nb_res = await session.execute(nb_stmt)
    notebook = nb_res.scalar_one_or_none()

    if not notebook or notebook.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found"
        )

    msg_stmt = (
        select(Message)
        .where(Message.notebook_id == notebook_id)
        .order_by(Message.created_at.asc())
    )
    msg_res = await session.execute(msg_stmt)
    messages = msg_res.scalars().all()

    return [
        MessageRead(
            id=m.id,
            notebook_id=m.notebook_id,
            role=m.role,
            content=m.content,
            created_at=m.created_at,
            citations=[c for c in (m.citations or []) if isinstance(c, dict)],
            injected_chunk_ids=[str(x) for x in (m.injected_chunk_ids or []) if x is not None],
        )
        for m in messages
    ]


@router.post("/{notebook_id}/messages", response_model=MessageRead, status_code=status.HTTP_201_CREATED)
@router.post("/{notebook_id}/messages/", response_model=MessageRead, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def post_notebook_message(
    notebook_id: str,
    payload: MessageCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session)
):
    """
    Appends a conversation message to notebook.
    Returns 404 if notebook not owned by caller.
    """
    nb_stmt = select(Notebook).where(
        Notebook.id == notebook_id,
        Notebook.user_id == current_user.id
    )
    nb_res = await session.execute(nb_stmt)
    notebook = nb_res.scalar_one_or_none()

    if not notebook or notebook.status == "deleting":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notebook not found"
        )

    citations_json_val = json.dumps(payload.citations) if payload.citations else None
    injected_chunk_ids_json_val = json.dumps(payload.injected_chunk_ids) if payload.injected_chunk_ids else None

    message = Message(
        id=str(uuid.uuid4()),
        notebook_id=notebook_id,
        role=payload.role,
        content=payload.content,
        citations_json=citations_json_val,
        injected_chunk_ids_json=injected_chunk_ids_json_val,
        created_at=datetime.now(timezone.utc),
    )
    session.add(message)
    await session.commit()
    await session.refresh(message)

    return MessageRead(
        id=message.id,
        notebook_id=message.notebook_id,
        role=message.role,
        content=message.content,
        created_at=message.created_at,
        citations=[c for c in (message.citations or []) if isinstance(c, dict)],
        injected_chunk_ids=[str(x) for x in (message.injected_chunk_ids or []) if x is not None],
    )
