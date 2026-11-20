# StudyLM (KnowledgeLM) — Remaining System Architecture & Phased Execution Plan
**Version**: 1.0.0-FROZEN  
**Target Stack**: Next.js 15 (App Router, React 19, TypeScript, Tailwind CSS), PDF.js Bounding Box Engine, YouTube Auto-Seek Player, SSE Citation Consumer, Docker Production Orchestration.  
**Backend Status**: Fully verified with 180/180 green tests in `studylm/backend` (FastAPI, SQLModel, Qdrant, Cloudflare R2, Procrastinate, FlashRank, Gemini).

---

## 1. Executive Summary & Non-Regression Architectural Guarantee

The StudyLM backend is hardened, certified, and fully verified across all core architectural specifications (multi-tenancy composite keys, 50MB dynamic stream limit, 20-source quota row locks, 2-tier YouTube educational moderation barrier, Qdrant MRL 768d hybrid BM25 search, FlashRank reranking, and authoritative citation resolution).

To ensure that the remaining frontend and orchestration systems are implemented with **zero architectural drift and zero regressions**, the execution is strictly decoupled into **6 discrete, sequentially isolated phases**.

### The Non-Regression Invariant
Each phase operates as an isolated subsystem governed by the following architectural guarantees:
1. **Upstream Immutability**: No phase may modify the exported TypeScript types, API contracts, or component prop interfaces established in Phase 1.
2. **State Decoupling via Single-Direction Event Bus**: Inter-pane interactions (e.g. clicking a citation in the Chat pane to highlight a sentence in the PDF or seek YouTube in the Center pane) execute exclusively via a strongly typed global **ViewerFocusTarget** dispatcher. Panes do not import or know about internal DOM, canvas, or player implementations of other panes.
3. **Mock-First Contract Verification**: Every phase includes a complete mock-service contract harness (MSW + typed fixtures) allowing it to be compiled, rendered, and unit/integration tested in complete isolation without dependencies on live backend databases or downstream UI features.
4. **Failure Containment**: A failure in one pane (e.g. PDF.js canvas rendering failure or YouTube video unavailable) is caught within that pane's error boundary and cannot crash the Workspace shell, the source drawer, or the chat stream.

---

## 2. System Architecture & Boundaries

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   NEXT.JS 15 WORKSPACE ROOT APP                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              Global Shell & Workspace Store                                │  │
│  │  - Active Notebook ID      - Active Source ID       - ViewerFocusTarget Event Dispatcher   │  │
│  │  - Session / Auth State    - Source Quota (X/20)    - Rate Limit State (60 q/hr)           │  │
│  └──────────────────┬─────────────────────────────┬────────────────────────────┬──────────────┘  │
│                     │                             │                            │                 │
│                     ▼                             ▼                            ▼                 │
│  ┌─────────────────────────────────┐ ┌───────────────────────────┐ ┌──────────────────────────┐  │
│  │      PANE 1: LEFT SIDEBAR       │ │   PANE 2: CENTER VIEWER   │ │    PANE 3: RIGHT CHAT    │  │
│  │ ─────────────────────────────── │ │ ───────────────────────── │ │ ──────────────────────── │  │
│  │ • Notebook Switcher / Creator   │ │ • Source Tab Switcher     │ │ • Conversation Feed      │  │
│  │ • Source List & Status Badges   │ │ • PDF.js Canvas + SVG     │ │ • Real-Time SSE Consumer │  │
│  │   [ready, processing, error]    │ │   Normalized Bbox Engine  │ │   (Sentence Buffered)    │  │
│  │ • 50MB File Dropzone            │ │ • YouTube Auto-Seek       │ │ • Clickable [[cite:N]]   │  │
│  │ • YouTube URL Import Modal      │ │   Iframe API Player       │ │   Interactive Chips      │  │
│  │ • Educational Barrier Warning:  │ │ • Image & Diagram Viewer  │ │ • Citation Hover Card    │  │
│  │   ⚠️ ERR_NON_EDUCATIONAL_CONTENT│ │ • Markdown Roadmap /      │ │ • 60 q/hr Quota Bar      │  │
│  │ • 20-Source Quota Lock Badge    │ │   Summary Viewer          │ │ • Multi-Source Filter    │  │
│  └─────────────────────────────────┘ └───────────────────────────┘ └──────────────────────────┘  │
└───────────────────────────────────────────────────┬──────────────────────────────────────────────┘
                                                    │ REST API + SSE Stream
                                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                DOCKER PRODUCTION ORCHESTRATION                                   │
│  ┌───────────────────────────┐  ┌───────────────────────────┐  ┌──────────────────────────────┐  │
│  │ Reverse Proxy (Caddy)     │  │ FastAPI App Server        │  │ Procrastinate Worker         │  │
│  │ HTTP 206 Partial Content  │─▶│ Uvicorn / Gunicorn        │─▶│ PyMuPDF, pysbd, FlashRank    │  │
│  │ SSE unbuffered proxy      │  │ SEC, STOR, CIT Endpoints  │  │ YouTube Transcript Ingestion │  │
│  └───────────────────────────┘  └─────────────┬─────────────┘  └──────────────┬───────────────┘  │
│                                               │                               │                  │
│                                 ┌─────────────┴─────────────┐                 │                  │
│                                 ▼                           ▼                 ▼                  │
│                    ┌─────────────────────────┐ ┌──────────────────────────────────────────────┐ │
│                    │ PostgreSQL 16 (Relational)│ │ Qdrant Vector DB (Dense 768d + Sparse BM25)  │ │
│                    └─────────────────────────┘ └──────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Contract Freeze & Versioning (Phase 0)

All data structures exchanged across backend, UI components, and mock adapters are frozen as TypeScript interfaces with Zod schemas. These match the backend `app/models.py` schemas 100%.

### 3.1 Frozen Domain Interfaces (`frontend/src/types/api.ts`)

```typescript
// 1. Core Source & Ingestion Types
export type SourceType = 'pdf' | 'image' | 'youtube';
export type SourceStatus = 'processing' | 'ready' | 'error' | 'deleting';
export type SummaryStatus = 'pending' | 'ready' | 'error';

export interface SentenceSpan {
  sentence_id: string; // e.g. "s0", "s1"
  text: string;
  bboxes: number[][];  // Multi-line: [[x0, y0, x1, y1], ...] normalized in [0.0, 1.0]
  start_seconds?: number;
  end_seconds?: number;
}

export interface SourceRead {
  id: string;
  user_id: string;
  notebook_id: string;
  title: string;
  source_type: SourceType;
  storage_key_or_url: string;
  file_size_bytes?: number;
  page_count?: number;
  estimated_tokens?: number;
  duration_seconds?: number;
  active_ingest_run_id?: string;
  status: SourceStatus;
  reindexing: boolean;
  error_code?: 'ERR_CORRUPT_FILE' | 'ERR_YT_NO_TRANSCRIPT' | 'ERR_NON_EDUCATIONAL_CONTENT' | string;
  error_message?: string;
  summary?: string;
  summary_status: SummaryStatus;
  created_at: string;
}

// 2. Notebook & Multi-Tenancy Types
export interface NotebookRead {
  id: string;
  user_id: string;
  title: string;
  status: 'active' | 'deleting' | 'error';
  created_at: string;
}

// 3. Authoritative Citation & Grounding Types
export interface ResolvedCitation {
  marker_id: number;          // 1, 2, ... corresponding to [[cite:1]]
  source_id: string;
  source_title: string;
  source_type: SourceType;
  page_number?: number;
  bboxes: number[][];         // Multi-line: [[x0, y0, x1, y1], ...] in [0.0, 1.0]
  start_seconds?: number;
  deep_link: string;          // PDF viewer anchor or YouTube timestamp URL
  quote: string;              // Verbatim quote from stored Qdrant payload truth
}

// 4. SSE Stream Event Schema (CIT-11)
export type SSEEvent = 
  | {
      type: 'content';
      text: string;
      citations: ResolvedCitation[];
    }
  | {
      type: 'done';
      total_citations: number;
    }
  | {
      type: 'error';
      message: string;
      code?: string;
    };

// 5. Inter-Pane Focus Event (Decoupling Bridge)
export interface ViewerFocusTarget {
  sourceId: string;
  pageNumber?: number;
  bboxes?: number[][];
  startSeconds?: number;
  quote?: string;
  timestamp: number; // Disambiguates consecutive clicks on identical citation
}
```

---

## 4. Discrete Phased Execution Breakdown

### PHASE 1: Contract Freeze, Type System, Mock Harness & 3-Pane Shell Layout
* **Goal**: Establish the zero-regression foundation, mock API harness, and responsive 3-pane resizable workspace shell.
* **Scope**:
  - Scaffold Next.js 15 (App Router, React 19, TypeScript strict mode, Tailwind CSS v4, Lucide React).
  - Frozen types (`frontend/src/types/api.ts`) and Zod schemas (`frontend/src/types/schemas.ts`).
  - Mock API harness (`frontend/src/mocks/`): Deterministic mock fixtures for notebooks, PDF sources with multi-line bboxes, YouTube sources with transcripts, educational barrier error triggers, and chunked SSE stream generators.
  - Workspace Shell: 3-pane responsive resizable layout using `react-resizable-panels`.
    * Left Pane: Min 240px, default 280px, collapsible to 48px icon sidebar.
    * Center Pane: Min 400px, flex-grow, collapsible if user focuses purely on chat.
    * Right Pane: Min 360px, default 420px, collapsible if user focuses on reading.
  - Global `WorkspaceStore` (Zustand):
    * `activeNotebookId`: string | null
    * `activeSourceId`: string | null
    * `activeFocusTarget`: ViewerFocusTarget | null
    * `rateLimit`: { queryCount: number; maxQueries: 60; windowStart: string }
  - App Shell Header: Notebook title breadcrumb, active source counter, user avatar, and connection health status indicator.
* **Decoupling Guarantee**:
  - The 3 pane slots are implemented as pure polymorphic wrappers: `<LeftSidebarSlot />`, `<CenterViewerSlot />`, `<RightChatSlot />`.
  - Phase 1 delivers empty/mocked shells inside the slots. No component in Phase 1 depends on PDF.js, YouTube API, or SSE streaming.
* **Deliverables**:
  - `frontend/package.json`
  - `frontend/tsconfig.json`
  - `frontend/src/types/api.ts`
  - `frontend/src/types/schemas.ts`
  - `frontend/src/mocks/fixtures.ts`
  - `frontend/src/mocks/mock-server.ts`
  - `frontend/src/store/workspace-store.ts`
  - `frontend/src/components/layout/WorkspaceShell.tsx`
  - `frontend/src/components/layout/ResizablePanes.tsx`
  - `frontend/src/components/layout/Header.tsx`
  - Unit tests verifying panel collapse/expand, state store mutation, and mock contract conformance.

---

### PHASE 2: Left Pane — Notebook & Source Lifecycle Management
* **Goal**: Complete notebook management, drag-and-drop file upload with 50MB client validation, YouTube ingestion modal with educational barrier warning, and 20-source quota enforcement.
* **Scope**:
  - **Notebook Management**:
    * Switcher dropdown listing active notebooks (`GET /notebooks`).
    * "New Notebook" dialog (`POST /notebooks`).
    * In-line title renaming (`PATCH /notebooks/{id}`).
    * Deletion confirmation modal (`DELETE /notebooks/{id}`) triggering optimistic UI removal and background cascade.
  - **Source List & State Machine**:
    * Renders source cards with status badges:
      - `processing`: Animated pulsing spinner + "Ingesting & indexing...".
      - `ready`: Document icon + title + page/duration metadata.
      - `deleting`: Faded state + "Cleaning up vectors...".
      - `error`: Warning badge + expandable error message.
    * Active source selection: Clicking a source updates `activeSourceId` in `WorkspaceStore`.
    * Source deletion button (`DELETE /sources/{id}`).
  - **Upload Drag-and-Drop Area**:
    * Pre-upload client-side file size validation: Rejects files >50MB immediately (`Payload exceeds maximum 50MB`).
    * Upload progress indicator (`POST /notebooks/{notebook_id}/sources`).
  - **20-Source Quota Guard**:
    * Displays live counter `X / 20 Sources`.
    * When `count >= 20`, disables upload button and dropzone with tooltip: `Notebook source limit reached (max 20)`.
  - **YouTube Ingestion Dialog & Educational Moderation Barrier**:
    * Modal accepting YouTube video URL.
    * When backend responds with `status="error"` and `error_code="ERR_NON_EDUCATIONAL_CONTENT"`, UI renders the exact required warning banner:
      > **⚠️ Upload educational related video, this video does not have educational content please recheck the link**
    * Video title and transcript are suppressed; source displays in error state with red alert border and re-submission button.
* **Decoupling Guarantee**:
  - Left Pane modifies ONLY `activeNotebookId` and `activeSourceId` in `WorkspaceStore`.
  - Left Pane does NOT import or manipulate PDF.js, YouTube players, or the chat stream.
  - Downstream changes in Viewer or Chat have zero impact on Left Pane.
* **Deliverables**:
  - `frontend/src/components/sidebar/NotebookSelector.tsx`
  - `frontend/src/components/sidebar/NotebookModal.tsx`
  - `frontend/src/components/sidebar/SourceList.tsx`
  - `frontend/src/components/sidebar/SourceCard.tsx`
  - `frontend/src/components/sidebar/FileUploadDropzone.tsx`
  - `frontend/src/components/sidebar/YouTubeImportModal.tsx`
  - `frontend/src/components/sidebar/EducationalWarningBanner.tsx`
  - `frontend/src/components/sidebar/QuotaBadge.tsx`
  - Tests verifying 50MB drop rejection, 20-source quota lockout, and Educational Barrier warning rendering.

---

### PHASE 3: Center Pane — Multimodal Viewer & Bounding Box Engine
* **Goal**: Build the multimodal viewing engine supporting PDF.js with SVG bounding-box overlays, YouTube auto-seek player, image diagrams, and document summary roadmaps.
* **Scope**:
  - **Tabbed Viewer Container**:
    * Switches viewer engine based on `activeSource.source_type`:
      - `'pdf'` -> `PdfViewer`
      - `'youtube'` -> `YouTubeViewer`
      - `'image'` -> `ImageViewer`
    * Source Roadmap toggle button: Switches to `SummaryRoadmapViewer` displaying token-driven hierarchical outlines.
  - **PDF.js Canvas & Normalized SVG Bounding Box Engine**:
    * Uses PDF.js (`pdfjs-dist`) for rendering PDF pages to HTML5 Canvas.
    * Supports HTTP 206 partial streaming via `/sources/{id}/stream`.
    * **Normalized Coordinate Mapper**: Converts backend `[x0, y0, x1, y1] \in [0.0, 1.0]` coordinates to page viewport pixels:
      $$\text{left} = x_0 \times \text{width}, \quad \text{top} = y_0 \times \text{height}$$
      $$\text{boxWidth} = (x_1 - x_0) \times \text{width}, \quad \text{boxHeight} = (y_1 - y_0) \times \text{height}$$
    * **Highlight Overlay Layer**: SVG overlay positioned directly over canvas with `pointer-events-none`.
    * Multi-line sentence support: Renders multiple `<rect>` elements for sentences wrapping across lines.
    * Pulse & Highlight Animation: Active highlight pulses with amber/gold border and semi-transparent fill (`rgba(251, 191, 36, 0.35)`).
    * Auto-Scroll on Focus: When `WorkspaceStore.activeFocusTarget` matches this source, auto-scrolls viewport to the target page and centers the bounding box.
  - **YouTube Auto-Seek Player**:
    * Embedded player utilizing YouTube Iframe Player API.
    * Reactive Seek Listener: Subscribes to `activeFocusTarget`. When a citation targets this video with `startSeconds`, calls:
      ```javascript
      player.seekTo(target.startSeconds, true);
      player.playVideo();
      ```
    * Transcript segment sync: Displays timestamped caption markers allowing manual seeking.
  - **Image & Diagram Viewer**:
    * High-resolution pan-and-zoom viewer with SVG bounding-box highlights for annotated diagrams.
  - **Document Summary / Roadmap View**:
    * Renders markdown summary fetched from `/sources/{source_id}/summarize`.
    * Formats sections, key concepts, and study guide questions.
* **Decoupling Guarantee**:
  - Center Viewer consumes ONLY `activeSource` and `activeFocusTarget` from `WorkspaceStore`.
  - It exposes ZERO internal DOM or canvas nodes to outside components.
  - Center Viewer has no knowledge of how citations were created (chat, search, or tests).
* **Deliverables**:
  - `frontend/src/components/viewer/ViewerContainer.tsx`
  - `frontend/src/components/viewer/PdfViewer.tsx`
  - `frontend/src/components/viewer/PdfPageCanvas.tsx`
  - `frontend/src/components/viewer/BboxHighlightOverlay.tsx`
  - `frontend/src/components/viewer/YouTubeViewer.tsx`
  - `frontend/src/components/viewer/ImageViewer.tsx`
  - `frontend/src/components/viewer/SummaryRoadmapViewer.tsx`
  - `frontend/src/utils/coordinate-math.ts` (normalized float to viewport pixel translation)
  - Unit tests verifying coordinate normalization math, multi-line bbox layout, and YouTube seek invocation.

---

### PHASE 4: Right Pane — Grounded Chat & Real-Time SSE Citation Stream Consumer
* **Goal**: Implement grounded conversation feed, sentence-buffered SSE stream consumer, interactive `[[cite:N]]` citation chips, hover preview cards, and rate-limit tracking.
* **Scope**:
  - **Conversation Feed**:
    * Message list rendering user turns and assistant responses.
    * Markdown syntax highlighting with math rendering (KaTeX for LaTeX formulas).
    * Session Resume: Automatically loads past messages from `GET /notebooks/{id}/messages`.
  - **Sentence-Buffered SSE Stream Consumer (`useSSEStream`)**:
    * Connects to `/notebooks/{id}/query/stream` using `fetch` with `ReadableStreamDefaultReader`.
    * Buffers arriving tokens until sentence boundary (`[.!?\n]`) matching backend `StreamingSentenceBuffer` behavior.
    * Parses SSE data payloads:
      - `type: "content"`: Appends text chunk and registers authoritative citations.
      - `type: "done"`: Finalizes stream, updates message metadata.
      - `type: "error"`: Handles refusal (`"I cannot find sufficient evidence..."`), rate-limit exceeded (HTTP 429), or mid-stream auth expiration (HTTP 401).
  - **Interactive Citation Token Transformer**:
    * RegEx parser identifies inline citation markers `\[\[cite:(\d+)\]\]` within markdown stream.
    * Replaces markers with custom interactive React component `<CitationChip markerId={N} citation={resolvedCitation} />`.
    * Clicking a `<CitationChip>` dispatches:
      ```typescript
      workspaceStore.dispatchFocusTarget({
        sourceId: citation.source_id,
        pageNumber: citation.page_number,
        bboxes: citation.bboxes,
        startSeconds: citation.start_seconds,
        quote: citation.quote,
        timestamp: Date.now(),
      });
      ```
  - **Citation Hover Card / Popover**:
    * Hovering over `<CitationChip>` displays authoritative metadata popover:
      - Source Title badge + icon (`pdf` or `youtube`).
      - Page number (e.g. `Page 14`) or Video timestamp (e.g. `12:45`).
      - Verbatim Quote snippet extracted strictly from stored Qdrant payload truth.
      - Deep link button.
  - **Hourly Rate-Limiter (60 queries/hr) Banner & Counter**:
    * Real-time query counter bar (`X / 60 queries this hour`).
    * Upon receiving HTTP 429 Too Many Requests:
      - Disables prompt input.
      - Displays sticky banner with window reset countdown timer.
  - **Retrieval Scope Selector**:
    * Multi-select chip group allowing user to query "All sources" or restrict search to specific selected sources (`source_ids: string[]`).
* **Decoupling Guarantee**:
  - The Chat Pane communicates with the rest of the application ONLY by emitting `ViewerFocusTarget` events to `WorkspaceStore`.
  - The Chat Pane does NOT import PDF.js or YouTube components.
  - The token streaming and citation resolution operate deterministically whether the viewer is active or collapsed.
* **Deliverables**:
  - `frontend/src/hooks/useSSEStream.ts`
  - `frontend/src/components/chat/ChatContainer.tsx`
  - `frontend/src/components/chat/MessageList.tsx`
  - `frontend/src/components/chat/MessageItem.tsx`
  - `frontend/src/components/chat/CitationChip.tsx`
  - `frontend/src/components/chat/CitationHoverCard.tsx`
  - `frontend/src/components/chat/ChatInput.tsx`
  - `frontend/src/components/chat/RateLimitIndicator.tsx`
  - `frontend/src/components/chat/SourceScopeSelector.tsx`
  - Tests verifying SSE stream parsing, inline `[[cite:N]]` token replacement, citation click event dispatching, and 429 rate limit lockout.

---

### PHASE 5: End-to-End Workspace Integration, Polish & UX Hardening
* **Goal**: Validate complete multi-pane choreography, session restore, keyboard navigation, and accessibility standards.
* **Scope**:
  - **Cross-Pane Focus Orchestration**:
    * Test & refine seamless citation navigation: User clicks `[[cite:1]]` in Chat -> Center Pane switches active tab to target source -> PDF viewer scrolls to target page and pulses multi-line bounding box -> YouTube player seeks to `t=X` and auto-plays.
  - **Session Resume**:
    * Automatically restore user's last active workspace on browser reload via `GET /auth/me` (`last_active_notebook_id`).
  - **Keyboard Shortcuts**:
    * `Cmd/Ctrl + K`: Focus search/query bar.
    * `Escape`: Dismiss active citation highlight / close modal.
    * `[` and `]`: Toggle left and right sidebar collapse.
  - **Accessibility & Contrast Audit**:
    * WCAG AA compliant contrast ratios for citation chips and SVG highlight overlays.
    * ARIA live regions for streaming chat tokens and status alerts.
* **Decoupling Guarantee**:
  - Phase 5 adds zero new state structures or schema mutations. It integrates the hardened components built in Phases 1–4.
* **Deliverables**:
  - `frontend/src/hooks/useKeyboardShortcuts.ts`
  - `frontend/src/hooks/useSessionResume.ts`
  - End-to-end integration test suite (`frontend/tests/e2e/workspace.spec.ts`) verifying full user flow from source upload to citation jumping.

---

### PHASE 6: Production Docker Orchestration & Deployment Hardening
* **Goal**: Deliver a production-grade, multi-container Docker orchestration unifying the Next.js frontend, FastAPI backend, Procrastinate worker, Qdrant vector database, PostgreSQL, and reverse proxy.
* **Scope**:
  - **Production Next.js Dockerfile**:
    * Multi-stage build (`builder`, `runner`).
    * Next.js `output: 'standalone'` configuration for minimal image size (<150MB).
    * Non-root security user (`nextjs:nodejs`).
  - **Production Backend & Worker Dockerfiles**:
    * Production Python 3.12 image with PyMuPDF, FlashRank, and dependencies.
    * Separate entrypoint for API (`uvicorn`) and background worker (`python -m app.tasks.worker`).
  - **Docker Compose Production Topology (`docker-compose.yml`)**:
    1. `postgres`: PostgreSQL 16 Alpine with persistent volume and `pg_isready` healthcheck.
    2. `qdrant`: Qdrant v1.11+ with persistent volume and HTTP healthcheck `/readyz`.
    3. `backend`: FastAPI server running 4 workers, depends on healthy postgres and qdrant.
    4. `worker`: Procrastinate async worker with worker heartbeat (10s) and stalled recovery (30s).
    5. `frontend`: Next.js 15 standalone container.
    6. `proxy`: Caddy or Nginx reverse proxy routing:
       - `/api/*` -> backend:8000
       - `/sources/*/stream` -> backend:8000 with HTTP 206 Range support and unbuffered chunking
       - `/notebooks/*/query/stream` -> backend:8000 with `X-Accel-Buffering: no` for SSE
       - `/*` -> frontend:3000
  - **Orchestration Verification & Smoke Test**:
    * Automated healthcheck probe script (`scripts/docker-smoke-test.sh`).
* **Decoupling Guarantee**:
  - Services communicate exclusively across internal Docker networks (`studylm-net`) via published ports and standard environment variables.
* **Deliverables**:
  - `frontend/Dockerfile`
  - `frontend/next.config.ts` (standalone output configuration)
  - `backend/Dockerfile`
  - `docker-compose.yml`
  - `docker-compose.override.yml` (dev mode support)
  - `Caddyfile` / `nginx.conf`
  - `.env.production.example`
  - Deployment validation script.

---

## 5. Complete Target File Layout

```
studylm/
├── .env.example
├── docker-compose.yml
├── Caddyfile
├── PHASE_ARCHITECTURE_PLAN.md
│
├── backend/                       # ALREADY COMPLETE & VERIFIED (180/180 green tests)
│   ├── app/
│   │   ├── config.py
│   │   ├── database.py
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── routers/
│   │   ├── services/
│   │   └── tasks/
│   └── tests/
│
└── frontend/                      # REMAINING WORKSPACE SYSTEM
    ├── package.json
    ├── tsconfig.json
    ├── next.config.ts
    ├── tailwind.config.ts
    ├── Dockerfile
    ├── public/
    │   └── pdf.worker.min.mjs
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   ├── page.tsx
    │   │   ├── globals.css
    │   │   └── api/mock/...       # Mock routes for offline testing
    │   ├── types/
    │   │   ├── api.ts             # Frozen TypeScript interfaces
    │   │   ├── schemas.ts         # Zod validation schemas
    │   │   └── events.ts          # Inter-pane event definitions
    │   ├── store/
    │   │   └── workspace-store.ts # Global Zustand state & event bus
    │   ├── hooks/
    │   │   ├── useSSEStream.ts    # Sentence-buffered SSE client
    │   │   ├── useSessionResume.ts
    │   │   └── useKeyboardShortcuts.ts
    │   ├── utils/
    │   │   ├── coordinate-math.ts # Bounding box normalization [0,1] -> px
    │   │   └── sanitize.ts
    │   ├── mocks/
    │   │   ├── fixtures.ts        # Frozen sample data
    │   │   └── mock-server.ts     # MSW handler setup
    │   └── components/
    │       ├── layout/
    │       │   ├── WorkspaceShell.tsx
    │       │   ├── ResizablePanes.tsx
    │       │   └── Header.tsx
    │       ├── sidebar/           # PANE 1
    │       │   ├── NotebookSelector.tsx
    │       │   ├── NotebookModal.tsx
    │       │   ├── SourceList.tsx
    │       │   ├── SourceCard.tsx
    │       │   ├── FileUploadDropzone.tsx
    │       │   ├── YouTubeImportModal.tsx
    │       │   ├── EducationalWarningBanner.tsx
    │       │   └── QuotaBadge.tsx
    │       ├── viewer/            # PANE 2
    │       │   ├── ViewerContainer.tsx
    │       │   ├── PdfViewer.tsx
    │       │   ├── PdfPageCanvas.tsx
    │       │   ├── BboxHighlightOverlay.tsx
    │       │   ├── YouTubeViewer.tsx
    │       │   ├── ImageViewer.tsx
    │       │   └── SummaryRoadmapViewer.tsx
    │       └── chat/              # PANE 3
    │           ├── ChatContainer.tsx
    │           ├── MessageList.tsx
    │           ├── MessageItem.tsx
    │           ├── CitationChip.tsx
    │           ├── CitationHoverCard.tsx
    │           ├── ChatInput.tsx
    │           ├── RateLimitIndicator.tsx
    │           └── SourceScopeSelector.tsx
    └── tests/
        ├── unit/
        └── e2e/
```

---

## 6. Execution Dependency Matrix & Verification Gateways

| Phase | Core Deliverable | Upstream Dependencies | Gate Verification Criteria | Regression Barrier |
|---|---|---|---|---|
| **Phase 1** | Contract Freeze & 3-Pane Shell | None (Backend Spec) | `tsc --noEmit` clean, 3 panes render & resize smoothly, mock harness ready | Types and schemas frozen; zero implementation coupling in slot wrappers |
| **Phase 2** | Left Pane: Sources & Notebooks | Phase 1 | File >50MB blocked client-side, 20-source limit locks UI, YouTube non-educational returns exact warning banner | Only mutates `activeNotebookId` and `activeSourceId` |
| **Phase 3** | Center Pane: PDF & YouTube Viewer | Phase 1 (types, store) | Multi-line bounding box renders at correct pixel coords, YouTube seeks to `start_seconds` on focus event | Agnostic to citation generator; internal canvas/player isolated |
| **Phase 4** | Right Pane: SSE Stream & Citations | Phase 1 (types, store) | Stream tokens buffer to sentence boundary, `[[cite:N]]` renders interactive chips, 429 locks input | Emits only `ViewerFocusTarget`; no viewer DOM access |
| **Phase 5** | Inter-Pane Integration & Polish | Phases 1, 2, 3, 4 | Full E2E loop passes: citation click switches tab & highlights bbox / seeks YouTube; session resumes | Zero schema mutations; integration over frozen contracts |
| **Phase 6** | Production Docker Orchestration | Phases 1–5 | `docker compose up` starts all 6 containers healthy; reverse proxy passes 206 range & SSE unbuffered | Fully isolated network topology with container healthchecks |

---

## 7. Sign-Off & Execution Readiness

This architectural plan guarantees:
1. **Mathematical Precision**: Bounding boxes adhere to normalized relative coordinate transforms $[x_0, y_0, x_1, y_1] \in [0.0, 1.0]$.
2. **Defensive Alignment**: The exact educational barrier warning text is mandated and verified:
   `⚠️ Upload educational related video, this video does not have educational content please recheck the link`.
3. **Zero Cascading Breakages**: By freezing types and mediating inter-pane communication through an event-based `ViewerFocusTarget`, downstream phases cannot force refactors or regressions in upstream deliverables.
