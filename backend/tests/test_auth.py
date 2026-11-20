"""
Security & Multi-Tenancy Test Suite (SEC-01..SEC-08) and Boundary Suite
Verifies:
- SEC-01: Unauthorized notebook access returns HTTP 404 Not Found
- SEC-02: Unauthorized source access returns HTTP 404 Not Found
- SEC-03: Composite foreign key constraint prevents mismatched tenant source
- SEC-04: Google OAuth login & HS256 JWT validation and expiry handling
- SEC-05: Session resume state restores active notebook and message history
- SEC-06: Strict tenant isolation in Qdrant hybrid retrieval filter
- SEC-07: Race-free account deletion end-to-end cascades and invalidates sessions
- SEC-08: Deactivated user login attempt returns HTTP 403 'Account pending deletion'
- Boundary: Malformed Authorization headers rejected with HTTP 401
- Boundary: Missing/empty subject ('sub') claim rejected with HTTP 401
- Boundary: Token expiration boundary (1s past) rejected with HTTP 401
- Boundary: Production rejection of mock Google OAuth tokens
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import List
import pytest
from fastapi import HTTPException
from httpx import AsyncClient
from jose import jwt
from qdrant_client import QdrantClient, models
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.config import Settings
from app.models import User, Notebook, Source, Message
from app.services.auth_service import (
    create_access_token,
    verify_google_id_token,
)
from app.services.qdrant_service import (
    build_tenant_filter,
    execute_tenant_retrieval,
    upsert_chunk_points,
)


# ==============================================================================
# SEC-01: Unauthorized Notebook Access Defense (HTTP 404 Anti-Enumeration)
# ==============================================================================
@pytest.mark.asyncio
async def test_unauthorized_notebook_access_returns_404(
    async_client: AsyncClient,
    user_a_token: str,
    user_b_token: str,
    user_a_notebook: Notebook,
):
    """
    SEC-01: User B attempts to access, update, and delete User A's notebook.
    The system MUST return HTTP 404 Not Found (not 403) to prevent resource enumeration.
    """
    # 1. GET User A's notebook using User B's token
    response_get = await async_client.get(
        f"/notebooks/{user_a_notebook.id}",
        headers={"Authorization": f"Bearer {user_b_token}"}
    )
    assert response_get.status_code == 404
    assert response_get.json()["detail"] == "Notebook not found"

    # 2. PATCH User A's notebook using User B's token
    response_patch = await async_client.patch(
        f"/notebooks/{user_a_notebook.id}",
        json={"title": "Hacked Title"},
        headers={"Authorization": f"Bearer {user_b_token}"}
    )
    assert response_patch.status_code == 404

    # 3. DELETE User A's notebook using User B's token
    response_del = await async_client.delete(
        f"/notebooks/{user_a_notebook.id}",
        headers={"Authorization": f"Bearer {user_b_token}"}
    )
    assert response_del.status_code == 404

    # 4. Verify User A can still retrieve the unchanged notebook
    response_owner = await async_client.get(
        f"/notebooks/{user_a_notebook.id}",
        headers={"Authorization": f"Bearer {user_a_token}"}
    )
    assert response_owner.status_code == 200
    assert response_owner.json()["title"] == user_a_notebook.title


# ==============================================================================
# SEC-02: Unauthorized Source Access Defense (HTTP 404 Anti-Enumeration)
# ==============================================================================
@pytest.mark.asyncio
async def test_unauthorized_source_access_returns_404(
    async_client: AsyncClient,
    user_a_token: str,
    user_b_token: str,
    user_a_source: Source,
):
    """
    SEC-02: User B attempts to access and delete User A's source.
    The system MUST return HTTP 404 Not Found (not 403).
    """
    # 1. GET User A's source using User B's token
    response_get = await async_client.get(
        f"/sources/{user_a_source.id}",
        headers={"Authorization": f"Bearer {user_b_token}"}
    )
    assert response_get.status_code == 404

    # 2. DELETE User A's source using User B's token
    response_del = await async_client.delete(
        f"/sources/{user_a_source.id}",
        headers={"Authorization": f"Bearer {user_b_token}"}
    )
    assert response_del.status_code == 404

    # 3. Verify User A can still access their source
    response_owner = await async_client.get(
        f"/sources/{user_a_source.id}",
        headers={"Authorization": f"Bearer {user_a_token}"}
    )
    assert response_owner.status_code == 200


# ==============================================================================
# SEC-03: Composite Foreign Key Mismatched Tenant Source Constraint
# ==============================================================================
@pytest.mark.asyncio
async def test_composite_fk_prevents_mismatched_tenant_source(
    db_session,
    user_a_notebook: Notebook,
    user_b: User,
):
    """
    SEC-03: Database rejects inserting a Source where source.user_id != notebook.user_id
    due to ForeignKeyConstraint(["notebook_id", "user_id"], ["notebook.id", "notebook.user_id"]).
    """
    # Attempt to associate User B's source with User A's notebook
    mismatched_source = Source(
        id=str(uuid.uuid4()),
        user_id=user_b.id,                # User B
        notebook_id=user_a_notebook.id,   # User A's notebook
        title="Mismatched Tenant Source",
        source_type="pdf",
        storage_key_or_url=f"users/{user_b.id}/notebooks/{user_a_notebook.id}/test.pdf",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )

    db_session.add(mismatched_source)
    with pytest.raises(IntegrityError):
        await db_session.commit()

    await db_session.rollback()


# ==============================================================================
# SEC-04: Google OAuth & JWT Validation
# ==============================================================================
@pytest.mark.asyncio
async def test_google_oauth_and_jwt_validation(
    async_client: AsyncClient,
):
    """
    SEC-04:
    - Valid Google token returns verified JWT
    - Valid JWT allows access to protected endpoint
    - Expired, tampered, and malformed tokens fail with HTTP 401 Unauthorized
    """
    # 1. Login with valid mock Google token
    mock_id_token = "mock_google_token_sub999_alice@uni.edu_Alice"
    login_resp = await async_client.post(
        "/auth/google",
        json={"id_token": mock_id_token}
    )
    assert login_resp.status_code == 200
    login_data = login_resp.json()
    access_token = login_data["access_token"]
    assert login_data["token_type"] == "bearer"
    assert login_data["user"]["email"] == "alice@uni.edu"

    # 2. Access /auth/me with valid JWT
    me_resp = await async_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {access_token}"}
    )
    assert me_resp.status_code == 200
    assert me_resp.json()["email"] == "alice@uni.edu"

    # 3. Access with expired JWT
    user_id = login_data["user"]["id"]
    expired_token = create_access_token(
        data={"sub": user_id, "email": "alice@uni.edu"},
        expires_delta=timedelta(seconds=-30)  # Expired in past
    )
    expired_resp = await async_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {expired_token}"}
    )
    assert expired_resp.status_code == 401
    assert "expired" in expired_resp.json()["detail"].lower()

    # 4. Access with forged / tampered / malformed token
    tampered_resp = await async_client.get(
        "/auth/me",
        headers={"Authorization": "Bearer invalid.jwt.string"}
    )
    assert tampered_resp.status_code == 401
    assert "could not validate credentials" in tampered_resp.json()["detail"].lower()

    # 5. Access with missing header
    missing_resp = await async_client.get("/auth/me")
    assert missing_resp.status_code == 401


# ==============================================================================
# SEC-05: Session Resume State Restores Active Notebook & History
# ==============================================================================
@pytest.mark.asyncio
async def test_session_resume_state(
    async_client: AsyncClient,
    user_a_token: str,
):
    """
    SEC-05: User re-login or profile inspection restores active notebook
    and conversation message history.
    """
    headers = {"Authorization": f"Bearer {user_a_token}"}

    # 1. Create Notebook 1 and Notebook 2
    nb1_resp = await async_client.post("/notebooks", json={"title": "Physics 101"}, headers=headers)
    assert nb1_resp.status_code == 201
    nb1_id = nb1_resp.json()["id"]

    nb2_resp = await async_client.post("/notebooks", json={"title": "Calculus II"}, headers=headers)
    assert nb2_resp.status_code == 201
    nb2_id = nb2_resp.json()["id"]

    # 2. Post messages in Notebook 2
    msg1 = await async_client.post(
        f"/notebooks/{nb2_id}/messages",
        json={"role": "user", "content": "What is the derivative of sin(x)?"},
        headers=headers
    )
    assert msg1.status_code == 201

    msg2 = await async_client.post(
        f"/notebooks/{nb2_id}/messages",
        json={"role": "assistant", "content": "The derivative of sin(x) is cos(x)."},
        headers=headers
    )
    assert msg2.status_code == 201

    # 3. Call /auth/me to check resumed state
    me_resp = await async_client.get("/auth/me", headers=headers)
    assert me_resp.status_code == 200
    resumed_nb_id = me_resp.json()["last_active_notebook_id"]
    assert resumed_nb_id == nb2_id

    # 4. Retrieve conversation history for resumed notebook
    history_resp = await async_client.get(
        f"/notebooks/{resumed_nb_id}/messages",
        headers=headers
    )
    assert history_resp.status_code == 200
    messages = history_resp.json()
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert "derivative" in messages[0]["content"]
    assert messages[1]["role"] == "assistant"
    assert "cos(x)" in messages[1]["content"]


# ==============================================================================
# SEC-06: Strict Tenant Isolation in Retrieval
# ==============================================================================
@pytest.mark.asyncio
async def test_strict_tenant_isolation_in_retrieval(
    mock_qdrant: QdrantClient,
    mock_embedding_vector: List[float],
    user_a: User,
    user_b: User,
):
    """
    SEC-06: Multi-source Qdrant query filter strictly enforces user_id == current_user.id.
    Chunks belonging to another tenant are never retrieved.
    Directly exercises app.services.qdrant_service against in-memory Qdrant instance.
    """
    collection_name = "studylm_chunks"

    # 1. Populate real in-memory Qdrant instance with multi-tenant points
    points = [
        models.PointStruct(
            id=1,
            vector=mock_embedding_vector,
            payload={
                "user_id": user_a.id,
                "ingest_run_id": "run_a1",
                "text": "Top Secret User A Formula: E=mc^2",
            },
        ),
        models.PointStruct(
            id=2,
            vector=mock_embedding_vector,
            payload={
                "user_id": user_a.id,
                "ingest_run_id": "run_a2",
                "text": "User A Exam Solutions",
            },
        ),
        models.PointStruct(
            id=3,
            vector=mock_embedding_vector,
            payload={
                "user_id": user_b.id,
                "ingest_run_id": "run_b1",
                "text": "User B Study Guide: Biology cells",
            },
        ),
    ]
    upsert_chunk_points(mock_qdrant, collection_name, points)

    # 2. Build tenant filters using authentic application service
    user_a_filter = build_tenant_filter(user_a.id, ["run_a1", "run_a2"])
    user_b_filter = build_tenant_filter(user_b.id, ["run_b1"])

    # 3. Assert authentic Qdrant models.Filter object structure
    assert isinstance(user_a_filter, models.Filter)
    assert isinstance(user_b_filter, models.Filter)
    assert user_a_filter.must[0].key == "user_id"
    assert user_a_filter.must[0].match.value == user_a.id
    assert user_a_filter.must[1].key == "ingest_run_id"
    assert user_a_filter.must[1].match.any == ["run_a1", "run_a2"]

    assert user_b_filter.must[0].key == "user_id"
    assert user_b_filter.must[0].match.value == user_b.id
    assert user_b_filter.must[1].key == "ingest_run_id"
    assert user_b_filter.must[1].match.any == ["run_b1"]

    # 4. Execute retrieval for User B: assert User B retrieves only their own chunk (id=3)
    user_b_results = execute_tenant_retrieval(
        client=mock_qdrant,
        collection_name=collection_name,
        user_id=user_b.id,
        query_vector=mock_embedding_vector,
        active_run_ids=["run_b1"],
    )
    assert len(user_b_results) == 1
    assert user_b_results[0].id == 3
    assert user_b_results[0].payload["user_id"] == user_b.id
    assert user_b_results[0].payload["text"] == "User B Study Guide: Biology cells"
    assert all(hit.payload["user_id"] == user_b.id for hit in user_b_results)
    assert not any(hit.payload["user_id"] == user_a.id for hit in user_b_results)

    # 5. Execute retrieval for User A: assert User A retrieves only their chunks (id=1, 2)
    user_a_results = execute_tenant_retrieval(
        client=mock_qdrant,
        collection_name=collection_name,
        user_id=user_a.id,
        query_vector=mock_embedding_vector,
        active_run_ids=["run_a1", "run_a2"],
    )
    assert len(user_a_results) == 2
    assert {hit.id for hit in user_a_results} == {1, 2}
    assert all(hit.payload["user_id"] == user_a.id for hit in user_a_results)
    assert not any(hit.payload["user_id"] == user_b.id for hit in user_a_results)

    # 6. Adversarial Cross-Tenant Probing: User B attempting to query User A's run_id returns 0 results
    cross_results = execute_tenant_retrieval(
        client=mock_qdrant,
        collection_name=collection_name,
        user_id=user_b.id,
        query_vector=mock_embedding_vector,
        active_run_ids=["run_a1"],
    )
    assert len(cross_results) == 0

    # 7. Payload Scroll without Query Vector verifies point filtering
    scroll_results = execute_tenant_retrieval(
        client=mock_qdrant,
        collection_name=collection_name,
        user_id=user_b.id,
        query_vector=None,
        active_run_ids=["run_b1"],
    )
    assert len(scroll_results) == 1
    assert scroll_results[0].id == 3


# ==============================================================================
# SEC-07: Account Deletion End-to-End Cascade & Immediate Revocation
# ==============================================================================
@pytest.mark.asyncio
async def test_account_deletion_end_to_end(
    async_client: AsyncClient,
    db_session,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
    user_a_source: Source,
):
    """
    SEC-07: DELETE /users/me sets user.is_active = False, immediately invalidates
    existing JWTs (subsequent requests fail with 401), and marks notebooks/sources for deletion.
    """
    headers = {"Authorization": f"Bearer {user_a_token}"}

    # 1. Request account deletion
    del_resp = await async_client.delete("/users/me", headers=headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleting"

    # 2. Subsequent request with the SAME token MUST immediately fail with 401 Unauthorized
    subsequent_resp = await async_client.get("/auth/me", headers=headers)
    assert subsequent_resp.status_code == 401
    assert "deactivated" in subsequent_resp.json()["detail"].lower()

    # 3. Verify database state
    user_stmt = select(User).where(User.id == user_a.id)
    user_res = await db_session.execute(user_stmt)
    refreshed_user = user_res.scalar_one()
    assert refreshed_user.is_active is False

    # 4. Verify user notebooks marked 'deleting'
    nb_stmt = select(Notebook).where(Notebook.user_id == user_a.id)
    nb_res = await db_session.execute(nb_stmt)
    notebooks = nb_res.scalars().all()
    assert all(nb.status == "deleting" for nb in notebooks)

    # 5. Verify user sources marked 'deleting'
    src_stmt = select(Source).where(Source.user_id == user_a.id)
    src_res = await db_session.execute(src_stmt)
    sources = src_res.scalars().all()
    assert len(sources) > 0
    assert all(src.status == "deleting" for src in sources)


# ==============================================================================
# SEC-08: Deactivated User Login Attempt Returns HTTP 403 Forbidden
# ==============================================================================
@pytest.mark.asyncio
async def test_deactivated_user_login_attempt_returns_403(
    async_client: AsyncClient,
    db_session,
    user_a: User,
):
    """
    SEC-08: A deactivated user attempting to log in via Google OAuth MUST be rejected
    with HTTP 403 Forbidden ('Account pending deletion').
    """
    # 1. Set user.is_active = False
    user_a.is_active = False
    db_session.add(user_a)
    await db_session.commit()
    await db_session.refresh(user_a)

    # 2. User attempts to log in via Google OAuth
    mock_id_token = f"mock_google_token_{user_a.google_id}_{user_a.email}_{user_a.name}"
    login_resp = await async_client.post(
        "/auth/google",
        json={"id_token": mock_id_token}
    )

    # 3. Assert HTTP 403 Forbidden with exact detail message
    assert login_resp.status_code == 403
    assert login_resp.json()["detail"] == "Account pending deletion"


# ==============================================================================
# Boundary & Edge-Case Test Suite
# ==============================================================================

@pytest.mark.asyncio
async def test_auth_malformed_authorization_header(
    async_client: AsyncClient,
):
    """
    Boundary & Edge-Case Test:
    Malformed Authorization headers must be rejected with HTTP 401 Unauthorized:
    - Malformed JWT string ('Bearer invalid.jwt.string') -> 401
    - Empty bearer token ('Bearer ') -> 401
    - Non-Bearer authorization scheme ('Basic dXNlcjpwYXNz') -> 401
    - Completely invalid header format ('InvalidSchemeTokenWithoutSpace') -> 401
    """
    # 1. Malformed JWT string
    res_invalid_jwt = await async_client.get(
        "/auth/me",
        headers={"Authorization": "Bearer invalid.jwt.string"}
    )
    assert res_invalid_jwt.status_code == 401
    assert "could not validate credentials" in res_invalid_jwt.json()["detail"].lower()

    # 2. Empty Bearer token
    res_empty_bearer = await async_client.get(
        "/auth/me",
        headers={"Authorization": "Bearer "}
    )
    assert res_empty_bearer.status_code == 401

    # 3. Non-Bearer authorization scheme
    res_basic = await async_client.get(
        "/auth/me",
        headers={"Authorization": "Basic dXNlcjpwYXNz"}
    )
    assert res_basic.status_code == 401
    assert "not authenticated" in res_basic.json()["detail"].lower()

    # 4. Missing scheme separator
    res_no_scheme = await async_client.get(
        "/auth/me",
        headers={"Authorization": "InvalidSchemeTokenWithoutSpace"}
    )
    assert res_no_scheme.status_code == 401


@pytest.mark.asyncio
async def test_auth_jwt_missing_or_empty_sub_claim(
    async_client: AsyncClient,
    test_settings: Settings,
):
    """
    Boundary & Edge-Case Test:
    Tokens with missing or empty 'sub' claims must be rejected with HTTP 401 Unauthorized
    ('Invalid token: missing subject claim').
    """
    # 1. Token signed with valid secret key but missing 'sub'
    token_missing_sub = jwt.encode(
        {
            "email": "nosub@example.com",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
        },
        test_settings.SECRET_KEY,
        algorithm=test_settings.ALGORITHM,
    )
    res_no_sub = await async_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token_missing_sub}"}
    )
    assert res_no_sub.status_code == 401
    assert "missing subject claim" in res_no_sub.json()["detail"].lower()

    # 2. Token signed with empty string 'sub'
    token_empty_sub = jwt.encode(
        {
            "sub": "",
            "email": "emptysub@example.com",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
        },
        test_settings.SECRET_KEY,
        algorithm=test_settings.ALGORITHM,
    )
    res_empty_sub = await async_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token_empty_sub}"}
    )
    assert res_empty_sub.status_code == 401
    assert "missing subject claim" in res_empty_sub.json()["detail"].lower()

    # 3. Token with nonexistent user sub
    phantom_user_id = str(uuid.uuid4())
    token_phantom = jwt.encode(
        {
            "sub": phantom_user_id,
            "email": "phantom@example.com",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
            "iat": datetime.now(timezone.utc),
        },
        test_settings.SECRET_KEY,
        algorithm=test_settings.ALGORITHM,
    )
    res_phantom = await async_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token_phantom}"}
    )
    assert res_phantom.status_code == 401
    assert "user not found" in res_phantom.json()["detail"].lower()


@pytest.mark.asyncio
async def test_auth_jwt_expired_token_boundary(
    async_client: AsyncClient,
    user_a: User,
):
    """
    Boundary & Edge-Case Test:
    JWT expired tokens at boundary conditions (e.g., 1 second ago)
    must be rejected with HTTP 401 Unauthorized ('Token has expired').
    """
    # 1. Expired 1 second in the past (strict boundary)
    token_expired_boundary = create_access_token(
        data={"sub": user_a.id, "email": user_a.email},
        expires_delta=timedelta(seconds=-1)
    )
    res_expired_boundary = await async_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token_expired_boundary}"}
    )
    assert res_expired_boundary.status_code == 401
    assert "expired" in res_expired_boundary.json()["detail"].lower()

    # 2. Expired 24 hours in the past
    token_expired_long = create_access_token(
        data={"sub": user_a.id, "email": user_a.email},
        expires_delta=timedelta(days=-1)
    )
    res_expired_long = await async_client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token_expired_long}"}
    )
    assert res_expired_long.status_code == 401
    assert "expired" in res_expired_long.json()["detail"].lower()


def test_audit_verify_google_token_mock_bypass_vulnerability(monkeypatch):
    """
    Forensic Audit & Security Boundary Test:
    verify_google_id_token MUST actively reject mock tokens when ENVIRONMENT is 'production'.
    Prevents backdoor privilege escalation in production deployments.
    """
    prod_settings = Settings(
        ENVIRONMENT="production",
        DEBUG=False,
        GOOGLE_CLIENT_ID="prod-client-id.apps.googleusercontent.com",
    )
    monkeypatch.setattr("app.services.auth_service.get_settings", lambda: prod_settings)

    mock_token = "mock_google_token_attacker_victim@example.com_Attacker"

    # In production, verify_google_id_token MUST raise HTTPException 401
    with pytest.raises(HTTPException) as exc_info:
        verify_google_id_token(mock_token)

    assert exc_info.value.status_code == 401
    assert "Mock authentication tokens are forbidden in production" in exc_info.value.detail


@pytest.mark.asyncio
async def test_production_rejects_mock_google_token(
    async_client: AsyncClient,
    monkeypatch,
):
    """
    End-to-End HTTP Boundary Test:
    POST /auth/google with a mock token in production environment MUST return HTTP 401 Unauthorized.
    """
    prod_settings = Settings(
        ENVIRONMENT="production",
        DEBUG=False,
        GOOGLE_CLIENT_ID="prod-client-id.apps.googleusercontent.com",
    )
    monkeypatch.setattr("app.services.auth_service.get_settings", lambda: prod_settings)

    response = await async_client.post(
        "/auth/google",
        json={"id_token": "mock_google_token_attacker_victim@example.com_Attacker"}
    )
    assert response.status_code == 401
    assert "Mock authentication tokens are forbidden in production" in response.json()["detail"]
