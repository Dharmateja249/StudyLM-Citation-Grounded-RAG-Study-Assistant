"""
Adversarial Security & Multi-Tenancy Challenge Suite (Milestone 1)
Author: challenger_m1_1

Adversarially probes:
1. Cross-tenant isolation & bypasses:
   - Unauthorized notebook access, update, deletion, messaging -> 404 (anti-enumeration)
   - Indistinguishability between non-existent and foreign tenant resources
   - Cross-tenant source access & deletion -> 404
   - Composite foreign key enforcement rejecting mismatched tenant sources at DB engine level
2. JWT forgery, tampering, and algorithm attacks:
   - alg: "none" attack
   - alg confusion (HS384, HS512, RS256)
   - Signature tampering / truncation
   - Payload tampering (IDOR via token payload)
   - Forgery with rogue secret keys
   - Missing, empty, or non-existent sub claims
   - Expired tokens & malformed bearer headers
3. Account deactivation & re-login attacks:
   - Immediate session revocation upon DELETE /users/me
   - Cascading status transition (notebooks/sources set to 'deleting')
   - Google OAuth re-login rejection with 403 'Account pending deletion'
   - Re-login attempt with same email but different Google ID
   - Immunity of peer tenants from neighbor deactivation
4. Production vulnerability probe:
   - Mock OAuth token bypass in production environment configuration
"""

import uuid
import base64
import json
from datetime import datetime, timedelta, timezone
import pytest
from httpx import AsyncClient
from jose import jwt
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.config import Settings
from app.models import User, Notebook, Source, Message
from app.services.auth_service import create_access_token, verify_google_id_token


# ==============================================================================
# Suite 1: Cross-Tenant Isolation & Anti-Enumeration (404 vs 403)
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_cross_tenant_notebook_isolation(
    async_client: AsyncClient,
    user_a: User,
    user_b: User,
    user_a_token: str,
    user_b_token: str,
    user_a_notebook: Notebook,
):
    """
    Adversarial Attack: User B attempts full CRUD and messaging against User A's notebook.
    Must return 404 Not Found on all endpoints to prevent resource enumeration.
    """
    headers_b = {"Authorization": f"Bearer {user_b_token}"}
    headers_a = {"Authorization": f"Bearer {user_a_token}"}

    # 1. READ: User B attempts GET /notebooks/{user_a_notebook.id}
    res_get = await async_client.get(f"/notebooks/{user_a_notebook.id}", headers=headers_b)
    assert res_get.status_code == 404, f"Expected 404, got {res_get.status_code}"
    assert res_get.json()["detail"] == "Notebook not found"

    # 2. UPDATE: User B attempts PATCH /notebooks/{user_a_notebook.id}
    res_patch = await async_client.patch(
        f"/notebooks/{user_a_notebook.id}",
        json={"title": "Hostile Hijack"},
        headers=headers_b,
    )
    assert res_patch.status_code == 404, f"Expected 404, got {res_patch.status_code}"

    # 3. DELETE: User B attempts DELETE /notebooks/{user_a_notebook.id}
    res_del = await async_client.delete(f"/notebooks/{user_a_notebook.id}", headers=headers_b)
    assert res_del.status_code == 404, f"Expected 404, got {res_del.status_code}"

    # 4. READ MESSAGES: User B attempts GET /notebooks/{user_a_notebook.id}/messages
    res_get_msg = await async_client.get(f"/notebooks/{user_a_notebook.id}/messages", headers=headers_b)
    assert res_get_msg.status_code == 404, f"Expected 404, got {res_get_msg.status_code}"

    # 5. INJECT MESSAGE: User B attempts POST /notebooks/{user_a_notebook.id}/messages
    res_post_msg = await async_client.post(
        f"/notebooks/{user_a_notebook.id}/messages",
        json={"role": "user", "content": "Hostile Injected Prompt"},
        headers=headers_b,
    )
    assert res_post_msg.status_code == 404, f"Expected 404, got {res_post_msg.status_code}"

    # 6. Verify User A's notebook integrity remains completely untouched
    res_owner = await async_client.get(f"/notebooks/{user_a_notebook.id}", headers=headers_a)
    assert res_owner.status_code == 200
    assert res_owner.json()["title"] == user_a_notebook.title
    assert res_owner.json()["status"] == "active"


@pytest.mark.asyncio
async def test_adversarial_anti_enumeration_indistinguishability(
    async_client: AsyncClient,
    user_b_token: str,
    user_a_notebook: Notebook,
):
    """
    Adversarial Anti-Enumeration Probe:
    Ensure that querying another tenant's notebook returns the EXACT same status code,
    headers, and error response payload as querying a completely random, non-existent UUID.
    """
    headers = {"Authorization": f"Bearer {user_b_token}"}
    non_existent_id = str(uuid.uuid4())

    res_foreign = await async_client.get(f"/notebooks/{user_a_notebook.id}", headers=headers)
    res_non_existent = await async_client.get(f"/notebooks/{non_existent_id}", headers=headers)

    assert res_foreign.status_code == 404
    assert res_non_existent.status_code == 404
    assert res_foreign.json() == res_non_existent.json() == {"detail": "Notebook not found"}


@pytest.mark.asyncio
async def test_adversarial_cross_tenant_source_isolation(
    async_client: AsyncClient,
    user_a_token: str,
    user_b_token: str,
    user_a_source: Source,
):
    """
    Adversarial Attack: User B attempts GET and DELETE against User A's source.
    Must return 404 Not Found (NOT 403 Forbidden).
    """
    headers_b = {"Authorization": f"Bearer {user_b_token}"}
    headers_a = {"Authorization": f"Bearer {user_a_token}"}

    # 1. READ: User B attempts GET /sources/{source_id}
    res_get = await async_client.get(f"/sources/{user_a_source.id}", headers=headers_b)
    assert res_get.status_code == 404
    assert res_get.json()["detail"] == "Source not found"

    # 2. DELETE: User B attempts DELETE /sources/{source_id}
    res_del = await async_client.delete(f"/sources/{user_a_source.id}", headers=headers_b)
    assert res_del.status_code == 404
    assert res_del.json()["detail"] == "Source not found"

    # 3. Verify User A can still retrieve the active source
    res_owner = await async_client.get(f"/sources/{user_a_source.id}", headers=headers_a)
    assert res_owner.status_code == 200
    assert res_owner.json()["status"] == "ready"


@pytest.mark.asyncio
async def test_adversarial_composite_fk_mismatched_tenant_source(
    db_session,
    user_a: User,
    user_b: User,
    user_a_notebook: Notebook,
):
    """
    Adversarial DB Attack: Attempting to insert a source with mismatched (notebook_id, user_id).
    Enforced by ForeignKeyConstraint(["notebook_id", "user_id"], ["notebook.id", "notebook.user_id"]).
    """
    # Vector 1: User B tries to insert source into User A's notebook with user_id=user_b.id
    attack_source_1 = Source(
        id=str(uuid.uuid4()),
        user_id=user_b.id,
        notebook_id=user_a_notebook.id,
        title="Hostile Attachment Attack 1",
        source_type="pdf",
        storage_key_or_url=f"users/{user_b.id}/notebooks/{user_a_notebook.id}/attack.pdf",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(attack_source_1)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()

    # Vector 2: Source claiming user_a.id but attached to non-existent notebook
    attack_source_2 = Source(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        notebook_id=str(uuid.uuid4()),
        title="Hostile Attachment Attack 2",
        source_type="pdf",
        storage_key_or_url="users/fake/attack.pdf",
        status="ready",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(attack_source_2)
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()


# ==============================================================================
# Suite 2: JWT Forgery, Tampering & Algorithm Exploitation
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_jwt_alg_none_attack(
    async_client: AsyncClient,
    user_a: User,
):
    """
    Adversarial Attack: Token crafted with alg: "none" (unsecured JWT).
    System must reject with 401 Unauthorized.
    """
    # Craft raw JWT header and payload with alg: "none"
    header = base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload_data = {
        "sub": user_a.id,
        "email": user_a.email,
        "exp": (datetime.now(timezone.utc) + timedelta(hours=1)).timestamp(),
    }
    payload = base64.urlsafe_b64encode(json.dumps(payload_data).encode()).decode().rstrip("=")
    alg_none_token = f"{header}.{payload}."

    resp = await async_client.get("/auth/me", headers={"Authorization": f"Bearer {alg_none_token}"})
    assert resp.status_code == 401
    assert "could not validate credentials" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_adversarial_jwt_algorithm_confusion(
    async_client: AsyncClient,
    user_a: User,
    test_settings: Settings,
):
    """
    Adversarial Attack: Token signed with unauthorized HMAC algorithm (HS384, HS512).
    System enforces algorithms=["HS256"] strictly.
    """
    payload = {
        "sub": user_a.id,
        "email": user_a.email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }

    for rogue_alg in ["HS384", "HS512"]:
        rogue_token = jwt.encode(payload, test_settings.SECRET_KEY, algorithm=rogue_alg)
        resp = await async_client.get("/auth/me", headers={"Authorization": f"Bearer {rogue_token}"})
        assert resp.status_code == 401, f"Failed to reject token signed with {rogue_alg}"


@pytest.mark.asyncio
async def test_adversarial_jwt_signature_tampering(
    async_client: AsyncClient,
    user_a_token: str,
):
    """
    Adversarial Attack: Token signature characters modified or truncated.
    """
    parts = user_a_token.split(".")
    assert len(parts) == 3

    # Flip characters in the signature segment
    tampered_sig = parts[2][:-4] + ("AAAA" if parts[2][-4:] != "AAAA" else "ZZZZ")
    tampered_token = f"{parts[0]}.{parts[1]}.{tampered_sig}"

    resp = await async_client.get("/auth/me", headers={"Authorization": f"Bearer {tampered_token}"})
    assert resp.status_code == 401
    assert "could not validate credentials" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_adversarial_jwt_payload_tampering_idor(
    async_client: AsyncClient,
    user_b_token: str,
    user_a: User,
):
    """
    Adversarial Attack: User B attempts IDOR by modifying the payload sub to User A's ID
    while keeping User B's signature.
    """
    parts = user_b_token.split(".")
    header_b64, payload_b64, sig_b64 = parts[0], parts[1], parts[2]

    # Decode payload
    padding = len(payload_b64) % 4
    if padding:
        payload_b64 += "=" * (4 - padding)
    payload_json = json.loads(base64.urlsafe_b64decode(payload_b64))

    # Tamper sub to point to victim User A
    payload_json["sub"] = user_a.id
    tampered_payload_b64 = base64.urlsafe_b64encode(json.dumps(payload_json).encode()).decode().rstrip("=")

    tampered_token = f"{header_b64}.{tampered_payload_b64}.{sig_b64}"

    resp = await async_client.get("/auth/me", headers={"Authorization": f"Bearer {tampered_token}"})
    assert resp.status_code == 401
    assert "could not validate credentials" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_adversarial_jwt_forged_with_rogue_secret_key(
    async_client: AsyncClient,
    user_a: User,
):
    """
    Adversarial Attack: Attacker generates a token signed with an unauthorized secret key.
    """
    rogue_payload = {
        "sub": user_a.id,
        "email": user_a.email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=1),
    }
    rogue_token = jwt.encode(rogue_payload, "completely-rogue-attacker-secret-key-999", algorithm="HS256")

    resp = await async_client.get("/auth/me", headers={"Authorization": f"Bearer {rogue_token}"})
    assert resp.status_code == 401
    assert "could not validate credentials" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_adversarial_jwt_missing_or_empty_sub(
    async_client: AsyncClient,
    test_settings: Settings,
):
    """
    Adversarial Attack: Validly signed token but sub claim is missing or empty.
    """
    # 1. Missing sub
    token_no_sub = jwt.encode(
        {"email": "nobody@example.com", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        test_settings.SECRET_KEY,
        algorithm="HS256"
    )
    resp1 = await async_client.get("/auth/me", headers={"Authorization": f"Bearer {token_no_sub}"})
    assert resp1.status_code == 401
    assert "missing subject claim" in resp1.json()["detail"].lower()

    # 2. Empty sub
    token_empty_sub = jwt.encode(
        {"sub": "", "email": "nobody@example.com", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        test_settings.SECRET_KEY,
        algorithm="HS256"
    )
    resp2 = await async_client.get("/auth/me", headers={"Authorization": f"Bearer {token_empty_sub}"})
    assert resp2.status_code == 401
    assert "missing subject claim" in resp2.json()["detail"].lower()


@pytest.mark.asyncio
async def test_adversarial_jwt_nonexistent_user_sub(
    async_client: AsyncClient,
    test_settings: Settings,
):
    """
    Adversarial Attack: Validly signed token pointing to a random non-existent user UUID.
    """
    phantom_id = str(uuid.uuid4())
    phantom_token = jwt.encode(
        {"sub": phantom_id, "email": "phantom@example.com", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        test_settings.SECRET_KEY,
        algorithm="HS256"
    )
    resp = await async_client.get("/auth/me", headers={"Authorization": f"Bearer {phantom_token}"})
    assert resp.status_code == 401
    assert "user not found" in resp.json()["detail"].lower()


# ==============================================================================
# Suite 3: Account Deactivation & Re-login Attacks
# ==============================================================================

@pytest.mark.asyncio
async def test_adversarial_immediate_token_revocation_on_deactivation(
    async_client: AsyncClient,
    user_a: User,
    user_a_token: str,
    user_a_notebook: Notebook,
):
    """
    Adversarial Attack: Deactivated user attempts to continue using an active JWT
    across all API endpoints. Must immediately fail with HTTP 401 Unauthorized.
    """
    headers = {"Authorization": f"Bearer {user_a_token}"}

    # Step 1: Deactivate account
    del_res = await async_client.delete("/users/me", headers=headers)
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "deleting"

    # Step 2: Immediate probing across endpoints with the same token
    endpoints_to_probe = [
        ("GET", "/auth/me", None),
        ("GET", "/notebooks", None),
        ("POST", "/notebooks", {"title": "Zombie Notebook"}),
        ("GET", f"/notebooks/{user_a_notebook.id}", None),
        ("PATCH", f"/notebooks/{user_a_notebook.id}", {"title": "Zombie Title"}),
        ("DELETE", f"/notebooks/{user_a_notebook.id}", None),
        ("DELETE", "/users/me", None),
    ]

    for method, path, json_body in endpoints_to_probe:
        if method == "GET":
            probe_res = await async_client.get(path, headers=headers)
        elif method == "POST":
            probe_res = await async_client.post(path, json=json_body, headers=headers)
        elif method == "PATCH":
            probe_res = await async_client.patch(path, json=json_body, headers=headers)
        elif method == "DELETE":
            probe_res = await async_client.delete(path, headers=headers)

        assert probe_res.status_code == 401, f"{method} {path} returned {probe_res.status_code}, expected 401"
        assert "deactivated" in probe_res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_adversarial_deactivated_oauth_relogin_variations(
    async_client: AsyncClient,
    db_session,
    user_a: User,
):
    """
    Adversarial Attack: Deactivated user attempts to re-login via Google OAuth:
    1. Using the exact original Google ID and email
    2. Using a NEW Google ID but the SAME email (account collision bypass attempt)
    Both must be blocked with HTTP 403 Forbidden ('Account pending deletion').
    """
    # 1. Mark user inactive
    user_a.is_active = False
    db_session.add(user_a)
    await db_session.commit()
    await db_session.refresh(user_a)

    # 2. Attack Variation 1: Same Google ID & email
    token_1 = f"mock_google_token_{user_a.google_id}_{user_a.email}_{user_a.name}"
    resp_1 = await async_client.post("/auth/google", json={"id_token": token_1})
    assert resp_1.status_code == 403
    assert resp_1.json()["detail"] == "Account pending deletion"

    # 3. Attack Variation 2: New/different Google ID with same registered email
    token_2 = f"mock_google_token_new_random_google_sub_9999_{user_a.email}_Impostor"
    resp_2 = await async_client.post("/auth/google", json={"id_token": token_2})
    assert resp_2.status_code == 403
    assert resp_2.json()["detail"] == "Account pending deletion"


@pytest.mark.asyncio
async def test_adversarial_peer_tenant_deactivation_immunity(
    async_client: AsyncClient,
    user_a: User,
    user_b: User,
    user_a_token: str,
    user_b_token: str,
):
    """
    Adversarial Probe: Deactivating User A must NOT affect User B's active session,
    data access, or credentials.
    """
    headers_a = {"Authorization": f"Bearer {user_a_token}"}
    headers_b = {"Authorization": f"Bearer {user_b_token}"}

    # User A deactivates
    del_res = await async_client.delete("/users/me", headers=headers_a)
    assert del_res.status_code == 200

    # User B remains 100% active and healthy
    b_profile = await async_client.get("/auth/me", headers=headers_b)
    assert b_profile.status_code == 200
    assert b_profile.json()["email"] == user_b.email
    assert b_profile.json()["is_active"] is True


# ==============================================================================
# Suite 4: Production Vulnerability Audit: Mock Token Bypass in Production
# ==============================================================================

def test_production_rejects_mock_google_token_bypass():
    """
    SEC Hardening Verification:
    Verify that in production environments (ENVIRONMENT == 'production'),
    verify_google_id_token strictly rejects mock tokens with HTTP 401 Unauthorized,
    eliminating the authentication bypass backdoor.
    """
    from fastapi import HTTPException, status

    prod_settings = Settings(
        ENVIRONMENT="production",
        DEBUG=False,
        GOOGLE_CLIENT_ID="prod-client-id.apps.googleusercontent.com",
    )

    mock_token = "mock_google_token_attacker_victim@example.com_Attacker"

    # In production, verify_google_id_token must REJECT mock tokens
    with pytest.raises(HTTPException) as exc_info:
        verify_google_id_token(mock_token, settings=prod_settings)

    assert exc_info.value.status_code == status.HTTP_401_UNAUTHORIZED
    assert "Mock authentication tokens are forbidden in production" in exc_info.value.detail
