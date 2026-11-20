"""
StudyLM Core SQLModel Database Entities & Pydantic Data Schemas
File: backend/app/models.py

Contains:
- Database Tables: User, Notebook, Source, UserRateLimit, SearchHistory, Message
- Multi-tenancy composite constraints and cascading deletion guards
- Pydantic Core Schemas: SentenceSpan, ChunkPayload, ResolvedCitation
- API & Auxiliary DTOs: CitationMarker, LLMAnswerPayload, EducationalCheckResult, CRUD schemas
"""

import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, ConfigDict
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlmodel import Field, Relationship, SQLModel


# ============================================================================
# 1. SQLModel Relational Database Tables
# ============================================================================

class User(SQLModel, table=True):
    """
    User entity representing an authenticated student account.
    Enforces active session validation and circular link to last active notebook.
    """
    __tablename__ = "user"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True,
        description="Unique user identifier (UUID4 string)",
    )
    google_id: str = Field(
        sa_column=Column(String, unique=True, index=True, nullable=False),
        description="Immutable Google OAuth 'sub' claim",
    )
    email: str = Field(
        sa_column=Column(String, unique=True, index=True, nullable=False),
        description="Primary email address",
    )
    name: str = Field(
        sa_column=Column(String, nullable=False),
        description="User display name",
    )
    avatar_url: Optional[str] = Field(
        default=None,
        sa_column=Column(String, nullable=True),
        description="Profile avatar image URL",
    )
    is_active: bool = Field(
        default=True,
        nullable=False,
        description="Account active status. False indicates account pending deletion.",
    )
    last_active_notebook_id: Optional[str] = Field(
        default=None,
        sa_column=Column(
            String,
            ForeignKey(
                "notebook.id",
                ondelete="SET NULL",
                use_alter=True,
                name="fk_user_last_notebook",
            ),
            nullable=True,
        ),
        description="Last active notebook for session resume (SET NULL on delete)",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
        description="User creation timestamp in UTC",
    )

    # Relationships
    notebooks: List["Notebook"] = Relationship(
        back_populates="user",
        passive_deletes=True,
        sa_relationship_kwargs={"foreign_keys": "[Notebook.user_id]"},
    )


class Notebook(SQLModel, table=True):
    """
    Notebook entity representing an isolated workspace of sources and conversations.
    Enforces strict multi-tenancy via composite unique constraint (id, user_id).
    """
    __tablename__ = "notebook"
    __table_args__ = (
        UniqueConstraint("id", "user_id", name="uq_notebook_id_user"),
    )

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True,
        description="Unique notebook identifier (UUID4 string)",
    )
    user_id: str = Field(
        sa_column=Column(
            String,
            ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        description="Owning user identifier",
    )
    title: str = Field(
        default="Untitled Notebook",
        sa_column=Column(String, nullable=False),
        description="Notebook display title",
    )
    status: str = Field(
        default="active",
        sa_column=Column(String, nullable=False),
        description="Lifecycle status: 'active', 'deleting', or 'error'",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
        description="Creation timestamp in UTC",
    )

    # Relationships
    user: Optional[User] = Relationship(
        back_populates="notebooks",
        sa_relationship_kwargs={"foreign_keys": "[Notebook.user_id]"},
    )
    sources: List["Source"] = Relationship(
        back_populates="notebook",
        passive_deletes=True,
    )
    messages: List["Message"] = Relationship(
        back_populates="notebook",
        passive_deletes=True,
    )


class Source(SQLModel, table=True):
    """
    Source entity representing an ingested document (PDF, Image, or YouTube lecture).
    Enforces strict multi-tenancy via composite foreign key (notebook_id, user_id)
    with ondelete="RESTRICT" to prevent raw SQL deletes from stranding vectors.
    """
    __tablename__ = "source"
    __table_args__ = (
        ForeignKeyConstraint(
            ["notebook_id", "user_id"],
            ["notebook.id", "notebook.user_id"],
            ondelete="RESTRICT",
            name="fk_source_notebook_user",
        ),
    )

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True,
        description="Unique source identifier (UUID4 string)",
    )
    user_id: str = Field(
        sa_column=Column(String, nullable=False, index=True),
        description="Owning user identifier (enforces composite FK tenant match)",
    )
    notebook_id: str = Field(
        sa_column=Column(String, nullable=False, index=True),
        description="Target notebook identifier",
    )
    title: str = Field(
        sa_column=Column(String, nullable=False),
        description="Source title (suppressed if rejected by educational barrier)",
    )
    source_type: str = Field(
        sa_column=Column(String, nullable=False),
        description="Type: 'pdf', 'image', or 'youtube'",
    )
    storage_key_or_url: str = Field(
        sa_column=Column(String, nullable=False),
        description="Cloudflare R2 object key or YouTube URL",
    )
    file_size_bytes: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
        description="Upload binary size in bytes (max 50 MB)",
    )
    page_count: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
        description="Number of document pages (for PDFs)",
    )
    estimated_tokens: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
        description="Estimated token count (routes summary <= 80k vs > 80k)",
    )
    duration_seconds: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
        description="Video duration in seconds (for YouTube sources)",
    )
    active_ingest_run_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String, nullable=True),
        description="UUID of current active blue-green ingestion run",
    )
    status: str = Field(
        default="processing",
        sa_column=Column(String, nullable=False),
        description="Status: 'processing', 'ready', 'error', 'deleting'",
    )
    reindexing: bool = Field(
        default=False,
        nullable=False,
        description="True when background re-indexing while status remains ready",
    )
    error_code: Optional[str] = Field(
        default=None,
        sa_column=Column(String, nullable=True),
        description="Error code ('ERR_CORRUPT_FILE', 'ERR_YT_NO_TRANSCRIPT', 'ERR_NON_EDUCATIONAL_CONTENT')",
    )
    error_message: Optional[str] = Field(
        default=None,
        sa_column=Column(String, nullable=True),
        description="Descriptive error message displayed to user",
    )
    summary: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
        description="Generated full document summary / roadmap",
    )
    summary_status: str = Field(
        default="pending",
        sa_column=Column(String, nullable=False),
        description="Summary status: 'pending', 'ready', 'error'",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
        description="Creation timestamp in UTC",
    )

    # Relationships
    notebook: Optional[Notebook] = Relationship(back_populates="sources")


class UserRateLimit(SQLModel, table=True):
    """
    UserRateLimit entity tracking the hourly chat query window.
    Enforces maximum 60 queries per 1-hour tumbling/sliding window.
    """
    __tablename__ = "userratelimit"

    user_id: str = Field(
        primary_key=True,
        description="User identifier",
    )
    window_start: datetime = Field(
        sa_column=Column(DateTime(timezone=True), nullable=False),
        description="UTC start time of current 1-hour rate limit window",
    )
    query_count: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False),
        description="Number of queries executed within current window",
    )


class SearchHistory(SQLModel, table=True):
    """
    SearchHistory entity tracking search queries within a notebook.
    """
    __tablename__ = "searchhistory"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True,
        description="Unique history record identifier",
    )
    user_id: str = Field(
        sa_column=Column(
            String,
            ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        description="Owning user identifier",
    )
    notebook_id: str = Field(
        sa_column=Column(
            String,
            ForeignKey("notebook.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        description="Target notebook identifier",
    )
    query_text: str = Field(
        sa_column=Column(String, nullable=False),
        description="Search query string",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
        description="Query timestamp in UTC",
    )


class Message(SQLModel, table=True):
    """
    Message entity representing conversation turns with citations.
    Stores citations and injected chunk IDs as JSON strings for 100% SQLite/Postgres parity.
    """
    __tablename__ = "message"

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        primary_key=True,
        description="Unique message identifier",
    )
    notebook_id: str = Field(
        sa_column=Column(
            String,
            ForeignKey("notebook.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        description="Target notebook identifier",
    )
    role: str = Field(
        sa_column=Column(String, nullable=False),
        description="Role: 'user' or 'assistant'",
    )
    content: str = Field(
        sa_column=Column(Text, nullable=False),
        description="Message content markdown (may include [[cite:N]] tokens)",
    )
    injected_chunk_ids_json: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
        description="JSON array of chunk IDs injected into context",
    )
    citations_json: Optional[str] = Field(
        default=None,
        sa_column=Column(Text, nullable=True),
        description="JSON array of resolved citation objects",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
        description="Creation timestamp in UTC",
    )

    # Relationships
    notebook: Optional[Notebook] = Relationship(back_populates="messages")

    # Helper JSON properties for clean application interaction
    @property
    def injected_chunk_ids(self) -> List[str]:
        if not self.injected_chunk_ids_json:
            return []
        try:
            return json.loads(self.injected_chunk_ids_json)
        except Exception:
            return []

    @injected_chunk_ids.setter
    def injected_chunk_ids(self, val: List[str]) -> None:
        self.injected_chunk_ids_json = json.dumps(val)

    @property
    def citations(self) -> List[dict]:
        if not self.citations_json:
            return []
        try:
            return json.loads(self.citations_json)
        except Exception:
            return []

    @citations.setter
    def citations(self, val: List[dict]) -> None:
        self.citations_json = json.dumps(val)


# ============================================================================
# 2. Pydantic Core Domain Schemas (Grounding, Ingestion & Retrieval)
# ============================================================================

class SentenceSpan(BaseModel):
    """
    Granular sentence boundary and highlight coordinate mapping.
    """
    sentence_id: str  # "s0", "s1", "s2", ...
    text: str
    bboxes: List[List[float]] = []  # Multi-line: [[x0, y0, x1, y1], ...] normalized floats [0.0, 1.0]
    start_seconds: Optional[float] = None  # YouTube start timestamp
    end_seconds: Optional[float] = None    # YouTube end timestamp

    model_config = ConfigDict(from_attributes=True)


class ChunkPayload(BaseModel):
    """
    Deterministic document chunk stored in Qdrant vector payload.
    Chunk ID format:
      PDF: {source_id}_p{page:04d}_c{idx:03d}
      YouTube: {source_id}_t{start_seconds:05d}_c{idx:03d}
    """
    chunk_id: str
    source_id: str
    notebook_id: str
    user_id: str
    ingest_run_id: str
    ingested_at: int  # Epoch seconds
    embedding_model: str
    source_title: str
    source_type: str  # "pdf" | "image" | "youtube"
    page_number: Optional[int] = None
    start_seconds: Optional[int] = None
    end_seconds: Optional[int] = None
    text: str
    sentences: List[SentenceSpan]

    model_config = ConfigDict(from_attributes=True)


class ResolvedCitation(BaseModel):
    """
    Authoritative citation resolved strictly from stored Qdrant payload truth.
    Untrusted LLM markers are validated against this schema.
    """
    marker_id: int  # 1, 2, ... corresponding to [[cite:1]], [[cite:2]]
    source_id: str
    source_title: str
    source_type: str
    page_number: Optional[int] = None
    bboxes: List[List[float]] = []  # Multi-line: [[x0, y0, x1, y1], ...]
    start_seconds: Optional[int] = None
    deep_link: str  # Viewer anchor URL or YouTube timestamp link
    quote: str      # Exact verbatim quote from the source sentence

    model_config = ConfigDict(from_attributes=True)


# ============================================================================
# 3. Auxiliary DTOs & API Request / Response Schemas
# ============================================================================

class CitationMarker(BaseModel):
    """
    Inline citation reference emitted by LLM in structured output.
    """
    marker_id: int
    chunk_alias: str   # Short alias injected in prompt: "C1", "C2", ...
    sentence_id: str   # Sentence identifier: "s0", "s1", ...


class LLMAnswerPayload(BaseModel):
    """
    Structured output returned by Gemini generation model.
    """
    answer: str
    citations: List[CitationMarker] = []


class EducationalCheckResult(BaseModel):
    """
    Result of YouTube educational relevance moderation check.
    """
    is_educational: bool
    confidence: float
    reason: Optional[str] = None


# --- User API Schemas ---

class UserRead(BaseModel):
    id: str
    google_id: str
    email: str
    name: str
    avatar_url: Optional[str] = None
    is_active: bool
    last_active_notebook_id: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Notebook API Schemas ---

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

    model_config = ConfigDict(from_attributes=True)


# --- Source API Schemas ---

class SourceCreate(BaseModel):
    title: str
    source_type: str  # "pdf" | "image" | "youtube"
    storage_key_or_url: str


class SourceRead(BaseModel):
    id: str
    user_id: str
    notebook_id: str
    title: str
    source_type: str
    storage_key_or_url: str
    file_size_bytes: Optional[int] = None
    page_count: Optional[int] = None
    estimated_tokens: Optional[int] = None
    duration_seconds: Optional[int] = None
    active_ingest_run_id: Optional[str] = None
    status: str
    reindexing: bool
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    summary: Optional[str] = None
    summary_status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Query API Schemas ---

class QueryRequest(BaseModel):
    notebook_id: str
    notebook_id: Optional[str] = None
    query: str
    source_ids: Optional[List[str]] = None


class QueryResponse(BaseModel):
    answer: str
    citations: List[ResolvedCitation] = []
    refusal: bool = False
