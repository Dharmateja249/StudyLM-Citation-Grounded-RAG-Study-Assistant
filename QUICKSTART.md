# StudyLM - Quick Start & Operations Guide

## 1. Prerequisites & Environment
Ensure you have Python 3.12+ and Node.js 18+ (with `pnpm`) installed. All external credentials for live services are managed via `.env` in the root directory:
- **Neon PostgreSQL**: Relational tables, user sessions, audit logs, and rate limiting.
- **Qdrant Cloud**: 768-dimensional vector store collection (`studylm_chunks`).
- **Google Gemini AI**: `gemini-embedding-2` for embeddings and `gemini-3.5-flash` for grounded synthesis.
- **Supabase S3 Storage**: `studyLM-sources` bucket for PDF binaries and HTTP 206 range streaming.

---

## 2. Starting the Application

### Start the Backend Server (Port 8000)
```powershell
cd backend
py run.py
```
- API Base: `http://127.0.0.1:8000`
- Interactive OpenAPI Docs: `http://127.0.0.1:8000/docs`
- Health Endpoint: `http://127.0.0.1:8000/health`

### Start the Frontend Dev Server (Port 3000)
```powershell
cd frontend
pnpm dev
```
- Web Application: `http://localhost:3000`

---

## 3. Using the Study Workspace

1. **Sign In**:
   - **Dev / Demo Mode**: Click **"Sign In as Dev User"** (or in the Sign-In modal, click **"Student Demo Login"**). Automatically signs in as Alex Student (`student@university.edu`).
   - **Google OAuth**: Click **"Continue with Google"** to trigger the account chooser redirect flow.
2. **Upload Sources**:
   - **PDF Upload**: Drag and drop any PDF (e.g. `sample_quantum_physics.pdf`) into the sidebar dropzone.
   - **YouTube Ingestion**: Click **"Add YouTube"** and paste an educational lecture link.
3. **Inspect Documents**:
   - Click any source card in the left sidebar to load it into the center Document Inspector.
   - Use page controls, zoom, and text inspection powered by RFC 7233 byte-range streaming.
4. **Ask Questions**:
   - Type queries into the chat box on the right (e.g., *"What is quantum entanglement according to the notes?"*).
   - Responses stream in real time with clickable citation pills (`[1]`).
   - Clicking citation pills jumps directly to the highlighted source passage.

---

## 4. Running the Automated Test Suites

### Backend Tests (Pytest)
```powershell
cd backend
$env:PYTHONPATH="C:\Users\Dharm\.gemini\antigravity\scratch\studylm\backend"

# Run Live Cloud Integration Tests (Zero Mocks)
py -m pytest tests/test_live_services_integration.py -v

# Run 4-Tier Automated End-to-End Test Matrix (82 tests)
py -m pytest tests/e2e/ -v

# Run Full Backend Suite (186 tests)
py -m pytest tests -q
```

### Frontend Tests (Vitest)
```powershell
cd frontend

# Run all 356 component, layout, and UI interaction tests
pnpm test:all
```
