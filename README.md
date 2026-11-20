# 🎓 StudyLM: Multimodal, Citation-Grounded RAG Study Assistant

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg?style=flat&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-15.1.0-black.svg?style=flat&logo=next.js&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.0-61DAFB.svg?style=flat&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-3.12+-3776AB.svg?style=flat&logo=python&logoColor=white)](https://www.python.org)
[![Neon](https://img.shields.io/badge/Neon-PostgreSQL-00E599.svg?style=flat&logo=postgresql&logoColor=white)](https://neon.tech)
[![Qdrant](https://img.shields.io/badge/Qdrant-Cloud_Vector_DB-DC382D.svg?style=flat&logo=qdrant&logoColor=white)](https://qdrant.tech)
[![Google Gemini](https://img.shields.io/badge/Google_Gemini-gemini--3.5--flash-8E75C2.svg?style=flat&logo=google&logoColor=white)](https://ai.google.dev)
[![Tests](https://img.shields.io/badge/Tests-100%25_Passing_(280+_tests)-brightgreen.svg?style=flat&logo=pytest&logoColor=white)](https://docs.pytest.org)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat)](LICENSE)

> **StudyLM** answers complex academic questions directly from your lecture PDFs, lecture slides, research notes, and YouTube lectures. Every claim is strictly backed by an authoritative sentence-level citation that is verified by the backend, streamed in real time via Server-Sent Events (SSE), and highlighted interactively inside the split-pane source viewer.

---

## 📑 Table of Contents

- [Key Highlights](#-key-highlights)
- [Architecture & Data Flow](#-architecture--data-flow)
- [Core Features](#-core-features)
  - [1. Authoritative Citation Grounding & Anti-Hallucination](#1-authoritative-citation-grounding--anti-hallucination)
  - [2. Multimodal Source Ingestion & Processing](#2-multimodal-source-ingestion--processing)
  - [3. Two-Tier Educational Content Barrier](#3-two-tier-educational-content-barrier)
  - [4. Real-time SSE Streaming & Sentence Buffering](#4-real-time-sse-streaming--sentence-buffering)
  - [5. Resilient Distributed Background Queue](#5-resilient-distributed-background-queue)
  - [6. Strict Multi-Tenant Isolation & Anti-Abuse](#6-strict-multi-tenant-isolation--anti-abuse)
- [Repository Structure](#-repository-structure)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Clone Repository](#1-clone-repository)
  - [2. Environment Configuration](#2-environment-configuration)
  - [3. Backend Setup](#3-backend-setup)
  - [4. Frontend Setup](#4-frontend-setup)
- [Interactive Workflows](#-interactive-workflows)
- [API Reference](#-api-reference)
- [Testing & Quality Assurance](#-testing--quality-assurance)
- [Security & Compliance](#-security--compliance)
- [License](#-license)

---

## 🌟 Key Highlights

- **Sentence-Level Grounded Citations**: Claims map directly to `[[cite:C1#s0]]` tokens. Clicking citation pills (`[1]`) jumps to the exact PDF page, draws an overlay bounding box over the source sentence, or seeks the embedded YouTube video to the exact timestamp.
- **Strict Anti-Hallucination Guard**: Employs hybrid dense retrieval (Gemini 768d embeddings in Qdrant) combined with BM25 and FlashRank cross-encoder reranking. Queries below confidence thresholds trigger calibrated factual refusals instead of inventing answers.
- **Two-Tier YouTube Content Moderation Barrier**: Prevents non-educational video pollution (music videos, gaming, entertainment vlogs) using title/tag heuristics backed by fast zero-shot Gemini LLM validation. Rejected videos suppress metadata, transcripts, and embeddings.
- **Zero-Downtime Blue-Green Ingestion**: Re-indexing sources creates isolated versioned vectors (`ingest_run_id`). Queries swap atomically upon completion, purging previous vectors without downtime.
- **Crash-Safe Queue Recovery**: Powered by Procrastinate on Neon PostgreSQL (`LISTEN/NOTIFY`). Recovers stranded tasks, handles worker crashes (`kill -9`), and prevents orphaned cloud storage objects via atomic rollbacks.

---

## 🏗 Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Client ["Frontend (Next.js 15 + React 19 + Tailwind)"]
        UI["Workspace Shell & Responsive Layout"]
        Viewer["Split-Pane Viewer (PDF Canvas + YouTube Seek Player)"]
        Chat["Streaming Chat & Citation Pills"]
        Store["Zustand Stores (Workspace & Auth)"]
    end

    subgraph Gateway ["API & Application Layer (FastAPI)"]
        AuthRouter["Auth & OAuth Router"]
        NBRouter["Notebooks & Messages Router"]
        SourcesRouter["Sources & Uploads Router (50MB Guard)"]
        QueryRouter["Query & Retrieval Router (Rate-Limiter: 60/hr)"]
        StreamBuffer["Streaming Sentence Buffer (Anti-Hallucination Filter)"]
    end

    subgraph Pipeline ["Processing & Vector Services"]
        Worker["Procrastinate Task Worker (Neon LISTEN/NOTIFY)"]
        PyMuPDF["PyMuPDF Coordinate Extractor + Gemini Vision OCR"]
        YTService["YouTube Transcript Ingestion & Timestamp Interpolation"]
        ModService["Two-Tier Educational Content Barrier"]
        Rerank["FlashRank Cross-Encoder & BM25 Hybrid Ranker"]
    end

    subgraph Cloud ["External Cloud Infrastructure"]
        NeonDB[("Neon Serverless PostgreSQL (Tables + Queue)")]
        Qdrant[("Qdrant Cloud (768d Cosine Vector Collection)")]
        Gemini[("Google Gemini API (gemini-embedding-2 / gemini-3.5-flash)")]
        S3[("Cloudflare R2 / S3 Object Storage (PDF Binaries)")]
    end

    UI --> Gateway
    Chat -- "POST /query/stream (SSE)" --> QueryRouter
    SourcesRouter -- "Upload / YouTube Import" --> Worker
    Worker --> PyMuPDF
    Worker --> YTService
    YTService --> ModService
    PyMuPDF --> Gemini
    Worker --> Qdrant
    Worker --> NeonDB
    SourcesRouter --> S3
    QueryRouter --> Qdrant
    QueryRouter --> Rerank
    QueryRouter --> Gemini
    QueryRouter --> StreamBuffer
    StreamBuffer -- "text/event-stream" --> Chat
    Chat -- "Click Citation [1]" --> Viewer
```

---

## 🚀 Core Features

### 1. Authoritative Citation Grounding & Anti-Hallucination
- **True Payload Grounding (`CIT-01`, `CIT-02`, `CIT-03`)**: Inline citation tokens are parsed deterministically against verified Qdrant payload truth. Any hallucinated citation marker is stripped before emitting tokens.
- **Calibrated Refusal (`CIT-04`)**: If retrieval similarity fails to satisfy relevance thresholds, the model politely refuses to guess:
  > *"I cannot find sufficient evidence in your uploaded sources to answer this question."*
- **Multimodal Visual Deep Linking**:
  - **PDF Documents**: Resolves page index and normalized bounding boxes `[ymin, xmin, ymax, xmax]` $\to$ `[x0, y0, x1, y1]`, rendering a highlight rectangle on canvas.
  - **YouTube Lectures**: Resolves start/end second offsets, automatically seeking the YouTube IFrame player to the exact second.

### 2. Multimodal Source Ingestion & Processing
- **High-Speed PDF Ingestion (`ING-01`..`ING-05`)**: Extracts page text, structural hierarchy, and word-level coordinates with PyMuPDF. Scanned or low-text pages seamlessly trigger Gemini Vision OCR fallback.
- **YouTube Timestamp Interpolation (`ING-06`)**: Captures caption segments from `youtube-transcript-api` and performs sentence-level linear interpolation for timestamp deep links (`https://youtube.com/watch?v=...&t=Xs`).
- **Blue-Green Reindexing (`ING-10`, `ING-11`)**: Ingest runs receive unique UUIDs (`ingest_run_id`). Points are upserted into Qdrant in isolation; the database switches the active pointer atomically on success.

### 3. Two-Tier Educational Content Barrier
- **Tier 1 (Heuristic Signals)**: Video title, description, and tags are analyzed against academic anchor keywords vs negative entertainment/music/vlog signals.
- **Tier 2 (Fast Gemini Classifier)**: Ambiguous content is routed to a structured zero-shot Gemini classifier prompt.
- **Privacy Shielding**: Non-educational submissions are immediately aborted (`ERR_NON_EDUCATIONAL_CONTENT`), suppressing title, transcript, and vector generation, while presenting an informative user banner in the UI.

### 4. Real-time SSE Streaming & Sentence Buffering
- **Sentence Buffer (`CIT-11`)**: Incoming tokens are buffered until a terminal punctuation delimiter (`.`, `!`, `?`, `\n`) is reached.
- **Marker Validation**: Resolves all citation markers in the completed sentence before emitting `event: content`. Prevents broken or incomplete citation brackets from escaping to the client.
- **Full SSE Lifecycle**: Emits structured packets: `token`, `content`, `citation`, `refusal`, `done`, and `error`.

### 5. Resilient Distributed Background Queue
- **Durable Tasks via Neon Postgres (`STOR-03`, `STOR-04`, `STOR-05`)**: Asynchronous ingestion jobs defer to Procrastinate queues with worker locks (`source_{source_id}`).
- **Orphan Prevention (`STOR-10`)**: Database commit errors immediately trigger compensating rollback deletions against S3/R2 object storage.
- **Cascading Deletion Race Defense (`STOR-08`)**: Ongoing ingestion tasks check source dequeue state; if a user initiates a notebook deletion mid-flight, the ingestion immediately terminates and cleans up points.

### 6. Strict Multi-Tenant Isolation & Anti-Abuse
- **Multi-Tenant Filter Enforcement (`SEC-06`)**: Every Qdrant retrieval query enforces hard boolean payload filters matching `user_id`, `notebook_id`, and `active_ingest_run_id`.
- **Anti-Enumeration 404 (`SEC-02`, `STOR-02`)**: Inaccessible or deleting entities return generic 404s to prevent tenant ID snooping.
- **Strict Quota & Rate Limits**:
  - **Payload Size**: 50 MB maximum per file upload (`HTTP 413`).
  - **Notebook Quotas**: 20 active sources maximum per notebook under `SELECT ... FOR UPDATE` row locks (`HTTP 400`).
  - **Chat Rate Limiting**: 60 queries/hour tumbling window per user with automatic `Retry-After` headers (`HTTP 429`).

---

## 📂 Repository Structure

```
studylm/
├── .env.example                     # Environment template with all required keys
├── .gitignore                       # Root gitignore (secrets, caches, local dbs)
├── PROJECT.md                       # Architectural specification & remediation roadmap
├── QUICKSTART.md                    # Operational guide & manual test walkthrough
├── backend/
│   ├── .gitignore                   # Python & FastAPI specific gitignore
│   ├── run.py                       # Dedicated Windows-compatible async runner
│   ├── pyproject.toml               # Poetry/pip build configuration
│   ├── requirements.txt             # Locked Python dependencies
│   ├── app/
│   │   ├── main.py                  # FastAPI application entrypoint & lifespan hooks
│   │   ├── config.py                # Pydantic Settings & environment prioritization
│   │   ├── database.py              # Async SQLAlchemy / Neon pooled & unpooled engines
│   │   ├── models.py                # SQLModel database tables & Pydantic API schemas
│   │   ├── routers/
│   │   │   ├── auth.py              # Google OAuth 2.0 & user profile management
│   │   │   ├── notebooks.py         # Notebook CRUD & message history
│   │   │   ├── sources.py           # Multi-part upload, YouTube import & streaming proxy
│   │   │   └── query.py             # Grounded query & SSE real-time streaming endpoint
│   │   ├── services/
│   │   │   ├── auth_service.py      # JWT token issuance & Google token verification
│   │   │   ├── storage_service.py   # Cloudflare R2 / S3 object upload & presigned URLs
│   │   │   ├── qdrant_service.py    # Vector indexing, index creation & tenant retrieval
│   │   │   ├── embedding_service.py # Gemini embedding service with dimension normalization
│   │   │   ├── citation_service.py  # Authoritative citation resolver & sentence buffer
│   │   │   ├── rerank_service.py    # FlashRank cross-encoder & hybrid reranking
│   │   │   ├── youtube_service.py   # Transcript extraction & deep link generator
│   │   │   ├── moderation_service.py# Two-tier educational relevance barrier
│   │   │   └── summary_service.py   # Token-driven full-context vs outline summarizer
│   │   └── tasks/
│   │       ├── worker.py            # Procrastinate worker runner on unpooled connection
│   │       ├── ingestion_tasks.py   # Blue-green ingestion & PDF/YouTube pipelines
│   │       └── cleanup_tasks.py     # Cascading soft/hard deletion & sweeper reaper
│   └── tests/                       # Comprehensive pytest suite (unit, e2e, adversarial)
└── frontend/
    ├── .gitignore                   # Next.js & TypeScript specific gitignore
    ├── next.config.ts               # Next.js configuration & backend API rewrites
    ├── package.json                 # Frontend dependencies and test scripts
    ├── tsconfig.json                # TypeScript compiler configuration
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx           # Root HTML layout & fonts
    │   │   └── page.tsx             # Main application shell with dynamic view switcher
    │   ├── components/
    │   │   ├── auth/                # Sign-in & onboarding modals
    │   │   ├── chat/                # Chat container, message list, citation chips, rate limiter
    │   │   ├── landing/             # Marketing landing page, features grid, FAQ
    │   │   ├── layout/              # Responsive split-pane workspace & mobile navigation
    │   │   ├── sidebar/             # Notebooks, source lists, PDF dropzone, YouTube modal
    │   │   └── viewer/              # PDF canvas renderer with highlights & YouTube player
    │   ├── lib/api/
    │   │   ├── client.ts            # Typed HTTP API client with auth interceptors
    │   │   └── sseStream.ts         # Incremental SSE stream reader & chunk parser
    │   ├── stores/
    │   │   ├── authStore.ts         # User session & local storage persistence
    │   │   └── workspaceStore.ts    # Active notebook, active source, split pane state
    │   └── types/                   # TypeScript interfaces & Zod validation schemas
    └── tests/                       # Vitest suites across Phase 1 to Phase 5
```

---

## 🛠 Tech Stack

| Domain | Technologies |
| :--- | :--- |
| **Frontend** | [Next.js 15.1](https://nextjs.org) (App Router), [React 19](https://react.dev), [TypeScript 5.7](https://www.typescriptlang.org), [TailwindCSS 3.4](https://tailwindcss.com), [Zustand 5.0](https://github.com/pmndrs/zustand), [Lucide React](https://lucide.dev) |
| **Backend** | [FastAPI](https://fastapi.tiangolo.com), [Pydantic v2](https://docs.pydantic.dev), [SQLModel](https://sqlmodel.tiangolo.com) / [SQLAlchemy 2.0](https://www.sqlalchemy.org), [Psycopg 3](https://www.psycopg.org) (Async), [Procrastinate](https://procrastinate.readthedocs.io) |
| **AI & Search** | [Google Gemini](https://ai.google.dev) (`gemini-embedding-2`, `gemini-3.5-flash`), [Qdrant Cloud](https://qdrant.tech), [FlashRank](https://github.com/PrithivirajDamodaran/FlashRank), [PyMuPDF](https://pymupdf.readthedocs.io) (Fitz) |
| **Storage & Database** | [Neon PostgreSQL](https://neon.tech) (Pooled for queries, Direct for DDL/Worker), [Cloudflare R2 / S3](https://www.cloudflare.com/developer-platform/r2/) |
| **Testing** | [Pytest](https://docs.pytest.org) (with `pytest-asyncio`, `pytest-mock`), [Vitest](https://vitest.dev) (with Testing Library & JSDOM) |

---

## 💻 Getting Started

### Prerequisites

- **Python**: 3.12 or newer
- **Node.js**: 18.18+ or 20+ (with `pnpm`)
- **Neon Database Account**: PostgreSQL instance with pgvector support
- **Qdrant Cloud Account**: Cluster with API key
- **Google Gemini API Key**: For embedding generation and chat completions
- **Cloudflare R2 / S3 Bucket**: S3-compatible storage credentials

---

### 1. Clone Repository

```bash
git clone https://github.com/Dharmateja249/StudyLM-Citation-Grounded-RAG-Study-Assistant.git
cd StudyLM-Citation-Grounded-RAG-Study-Assistant
```

---

### 2. Environment Configuration

Copy `.env.example` to `.env` (or `.env.local`):

```bash
cp .env.example .env
```

Populate the keys in `.env`:

```env
# 1. Environment & Server
ENVIRONMENT=development
DEBUG=True
PORT=8000
FRONTEND_URL=http://localhost:3000

# 2. Database (Neon Serverless PostgreSQL)
DATABASE_URL=postgresql+psycopg://user:pass@ep-pooler.neon.tech/studylm?sslmode=require
DATABASE_URL_UNPOOLED=postgresql+psycopg://user:pass@ep-direct.neon.tech/studylm?sslmode=require

# 3. Vector Database (Qdrant Cloud)
QDRANT_URL=https://your-cluster-url.qdrant.tech:6333
QDRANT_API_KEY=your-qdrant-api-key
QDRANT_COLLECTION_NAME=studylm_chunks

# 4. Google Gemini AI Models
GEMINI_API_KEY=your-gemini-api-key
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
GEMINI_GENERATION_MODEL=gemini-3.5-flash-lite
EMBEDDING_DIMENSION=768

# 5. Cloud Object Storage (R2 / S3)
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-access-key
R2_BUCKET_NAME=studylm-sources
R2_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com

# 6. Authentication & Security
JWT_SECRET_KEY=generate-a-secure-random-secret
JWT_ALGORITHM=HS256
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

---

### 3. Backend Setup

```powershell
# Navigate to backend directory
cd backend

# Create & activate a virtual environment
python -m venv .venv
.venv\Scripts\Activate.ps1    # On Windows
# source .venv/bin/activate   # On Linux/macOS

# Install dependencies
pip install -r requirements.txt

# Run database table initialization & start API server
python run.py
```

The backend server is live at:
- **API Server**: [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Interactive Swagger Docs**: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **Health Check**: [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health)

---

### 4. Frontend Setup

In a new terminal window:

```powershell
# Navigate to frontend directory
cd frontend

# Install dependencies using pnpm
pnpm install

# Start Next.js development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. Next.js automatically proxies requests from `/api/*` to `http://127.0.0.1:8000/*`.

---

## 🧭 Interactive Workflows

```
┌────────────────────────────────────────────────────────────────────────┐
│                        STUDYLM WORKSPACE SHELL                         │
├───────────────┬───────────────────────────────┬────────────────────────┤
│ LEFT SIDEBAR  │     DOCUMENT INSPECTOR        │       AI CHAT          │
│               │                               │                        │
│ • Notebooks   │ [PDF Viewer]                  │ Student:               │
│   - Physics   │   ┌─────────────────────────┐ │ "Explain Newton's law" │
│   - Biology   │   │  Section 2.1            │ │                        │
│               │   │  [ Newton's second law] │ │ StudyLM:               │
│ • Sources     │   │  [ is F = ma.         ] │ │ "According to your   │
│   - Notes.pdf │   │                         │ │  lecture, F = ma     │
│   - Video (YT)│   └─────────────────────────┘ │  [1].                  │
│               │ [YouTube Player @ 04:12]      │                        │
│ [+ Add PDF]   │                               │ [Ask questions...]     │
│ [+ Add Video] │ Jump to Citation [1] Highlight│ Rate Limit: 58/60 left │
└───────────────┴───────────────────────────────┴────────────────────────┘
```

1. **One-Click Demo Login**: Click **"Sign In as Dev User"** on the landing page or modal to instantly enter the workspace without needing live Google OAuth credentials.
2. **Upload Documents**: Drag & drop any PDF into the sidebar. Watch the status transition in real time from `processing` to `ready`.
3. **Import YouTube Lectures**: Click **"Add YouTube"**, paste any educational lecture link, and let StudyLM extract and align timestamps.
4. **Interactive Grounded Chat**: Ask questions in the right-hand panel. Tokens stream in real time. Click citation badges (`[1]`) to instantly inspect the highlighted ground-truth passage in the document viewer.

---

## 📡 API Reference

### Authentication (`/auth`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/v1/auth/google/login` | Initiates Google OAuth 2.0 account chooser redirect flow |
| `GET` | `/v1/auth/google/callback` | Exchanges authorization code for tokens, creates/resumes session |
| `GET` | `/auth/me` | Fetches current user profile and session resume state |
| `DELETE` | `/users/me` | Deactivates account, marks `is_active=False`, cascades deletions |

### Notebooks (`/notebooks`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/notebooks` | Lists all active notebooks belonging to authenticated user |
| `POST` | `/notebooks` | Creates a new notebook with default title |
| `GET` | `/notebooks/{id}` | Retrieves notebook metadata with anti-enumeration protection |
| `PATCH` | `/notebooks/{id}` | Updates notebook title or metadata |
| `DELETE` | `/notebooks/{id}` | Two-phase deletion: marks `status='deleting'` & purges vectors |
| `GET` | `/notebooks/{id}/messages` | Fetches conversation history with citation payload array |
| `POST` | `/notebooks/{id}/messages` | Persists user or assistant message with resolved citations |

### Sources (`/sources` & `/notebooks/{id}/sources`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/notebooks/{id}/sources` | Lists all active sources (`ready`, `processing`, `error`) |
| `POST` | `/notebooks/{id}/sources` | Multi-part upload for PDF/document binaries with 50MB quota check |
| `POST` | `/notebooks/{id}/sources/youtube` | Imports YouTube video URL with educational relevance validation |
| `GET` | `/sources/{id}` | Fetches individual source metadata |
| `DELETE` | `/sources/{id}` | Dequeues vector deletion, cleans up S3 objects & deletes source record |
| `GET` | `/sources/{id}/stream` | HTTP 206 Partial Content Range streaming proxy for PDF viewer |
| `GET` | `/sources/{id}/presigned-url` | Generates 15-minute presigned download URL |

### Query & Citations (`/notebooks/{id}/query`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/notebooks/{id}/query` | Primary grounded query endpoint returning JSON answer & citations |
| `POST` | `/notebooks/{id}/query/stream` | Real-time SSE streaming endpoint with sentence-level citation buffering |
| `POST` | `/sources/{id}/summarize` | Token-driven summarization (single-pass full context vs hierarchical outline) |

---

## 🧪 Testing & Quality Assurance

StudyLM maintains 100% passing test coverage across both backend and frontend.

### 1. Run Backend Pytest Suite
```powershell
cd backend
$env:PYTHONPATH="."
python -m pytest -v
```
- **194/194 Tests Passing**: Covers multi-tenancy isolation (`SEC`), storage rollback & quota limits (`STOR`), durable blue-green ingestion (`ING`), and citation resolution & refusal (`CIT`).

### 2. Run Frontend Vitest Suite
```powershell
cd frontend
pnpm test:all
```
- **96/96 Tests Passing across 23 test suites**: Validates design tokens, Zod schemas, SSE stream chunk parsing, modal dialogs, PDF coordinate highlight math, and YouTube seek player interactions.

---

## 🛡 Security & Compliance

- **No Secrets in Version Control**: Rigorous `.gitignore` files at root, backend, and frontend ensure credentials (`.env`, `.env.local`), database files (`*.db`), and internal agent logs are never pushed.
- **Tenant Data Isolation**: Database queries strictly filter by `user_id`; Qdrant point retrieval applies required boolean payload indexes on `user_id`, `notebook_id`, and `ingest_run_id`.
- **Anti-Enumeration 404s**: Probing non-existent, deleted, or cross-tenant resource IDs consistently yields uniform `404 Not Found` responses to prevent ID guessing.
- **Prompt Injection Defense**: Sanitizes adversarial delimiters (`[CHUNK_START]`, `[[cite:`) and safely escapes double-quotes in source titles before LLM context construction.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
