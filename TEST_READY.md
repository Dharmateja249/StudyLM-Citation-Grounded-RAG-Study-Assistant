# E2E Test Suite Ready

## Test Runner
- Command: `cd backend; py -m pytest tests/e2e/ -v`
- Offline / Regression Suite: `cd backend; py -m pytest tests/e2e/ -m "not live"`
- Expected: all 82 tests pass with exit code 0 (execution duration: ~20-25 seconds)

## Coverage Summary
| Tier | Count | Description |
|------|------:|-------------|
| 1. Feature Coverage | 37 | $\ge 5$ tests per area across 7 core functional areas |
| 2. Boundary & Corner Cases | 35 | $\ge 5$ tests per area across 7 boundary/quota areas |
| 3. Cross-Feature Combinations | 6 | Pairwise interactions, race conditions, and clean teardowns |
| 4. Real-World Application Scenarios | 4 | Complete multi-step student & researcher workflows |
| **Total** | **82** | 100% passing across all 4 tiers with zero flakiness |

## Feature Checklist
| Core Feature Area | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Status |
|-------------------|:------:|:------:|:------:|:------:|:------:|
| 1. Auth & Session Management (OAuth, Profile, Deactivation) | 5 | 5 | ✓ | ✓ | READY |
| 2. Notebook Management & Multi-Tenant Isolation (404 Defense) | 6 | 5 | ✓ | ✓ | READY |
| 3. YouTube Ingestion (201 Route, Captions, Educational Barrier) | 5 | 5 | ✓ | ✓ | READY |
| 4. PDF Ingestion (Upload, Bboxes, OCR Fallback, Page Isolation) | 5 | 5 | ✓ | ✓ | READY |
| 5. Source Management & Deletion (Listing, Stream, Range 206, Presigned) | 6 | 5 | ✓ | ✓ | READY |
| 6. Background Queue & Worker (Deferrals, Ingest, Delete, Sweeper) | 5 | 5 | ✓ | ✓ | READY |
| 7. Query, Citations & Grounding (Hybrid RRF, SSE Stream, Rate Limit) | 5 | 5 | ✓ | ✓ | READY |

## Invariant Verification Summary
- **Anti-Enumeration Defense (SEC-01/02)**: Verified. Cross-tenant access and access to deleting resources strictly return HTTP 404 Not Found (never 403).
- **Quota Bounds**: Verified. 20-source limit (HTTP 400), 50MB payload headers & dynamic stream limits (HTTP 413), and 60 queries/hr rate limiting (HTTP 429) verified with tumbling window reset.
- **Race Condition Safety**: Verified. Immediate deletion during ingestion triggers conditional SQL rollback, purging temporary vectors and storage binaries with 0 leaks.
- **Multi-Tenant State Isolation**: Verified. Zero semantic vector leakage across tenant boundaries in shared Qdrant collections.

## Test Artifacts Directory
- Infrastructure Spec: `TEST_INFRA.md` (project root)
- Harness & Fixtures: `backend/tests/e2e/conftest.py`
- Tier 1 Suite: `backend/tests/e2e/test_tier1_feature_coverage.py`
- Tier 2 Suite: `backend/tests/e2e/test_tier2_boundary_corner.py`
- Tier 3 Suite: `backend/tests/e2e/test_tier3_pairwise_combinations.py`
- Tier 4 Suite: `backend/tests/e2e/test_tier4_real_world_scenarios.py`
