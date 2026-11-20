# Project: StudyLM Codebase Audit & Remediation

## Architecture
- **Backend**: FastAPI (`backend/app/main.py`), SQLModel/SQLAlchemy (`backend/app/database.py`, `backend/app/models.py`), Procrastinate background queue (`backend/app/tasks/worker.py`), Neon PostgreSQL, Supabase S3 storage (`studyLM-sources`), Qdrant Cloud vector database (`studylm_chunks`), Google Gemini AI (`gemini-embedding-2`, `gemini-3.5-flash-lite`).
- **Frontend**: Next.js 15.1.0 (`App Router`), React 19, TypeScript 5.7, TailwindCSS 3.4, Zustand 5.0, Vitest 2.1.
- **Data Flow**:
  - File Upload -> S3 Object Storage -> Source (status='processing') in Neon -> Procrastinate queue (`sources`) -> Worker `ingest_source_task` -> Text Extraction & Chunking -> Gemini Embeddings -> Qdrant Upsert -> Source (status='ready').
  - Auth Flow: Google OAuth / Dev Login -> JWT token + User Profile -> `authStore.ts` -> Sidebar / Header avatar rendering.

## Feature Inventory & Issue Catalog
| # | Issue ID | Category | Description | Affected Files | Milestone | Status |
|---|----------|----------|-------------|----------------|-----------|--------|
| 1 | ISSUE-01 | Ingestion Pipeline | Frontend lacks status polling / refetch for sources in 'processing' state | `frontend/src/components/sidebar/SourceList.tsx`, `SourceCard.tsx` | M1 | RESOLVED |
| 2 | ISSUE-02 | Ingestion Pipeline | Backend swallows Procrastinate queue deferral exceptions with no in-process fallback | `backend/app/routers/sources.py` | M1 | RESOLVED |
| 3 | ISSUE-03 | Ingestion Pipeline | Worker task in `main.py` is unsupervised; dies on Neon socket resets | `backend/app/main.py`, `backend/app/tasks/worker.py` | M1 | RESOLVED |
| 4 | ISSUE-04 | Ingestion Pipeline | Tasks transition to 'error' status on first attempt before Procrastinate retries complete | `backend/app/tasks/ingestion_tasks.py` | M1 | RESOLVED |
| 5 | ISSUE-05 | Ingestion Pipeline | Worker crash leaves jobs stranded in 'doing' with NULL worker_id without recovery | `backend/app/tasks/cleanup_tasks.py` | M1 | RESOLVED |
| 6 | ISSUE-06 | Avatar Display | `next.config.ts` omits `images.remotePatterns` for external avatar CDNs | `frontend/next.config.ts` | M2 | RESOLVED |
| 7 | ISSUE-07 | Avatar Display | `LeftSidebar.tsx` uses raw `<img>` without `onError` fallback and missing `referrerPolicy="no-referrer"` | `frontend/src/components/sidebar/LeftSidebar.tsx` | M2 | RESOLVED |
| 8 | ISSUE-08 | Avatar Display | `authStore.ts` does not persist user profile in localStorage; causes hydration race/null user | `frontend/src/stores/authStore.ts` | M2 | RESOLVED |
| 9 | ISSUE-09 | Avatar Display | Dev login and landing page `handleGetStarted` omit avatar URL; dev seed has avatar_url=None | `frontend/src/app/page.tsx`, `backend/app/services/auth_service.py` | M2 | RESOLVED |
| 10 | ISSUE-10 | Avatar Display | Landing page navbar and mobile headers omit user avatar rendering when signed in | `frontend/src/components/landing/LandingNavbar.tsx`, `WorkspaceShell.tsx` | M2 | RESOLVED |
| 11 | ISSUE-11 | Avatar Display | Sidebar collapse (w-12) causes avatar and text visual overflow | `frontend/src/components/sidebar/LeftSidebar.tsx` | M2 | RESOLVED |
| 12 | ISSUE-12 | Contracts & APIs | Assistant message citations dropped by backend `MessageCreate` schema | `backend/app/routers/notebooks.py`, `frontend/src/components/chat/ChatContainer.tsx` | M3 | RESOLVED |
| 13 | ISSUE-13 | Contracts & APIs | 429 rate limit responses omit `Retry-After` header, causing 1-hr frontend lockout | `backend/app/routers/query.py`, `frontend/src/lib/api/client.ts` | M3 | RESOLVED |
| 14 | ISSUE-14 | Contracts & APIs | Image upload accepted but sent to PDF extractor crashing in PyMuPDF | `backend/app/routers/sources.py`, `backend/app/tasks/ingestion_tasks.py` | M3 | RESOLVED |
| 15 | ISSUE-15 | Services & Infra | Unbounded concurrency in Gemini document embedding calls | `backend/app/services/embedding_service.py` | M3 | RESOLVED |
| 16 | ISSUE-16 | Services & Infra | Synchronous blocking calls on event loop for Qdrant and YouTube APIs | `backend/app/services/qdrant_service.py`, `backend/app/services/youtube_service.py` | M3 | RESOLVED |
| 17 | ISSUE-17 | Testing & Scripts | `package.json` missing standard `test` script and `tests/ui` in `test:all` | `frontend/package.json` | M3 | RESOLVED |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Upload Ingestion Pipeline Remediation | Resolve pipeline stall: Frontend active polling in `SourceList.tsx`, backend in-process fallback in `sources.py`, worker supervisor in `main.py`, retry status guard in `ingestion_tasks.py`, stranded job recovery | None | COMPLETE |
| M2 | User Profile Avatar Display Remediation | Resolve missing avatar: `images.remotePatterns` in `next.config.ts`, `LeftSidebar` with `no-referrer` and `onError`, `authStore` user persistence, dev seeds & `page.tsx` default avatar, `LandingNavbar` avatar, collapsed sidebar support | None | COMPLETE |
| M3 | API Contracts, Edge Cases & Infrastructure Hardening | YouTube transcript v1 API compatibility, 429 header handling, Gemini batch embedding, sync blocking cleanup | M1, M2 | COMPLETE |
| M4 | Comprehensive End-to-End & Live Cloud Verification | Full suite verification: `pytest` (100% passed), `vitest` (356/356 passed), `tsc --noEmit` (clean), live 18-page PDF end-to-end ingestion, Qdrant indexing, and grounded citation verification | M1, M2, M3 | COMPLETE |

## Interface Contracts
### Ingestion Status Polling Contract
- Frontend `SourceList.tsx` polls `GET /notebooks/{id}/sources` every 2.0s while any item has `status === 'processing'` or `'deleting'`.
- Backend returns `SourceRead` with `status: 'processing' | 'ready' | 'error'`.
- Backend in `sources.py` triggers in-process `asyncio.create_task` fallback if Procrastinate queue deferral fails.

### User Avatar & Auth Store Contract
- `authStore.ts` persists `user` in `localStorage` under `studylm_user_profile` alongside `studylm_auth_token`.
- `UserAvatar.tsx` renders avatar image with `referrerPolicy="no-referrer"` and falls back to uppercase initial letter if `avatar_url` is missing or fails to load.
- `GET /api/auth/me` returns `avatar_url: string | null`.

### Notebook Message Citations Contract
- `POST /notebooks/{notebook_id}/messages` accepts `MessageCreate`: `{ role: string, content: string, citations?: List[dict] | null }`.
- Backend persists `citations` in Neon `message` table.
- `GET /notebooks/{notebook_id}/messages` returns `citations: List[dict]`.

## Code Layout
- `backend/app/`: FastAPI application
  - `routers/`: API endpoints (`sources.py`, `notebooks.py`, `query.py`, `auth.py`)
  - `tasks/`: Procrastinate background workers & tasks (`worker.py`, `ingestion_tasks.py`, `cleanup_tasks.py`)
  - `services/`: Cloud integrations (`storage_service.py`, `qdrant_service.py`, `embedding_service.py`, `auth_service.py`)
- `frontend/src/`: Next.js application
  - `components/`: UI components (`sidebar/`, `landing/`, `common/`, `chat/`, `viewer/`, `layout/`)
  - `stores/`: Zustand stores (`authStore.ts`, `notebookStore.ts`)
  - `lib/api/`: API client (`client.ts`)
