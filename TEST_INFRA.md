# StudyLM End-to-End (E2E) Test Infrastructure Specification

## 1. Overview & Architectural Principles

The StudyLM E2E test suite provides comprehensive, requirement-driven, opaque-box integration verification across all system components defined in `PROJECT.md`. The suite treats the FastAPI web API and Procrastinate background queue as black boxes, verifying the system strictly through HTTP endpoints, SSE streaming interfaces, database state invariants, and background job queue effects.

### Core Testing Invariants
1. **Opaque-Box Verification**: Tests interact purely via public HTTP endpoints (`httpx.AsyncClient` / `starlette.testclient.TestClient`). Tests assert HTTP response status codes, response headers, JSON payload schemas, and persisted state.
2. **Zero-Flakiness Offline Execution**: All external third-party dependencies (Google OAuth, Cloudflare R2 / Supabase S3, Qdrant Cloud, Gemini API, PostgreSQL network sockets) are mocked or run via high-fidelity in-memory engines (`:memory:` SQLite with `StaticPool`, in-memory Qdrant with 768d vectors, in-memory R2 storage dictionary, and `procrastinate.testing.InMemoryConnector`).
3. **Multi-Tenant Security Enforcement**: Multi-tenant isolation invariants are tested proactively. Cross-tenant access attempts must return HTTP 404 Not Found (anti-enumeration defense per SEC-01/02), never HTTP 403 Forbidden.
4. **Deterministic Reproducibility**: All random generators and embeddings use deterministic seeds (e.g. `np.random.RandomState(42)` generating unit-norm 768-dimensional vectors), eliminating stochastic test failures.
5. **Fast Feedback Loop**: The entire Tier 1–4 test suite executes in under 60 seconds locally without requiring network access, live cloud keys, or Docker containers.

---

## 2. Test Harness & In-Memory Services Topology

| Subsystem | Production Target | E2E Test Implementation | Key Configuration |
| :--- | :--- | :--- | :--- |
| **Web Server** | FastAPI (ASGI / Uvicorn) | `httpx.AsyncClient` with `ASGITransport` | Mounted at root & `/api`, dual slash coverage |
| **Relational DB** | PostgreSQL (Neon) | SQLite `sqlite+aiosqlite:///:memory:` | `StaticPool`, `PRAGMA foreign_keys = ON` |
| **Background Queue** | Procrastinate (PostgreSQL) | Procrastinate `InMemoryConnector` | Zero socket connections, per-source locks |
| **Vector Database** | Qdrant Cloud | `QdrantClient(":memory:")` | 768-dim dense MRL vectors, Cosine distance |
| **Object Storage** | Cloudflare R2 / Supabase S3 | `MockStorageService` | Byte-level dictionary, presigned URLs, HTTP 206 slice |
| **AI / Embeddings** | Gemini 2.5/3.7 & Embeddings | `MockEmbeddingService` / Deterministic L2 | 768-dim L2-normalized floats, deterministic seed |

### Database Lifecycle & Foreign Key Ordering
The SQLite in-memory engine uses `StaticPool` to ensure all concurrent connections in a test share the identical in-memory database. SQLite foreign key enforcement is turned on via `PRAGMA foreign_keys=ON;`. 

Before each test, tables are created via `SQLModel.metadata.create_all`. At test teardown, data is truncated in strict foreign-key dependency order to prevent constraint violations:
1. Break circular FK cycle: `UPDATE "user" SET last_active_notebook_id = NULL;`
2. Delete child leaf tables: `DELETE FROM message; DELETE FROM source;`
3. Delete parent table: `DELETE FROM notebook;`
4. Delete root user table: `DELETE FROM "user";`

---

## 3. The 4-Tier Test Suite Architecture

```
backend/tests/e2e/
├── __init__.py
├── conftest.py                             # E2E fixtures, clients, factories, and harness
├── test_tier1_feature_coverage.py          # Tier 1: Core feature coverage (>=5 tests per area)
├── test_tier2_boundary_corner.py           # Tier 2: Boundary, error codes & quotas (>=5 per area)
├── test_tier3_pairwise_combinations.py     # Tier 3: Cross-feature combinations & race conditions
└── test_tier4_real_world_scenarios.py      # Tier 4: Multi-step real-world user workflows
```

---

## 4. Tier 1: Feature Coverage (Core Areas, >=5 Test Cases Each)

Tier 1 verifies that every functional requirement across the 7 core feature areas operates correctly under standard, nominal conditions.

### Area 1.1: Authentication & Session Management
- **TC-T1-AUTH-01 (Google OAuth Registration)**: `POST /auth/google` with valid Google ID token registers a new user, sets `is_active=True`, returns 200 OK with JWT bearer token and user profile.
- **TC-T1-AUTH-02 (Existing User Login)**: `POST /auth/google` for existing user updates user name/avatar and returns refreshed JWT bearer token.
- **TC-T1-AUTH-03 (Session Profile Fetch)**: `GET /auth/me` with valid JWT returns current user profile matching stored user entity.
- **TC-T1-AUTH-04 (Session Resume State)**: Creating/accessing a notebook updates `last_active_notebook_id` on the user; subsequent `GET /auth/me` reflects the active notebook ID.
- **TC-T1-AUTH-05 (Account Deactivation)**: `DELETE /users/me` marks `user.is_active = False`, transitions user notebooks/sources to `status="deleting"`, and returns `status="deleting"`.

### Area 1.2: Notebook Management & Multi-Tenant Isolation
- **TC-T1-NB-01 (Create Notebook)**: `POST /notebooks` creates notebook with title, status='active', assigned to `current_user.id`, returning 201 Created.
- **TC-T1-NB-02 (List User Notebooks)**: `GET /notebooks` returns list of active notebooks owned by current user ordered by creation date descending.
- **TC-T1-NB-03 (Get Notebook by ID)**: `GET /notebooks/{id}` returns notebook details and updates user's `last_active_notebook_id`.
- **TC-T1-NB-04 (Update Notebook Title)**: `PATCH /notebooks/{id}` updates notebook title and returns updated `NotebookRead`.
- **TC-T1-NB-05 (Delete Notebook)**: `DELETE /notebooks/{id}` marks notebook and child sources as `deleting`, clearing `last_active_notebook_id` if active.
- **TC-T1-NB-06 (Notebook Chat History)**: `POST /notebooks/{id}/messages` and `GET /notebooks/{id}/messages` store and retrieve conversational messages with role and timestamp.

### Area 1.3: YouTube Ingestion
- **TC-T1-YT-01 (YouTube Source Ingestion Route)**: `POST /notebooks/{id}/sources/youtube` returns 201 Created with `SourceRead` (`status="processing"`), enqueuing ingestion task.
- **TC-T1-YT-02 (URL Canonicalization)**: Ingestion accepts short URLs (`youtu.be/xyz`) or standard URLs (`youtube.com/watch?v=xyz`) and stores canonical URL format.
- **TC-T1-YT-03 (Educational Barrier Approval)**: Educational video (e.g. "Linear Algebra Lecture 1") passes 2-tier educational filter.
- **TC-T1-YT-04 (Caption Segmentation & Timestamp Interpolation)**: Worker parses raw transcript, runs `pysbd` sentence segmentation, and calculates interpolated `start_seconds` / `end_seconds`.
- **TC-T1-YT-05 (YouTube Vector Upsert)**: Worker builds ~400-token chunks with `t=X` deep links and deterministic IDs, upserts 768d vectors to Qdrant, and marks source `ready`.

### Area 1.4: PDF Ingestion
- **TC-T1-PDF-01 (PDF Upload Route)**: `POST /notebooks/{id}/sources` with PDF multipart file uploads binary to R2 and returns 201 Created with `status="processing"`.
- **TC-T1-PDF-02 (Bounding Box Normalization)**: PyMuPDF extracts text bounding boxes and normalizes coordinates to $[0.0, 1.0]$ float space.
- **TC-T1-PDF-03 (Multiline Sentence Bounding Boxes)**: Multi-line sentences collect multiple bounding boxes as `List[List[float]]` per sentence.
- **TC-T1-PDF-04 (OCR Fallback on Scanned Page)**: PDF page with <50 characters triggers OCR fallback; Gemini Vision integer bboxes $[0, 1000]$ convert to $[0.0, 1.0]$.
- **TC-T1-PDF-05 (Page-Boundary Isolation & Deterministic IDs)**: Zero page bleeding; sentences crossing page boundaries are split; chunks named `{source_id}_p{page:04d}_c{idx:03d}`.

### Area 1.5: Source Management & Two-Phase Deletion
- **TC-T1-SRC-01 (List Notebook Sources)**: `GET /notebooks/{id}/sources` returns active sources in notebook with HTTP 200 OK.
- **TC-T1-SRC-02 (Get Source Details)**: `GET /sources/{source_id}` returns source metadata, file size, status, and duration.
- **TC-T1-SRC-03 (Two-Phase Source Deletion Phase 1)**: `DELETE /sources/{source_id}` synchronously transitions status to `deleting`, commits, and defers `delete_source_task`.
- **TC-T1-SRC-04 (Binary Stream Proxy)**: `GET /sources/{source_id}/stream` returns binary file with `Accept-Ranges: bytes` and `Content-Type: application/pdf`.
- **TC-T1-SRC-05 (HTTP 206 Partial Content Range)**: `GET /sources/{source_id}/stream` with `Range: bytes=0-511` returns HTTP 206 Partial Content with `Content-Range: bytes 0-511/{total}`.
- **TC-T1-SRC-06 (Presigned Download URL)**: `GET /sources/{source_id}/presigned-url` returns 15-minute presigned download URL.

### Area 1.6: Background Queue & Worker (Procrastinate)
- **TC-T1-WORKER-01 (Task Deferral)**: Calling `defer_ingest_source`, `defer_delete_source`, `defer_cleanup_notebook` enqueues tasks without error.
- **TC-T1-WORKER-02 (PDF Ingestion Task Execution)**: Worker executes `ingest_source_task`, parses PDF, upserts vectors to Qdrant, updates `active_ingest_run_id`, sets status `ready`.
- **TC-T1-WORKER-03 (YouTube Ingestion Task Execution)**: Worker executes `ingest_source_task` for YouTube, interpolates timestamps, upserts vectors, sets status `ready`.
- **TC-T1-WORKER-04 (Source Deletion Task Execution)**: Worker executes `delete_source_task`, purges vectors from Qdrant, deletes R2 object, and deletes SQL row.
- **TC-T1-WORKER-05 (Notebook Sweeper Task Execution)**: Worker executes `cleanup_notebook_task`, cascades through child sources, and deletes notebook SQL row.

### Area 1.7: Query, Citations & Grounding
- **TC-T1-QUERY-01 (Grounded Q&A Query)**: `POST /notebooks/{id}/query` retrieves relevant chunks from Qdrant, reranks with FlashRank, synthesizes answer with authoritative citations.
- **TC-T1-QUERY-02 (Chitchat Intent Bypass)**: Conversational query (e.g. "Hello", "Thanks") routes to chitchat response without triggering ungrounded refusal.
- **TC-T1-QUERY-03 (Multi-Turn Query Rewriting)**: Follow-up question (e.g. "Can you elaborate on that?") rewrites query using conversation history from `Message` table.
- **TC-T1-QUERY-04 (SSE Streaming Query)**: `POST /notebooks/{id}/query/stream` streams Server-Sent Events (`content`, `citation`, `done`) adhering to frontend stream parser.
- **TC-T1-QUERY-05 (Document Summarization)**: `POST /sources/{id}/summarize` generates summary, sets `summary_status="ready"`, and persists summary in source row.

---

## 5. Tier 2: Boundary & Corner Cases (Core Areas, >=5 Test Cases Each)

Tier 2 exercises strict boundary conditions, quota limits, defensive error handling, malformed payloads, and security defenses.

### Area 2.1: Auth & Session Boundary
- **TC-T2-AUTH-01 (Deactivated User 403 Forbidden)**: User with `is_active=False` attempting `POST /auth/google` is blocked with HTTP 403 Forbidden ("Account pending deletion") [SEC-08].
- **TC-T2-AUTH-02 (Expired JWT 401)**: Request with expired JWT token returns HTTP 401 Unauthorized.
- **TC-T2-AUTH-03 (Tampered JWT Signature 401)**: Request with invalid or altered signature returns HTTP 401 Unauthorized.
- **TC-T2-AUTH-04 (Malformed Bearer Header 401)**: Headers missing "Bearer " prefix or containing empty tokens return HTTP 401 Unauthorized.
- **TC-T2-AUTH-05 (Google Token Missing Email 400)**: Google OAuth payload with token lacking email returns HTTP 400 Bad Request.

### Area 2.2: Notebook Management & Multi-Tenant Boundary
- **TC-T2-NB-01 (Cross-Tenant GET 404 Defense)**: User B attempting `GET /notebooks/{user_a_notebook_id}` receives HTTP 404 Not Found (never 403) [SEC-01].
- **TC-T2-NB-02 (Cross-Tenant PATCH 404 Defense)**: User B attempting `PATCH /notebooks/{user_a_notebook_id}` receives HTTP 404 Not Found.
- **TC-T2-NB-03 (Cross-Tenant DELETE 404 Defense)**: User B attempting `DELETE /notebooks/{user_a_notebook_id}` receives HTTP 404 Not Found.
- **TC-T2-NB-04 (Deleting Notebook 404)**: Accessing a notebook with `status="deleting"` via `GET /notebooks/{id}` returns HTTP 404 Not Found.
- **TC-T2-NB-05 (Whitespace / Empty Title Normalization)**: Notebook created with whitespace title trims cleanly or defaults to "Untitled Notebook".

### Area 2.3: YouTube Ingestion Boundary
- **TC-T2-YT-01 (Invalid YouTube URL Format 400)**: `POST /notebooks/{id}/sources/youtube` with malformed URL (e.g. `https://not-youtube.com/watch`) returns HTTP 400 Bad Request.
- **TC-T2-YT-02 (Missing Captions ERR_YT_NO_TRANSCRIPT)**: Video with transcripts disabled transitions source to `status="error"`, `error_code="ERR_YT_NO_TRANSCRIPT"`.
- **TC-T2-YT-03 (Non-Educational Barrier Rejection)**: Video classified as non-educational sets `status="error"`, `error_code="ERR_NON_EDUCATIONAL_CONTENT"`, masks title to `"[Suppressed: Non-Educational Content]"`, summary=None, and writes 0 vectors to Qdrant.
- **TC-T2-YT-04 (Empty Transcript Sentences)**: Video with zero extractable sentences transitions to `status="error"`, `error_code="ERR_YT_NO_TRANSCRIPT"`.
- **TC-T2-YT-05 (YouTube Video ID Extraction Edge Cases)**: Supports various YouTube URL forms (embed links, query param variations, timestamps in URL).

### Area 2.4: PDF Ingestion Boundary
- **TC-T2-PDF-01 (Zero-Byte File Upload 400)**: Uploading an empty 0-byte file returns HTTP 400 Bad Request ("Cannot upload an empty file").
- **TC-T2-PDF-02 (50MB Content-Length Limit 413)**: Request with header `Content-Length: 52428801` returns HTTP 413 Request Entity Too Large immediately without reading body.
- **TC-T2-PDF-03 (50MB Stream Counter Limit 413)**: Stream reader exceeding 50MB dynamically aborts with HTTP 413 Request Entity Too Large.
- **TC-T2-PDF-04 (Corrupted PDF Rejection ERR_CORRUPT_FILE)**: Corrupted PDF bytes transition source to `status="error"`, `error_code="ERR_CORRUPT_FILE"`, and worker remains alive.
- **TC-T2-PDF-05 (Scanned Page Coordinate Clamping)**: Gemini Vision OCR bounding boxes $[0, 1000]$ are clamped strictly within $[0.0, 1.0]$ floats without index out-of-bounds.

### Area 2.5: Source Management & Two-Phase Deletion Boundary
- **TC-T2-SRC-01 (20-Source Quota Lock 400)**: Uploading 21st source to a notebook returns HTTP 400 Bad Request ("Notebook source limit reached (max 20)") [STOR-12].
- **TC-T2-SRC-02 (Upload Rejection on Deleting Notebook 409)**: Uploading a source to a notebook with `status="deleting"` returns HTTP 409 Conflict [STOR-08].
- **TC-T2-SRC-03 (Immediate Post-Delete 404)**: Immediately after `DELETE /sources/{id}` (Phase 1), `GET /sources/{id}` returns HTTP 404 Not Found.
- **TC-T2-SRC-04 (Out-of-Bounds Range Request 416)**: Requesting `Range: bytes=5000-6000` on a 1000-byte file returns HTTP 416 Range Not Satisfiable with `Content-Range: bytes */1000`.
- **TC-T2-SRC-05 (Duplicate Deletion 404)**: Attempting to delete an already deleting source returns HTTP 404 Not Found.

### Area 2.6: Background Queue & Worker Boundary
- **TC-T2-WORKER-01 (Dequeue Abort on Deleting Source)**: Ingestion task dequeued for a source already marked `deleting` cleanly aborts without vector/storage operations [STOR-04].
- **TC-T2-WORKER-02 (Queue Serialization Lock Invariant)**: Tasks for the same source are tagged with `lock=f"source_{source_id}"`, preventing race conditions.
- **TC-T2-WORKER-03 (Transient R2 Error Retry Backoff)**: R2 network error during deletion raises `RetryableR2Error`, preserving `status="deleting"` for Procrastinate retry.
- **TC-T2-WORKER-04 (Mid-Ingest Deletion Conditional Commit)**: Conditional SQL `WHERE status != 'deleting'` catches 0 row update when source is deleted mid-flight, purging newly upserted temporary vectors.
- **TC-T2-WORKER-05 (Sweeper 4-Hour Deadline Backstop)**: Notebook sweeper honors 4-hour safety backstop to prevent runaway execution.

### Area 2.7: Query, Citations & Grounding Boundary
- **TC-T2-QUERY-01 (60 Queries/Hour Rate Limit 429)**: Executing 60 queries succeeds; the 61st query within the hour returns HTTP 429 Too Many Requests ("Rate limit exceeded") [CIT-10].
- **TC-T2-QUERY-02 (Rate Limit Window Reset)**: After window expiration (>3600 seconds), query count resets to 1 and query succeeds.
- **TC-T2-QUERY-03 (Empty Query 400)**: Submitting empty or whitespace query returns HTTP 400 Bad Request ("Query cannot be empty").
- **TC-T2-QUERY-04 (Grounding Refusal Threshold <0.40)**: Query with low relevance score (<0.40) triggers calibrated refusal answer ("I cannot find sufficient evidence...").
- **TC-T2-QUERY-05 (Prompt Injection Delimiter Sanitization)**: Inputs containing `[CHUNK_START`, `[[cite:`, or unescaped quotes are sanitized to prevent context escaping.

---

## 6. Tier 3: Cross-Feature Combinations (Pairwise Interactions)

Tier 3 tests system dynamics where two or more features interact, especially concurrent operations and race conditions:

- **TC-T3-PAIR-01 (Ingestion + Immediate Delete Race)**:
  - Client uploads PDF source.
  - While background worker is processing, client immediately calls `DELETE /sources/{source_id}`.
  - Phase 1 marks `status="deleting"`. Worker conditional update `WHERE status != 'deleting'` returns `rowcount == 0`.
  - Worker detects race, immediately purges any temporary vectors upserted to Qdrant, deletes R2 binary, and removes SQL row.
  - Invariant asserted: 0 leaked vectors in Qdrant, 0 leaked objects in R2, 0 zombie SQL rows.

- **TC-T3-PAIR-02 (Multi-Source Query with Hybrid Citations)**:
  - Notebook contains an active PDF source (page numbers + bounding boxes) and an active YouTube source (timestamps).
  - Grounded query submitted requiring evidence from both sources.
  - Hybrid search retrieves points from both sources; FlashRank reranks candidates.
  - Sentence buffer resolves both citation formats: PDF `[[cite:C1#s0]]` with `bboxes` and YouTube `[[cite:C2#s1]]` with `start_seconds`/deep link `t=X`.
  - Invariant asserted: Citations list contains both source types with valid heterogeneous metadata.

- **TC-T3-PAIR-03 (Account Deletion Cascading Purge)**:
  - User has 2 active notebooks, 3 PDF sources, and 1 YouTube source with vector points in Qdrant and binaries in R2.
  - User calls `DELETE /users/me`.
  - User marked `is_active=False`; all notebooks and sources marked `status="deleting"`.
  - Cascading background tasks execute: all vectors purged from Qdrant, all R2 objects deleted under user's prefix.
  - Subsequent requests with User's JWT return HTTP 401 / HTTP 403.

- **TC-T3-PAIR-04 (Query Streaming Mid-Stream Token Expiration)**:
  - Client initiates SSE stream (`/notebooks/{id}/query/stream`).
  - Midway through streaming tokens, user token expires or account is revoked.
  - Stream pipeline catches unauthorized state, emits `error` event, and terminates stream cleanly without emitting unverified tokens.

- **TC-T3-PAIR-05 (Notebook Deletion Sweeper vs Concurrent Upload)**:
  - User initiates notebook deletion (`DELETE /notebooks/{id}`).
  - Notebook status becomes `deleting`; sweeper task deferred.
  - Concurrent upload arrives (`POST /notebooks/{id}/sources`).
  - Upload is rejected with HTTP 409 Conflict ("Notebook is pending deletion").
  - Sweeper runs to completion without lock contention.

- **TC-T3-PAIR-06 (Blue-Green Ingestion Re-Indexing Continuity)**:
  - Source has active run `run_alpha` with ready status.
  - Re-indexing triggered, generating `run_beta` in background.
  - Concurrent query runs during embedding: retrieval filter uses `active_ingest_run_id == "run_alpha"`, returning valid results without downtime.
  - Once `run_beta` finishes, atomic DB commit sets `active_ingest_run_id = "run_beta"`.
  - Post-commit hook purges `run_alpha` vectors. Subsequent queries retrieve `run_beta` vectors.

---

## 7. Tier 4: Real-World Application Scenarios (End-to-End User Workflows)

Tier 4 tests cohesive multi-step user workflows simulating real students and researchers using StudyLM:

- **TC-T4-E2E-01 (Full Student Study Session Workflow)**:
  1. Student authenticates via Google OAuth (`POST /auth/google`).
  2. Creates notebook "Quantum Mechanics 101" (`POST /notebooks`).
  3. Uploads course syllabus PDF (`POST /notebooks/{id}/sources`).
  4. Ingests video lecture from YouTube (`POST /notebooks/{id}/sources/youtube`).
  5. Background worker processes both sources to `status="ready"`.
  6. Student verifies sources list (`GET /notebooks/{id}/sources`).
  7. Student submits query: "What is the Schrödinger equation and its physical interpretation?"
  8. Verified response contains grounded explanation and citations linking to both PDF and YouTube video timestamps.
  9. Student asks conversational follow-up via SSE stream: "Can you give a practical example?"
  10. Student deletes syllabus PDF; verifies subsequent queries rely only on remaining video source.

- **TC-T4-E2E-02 (Multi-Tenant Academic Lab Isolation Workflow)**:
  1. Alice (Student A) and Bob (Student B) register via OAuth.
  2. Alice creates "Proprietary Lab Findings"; Bob creates "Literature Review".
  3. Alice uploads confidential research PDF; Bob uploads public review PDF.
  4. Both sources ingested to `ready`.
  5. Alice queries her notebook, verifying citations.
  6. Bob attempts to access Alice's notebook (`GET /notebooks/{alice_id}`): receives HTTP 404 Not Found.
  7. Bob attempts to query Alice's notebook: receives HTTP 404 Not Found.
  8. Bob attempts to upload to Alice's notebook: receives HTTP 404 Not Found.
  9. Bob queries his own notebook: verifies zero vector leakage from Alice's confidential documents.
  10. Alice deletes her account (`DELETE /users/me`): Bob's workspace remains fully functional.

- **TC-T4-E2E-03 (Research Session Resume & Document Summarization Workflow)**:
  1. User authenticates and creates notebook.
  2. User uploads 50-page research paper PDF.
  3. User requests token-driven summary (`POST /sources/{id}/summarize`).
  4. User streams PDF pages using HTTP 206 Partial Content range requests (`Range: bytes=0-1024`).
  5. User requests 15-minute presigned download URL (`GET /sources/{id}/presigned-url`).
  6. User simulates browser reload: calls `GET /auth/me` to resume `last_active_notebook_id` and restores message history from `GET /notebooks/{id}/messages`.

- **TC-T4-E2E-04 (Quota Saturation, Boundary Enforcement, and Cleanup Recovery Workflow)**:
  1. User creates notebook.
  2. User uploads 20 PDF sources in sequence, reaching quota limit (`SOURCE_QUOTA=20`).
  3. User attempts 21st PDF upload: rejected with HTTP 400 Bad Request ("Notebook source limit reached").
  4. User attempts YouTube upload: rejected with HTTP 400 Bad Request.
  5. User deletes 2 sources via `DELETE /sources/{id}`.
  6. Worker executes two-phase deletion.
  7. User uploads 2 new sources: both succeed (201 Created).
  8. Invariant asserted: Source count remains strictly within quota $\le 20$.

---

## 8. Test Execution Guide

### Invocation Commands

```powershell
# Run the complete E2E test suite
py -m pytest backend/tests/e2e/ -v

# Run individual tiers
py -m pytest backend/tests/e2e/test_tier1_feature_coverage.py -v
py -m pytest backend/tests/e2e/test_tier2_boundary_corner.py -v
py -m pytest backend/tests/e2e/test_tier3_pairwise_combinations.py -v
py -m pytest backend/tests/e2e/test_tier4_real_world_scenarios.py -v

# Run specific feature area inside Tier 1
py -m pytest backend/tests/e2e/test_tier1_feature_coverage.py -k "youtube" -v

# Run with fail-fast and short traceback
py -m pytest backend/tests/e2e/ -x --tb=short
```

---

## 9. CI/CD Quality Gates & Exit Criteria

Before any release or milestone completion, the test suite must satisfy the following Quality Gate:
1. **100% Pass Rate**: Zero test failures or unexpected errors across all 4 tiers.
2. **Zero Flakiness**: 5 consecutive runs produce identical results with 0 flakiness.
3. **Execution Speed**: Full suite completes in $<60$ seconds in offline test mode.
4. **Coverage Integrity**: Minimum 5 test cases per core feature area in Tier 1 and Tier 2, plus complete coverage of cross-feature races and end-to-end workflows.
5. **Readiness Signal**: The publication of `TEST_READY.md` certifies that the test suite has passed all forensic verification checks.
