# Original User Request

## 2026-10-09T17:54:12Z

# Teamwork Project Prompt — Final (with Educational Filter Barrier)

Requested team: Full team (comprehensive multi-agent stress-testing, automated fuzzing, and detailed audit report)

Execute exhaustive stress-testing, adversarial fuzzing, and extreme edge-case verification against the StudyLM (KnowledgeLM) backend architecture, implementing necessary service modules and producing a definitive Production-Readiness & Architectural Verification Report.

Working directory: D:\Projects-GENAI\studylm\backend (Environment fallback: C:\Users\Dharm\.gemini\antigravity\scratch\studylm\backend)
Integrity mode: development

## Requirements

### R1. Extreme Edge-Case & Stress Testing
Execute exhaustive, adversarial, and extreme-condition test suites across all 4 core architectural subsystems:
1. **Multi-Tenancy & Auth**: Cross-tenant data leakage under concurrent queries, token expiration mid-stream, revoked/deactivated session token rejection, and malformed Google OAuth JWTs.
2. **Storage & Cascading Deletion Races**: Deletes arriving mid-ingest, multiple concurrent deletes on the same source/notebook, object storage (R2) network aborts during multi-part upload, and sweeper deadline recovery.
3. **Durable Ingestion & Worker Failures**: Sudden worker crash (`kill -9`) mid-chunking/mid-embedding, simulated PostgreSQL connection drops (`LISTEN/NOTIFY` severed), heavy CPU event-loop saturation (scanned 500-page PDF OCR), corrupted/malformed PDFs, and zero-downtime blue-green vector re-indexing.
4. **Retrieval, Citations & Hallucination Resistance**: Out-of-context citation injections, adversarial prompt delimiters (`[CHUNK_START`, `[[cite:`) in user documents, low-relevance queries tripping calibrated refusal thresholds, and multi-line sentence coordinate alignment on rotated/cropped PDFs.

### R2. Deterministic Quota & Rate Limit Enforcement
Verify hard constraints under high concurrency:
- Max 50 MB upload payload enforcement.
- Per-user 20-source limit enforced with row-level transaction locks (`SELECT ... FOR UPDATE`).
- Per-user 60 queries/hour chat rate limit with PostgreSQL window tracking.

### R3. Educational Relevance Content Barrier (YouTube Ingestion Guard)
Implement and verify a two-tier content moderation barrier during YouTube source ingestion:
1. **Description & Title Analysis**: Scans video metadata (title, description, tags, category) using educational anchor keywords vs negative entertainment/vlog/music signals.
2. **LLM Verification**: Ambiguous videos are evaluated by a fast classifier prompt analyzing whether the content is academic/educational.
3. **Rejection & Privacy Shielding**: If non-educational:
   - Ingestion halts immediately without vector indexing.
   - Video title, transcript, and description are **completely suppressed** from the workspace.
   - Source sets `status = "error"`, `error_code = "ERR_NON_EDUCATIONAL_CONTENT"`, and `error_message = "Upload educational related video, this video does not have educational content please recheck the link"`.
   - UI renders the required warning banner:
     > **⚠️ Upload educational related video, this video does not have educational content please recheck the link**

### R4. Implementation of Underlying Application Code & Passing Baseline Tests
Implement all necessary application components (`config.py`, `models.py`, `database.py`, services, background tasks, and routers) such that all 50 baseline tests (`SEC-01..08`, `STOR-01..12`, `ING-01..19`, `CIT-01..11`) transition from Red to Green.

### R5. Detailed Production-Readiness & Audit Report
Generate a comprehensive markdown report (`audit_and_stress_test_report.md` in the artifact directory C:\Users\Dharm\.gemini\antigravity\brain\31997130-7c17-4e81-a166-0cca55af7adb) detailing:
- Vulnerability / race-condition matrix with reproduction steps and resolution status.
- Verification of the Educational Content Barrier against non-educational YouTube links.
- Failure-mode recovery verifications (worker crash, stalled job recovery, delete mid-ingest).
- Performance under simulated load, memory footprint, and Qdrant storage usage.
- Architectural certification and sign-off.

## Acceptance Criteria

### Automated Verification
- [ ] All 50 baseline tests (`SEC-01..08`, `STOR-01..12`, `ING-01..19`, `CIT-01..11`) pass cleanly in `pytest`.
- [ ] Non-educational YouTube videos are blocked, return `ERR_NON_EDUCATIONAL_CONTENT`, display the exact warning text, and suppress content/description.
- [ ] Stress and adversarial tests run without unhandled exceptions or data resurrection.
- [ ] Zero cross-tenant data leakage or orphan vector/object artifacts in extreme abort simulations.
- [ ] The `audit_and_stress_test_report.md` artifact is generated with complete metrics and analysis.


## 2026-10-11T16:16:58Z

# Teamwork Project Prompt — Phased Implementation & Edge-Case Verification

> Status: Launched
> Goal: Craft prompt → get user approval → delegate to teamwork_preview
> Requested team: Full team (phased implementation, cumulative regression fencing, and extreme edge-case verification)

Implement the complete Next.js 15 3-Pane Grounded Study Workspace (TypeScript, Tailwind CSS, Zustand, MSW v2, PDF.js Bbox Engine, YouTube Auto-Seek, SSE Streaming) and Docker Orchestration sequentially across 6 decoupled phases, executing exhaustive edge-case test suites at the end of each phase with strict cumulative regression fencing.

Working directory: C:\Users\Dharm\.gemini\antigravity\scratch\studylm
Integrity mode: development

## Requirements

### R1. Phase 1: Core Scaffolding, Frozen Domain Types, Session State & MSW v2 Contract Layer
1. **Next.js 15 & Tooling Setup**: Scaffold `frontend/` with Next.js 15 (App Router, React 19, TypeScript, Tailwind CSS, Vitest 2.x, React Testing Library, Zustand 5.x).
2. **Contract Freeze (`src/types/api.ts`)**: Implement and freeze all domain interfaces (`SourceRead`, `SentenceSpan`, `ResolvedCitation`, `ChatMessageRead`, `NotebookRead`, `RateLimitStatus`, `ViewerFocusTarget`) matching backend SQLModel models 100%.
3. **MSW v2 Gateway Contract Harness (`tests/mocks/`)**: Full mock server modeling all 12 backend endpoints with success and edge-case error statuses (200, 206, 400, 401, 403, 404, 409, 413, 429, 500).
4. **Auth & Session Store**: Google OAuth / session management, Bearer token interceptor, anti-enumeration 404 handler, and cross-tenant session state purge.
5. **Phase 1 Edge-Case Verification**:
   - `test_google_oauth_session_initialization`
   - `test_unauthenticated_session_redirects_to_login`
   - `test_expired_jwt_triggers_token_refresh_or_logout`
   - `test_deactivated_user_displays_403_banner`
   - `test_anti_enumeration_404_handling`
   - `test_conflict_409_handling`
   - `test_rate_limit_429_interceptor`

### R2. Phase 2: Left Pane — Sources, Upload Dropzone, Quotas & YouTube Educational Moderation Barrier UI
1. **Notebook & Source Management**: Notebook switcher, source list with 5 lifecycle state badges (`processing` pulsing skeleton, `ready`, `deleting` grayed out, `reindexing` secondary tag, `error`).
2. **Quota & Upload Enforcement**:
   - 50MB file size client-side pre-flight blocker before network request.
   - 20-source per-user quota lock: 21st upload disabled with tooltip "Maximum 20 sources reached".
3. **Two-Tier YouTube Educational Moderation Barrier UI**:
   - Submitting non-educational URL displays exact verbatim amber warning banner:
     `⚠️ Upload educational related video, this video does not have educational content please recheck the link`
   - Video title is completely suppressed, rendering as `[Suppressed: Non-Educational Content]`.
   - Video description, transcript button, and inspect actions are blocked from workspace view.
4. **Phase 2 Edge-Case Verification**:
   - `test_non_educational_youtube_displays_exact_warning_banner`
   - `test_non_educational_youtube_suppresses_title_and_transcript`
   - `test_valid_educational_youtube_ingestion_renders_ready`
   - `test_client_blocks_upload_exceeding_50mb`
   - `test_twenty_source_quota_locks_upload_ui`
   - `test_backend_400_quota_error_renders_quota_toast`
   - `test_delete_source_requires_confirmation_and_optimistic_update`

### R3. Phase 3: Center Pane — Conversational Chat Workspace, Sentence-Buffered SSE & Citations
1. **SSE Streaming Consumer (`useSSEStream`)**: Incremental packet assembler handling fragmented chunk boundaries (`event: token`, `event: citation`, `event: refusal`, `event: done`, `event: error`).
2. **Sentence-Buffered Markdown Renderer**:
   - Replaces `[[cite:N]]` markers with clickable interactive citation pills `[N]`.
   - Hovercard displays authoritative source title, page number, and quote preview.
   - Unverified citations (`[Citation Unverified]`) render subtle warning pill with tooltip without crashing.
3. **Refusal & Rate Limit Handling**:
   - Calibrated retrieval refusal renders notice: "I don't have enough information in your notes to answer that."
   - 60 queries/hr rate limit error (429) disables prompt input and renders real-time countdown timer.
4. **Phase 3 Edge-Case Verification**:
   - `test_sse_parses_token_stream_incrementally`
   - `test_sse_handles_fragmented_packet_boundaries`
   - `test_sse_resolves_citations_on_done`
   - `test_sse_mid_stream_token_expiry_401`
   - `test_markdown_replaces_cite_tokens_with_interactive_pills`
   - `test_unverified_citation_renders_warning_tag`
   - `test_citation_pill_hovercard_displays_payload_quote`
   - `test_citation_pill_click_dispatches_sync_event`
   - `test_calibrated_refusal_renders_clear_notice`
   - `test_rate_limit_429_disables_chat_input_with_countdown`

### R4. Phase 4: Right Pane — Multimodal Deep-Link Inspector (PDF.js & YouTube Auto-Seek)
1. **PDF.js Canvas & Normalized Bounding Box Engine**:
   - High-fidelity PDF rendering with text layer.
   - Mathematical coordinate conversion mapping normalized $[0.0, 1.0]$ floats to viewport pixels across all 4 rotation angles ($0^\circ, 90^\circ, 180^\circ, 270^\circ$).
   - Multi-line bounding box rendering (`bboxes: number[][]`) with glowing pulse animation.
   - Scanned page fallback: when `bboxes` is empty (`[]`), renders page-level amber alert highlight.
2. **YouTube Auto-Seek Player**:
   - Embeds IFrame API with timestamp seeking (`seekTo(start_seconds, true)`).
   - Formats timestamp badges (`MM:SS` or `HH:MM:SS`).
3. **Multimodal Inspector Switcher**: Seamlessly toggles between PDF viewer and YouTube player based on citation target.
4. **Phase 4 Edge-Case Verification**:
   - `test_transform_box_across_all_rotations_0_90_180_270`
   - `test_percentage_to_pixel_viewport_mapping`
   - `test_multiline_sentence_renders_multiple_highlight_rectangles`
   - `test_scanned_page_empty_bboxes_renders_page_banner`
   - `test_active_citation_scrolls_target_page_into_view`
   - `test_youtube_player_seek_to_exact_timestamp`
   - `test_multimodal_tab_switching_preserves_scroll_and_timestamp`

### R5. Phase 5: Composite 3-Pane Workspace, Cross-Pane Event Bus & Playwright E2E
1. **Composite Workspace Shell**: Resizable 3-pane layout using `react-resizable-panels` with persisted widths in localStorage and mobile drawer collapse.
2. **Decoupled Single-Direction Event Bus**: Inter-pane synchronization via `ViewerFocusTarget` (`source_id`, `page_number`, `bboxes`, `start_seconds`) on Zustand store. Panes never directly touch peer DOM.
3. **Playwright End-to-End Suite**:
   - `test_e2e_student_complete_rag_journey`: Login -> create notebook -> upload PDF -> wait ready -> ask question -> verify streaming -> click citation [1] -> assert PDF scrolled to page 42 with yellow highlight box visible.
   - `test_e2e_entertainment_video_rejection`: Submit music video link -> assert banner `⚠️ Upload educational related video...` appears -> assert title masked -> assert inspector remains closed.
   - `test_e2e_cross_tenant_isolation`: User B navigates to User A's notebook -> assert 404 page -> 0 data exposed.
4. **Phase 5 Edge-Case Verification**:
   - `test_resizable_pane_drag_persists_widths`
   - `test_mobile_drawer_collapses_left_and_right_panes`
   - `test_keyboard_shortcuts_panel_toggle`

### R6. Phase 6: Production Docker Orchestration & Reverse Proxy Hardening
1. **Next.js Standalone Dockerfile**: Multi-stage build producing minimal production container.
2. **Docker Compose Parity**: Orchestrates Next.js frontend, FastAPI backend, Procrastinate worker, PostgreSQL 16, Qdrant, and Caddy reverse proxy.
3. **Caddy Reverse Proxy Configuration**: Hardened Caddyfile supporting HTTP 206 partial content range requests for PDF streaming, unbuffered SSE streaming (`X-Accel-Buffering: no`), and strict CSP headers.
4. **Phase 6 Edge-Case Verification**:
   - `test_frontend_standalone_docker_healthcheck`
   - `test_csp_and_security_headers`
   - `test_http_206_pdf_range_streaming_through_reverse_proxy`

## Acceptance Criteria

### Automated Verification & Cumulative Regression Fencing
- [ ] **Cumulative Regression Invariant**:
  - `pnpm test:phase1` passes all Phase 1 tests.
  - `pnpm test:phase2` runs Phase 1 + Phase 2 tests (zero Phase 1 regression).
  - `pnpm test:phase3` runs Phase 1 + Phase 2 + Phase 3 tests.
  - `pnpm test:phase4` runs Phase 1 + Phase 2 + Phase 3 + Phase 4 tests.
  - `pnpm test:phase5` runs Phase 1..5 tests + Playwright E2E suite.
- [ ] **TypeScript & Linting Gate**: `pnpm tsc --noEmit` and `pnpm lint` exit with code 0 at every phase.
- [ ] **Educational Barrier Invariant**: Non-educational YouTube videos show verbatim warning `Upload educational related video, this video does not have educational content please recheck the link`, title is suppressed to `[Suppressed: Non-Educational Content]`, and no transcript/inspector is rendered.
- [ ] **Hard Quota Enforcement**: 50MB client-side upload blocker and 20-source quota lock verified.
- [ ] **Rotation Geometry Proof**: PDF coordinate transforms verified at $0^\circ, 90^\circ, 180^\circ, 270^\circ$.
- [ ] **Docker Orchestration**: Clean build and healthy start for frontend standalone container and Caddy proxy.


## 2026-10-13T14:44:42Z

# Teamwork Project Prompt — Phased Implementation & Edge-Case Verification (Resuming Phase 5 & 6)

> Status: Launched
> Goal: Continue implementation from Phase 5 → Phase 6 → Final Victory Audit
> Requested team: Full team (phased implementation, cumulative regression fencing, and extreme edge-case verification)

Implement and verify the remaining phases (Phase 5: Composite 3-Pane Workspace Shell, Keyboard Shortcuts, Session Resume, Playwright E2E suites; and Phase 6: Docker Production Orchestration Verification & Final Victory Audit) of the StudyLM Grounded Study Workspace, continuing from the certified 100% green baseline of Phases 1–4.

Working directory: C:\Users\Dharm\.gemini\antigravity\scratch\studylm
Integrity mode: development

## Baseline (Already Certified PASS)
- **Backend**: 100% complete and certified with 180/180 pytest tests passing (`py -m pytest`).
- **Phase 1 (Core Scaffolding, Frozen Types, MSW v2 Gateway, Auth Session)**: Certified PASS (61 tests green).
- **Phase 2 (Left Sidebar, Quotas, YouTube Educational Barrier UI with exact warning banner & title suppression)**: Certified PASS (45 tests green).
- **Phase 3 (Center Chat Workspace, Incremental SSE, Grounded Markdown & Citations, Rate Limit Countdown)**: Certified PASS (36 tests green).
- **Phase 4 (Right Multimodal Deep-Link Inspector, PDF Coordinate Transforms 0/90/180/270°, YouTube Seek & Non-Educational Early Return)**: Certified PASS (65 tests green).
- **Cumulative Status**: 27 test files, 223/223 tests passing in frontend, 0 TypeScript errors (`tsc --noEmit`), 0 ESLint errors (`eslint .`), Next.js 15 standalone build clean.

## Requirements to Complete

### R5. Phase 5: Composite 3-Pane Workspace Shell, Event Bus & E2E Verification
1. **Composite Workspace Shell (`WorkspaceShell.tsx`)**:
   - Verify Left Pane (SourceList, NotebookSelector, FileUploadDropzone, QuotaBadge).
   - Verify Center Pane (ViewerContainer with PdfViewer / YouTubeViewer).
   - Verify Right Pane (ChatContainer with SSE stream, MessageList, CitationChips, RateLimitIndicator).
   - Resizable split-pane handles with `localStorage` size persistence.
2. **Mobile Drawers & Keyboard Shortcuts**:
   - Responsive drawers/collapsible panels (<768px).
   - Keyboard navigation (`Cmd/Ctrl+B` toggle left, `Cmd/Ctrl+J` toggle right, `Cmd/Ctrl+K` quick search/notebook).
   - Session resume hook (`useSessionResume.ts`) restoring active notebook and sources on load.
3. **E2E & Layout Test Suite**:
   - Implement E2E suites in `tests/phase5/` or Playwright covering:
     a. `test_e2e_student_complete_rag_journey`: Login -> create notebook -> upload PDF -> wait ready -> ask question -> verify streaming -> click citation [1] -> assert target page rendered with highlight.
     b. `test_e2e_entertainment_video_rejection`: Submit non-educational YouTube video -> verify exact warning banner `⚠️ Upload educational related video, this video does not have educational content please recheck the link` -> verify title masked to `[Suppressed: Non-Educational Content]` -> assert player/transcript blocked.
     c. `test_e2e_cross_tenant_isolation`: User B accesses User A's notebook -> assert 404 shielding and 0 data leaked.
   - Run cumulative verification gate `pnpm run verify:p5` (must pass Phases 1-5 + E2E with 0 regressions).

### R6. Phase 6: Production Docker Orchestration & Reverse Proxy Hardening
1. **Next.js Standalone Dockerfile**: Verify multi-stage build producing minimal production container with `node:22-alpine`.
2. **Docker Compose Parity**: Orchestrate Next.js frontend, FastAPI backend, Procrastinate worker, PostgreSQL 16, Qdrant, and Caddy reverse proxy.
3. **Caddy Reverse Proxy Configuration**: Verify `frontend/docker/Caddyfile` supports HTTP 206 range requests for PDF streaming, unbuffered SSE streaming (`X-Accel-Buffering: no`), and strict CSP headers.
4. **Phase 6 Verification**: Run `tests/phase5/test_deployment_docker_parity.test.ts`.

### Final Victory Audit
- An independent Forensic Auditor must verify:
  1. Full cumulative test suite passing with 0 failures (`pnpm test:all` or `pnpm verify:all`).
  2. Clean static analysis (`tsc --noEmit` and `eslint .`).
  3. Clean Next.js 15 production build (`pnpm build`).
  4. Backend pytest suite green (`py -m pytest`, 180/180 pass).
  5. Zero hardcoded bypasses or leaked non-educational YouTube metadata.

## Acceptance Criteria
- [ ] `pnpm run verify:p5` passes with 0 errors.
- [ ] `pnpm build` creates valid `.next/standalone`.
- [ ] Backend `py -m pytest` passes 180/180 tests.
- [ ] Exact educational rejection banner and title masking verified end-to-end.
- [ ] Final Victory Audit signed off.


## 2026-11-09T16:03:57Z

# Teamwork Project Prompt — StudyLM Frontend UI/UX (Phase 1: Token & Theme Foundations)

> Status: Launched  
> Goal: Implement and verify Phase 1 strictly, then STOP and report for user approval before proceeding to Phase 2  
> Requested team: Focused team for Phase 1 implementation, design token verification, and cumulative regression fencing  

Implement Phase 1 of the StudyLM Frontend UI/UX overhaul according to the approved plan. After completing Phase 1 and passing all verification tests, **STOP immediately and do not touch Phase 2 files**. Report results and wait for user approval to proceed to the next phase.

Working directory: C:\Users\Dharm\.gemini\antigravity\scratch\studylm  
Integrity mode: development  

## Context & Constraints
- **Approved Implementation Plan**: `C:\Users\Dharm\.gemini\antigravity\brain\31997130-7c17-4e81-a166-0cca55af7adb\studylm_ui_ux_overhaul_plan.md`
- **Figma Reference**: [Figma Project (Node 4:22)](https://www.figma.com/design/hbMtpoO70qU9X9Rzk6RA8y/Untitled?node-id=4-22)
- **Baseline**: 271/271 frontend vitest tests passing across 33 test files; 180/180 backend pytest tests passing.
- **Stop-and-Wait Rule**: After completing Phase 1, stop execution and request user approval. Do NOT proceed to Phase 2 (Landing Page components) in this run.

---

## Requirements for Phase 1

### R1. Configure Tailwind Theme Tokens
In `frontend/tailwind.config.ts`, extend `theme.extend.colors` with the exact Figma Dark Obsidian palette:
- `obsidian-canvas`: `#191C23`
- `obsidian-surface`: `#111318`
- `obsidian-surface-tint`: `#242238`
- `obsidian-accent`: `#8B83FF`
- `obsidian-accent-hover`: `#7A72F0`
- `obsidian-border`: `#30343E`
- `obsidian-text-primary`: `#F3F4F6`
- `obsidian-text-secondary`: `#A1A6B3`
- `obsidian-text-dim`: `#737B8C`
- `obsidian-warning`: `#F59E0B`
- Preserve existing HSL variable mappings (`background`, `foreground`, `card`, `border`, etc.) so that all existing components continue to function seamlessly without regressions.

### R2. Align CSS Variables with Dark Obsidian Palette
In `frontend/src/app/globals.css`:
- Map the `.dark` class CSS variables to match the Obsidian tones:
  - `--background`: 222 17% 12% (corresponds to `#191C23`)
  - `--card`: 225 17% 8% (corresponds to `#111318`)
  - `--border`: 222 13% 22% (corresponds to `#30343E`)
  - `--primary`: 244 100% 76% (corresponds to `#8B83FF`)
  - `--primary-foreground`: 222 17% 12%
- Verify WCAG AAA contrast between foreground and background.

### R3. Base Document Configuration
In `frontend/src/app/layout.tsx`:
- Ensure `<html lang="en" className="dark">` is retained.
- Apply `bg-[#191C23] text-[#F3F4F6] selection:bg-[#8B83FF]/30 selection:text-[#F3F4F6] antialiased` to the `<body>`.

### R4. Phase 1 Verification & Cumulative Regression Protection
1. Run `pnpm exec vitest run tests/phase1/test_design_tokens.test.tsx` to ensure design token contrast and landmark tests pass.
2. Run full vitest suite: `pnpm exec vitest run` (all 33 test files must pass with 271/271 green tests).
3. Run `pnpm tsc --noEmit` to guarantee zero TypeScript errors.
4. Stop execution and report verification evidence. Do NOT create or modify Phase 2 landing page files.

---

## Acceptance Criteria
- [ ] `tailwind.config.ts` exports `obsidian` tokens matching the Figma design hex codes.
- [ ] `globals.css` dark theme variables match Obsidian `#191C23` canvas and `#111318` card surfaces.
- [ ] `tests/phase1/test_design_tokens.test.tsx` passes with 0 errors.
- [ ] `pnpm exec vitest run` passes 100% (271/271 tests).
- [ ] `pnpm tsc --noEmit` passes with 0 errors.
- [ ] Execution stops cleanly after Phase 1 with a report ready for user review.


## 2026-11-09T16:18:48Z

# Teamwork Project Prompt — StudyLM Frontend UI/UX (Phase 2: 7-Section Landing Page)

> Status: Launched  
> Goal: Implement and verify Phase 2 strictly (7-Section Landing Page + in-place gateway + interactive hero preview + test suite), then STOP and report for user approval before proceeding to Phase 3  
> Requested team: Focused team for Phase 2 landing page implementation, component interaction testing, and cumulative regression fencing  

Implement Phase 2 of the StudyLM Frontend UI/UX overhaul according to the approved plan. After completing Phase 2 and passing all edge-case tests, **STOP immediately and do not touch Phase 3 files**. Report results and wait for user approval to proceed to Phase 3.

Working directory: C:\Users\Dharm\.gemini\antigravity\scratch\studylm  
Integrity mode: development  

## Context & Constraints
- **Approved Implementation Plan**: `C:\Users\Dharm\.gemini\antigravity\brain\31997130-7c17-4e81-a166-0cca55af7adb\studylm_ui_ux_overhaul_plan.md`
- **Figma Reference**: [Figma Project (Node 4:22)](https://www.figma.com/design/hbMtpoO70qU9X9Rzk6RA8y/Untitled?node-id=4-22)
- **Figma Visual Renders**: `landing-full.png`, `section2.png` through `section7.png` in the brain artifacts directory.
- **SVG Design Assets**: `frontend/public/section2.svg` through `section7.svg` and `landing-figma.svg`.
- **Baseline**: Phase 1 verified PASS. 271/271 frontend vitest tests passing across 33 test files; 180/180 backend pytest tests passing.
- **Stop-and-Wait Rule**: After completing Phase 2, stop execution and request user approval. Do NOT proceed to Phase 3 (Auth/Onboarding modals) in this run.

---

## Requirements for Phase 2

### R1. Modular Landing Page Components in `src/components/landing/`
Build high-fidelity, accessible React 19 + Tailwind CSS components in Dark Obsidian (`#191C23` canvas, `#111318` surface, `#8B83FF` accent, `#30343E` border):
1. **`LandingNavbar.tsx`**:
   - Sticky top header with backdrop blur (`backdrop-blur-md bg-[#191C23]/80 border-b border-[#30343E]`).
   - StudyLM logo (glowing lavender dot + bold typography).
   - Anchor links: `#how-it-works`, `#features`, `#use-cases`, `#faq`.
   - Action button: "Sign In" (opens `SignInModal` or dev login), or "Open Workspace →" pill if authenticated.
2. **`HeroSection.tsx`**:
   - Overline: `EVIDENCE, NOT JUST ANSWERS` in `#8B83FF`.
   - Headline: `A citation is a starting point. Not a footnote.`
   - Side description text and CTA buttons: `[Get started with StudyLM →]` and `[Explore Interactive Demo]`.
   - **Interactive Illustrative Workspace Preview Card**:
     - Left side: Mock chat query response with citation chips `[1]`, `[2]`, `[3]`.
     - Right side: Mock document inspector showing the active excerpt and verified quote callout.
     - Clicking `[1]`, `[2]`, or `[3]` updates the active citation in state, highlighting the corresponding excerpt and updating the quote in real time.
   - 3 Quick Highlights row below the card: Page-level context, Lecture timestamps, and Multi-source synthesis.
3. **`HowItWorksSection.tsx`**:
   - Headline: `From source material to a clearer answer.`
   - 3 numbered step cards matching Figma Section 2:
     - `01 Bring your sources` (Upload progress card with 4 sources).
     - `02 Ask in your own words` (Search bar prompt mockup).
     - `03 Follow the evidence` (Exact verified citation quote callout card).
4. **`FeaturesGridSection.tsx`**:
   - Headline: `Everything stays connected to your material.`
   - 6-card grid matching Figma Section 3:
     1. *Define the scope* (per-source selection)
     2. *Compare explanations* (multi-document synthesis)
     3. *Unpack difficult concepts* (interactive grounding)
     4. *Revisit the right moment* (video lecture timestamps)
     5. *Keep the question going* (contextual follow-ups)
     6. *Organize by how you think* (notebook management)
5. **`UseCasesSection.tsx`**:
   - Headline: `For the questions worth spending time on.`
   - 2 audience cards matching Figma Section 4:
     - **For Students**: *"Understand it. Don't just reread it."* with sample prompts.
     - **For Researchers**: *"Read across sources. Think critically."* with comparative chips.
6. **`ConnectIdeasSection.tsx`**:
   - Headline: `A clearer view. Across every source.`
   - Multi-source synthesis inspector matching Figma Section 5:
     - Paper PDF + Textbook PDF + Video Lecture + "The Connection" callout.
7. **`FaqSection.tsx`**:
   - Headline: `Good questions. Clear answers.`
   - 5 expandable/collapsible accordions matching Figma Section 6 with smooth animations and `aria-expanded` attributes:
     - How does StudyLM use my sources?
     - How is this different from standard chat AI?
     - How do citations work?
     - Can I compare multiple sources at once?
     - How do I know the answers are accurate?
8. **`CtaBannerSection.tsx`**:
   - Overline: `START WITH ONE QUESTION`
   - Headline: `Your next insight is already in your sources.`
   - Button: `[Get started with StudyLM →]`
   - Subtext: `Upload → Ask → Inspect`
9. **`LandingFooter.tsx`**:
   - StudyLM branding, status indicator ("All systems operational"), copyright, navigation links, and GitHub/docs links.
10. **`LandingPage.tsx`**:
   - Composite component assembling all 7 sections, Navbar, and Footer.

### R2. Seamless In-Place Gateway in `src/app/page.tsx`
- Conditionally render `LandingPage` when unauthenticated (`!isAuthenticated`).
- Render `WorkspaceShell` when authenticated or when "Open Workspace" is clicked.
- If an authenticated user views the landing page, display a persistent top banner: *"You are signed in as [User]. [Return to Workspace →]"*.
- Maintain 100% backward compatibility with existing tests that render `WorkspaceShell` or `Home`.

### R3. Interactive & Edge-Case Verification Suite
- Create `frontend/tests/ui/test_landing_page_interactions.test.tsx`:
  1. `test_renders_all_7_sections_with_landmarks`: Verify all 7 section landmarks and headlines are present.
  2. `test_hero_interactive_workspace_card_citation_switching`: Verify clicking `[1]`, `[2]`, `[3]` pills changes the active quote text and highlights.
  3. `test_faq_accordion_expand_collapse`: Verify clicking accordion headers toggles `aria-expanded` and reveals/hides answer content.
  4. `test_cta_and_navbar_navigation`: Verify clicking "Get started" or "Sign In" calls the open sign-in action or navigates correctly.
  5. `test_authenticated_user_banner`: Verify banner appears when authenticated and links back to workspace.
- Run `pnpm tsc --noEmit` (0 errors).
- Run `pnpm eslint .` (0 errors).
- Run `pnpm exec vitest run` across all 34 test files (271+ tests passing).

---

## Acceptance Criteria
- [ ] All 10 landing page components created in `src/components/landing/`.
- [ ] Interactive hero preview card updates quotes and highlighted excerpt on citation pill clicks.
- [ ] FAQ accordions toggle with proper accessibility attributes (`aria-expanded`, `aria-controls`).
- [ ] `src/app/page.tsx` switches cleanly between landing page and workspace.
- [ ] `tests/ui/test_landing_page_interactions.test.tsx` passes 5/5 tests.
- [ ] Cumulative vitest test suite passes 100% (271+ tests).
- [ ] `pnpm tsc --noEmit` and `pnpm eslint .` pass with 0 errors.
- [ ] Execution stops cleanly after Phase 2 with a report ready for user review.


## 2026-11-09T17:28:04Z

# Teamwork Project Prompt — StudyLM Frontend Complete Implementation (Phases 3–6)

> Status: Launched  
> Goal: Complete the entire frontend implementation (Phases 3–6) sequentially, running automated edge-case and regression tests at each phase, until all acceptance criteria are fully met  
> Requested team: Full team (phased implementation, cumulative regression fencing, and forensic victory audit)  

Execute the remaining phases (Phase 3 through Phase 6) of the StudyLM Frontend UI/UX overhaul according to the approved plan. Work must proceed sequentially through each phase, running dedicated edge-case test suites and verifying zero cumulative regressions at the end of every phase, until the entire frontend implementation is certified complete.

Working directory: C:\Users\Dharm\.gemini\antigravity\scratch\studylm  
Integrity mode: development  

## Context & Baseline
- **Approved Plan**: `C:\Users\Dharm\.gemini\antigravity\brain\31997130-7c17-4e81-a166-0cca55af7adb\studylm_ui_ux_overhaul_plan.md`
- **Figma Reference**: [Figma Project (Node 4:22)](https://www.figma.com/design/hbMtpoO70qU9X9Rzk6RA8y/Untitled?node-id=4-22)
- **Baseline**:
  - Phase 1 (Tokens & Dark Obsidian Theme): Certified PASS.
  - Phase 2 (7-Section Landing Page & In-Place Gateway): Certified PASS.
  - Test Suite Baseline: 304/304 frontend tests passing across 36 test files; 180/180 backend tests passing.

---

## Requirements to Complete

### R3. Phase 3: Material 3 Auth Modal & Guided Onboarding Flow
1. **`src/components/auth/SignInModal.tsx`**:
   - Material 3 dark obsidian dialog with backdrop blur (`#111318/90`, border `#30343E`, `rounded-3xl shadow-2xl`).
   - "Continue with Google" button (initiates `/api/v1/auth/google/login`).
   - "Quick Dev / Demo Sign-In" button: 1-click test session that sets active student credentials in `useAuthStore` (`Alex Student`, `student@university.edu`, active token).
   - Keyboard accessible (`Escape` key dismiss, focus trap, ARIA `role="dialog"`, `aria-modal="true"`).
2. **`src/components/onboarding/LoginOnboardingModal.tsx`**:
   - Triggers immediately after authentication:
     - **Path A (Existing User)**: "Continue with [Last Active Notebook] → Open Workspace" or "Create a new notebook".
     - **Path B (New User with 0 notebooks)**: 2-step wizard (Enter notebook title $\rightarrow$ creates notebook and opens source upload modal).
3. **Store Integration**:
   - Update `useWorkspaceStore`: add `isSignInModalOpen`, `setSignInModalOpen`, `isOnboardingOpen`, `setOnboardingOpen`.
   - Wire `LandingNavbar.tsx` and `HeroSection.tsx` Sign-In / Get Started buttons to trigger `setSignInModalOpen(true)`.
   - Mount `SignInModal` and `LoginOnboardingModal` in `LandingPage.tsx` / `page.tsx`.
4. **Phase 3 Verification**:
   - Author `frontend/tests/ui/test_auth_and_onboarding_modal.test.tsx` verifying modal opening/closing, 1-click demo login, onboarding routing, and Google redirect trigger.
   - Run cumulative vitest check (all tests must pass with 0 regressions).

### R4. Phase 4: Reorganized 3-Pane Workspace Shell & Source Scope Selector
1. **Left Sidebar Reorganization**:
   - Top Header: StudyLM Logo (clicking navigates back to landing page with persistent return banner) + Notebook Switcher.
   - Build `src/components/sidebar/SourceScopeSelector.tsx`: Checkbox per source `[✓]` with count header `3 of 4 sources selected` to define chat query scope.
   - Fixed Bottom Bar: Prominent lavender `[＋ Create Notebook]` button (`data-testid="sidebar-create-notebook-btn"`).
2. **Center Chat Enhancements**:
   - In `src/components/chat/ChatContainer.tsx`: when conversation is empty, display Clickable Starter Prompt Chips (`[Summarize this material]`, `[Compare viewpoints]`, `[Generate practice questions]`).
   - Clicking any chip automatically submits the prompt to the SSE streaming pipeline.
3. **Right Pane Unified Inspector Stack (`src/components/viewer/UnifiedInspectorPane.tsx`)**:
   - Vertically split stack:
     - **Top**: Expandable Citations Card Feed showing verified quote, source name, page number / timestamp for active answer.
     - **Bottom**: Live Viewer (PDF canvas with rotated bounding boxes $0^\circ, 90^\circ, 180^\circ, 270^\circ$, or YouTube auto-seek player).
     - **Non-Educational YouTube Video Shield**: Full warning card with verbatim banner `⚠️ Upload educational related video, this video does not have educational content please recheck the link`, title suppressed to `[Suppressed: Non-Educational Content]`, transcript and player locked, and quota reclaim delete button.
4. **Slot Compatibility**:
   - Maintain all existing slot prop interfaces and ARIA landmarks (`data-testid="left-sidebar-slot"`, `data-testid="center-viewer-slot"`, `data-testid="right-chat-slot"`, `data-testid="workspace-desktop-layout"`).
5. **Phase 4 Verification**:
   - Author `frontend/tests/ui/test_unified_inspector_and_scope.test.tsx` verifying scope filtering, starter prompt chips, citations feed, and viewer synchronization.
   - Run `tests/phase5/test_composite_workspace_layout.test.tsx` and full cumulative vitest suite.

### R5. Phase 5: Mobile Bottom Navigation Bar (<768px) with Smart Jump
1. Build `src/components/layout/MobileBottomNav.tsx`:
   - Material 3 bottom navigation bar fixed for viewports `<768px` with 3 tabs:
     - `Sources` (Folder icon)
     - `Chat` (MessageSquare icon)
     - `Inspector` (Eye / BookOpen icon)
2. Update `src/components/layout/WorkspaceShell.tsx`:
   - Manage active mobile tab (`mobileTab: 'sources' | 'chat' | 'inspector'`).
   - **Smart Jump**: When a citation pill `[N]` is tapped inside the Chat tab on mobile, automatically switch `mobileTab` to `'inspector'` and scroll the bottom viewer to that page / timestamp.
   - Maintain slide-over drawer fallback and `Escape` key listeners.
3. **Phase 5 Verification**:
   - Author `frontend/tests/ui/test_mobile_bottom_nav_and_smart_jump.test.tsx` verifying tab switching, smart jump on citation click, and desktop hiding.
   - Run cumulative vitest check.

### R6. Phase 6: Full Regression Verification & Production Standalone Build
1. Static type check: `pnpm tsc --noEmit` (0 errors).
2. Code quality: `pnpm eslint .` (0 errors).
3. Full Vitest test suite: `pnpm exec vitest run` across all test files (100% pass across 304+ tests, 0 regressions).
4. Backend integration check: `cd ../backend; py -m pytest -q` (180/180 pass).
5. Standalone build: `pnpm build` (generates `.next/standalone` production container distribution cleanly).

---

## Acceptance Criteria
- [ ] **Phase 3**: `SignInModal.tsx` and `LoginOnboardingModal.tsx` implemented and verified; `test_auth_and_onboarding_modal.test.tsx` passes.
- [ ] **Phase 4**: `SourceScopeSelector.tsx` and `UnifiedInspectorPane.tsx` integrated; starter prompt chips functional; `test_unified_inspector_and_scope.test.tsx` passes; YouTube barrier shield verified.
- [ ] **Phase 5**: `MobileBottomNav.tsx` active on mobile; Smart Jump switches tab to Inspector on citation tap; `test_mobile_bottom_nav_and_smart_jump.test.tsx` passes.
- [ ] **Phase 6**: `pnpm tsc --noEmit` (0 errors), `pnpm eslint .` (0 errors), full vitest suite (100% green), backend pytest (180/180 green), and `pnpm build` succeeds.
- [ ] **Victory Audit**: Independent Victory Auditor certifies complete implementation with VICTORY CONFIRMED.
