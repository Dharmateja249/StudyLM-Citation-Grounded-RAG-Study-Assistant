"""
Database Engine, Session Factory, and Lifespan Management.
Supports PostgreSQL with psycopg in production and SQLite with aiosqlite in tests.
Enforces foreign key constraints in SQLite via PRAGMA foreign_keys = ON.
"""

import sys
import asyncio
from typing import AsyncGenerator

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import event, text
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import get_settings

settings = get_settings()


def normalize_database_url(url: str) -> str:
    """
    Ensure the database connection URL uses the appropriate async DBAPI driver:
    - postgresql:// or postgres:// -> postgresql+psycopg://
    - sqlite:// -> sqlite+aiosqlite://
    """
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    if url.startswith("postgresql://") and not url.startswith("postgresql+"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("sqlite://") and not url.startswith("sqlite+"):
        return url.replace("sqlite://", "sqlite+aiosqlite://", 1)
    return url


ASYNC_DATABASE_URL = normalize_database_url(settings.DATABASE_URL)
IS_SQLITE = "sqlite" in ASYNC_DATABASE_URL

engine_kwargs = {
    "echo": settings.DEBUG,
    "future": True,
}

if IS_SQLITE:
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_pre_ping"] = True
    engine_kwargs["pool_recycle"] = 60
    engine_kwargs["pool_size"] = 10
    engine_kwargs["max_overflow"] = 20
    engine_kwargs["connect_args"] = {
        "connect_timeout": 10,
    }

# Create async SQLAlchemy / SQLModel engine (pooled for app queries)
engine = create_async_engine(ASYNC_DATABASE_URL, **engine_kwargs)

# Direct engine for DDL/migrations (unpooled to avoid PgBouncer session limits per Neon skills)
direct_engine = (
    create_async_engine(
        normalize_database_url(settings.DATABASE_URL_UNPOOLED),
        **engine_kwargs,
    )
    if settings.DATABASE_URL_UNPOOLED
    else engine
)


# Attach foreign key pragma listener and circular constraint interceptor for SQLite connections
if IS_SQLITE:
    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    @event.listens_for(engine.sync_engine, "before_cursor_execute", retval=True)
    def intercept_sqlite_alter_constraint(conn, cursor, statement, parameters, context, executemany):
        """
        Intercepts and silences 'ALTER TABLE ... ADD CONSTRAINT' on SQLite.
        PostgreSQL requires use_alter=True on circular foreign keys;
        SQLite creates the column directly in CREATE TABLE and rejects ADD CONSTRAINT syntax.
        """
        if "ALTER TABLE" in statement and "ADD CONSTRAINT" in statement:
            return "SELECT 1", parameters
        return statement, parameters


# Async session maker
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields an active async database session.
    Automatically rolls back on unhandled exception and closes at teardown.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """
    Initialize database schema. Imports models to register tables in metadata.
    Follows Neon agent skills: runs DDL over unpooled direct connection to avoid PgBouncer session limits.
    """
    import app.models  # noqa: F401 - Register models in SQLModel.metadata

    target_engine = direct_engine if settings.DATABASE_URL_UNPOOLED else engine
    async with target_engine.begin() as conn:
        if IS_SQLITE:
            await conn.execute(text("PRAGMA foreign_keys = ON;"))
        await conn.run_sync(SQLModel.metadata.create_all)


async def close_db() -> None:
    """Dispose of engine connections at shutdown."""
    await engine.dispose()
    if direct_engine is not engine:
        await direct_engine.dispose()
