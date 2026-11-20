"""
Application Configuration and Environment Settings.
Driven by Pydantic Settings with strict quota and rate-limit guardrails.
"""

from functools import lru_cache
from pathlib import Path
from typing import List, Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_CURRENT_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _CURRENT_DIR.parent
_ROOT_DIR = _BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            str(_ROOT_DIR / ".env"),
            str(_BACKEND_DIR / ".env"),
            ".env",
            str(_ROOT_DIR / ".env.local"),
            str(_BACKEND_DIR / ".env.local"),
            ".env.local",
        ),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ---------------------------------------------------------
    # Application & Environment
    # ---------------------------------------------------------
    PROJECT_NAME: str = "StudyLM Backend"
    ENVIRONMENT: str = "development"  # "development" | "testing" | "production"
    DEBUG: bool = False

    # ---------------------------------------------------------
    # Security & Auth Subsystem
    # ---------------------------------------------------------
    SECRET_KEY: str = "studylm-super-secret-dev-key-change-in-production-abcdef123456"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    GOOGLE_CLIENT_ID: str = "mock-google-client-id"
    GOOGLE_CLIENT_SECRET: str = "mock-google-client-secret"

    # ---------------------------------------------------------
    # Database (PostgreSQL / SQLite for Testing)
    # ---------------------------------------------------------
    DATABASE_URL: str = "postgresql+psycopg://postgres:postgres@localhost:5432/studylm"
    DATABASE_URL_UNPOOLED: Optional[str] = None
    PROCRASTINATE_DATABASE_URL: Optional[str] = None

    @property
    def effective_procrastinate_database_url(self) -> str:
        """
        Returns connection string for Procrastinate task worker.
        Following Neon agent skills: Procrastinate relies on LISTEN/NOTIFY and session locks,
        which requires a direct (unpooled) PostgreSQL connection rather than PgBouncer transaction pooler.
        Ensures SQLAlchemy / asyncpg dialect prefixes are stripped so psycopg/libpq parses it as a valid URI.
        """
        raw_url = (
            self.PROCRASTINATE_DATABASE_URL
            or self.DATABASE_URL_UNPOOLED
            or self.DATABASE_URL
        )
        if not raw_url:
            return ""

        url = str(raw_url)
        # Sanitize dialect prefixes for psycopg/libpq compatibility
        if url.startswith("postgresql+psycopg://"):
            url = url.replace("postgresql+psycopg://", "postgresql://", 1)
        elif url.startswith("postgresql+asyncpg://"):
            url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
        elif url.startswith("postgresql+psycopg2://"):
            url = url.replace("postgresql+psycopg2://", "postgresql://", 1)
        elif url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)

        return url

    # ---------------------------------------------------------
    # Cloudflare R2 Object Storage
    # ---------------------------------------------------------
    R2_ACCOUNT_ID: str = "mock-r2-account-id"
    R2_ACCESS_KEY_ID: str = "mock-r2-access-key-id"
    R2_SECRET_ACCESS_KEY: str = "mock-r2-secret-access-key"
    R2_BUCKET_NAME: str = "studylm-sources"
    R2_ENDPOINT_URL: Optional[str] = None
    PRESIGNED_URL_EXPIRE_SECONDS: int = 900  # 15 minutes

    # ---------------------------------------------------------
    # Qdrant Vector Database
    # ---------------------------------------------------------
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: Optional[str] = None
    QDRANT_COLLECTION_NAME: str = "studylm_chunks"

    # ---------------------------------------------------------
    # Gemini AI Models & Embeddings
    # ---------------------------------------------------------
    GEMINI_API_KEY: str = "mock-gemini-api-key"
    GEMINI_EMBEDDING_MODEL: str = "gemini-embedding-2"
    EMBEDDING_DIMENSION: int = 768
    GEMINI_GENERATION_MODEL: str = "gemini-3.7-flash"
    GEMINI_FALLBACK_MODELS: List[str] = [
        "gemini-3.7-flash",
        "gemini-3.6-flash",
        "gemini-3.5-flash-lite",
    ]
    RETRIEVAL_REFUSAL_THRESHOLD: float = 0.40
    SUMMARY_FULL_CONTEXT_TOKEN_LIMIT: int = 80000

    # ---------------------------------------------------------
    # Quotas & Rate Limits (P0 Critical Constraints)
    # ---------------------------------------------------------
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024  # 50 MB in bytes (52,428,800)
    SOURCE_QUOTA: int = 20  # Max 20 sources per user
    RATE_LIMIT_QUERIES_PER_HOUR: int = 60  # 60 queries/hour per user
    RATE_LIMIT_WINDOW_SECONDS: int = 3600  # 1 hour window

    # ---------------------------------------------------------
    # Worker & Maintenance Intervals
    # ---------------------------------------------------------
    WORKER_UPDATE_HEARTBEAT_INTERVAL: float = 10.0
    WORKER_STALLED_TIMEOUT: float = 30.0
    WORKER_POLLING_INTERVAL: float = 1.0
    SWEEPER_DEADLINE_HOURS: int = 4
    REAPER_GRACE_PERIOD_SECONDS: int = 7200  # 2-hour grace period
    ORPHAN_R2_RECONCILER_AGE_SECONDS: int = 3600  # 1 hour

    # ---------------------------------------------------------
    # Educational Relevance Content Barrier (YouTube Ingestion Guard)
    # ---------------------------------------------------------
    EDUCATIONAL_BARRIER_ENABLED: bool = True
    EDUCATIONAL_KEYWORDS: List[str] = [
        "lecture", "tutorial", "course", "chapter", "university", "proof",
        "derivation", "concept", "syllabus", "textbook", "lesson", "education",
        "academic", "math", "physics", "computer science", "chemistry", "biology",
        "history", "seminar", "workshop", "calculus", "linear algebra",
        "devops", "kubernetes", "algorithm", "machine learning", "deep learning",
        "neural network", "artificial intelligence", "data science",
        "programming", "coding", "software", "development", "python", "javascript",
        "typescript", "java", "c++", "react", "html", "css", "sql", "database",
        "engineering", "technology", "science", "mathematics", "economics",
        "finance", "business", "management", "philosophy", "guide", "explained",
        "explanation", "introduction", "crash course", "fundamentals",
        "basics", "study", "learning", "class", "training", "summary",
        "notes", "review", "exam", "preparation", "presentation", "conference",
        "analytics", "docker", "architecture", "analysis", "huberman", "podcast",
    ]
    NON_EDUCATIONAL_NEGATIVE_FLAGS: List[str] = [
        "official music video", "music video", "official audio", "lyric video",
        "vlog", "gameplay", "trailer", "teaser", "unboxing", "prank",
        "mukbang", "comedy skit", "tiktok compilation", "sports highlights"
    ]
    EDUCATIONAL_REJECTION_ERROR_CODE: str = "ERR_NON_EDUCATIONAL_CONTENT"
    EDUCATIONAL_REJECTION_ERROR_MESSAGE: str = (
        "Upload educational related video, this video does not have educational content please recheck the link"
    )


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings singleton."""
    return Settings()
