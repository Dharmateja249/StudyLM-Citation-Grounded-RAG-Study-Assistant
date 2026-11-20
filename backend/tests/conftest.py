"""
Pytest Test Harness & Fixture Architecture.
Configured for zero-flakiness offline verification using:
- In-memory SQLite with StaticPool and PRAGMA foreign_keys = ON;
- Isolated DB tables created and dropped per test (clean_db fixture);
- Lifespan engine isolation preventing PostgreSQL connection leakage;
- FastAPI AsyncClient and TestClient;
- Google OAuth token mocking;
- In-memory Qdrant Client;
- In-memory Cloudflare R2 Mock;
- Mock Gemini embeddings (768-dim L2-normalized) and generation responses.
"""

import uuid
from datetime import datetime, timezone
from typing import AsyncGenerator, Generator, Optional, Dict, Any, List
from unittest.mock import AsyncMock

import numpy as np
import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from jose import jwt
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncEngine
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import Settings, get_settings
from app.database import get_session
import app.models  # noqa: F401
from app.models import User, Notebook, Source


# =====================================================================
# 1. Test Settings Fixture
# =====================================================================
@pytest.fixture(scope="session")
def test_settings() -> Settings:
    """Return test-specific settings overriding external services."""
    return Settings(
        ENVIRONMENT="testing",
        DEBUG=False,
        DATABASE_URL="sqlite+aiosqlite:///:memory:",
        PROCRASTINATE_DATABASE_URL="postgresql://mock:mock@localhost:5432/mock",
        SECRET_KEY="test-secret-key-12345678901234567890",
        ALGORITHM="HS256",
        ACCESS_TOKEN_EXPIRE_MINUTES=60,
        GOOGLE_CLIENT_ID="test-google-client-id",
        R2_ACCOUNT_ID="test-r2-account-id",
        R2_ACCESS_KEY_ID="test-r2-access-key",
        R2_SECRET_ACCESS_KEY="test-r2-secret-key",
        R2_BUCKET_NAME="test-studylm-sources",
        QDRANT_URL=":memory:",
        GEMINI_API_KEY="test-gemini-key",
        RETRIEVAL_REFUSAL_THRESHOLD=0.40,
        MAX_UPLOAD_SIZE=50 * 1024 * 1024,
        SOURCE_QUOTA=20,
        RATE_LIMIT_QUERIES_PER_HOUR=60,
    )


@pytest.fixture(autouse=True)
def override_test_settings(test_settings: Settings, monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest):
    """Binds application get_settings to test_settings across all modules (except live tests)."""
    if request.node.get_closest_marker("live"):
        return
    monkeypatch.setattr("app.config.get_settings", lambda: test_settings)
    monkeypatch.setattr("app.services.auth_service.get_settings", lambda: test_settings)
    monkeypatch.setattr("app.services.qdrant_service.get_settings", lambda: test_settings)
    monkeypatch.setattr("app.tasks.cleanup_tasks.get_settings", lambda: test_settings)
    monkeypatch.setattr("app.tasks.cleanup_tasks.settings", test_settings)


# =====================================================================
# 1.1 Procrastinate In-Memory Worker Connector Fixture
# =====================================================================
@pytest.fixture(autouse=True)
def set_inmemory_procrastinate_connector():
    """
    Ensures Procrastinate background worker operates strictly with InMemoryConnector
    during tests, preventing live PostgreSQL queries and interface errors.
    """
    from app.tasks.worker import app as procrastinate_app
    from procrastinate.testing import InMemoryConnector

    in_mem = InMemoryConnector()
    with procrastinate_app.replace_connector(in_mem):
        yield procrastinate_app



@pytest.fixture
def procrastinate_app():
    """Provides reference to configured Procrastinate app instance."""
    from app.tasks.worker import app as p_app
    return p_app



# =====================================================================
# 2. In-Memory SQLite Engine & FK Enforcement (Synchronous Fixture)
# =====================================================================
@pytest.fixture(scope="session")
def test_engine() -> Generator[AsyncEngine, None, None]:
    """
    Creates an async in-memory SQLite engine with StaticPool.
    StaticPool ensures all sessions and queries share the identical in-memory database.
    Attaches PRAGMA foreign_keys = ON; to enforce composite foreign keys.
    Synchronous fixture signature prevents PytestAsyncioError when requested by sync fixtures.
    """
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    @event.listens_for(engine.sync_engine, "before_cursor_execute", retval=True)
    def intercept_sqlite_alter_constraint(conn, cursor, statement, parameters, context, executemany):
        if "ALTER TABLE" in statement and "ADD CONSTRAINT" in statement:
            return "SELECT 1", parameters
        return statement, parameters

    yield engine
    engine.sync_engine.dispose()


@pytest.fixture(scope="session")
def test_session_factory(test_engine: AsyncEngine) -> async_sessionmaker:
    """Session maker bound to the test engine."""
    return async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )


# =====================================================================
# 3. Clean DB Isolation Fixture (Per-Test Lifecycle & FK Ordering)
# =====================================================================
@pytest_asyncio.fixture(autouse=True)
async def clean_db(test_engine: AsyncEngine, request: pytest.FixtureRequest) -> AsyncGenerator[None, None]:
    """
    Creates all tables before each test and safely truncates data after each test.
    Handles circular foreign keys (User.last_active_notebook_id <-> Notebook.user_id)
    without attempting invalid PRAGMA modification inside transaction blocks.
    Bypassed for live tests to avoid running SQLite operations on live environments.
    """
    if request.node.get_closest_marker("live"):
        yield
        return

    # 1. Ensure table schema exists
    async with test_engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

    yield

    # 2. Teardown: truncate data in strict dependency order respecting foreign keys
    async with test_engine.begin() as conn:
        # Step A: Break circular foreign key cycle
        await conn.execute(text('UPDATE "user" SET last_active_notebook_id = NULL;'))
        # Step B: Delete child leaf tables
        await conn.execute(text("DELETE FROM message;"))
        await conn.execute(text("DELETE FROM source;"))
        # Step C: Delete parent tables
        await conn.execute(text("DELETE FROM notebook;"))
        # Step D: Delete root user table
        await conn.execute(text('DELETE FROM "user";'))

    await test_engine.dispose()



@pytest_asyncio.fixture
async def db_session(test_session_factory: async_sessionmaker) -> AsyncGenerator[AsyncSession, None]:
    """Provides an active async session for tests to query/insert directly."""
    async with test_session_factory() as s:
        try:
            yield s
        finally:
            await s.rollback()
            await s.close()


@pytest_asyncio.fixture
async def session(db_session: AsyncSession) -> AsyncSession:
    """Alias for db_session fixture."""
    return db_session


# =====================================================================
# 4. FastAPI Application & Test Clients (Lifespan Engine Isolation)
# =====================================================================
@pytest.fixture
def app(test_settings: Settings, test_session_factory: async_sessionmaker, test_engine: AsyncEngine, monkeypatch: pytest.MonkeyPatch):
    """
    FastAPI application instance with:
    - Mocked lifespan init_db and close_db hooks to eliminate PostgreSQL leakage
    - Dependency overrides for get_session and get_settings
    - State and module engine overrides bound to the in-memory SQLite engine
    """
    import app.main as main_module
    import app.database as db_module
    from app.main import app as main_app

    # 1. Defuse lifespan PostgreSQL execution
    monkeypatch.setattr(main_module, "init_db", AsyncMock())
    monkeypatch.setattr(main_module, "close_db", AsyncMock())

    # 2. Override module-level database variables
    monkeypatch.setattr(db_module, "engine", test_engine)
    monkeypatch.setattr(db_module, "IS_SQLITE", True)
    monkeypatch.setattr(db_module, "AsyncSessionLocal", test_session_factory)
    main_app.state.engine = test_engine

    # 3. Configure dependency overrides
    async def override_get_session() -> AsyncGenerator[AsyncSession, None]:
        async with test_session_factory() as s:
            try:
                yield s
            finally:
                await s.close()

    main_app.dependency_overrides[get_session] = override_get_session
    main_app.dependency_overrides[get_settings] = lambda: test_settings

    yield main_app

    main_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def async_client(app) -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP client for testing endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest.fixture
def client(app) -> Generator[TestClient, None, None]:
    """Synchronous test client with safe mocked lifespan."""
    with TestClient(app) as test_client:
        yield test_client


# =====================================================================
# 5. Auth Fixtures: Users & JWT Tokens (Async-Compatible Signatures)
# =====================================================================
@pytest_asyncio.fixture
async def user_a(test_session_factory: async_sessionmaker) -> User:
    """User A in database."""
    async with test_session_factory() as s:
        user = User(
            id=str(uuid.uuid4()),
            google_id="google-user-a",
            email="usera@university.edu",
            name="Student User A",
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        s.add(user)
        await s.commit()
        await s.refresh(user)
        return user


@pytest_asyncio.fixture
async def user_b(test_session_factory: async_sessionmaker) -> User:
    """User B (distinct tenant) in database."""
    async with test_session_factory() as s:
        user = User(
            id=str(uuid.uuid4()),
            google_id="google-user-b",
            email="userb@university.edu",
            name="Student User B",
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        s.add(user)
        await s.commit()
        await s.refresh(user)
        return user


@pytest_asyncio.fixture
async def test_user(user_a: User) -> User:
    """Alias for user_a fixture."""
    return user_a


@pytest_asyncio.fixture
async def test_user_b(user_b: User) -> User:
    """Alias for user_b fixture."""
    return user_b


def create_token_for_user(user_id: str, settings: Settings, is_active: bool = True) -> str:
    """Helper to generate JWT bearer token."""
    payload = {
        "sub": user_id,
        "is_active": is_active,
        "exp": datetime.now(timezone.utc).timestamp() + (settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


@pytest_asyncio.fixture
async def user_a_token(user_a: User, test_settings: Settings) -> str:
    """Async fixture resolving User A JWT."""
    return create_token_for_user(user_a.id, test_settings)


@pytest_asyncio.fixture
async def user_b_token(user_b: User, test_settings: Settings) -> str:
    """Async fixture resolving User B JWT."""
    return create_token_for_user(user_b.id, test_settings)


@pytest_asyncio.fixture
async def user_token(user_a_token: str) -> str:
    """Alias for user_a_token fixture."""
    return user_a_token


@pytest_asyncio.fixture
async def auth_headers(user_a_token: str) -> Dict[str, str]:
    """Authorization headers for User A."""
    return {"Authorization": f"Bearer {user_a_token}"}


@pytest_asyncio.fixture
async def auth_headers_b(user_b_token: str) -> Dict[str, str]:
    """Authorization headers for User B."""
    return {"Authorization": f"Bearer {user_b_token}"}


@pytest.fixture
def mock_google_token() -> Dict[str, Any]:
    """Simulated valid Google OAuth token payload."""
    return {
        "sub": "google-user-a",
        "email": "usera@university.edu",
        "name": "Student User A",
        "picture": "https://example.com/avatar.png",
        "email_verified": True,
    }


# =====================================================================
# 6. Resource Fixtures: Notebooks & Sources
# =====================================================================
@pytest_asyncio.fixture
async def user_a_notebook(test_session_factory: async_sessionmaker, user_a: User) -> Notebook:
    """Notebook owned by User A."""
    async with test_session_factory() as s:
        notebook = Notebook(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            title="Physics 101",
            status="active",
            created_at=datetime.now(timezone.utc),
        )
        s.add(notebook)
        await s.commit()
        await s.refresh(notebook)
        return notebook


@pytest_asyncio.fixture
async def user_b_notebook(test_session_factory: async_sessionmaker, user_b: User) -> Notebook:
    """Notebook owned by User B."""
    async with test_session_factory() as s:
        notebook = Notebook(
            id=str(uuid.uuid4()),
            user_id=user_b.id,
            title="Chemistry 101",
            status="active",
            created_at=datetime.now(timezone.utc),
        )
        s.add(notebook)
        await s.commit()
        await s.refresh(notebook)
        return notebook


@pytest_asyncio.fixture
async def test_notebook(user_a_notebook: Notebook) -> Notebook:
    """Alias for user_a_notebook fixture."""
    return user_a_notebook



@pytest_asyncio.fixture
async def user_a_source(test_session_factory: async_sessionmaker, user_a: User, user_a_notebook: Notebook) -> Source:
    """Source owned by User A associated with User A's notebook."""
    async with test_session_factory() as s:
        source = Source(
            id=str(uuid.uuid4()),
            user_id=user_a.id,
            notebook_id=user_a_notebook.id,
            title="Lecture 1 Notes",
            source_type="pdf",
            storage_key_or_url=f"users/{user_a.id}/notebooks/{user_a_notebook.id}/lec1.pdf",
            status="ready",
            created_at=datetime.now(timezone.utc),
        )
        s.add(source)
        await s.commit()
        await s.refresh(source)
        return source


# =====================================================================
# 7. Mock Cloudflare R2 Storage Service
# =====================================================================
class MockStorageService:
    """In-memory mock for Cloudflare R2 object storage."""

    def __init__(self):
        self.files: Dict[str, bytes] = {}
        self.deleted_keys: List[str] = []

    async def upload_file(self, file_bytes: bytes, storage_key: str, content_type: str = "application/pdf") -> str:
        self.files[storage_key] = file_bytes
        return storage_key

    async def delete_file(self, storage_key: str, **kwargs: Any) -> bool:
        self.deleted_keys.append(storage_key)
        if storage_key in self.files:
            del self.files[storage_key]
            return True
        return False

    async def delete_prefix(self, prefix: str) -> int:
        keys_to_delete = [k for k in self.files if k.startswith(prefix)]
        for k in keys_to_delete:
            del self.files[k]
            self.deleted_keys.append(k)
        return len(keys_to_delete)

    async def get_file_bytes(self, storage_key: str) -> Optional[bytes]:
        return self.files.get(storage_key)

    async def get_file_range(self, storage_key: str, start: int, end: int) -> bytes:
        content = self.files.get(storage_key, b"")
        return content[start:end + 1]

    def generate_presigned_url(self, storage_key: str, expires_in: int = 900) -> str:
        return f"https://mock-r2.studylm.io/{storage_key}?expires={expires_in}"

    def build_scoped_key(self, user_id: str, notebook_id: str, source_id: str, filename: str) -> str:
        return f"users/{user_id}/notebooks/{notebook_id}/{source_id}/{filename}"


@pytest.fixture
def mock_storage() -> MockStorageService:
    return MockStorageService()


# =====================================================================
# 8. In-Memory Qdrant Client Fixture
# =====================================================================
@pytest.fixture
def mock_qdrant() -> QdrantClient:
    """In-memory Qdrant client configured with 768d dense vectors."""
    client = QdrantClient(":memory:")
    from app.config import get_settings
    current_settings = get_settings()
    for c_name in {current_settings.QDRANT_COLLECTION_NAME, "studylm_chunks"}:
        client.create_collection(
            collection_name=c_name,
            vectors_config=qmodels.VectorParams(size=768, distance=qmodels.Distance.COSINE),
        )
    return client


# =====================================================================
# 9. Mock Gemini AI Fixtures (Deterministic Embeddings & LLM)
# =====================================================================
def get_mock_vector(dim: int = 768, seed: int = 42) -> List[float]:
    """Generate a deterministic L2-normalized vector."""
    rng = np.random.RandomState(seed)
    vec = rng.randn(dim).astype(np.float32)
    norm = np.linalg.norm(vec)
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


@pytest.fixture
def mock_embedding_vector() -> List[float]:
    return get_mock_vector(dim=768, seed=42)



