"""
Milestone 1 Adversarial Stress Test Suite
Author: Challenger 2 (challenger_m1_2_retry)

Empirically probes:
1. Account Deletion Cascading Cleanup Deferral:
   - Account deletion with 0 notebooks (clean 200, 0 deferrals, inactive user)
   - Account deletion with multiple notebooks (active vs already deleting; only active deferred)
   - Partial queue broker failure resilience (loop continues despite exception on notebook 1)
   - Double-deletion idempotency (subsequent DELETE -> 401 Unauthorized)
   - Re-login guard for deactivated user (POST /auth/google -> 403 'Account pending deletion')
   - Cross-tenant boundaries (User B cannot delete User A's account, notebooks, or trigger cleanups)
2. Session Resume Citation Integrity Under Corruption:
   - Clean citations & injected chunks (200 OK)
   - Syntax corruption (malformed JSON string) -> graceful fallback to []
   - Null and empty string handling -> graceful fallback
   - Hostile delimiters / XSS / SQLi strings in citation payload -> safe handling
   - Non-list JSON primitives, dict instead of list, list of non-dicts -> empirical failure mode
"""

import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pydantic
import pytest
from httpx import AsyncClient
from sqlmodel import select

from app.models import Message, Notebook, Source, User
from app.routers.notebooks import MessageRead


# ==============================================================================
# Suite 1: Account Deletion Cascading Cleanup Deferral Probes
# ==============================================================================

@pytest.mark.asyncio
async def test_account_deletion_zero_notebooks(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a: User,
    db_session,
):
    """
    Probe 1: Account deletion when user has 0 notebooks.
    Must succeed cleanly (200 OK), mark user is_active=False,
    and invoke defer_cleanup_notebook 0 times without error.
    """
    user_a_id = user_a.id
    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        res = await async_client.delete("/users/me", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["status"] == "deleting"

        # Assert zero calls to defer_cleanup_notebook
        assert mock_defer.call_count == 0

    # User must be inactive in DB
    db_session.expire_all()
    user = (await db_session.execute(select(User).where(User.id == user_a_id))).scalar_one()
    assert user.is_active is False

    # Immediate token revocation
    probe = await async_client.get("/auth/me", headers=auth_headers)
    assert probe.status_code == 401


@pytest.mark.asyncio
async def test_account_deletion_multiple_notebooks_active_and_deleting(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a: User,
    db_session,
):
    """
    Probe 2: Account deletion when user has multiple notebooks:
    - nb_active_1: active
    - nb_active_2: active
    - nb_already_deleting: status='deleting'
    Must defer cleanup ONLY for active notebooks (nb_active_1, nb_active_2),
    and NOT re-defer for the notebook already in 'deleting' state.
    """
    user_a_id = user_a.id
    nb_active_1 = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a_id,
        title="Active 1",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    nb_active_2 = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a_id,
        title="Active 2",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    nb_already_deleting = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a_id,
        title="Already Deleting",
        status="deleting",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([nb_active_1, nb_active_2, nb_already_deleting])
    await db_session.commit()

    nb_1_id = nb_active_1.id
    nb_2_id = nb_active_2.id
    nb_del_id = nb_already_deleting.id

    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        res = await async_client.delete("/users/me", headers=auth_headers)
        assert res.status_code == 200

        deferred_ids = [
            call.kwargs.get("notebook_id") or call.args[0]
            for call in mock_defer.call_args_list
        ]
        assert len(deferred_ids) == 2
        assert nb_1_id in deferred_ids
        assert nb_2_id in deferred_ids
        assert nb_del_id not in deferred_ids, "Should NOT re-defer already deleting notebook"

    db_session.expire_all()
    all_nbs = (await db_session.execute(select(Notebook).where(Notebook.user_id == user_a_id))).scalars().all()
    assert all(nb.status == "deleting" for nb in all_nbs)


@pytest.mark.asyncio
async def test_account_deletion_queue_deferral_partial_failure_resilience(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a: User,
    db_session,
):
    """
    Probe 3: If defer_cleanup_notebook fails with an exception on the first notebook,
    the loop must catch the exception and proceed to defer cleanup for the remaining notebooks.
    """
    nb1 = Notebook(
        id="nb-fail-1",
        user_id=user_a.id,
        title="Notebook 1",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    nb2 = Notebook(
        id="nb-succeed-2",
        user_id=user_a.id,
        title="Notebook 2",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([nb1, nb2])
    await db_session.commit()

    side_effects = [RuntimeError("Queue broker network partition"), None]

    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        mock_defer.side_effect = side_effects

        res = await async_client.delete("/users/me", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["status"] == "deleting"

        # Both notebooks were attempted despite the first one raising an error
        assert mock_defer.call_count == 2
        called_ids = [
            call.kwargs.get("notebook_id") or call.args[0]
            for call in mock_defer.call_args_list
        ]
        assert "nb-fail-1" in called_ids
        assert "nb-succeed-2" in called_ids


@pytest.mark.asyncio
async def test_account_deletion_double_delete_and_relogin_guard(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a: User,
    db_session,
):
    """
    Probe 4: Double deletion idempotency & deactivation guard:
    - 1st DELETE /users/me -> 200 OK.
    - 2nd DELETE /users/me with same token -> 401 Unauthorized (deactivated).
    - POST /auth/google with deactivated user -> 403 Forbidden ('Account pending deletion').
    """
    # First deletion
    res1 = await async_client.delete("/users/me", headers=auth_headers)
    assert res1.status_code == 200

    # Second deletion attempt with same token
    res2 = await async_client.delete("/users/me", headers=auth_headers)
    assert res2.status_code == 401
    assert "deactivated" in res2.json()["detail"].lower()

    # Re-login attempt via Google OAuth
    mock_token = f"mock_google_token_{user_a.google_id}_{user_a.email}_{user_a.name}"
    res_relogin = await async_client.post("/auth/google", json={"id_token": mock_token})
    assert res_relogin.status_code == 403
    assert res_relogin.json()["detail"] == "Account pending deletion"


@pytest.mark.asyncio
async def test_cross_tenant_account_deletion_boundaries(
    async_client: AsyncClient,
    auth_headers_b: dict,
    user_a: User,
    user_b: User,
    db_session,
):
    """
    Probe 5: User B deletes their account.
    Verify User A is completely isolated:
    - User A remains active.
    - User A's notebooks remain active and no deferral tasks are queued for them.
    - User B cannot delete User A's notebook (returns 404, no deferral).
    """
    user_a_id = user_a.id
    user_b_id = user_b.id
    nb_a = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a_id,
        title="User A Notebook",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    nb_b = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_b_id,
        title="User B Notebook",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add_all([nb_a, nb_b])
    await db_session.commit()

    nb_a_id = nb_a.id
    nb_b_id = nb_b.id

    with patch("app.tasks.cleanup_tasks.defer_cleanup_notebook", new_callable=AsyncMock) as mock_defer:
        # User B attempts to delete User A's notebook directly
        res_del_cross = await async_client.delete(f"/notebooks/{nb_a_id}", headers=auth_headers_b)
        assert res_del_cross.status_code == 404
        assert mock_defer.call_count == 0

        # User B deletes their own account
        res_del_b = await async_client.delete("/users/me", headers=auth_headers_b)
        assert res_del_b.status_code == 200

        # Only User B's notebook was deferred
        assert mock_defer.call_count == 1
        deferred_id = mock_defer.call_args.kwargs.get("notebook_id") or mock_defer.call_args.args[0]
        assert deferred_id == nb_b_id

    # Verify User A database state is completely intact
    db_session.expire_all()
    user_a_db = (await db_session.execute(select(User).where(User.id == user_a_id))).scalar_one()
    assert user_a_db.is_active is True

    nb_a_db = (await db_session.execute(select(Notebook).where(Notebook.id == nb_a_id))).scalar_one()
    assert nb_a_db.status == "active"


# ==============================================================================
# Suite 2: Session Resume Citation Integrity Under Corruption
# ==============================================================================

@pytest.mark.asyncio
async def test_session_resume_citation_clean_and_malformed_syntax(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a: User,
    db_session,
):
    """
    Probe 6: Verifies that clean citations, syntax-corrupted JSON strings,
    empty strings, and null citations are handled gracefully without crashing.
    """
    nb = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Session Resume Syntax Test NB",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(nb)
    await db_session.commit()

    # Message 1: Clean valid citations
    msg_clean = Message(
        id=str(uuid.uuid4()),
        notebook_id=nb.id,
        role="assistant",
        content="Clean message",
        citations_json=json.dumps([{"chunk_id": "c1", "quote": "Valid citation"}]),
        injected_chunk_ids_json=json.dumps(["c1"]),
        created_at=datetime.now(timezone.utc),
    )
    # Message 2: Malformed JSON syntax (unparseable)
    msg_syntax_corrupt = Message(
        id=str(uuid.uuid4()),
        notebook_id=nb.id,
        role="assistant",
        content="Syntax corrupt message",
        citations_json="{invalid: json, not quote",
        injected_chunk_ids_json="{bad json",
        created_at=datetime.now(timezone.utc),
    )
    # Message 3: None / NULL in DB
    msg_null = Message(
        id=str(uuid.uuid4()),
        notebook_id=nb.id,
        role="user",
        content="Null message",
        citations_json=None,
        injected_chunk_ids_json=None,
        created_at=datetime.now(timezone.utc),
    )
    # Message 4: Empty strings in DB
    msg_empty = Message(
        id=str(uuid.uuid4()),
        notebook_id=nb.id,
        role="user",
        content="Empty string message",
        citations_json="",
        injected_chunk_ids_json="",
        created_at=datetime.now(timezone.utc),
    )
    # Message 5: Adversarial injection (XSS/SQLi in citation strings)
    msg_xss = Message(
        id=str(uuid.uuid4()),
        notebook_id=nb.id,
        role="assistant",
        content="XSS message",
        citations_json=json.dumps([{"source_id": "<script>alert('xss')</script>", "quote": "'; DROP TABLE message; --"}]),
        injected_chunk_ids_json=json.dumps(["safe_chunk"]),
        created_at=datetime.now(timezone.utc),
    )

    db_session.add_all([msg_clean, msg_syntax_corrupt, msg_null, msg_empty, msg_xss])
    await db_session.commit()

    res = await async_client.get(f"/notebooks/{nb.id}/messages", headers=auth_headers)
    assert res.status_code == 200
    msgs = res.json()
    assert len(msgs) == 5

    # Check clean
    assert msgs[0]["citations"] == [{"chunk_id": "c1", "quote": "Valid citation"}]
    assert msgs[0]["injected_chunk_ids"] == ["c1"]

    # Check syntax corrupted: degraded gracefully to []
    assert msgs[1]["citations"] == []
    assert msgs[1]["injected_chunk_ids"] == []

    # Check null
    assert msgs[2]["citations"] == []
    assert msgs[2]["injected_chunk_ids"] == []

    # Check empty string
    assert msgs[3]["citations"] == []
    assert msgs[3]["injected_chunk_ids"] == []

    # Check XSS / SQLi payload preserved safely as strings without corruption
    assert msgs[4]["citations"][0]["source_id"] == "<script>alert('xss')</script>"
    assert msgs[4]["citations"][0]["quote"] == "'; DROP TABLE message; --"


@pytest.mark.asyncio
async def test_session_resume_citation_type_corruption_vulnerability(
    async_client: AsyncClient,
    auth_headers: dict,
    user_a: User,
    db_session,
):
    """
    Probe 7 (CRITICAL CHALLENGE - Hardened Resilience Verification):
    Examines behavior when citations_json or injected_chunk_ids_json contain
    valid JSON that does not match expected schema types:
    - citations_json contains integer '123'
    - citations_json contains string '"raw string"'
    - citations_json contains dict '{"key": "val"}' instead of List[dict]
    - citations_json contains list of ints '[1, 2, 3]' instead of List[dict]
    - injected_chunk_ids_json contains list of ints '[100, 200]' instead of List[str]

    Verifies that hardened Message property getters, Pydantic pre-validators,
    and router boundary sanitizers ensure graceful fallback (empty list or stringified IDs)
    and that GET /notebooks/{id}/messages returns HTTP 200 OK without crashing.
    """
    nb = Notebook(
        id=str(uuid.uuid4()),
        user_id=user_a.id,
        title="Session Resume Type Corruption NB",
        status="active",
        created_at=datetime.now(timezone.utc),
    )
    db_session.add(nb)
    await db_session.commit()

    type_corruption_cases = [
        ("integer_citation", "123", json.dumps(["valid_chunk"])),
        ("string_citation", '"raw_string_not_list"', json.dumps(["valid_chunk"])),
        ("dict_not_list_citation", '{"chunk_id": "c1"}', json.dumps(["valid_chunk"])),
        ("list_of_ints_citation", '[1, 2, 3]', json.dumps(["valid_chunk"])),
        ("list_of_ints_chunks", json.dumps([{"c": 1}]), '[100, 200]'),
    ]

    for label, cit_val, chunk_val in type_corruption_cases:
        msg = Message(
            id=str(uuid.uuid4()),
            notebook_id=nb.id,
            role="assistant",
            content=f"Corrupted type message: {label}",
            citations_json=cit_val,
            injected_chunk_ids_json=chunk_val,
            created_at=datetime.now(timezone.utc),
        )
        db_session.add(msg)
        await db_session.commit()

        # Probing the property getters confirms they return sanitized, contract-compliant types:
        if label in ("integer_citation", "string_citation", "dict_not_list_citation", "list_of_ints_citation"):
            assert msg.citations == [], f"Expected clean empty list for {label}, got {msg.citations}"
        elif label == "list_of_ints_chunks":
            assert msg.citations == [{"c": 1}]
            assert msg.injected_chunk_ids == ["100", "200"], f"Expected stringified chunk IDs, got {msg.injected_chunk_ids}"

        # Instantiating MessageRead with these properties succeeds cleanly without ValidationError:
        read_msg = MessageRead(
            id=msg.id,
            notebook_id=msg.notebook_id,
            role=msg.role,
            content=msg.content,
            created_at=msg.created_at,
            citations=msg.citations,
            injected_chunk_ids=msg.injected_chunk_ids,
        )
        assert isinstance(read_msg.citations, list)
        assert isinstance(read_msg.injected_chunk_ids, list)

        # In the API endpoint, conversation history retrieval returns HTTP 200 OK without crashing:
        res = await async_client.get(f"/notebooks/{nb.id}/messages", headers=auth_headers)
        assert res.status_code == 200, f"Expected 200 OK, got {res.status_code}: {res.text}"
        data = res.json()
        assert len(data) >= 1

        # Cleanup for next iteration
        await db_session.delete(msg)
        await db_session.commit()
