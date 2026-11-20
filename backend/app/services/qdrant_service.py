"""
Qdrant Vector Database Retrieval and Multi-Tenant Isolation Service.

Enforces strict tenant boundaries at the database query layer:
All queries against Qdrant collections MUST include a filter matching
the current user's ID (`user_id == current_user.id`) and optionally
scoped to active ingest runs (`ingest_run_id in active_run_ids`) and
notebook (`notebook_id == notebook_id`).
"""

from typing import List, Optional, Any
from qdrant_client import QdrantClient
from qdrant_client.http import models

from app.config import get_settings


def get_qdrant_client(url: Optional[str] = None, api_key: Optional[str] = None) -> QdrantClient:
    """
    Initializes and returns a QdrantClient instance using application settings
    or provided overrides.
    """
    settings = get_settings()
    endpoint = url or settings.QDRANT_URL
    key = api_key if api_key is not None else settings.QDRANT_API_KEY
    if endpoint == ":memory:":
        return QdrantClient(":memory:")
    return QdrantClient(url=endpoint, api_key=key, timeout=30.0)


def build_tenant_filter(
    user_id: str,
    active_run_ids: Optional[List[str]] = None,
    notebook_id: Optional[str] = None,
) -> models.Filter:
    """
    Constructs an authentic Qdrant models.Filter enforcing strict tenant isolation.

    Guarantees:
    - `user_id` clause is unconditionally present in the `must` filter.
    - If `active_run_ids` is provided:
        - Non-empty: matches any ingest_run_id in active_run_ids.
        - Empty: matches a non-existent run ID so 0 chunks are retrieved.
    - If `notebook_id` is provided: scopes retrieval to the specified notebook.
    """
    if not user_id:
        raise ValueError("user_id is required to construct a tenant-isolated filter")

    must_conditions: List[models.FieldCondition] = [
        models.FieldCondition(
            key="user_id",
            match=models.MatchValue(value=user_id),
        )
    ]

    if active_run_ids is not None:
        if len(active_run_ids) > 0:
            must_conditions.append(
                models.FieldCondition(
                    key="ingest_run_id",
                    match=models.MatchAny(any=active_run_ids),
                )
            )
        else:
            # Empty active runs means no active chunks should match
            must_conditions.append(
                models.FieldCondition(
                    key="ingest_run_id",
                    match=models.MatchValue(value="__NO_ACTIVE_RUNS__"),
                )
            )

    if notebook_id:
        must_conditions.append(
            models.FieldCondition(
                key="notebook_id",
                match=models.MatchValue(value=notebook_id),
            )
        )

    return models.Filter(must=must_conditions)


def execute_tenant_retrieval(
    client: QdrantClient,
    collection_name: str,
    user_id: str,
    query_vector: Optional[List[float]] = None,
    active_run_ids: Optional[List[str]] = None,
    notebook_id: Optional[str] = None,
    limit: int = 10,
    score_threshold: Optional[float] = None,
) -> List[Any]:
    """
    Executes a vector search or point scroll against Qdrant strictly scoped
    by the tenant filter.

    If `query_vector` is provided:
        Calls `client.search` and returns `List[models.ScoredPoint]`.
    If `query_vector` is None:
        Calls `client.scroll` and returns `List[models.Record]`.
    """
    tenant_filter = build_tenant_filter(
        user_id=user_id,
        active_run_ids=active_run_ids,
        notebook_id=notebook_id,
    )

    if query_vector is not None:
        if hasattr(client, "query_points"):
            response = client.query_points(
                collection_name=collection_name,
                query=query_vector,
                query_filter=tenant_filter,
                limit=limit,
                score_threshold=score_threshold,
                with_payload=True,
            )
            return response.points
        else:
            search_results = client.search(
                collection_name=collection_name,
                query_vector=query_vector,
                query_filter=tenant_filter,
                limit=limit,
                score_threshold=score_threshold,
                with_payload=True,
            )
            return search_results
    else:
        records, _ = client.scroll(
            collection_name=collection_name,
            scroll_filter=tenant_filter,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        return records


def upsert_chunk_points(
    client: QdrantClient,
    collection_name: str,
    points: List[models.PointStruct],
) -> None:
    """
    Upserts document chunk points into the specified Qdrant collection.
    """
    client.upsert(
        collection_name=collection_name,
        points=points,
        wait=True,
    )


def delete_tenant_vectors(
    client: QdrantClient,
    collection_name: str,
    user_id: str,
    notebook_id: Optional[str] = None,
    source_id: Optional[str] = None,
    ingest_run_id: Optional[str] = None,
) -> None:
    """
    Deletes points strictly scoped to a tenant, optionally filtered by notebook,
    source, or ingest_run_id.
    """
    must_conditions = [
        models.FieldCondition(
            key="user_id",
            match=models.MatchValue(value=user_id),
        )
    ]
    if notebook_id:
        must_conditions.append(
            models.FieldCondition(
                key="notebook_id",
                match=models.MatchValue(value=notebook_id),
            )
        )
    if source_id:
        must_conditions.append(
            models.FieldCondition(
                key="source_id",
                match=models.MatchValue(value=source_id),
            )
        )
    if ingest_run_id:
        must_conditions.append(
            models.FieldCondition(
                key="ingest_run_id",
                match=models.MatchValue(value=ingest_run_id),
            )
        )

    delete_filter = models.Filter(must=must_conditions)
    client.delete(
        collection_name=collection_name,
        points_selector=models.FilterSelector(filter=delete_filter),
        wait=True,
    )
