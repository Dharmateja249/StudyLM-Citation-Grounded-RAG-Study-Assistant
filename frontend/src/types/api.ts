/**
 * StudyLM Domain Interfaces — Frozen Contract matching backend/app/models.py 100%
 * File: frontend/src/types/api.ts
 */

// 1. Core Source & Ingestion Types
export type SourceType = 'pdf' | 'image' | 'youtube';
export type SourceStatus = 'processing' | 'ready' | 'error' | 'deleting';
export type SummaryStatus = 'pending' | 'ready' | 'error';

export type SourceErrorCode =
  | 'ERR_CORRUPT_FILE'
  | 'ERR_YT_NO_TRANSCRIPT'
  | 'ERR_NON_EDUCATIONAL_CONTENT'
  | string;

export interface SentenceSpan {
  sentence_id: string; // "s0", "s1", "s2", ...
  text: string;
  bboxes: number[][]; // Multi-line: [[x0, y0, x1, y1], ...] normalized in [0.0, 1.0]
  start_seconds?: number | null;
  end_seconds?: number | null;
}

export interface SourceRead {
  id: string;
  user_id: string;
  notebook_id: string;
  title: string;
  source_type: SourceType;
  storage_key_or_url: string;
  file_size_bytes?: number | null;
  page_count?: number | null;
  estimated_tokens?: number | null;
  duration_seconds?: number | null;
  active_ingest_run_id?: string | null;
  status: SourceStatus;
  reindexing: boolean;
  error_code?: SourceErrorCode | null;
  error_message?: string | null;
  summary?: string | null;
  summary_status: SummaryStatus;
  created_at: string;
}

export interface SourceCreate {
  title: string;
  source_type: SourceType;
  storage_key_or_url: string;
}

// 2. Notebook & Multi-Tenancy Types
export type NotebookStatus = 'active' | 'deleting' | 'error';

export interface NotebookRead {
  id: string;
  user_id: string;
  title: string;
  status: NotebookStatus;
  created_at: string;
}

export interface NotebookCreate {
  title?: string;
}

export interface NotebookUpdate {
  title?: string;
}

// 3. User & Auth Types
export interface UserProfileResponse {
  id: string;
  email: string;
  name: string;
  avatar_url?: string | null;
  is_active: boolean;
  last_active_notebook_id?: string | null;
  created_at: string;
}

export type UserRead = UserProfileResponse;

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserProfileResponse;
}

export interface DeletionResponse {
  status: string;
  message: string;
}

// 4. Authoritative Citation & Grounding Types
export interface ResolvedCitation {
  marker_id: number; // 1, 2, ... corresponding to [[cite:1]]
  source_id: string;
  source_title: string;
  source_type: SourceType;
  page_number?: number | null;
  bboxes: number[][]; // Multi-line: [[x0, y0, x1, y1], ...] in [0.0, 1.0]
  start_seconds?: number | null;
  deep_link: string; // PDF viewer anchor or YouTube timestamp URL
  quote: string; // Verbatim quote from stored Qdrant payload truth
}

// 5. Message & Chat History Types
export type MessageRole = 'user' | 'assistant';

export interface ChatMessageRead {
  id: string;
  notebook_id: string;
  role: MessageRole;
  content: string;
  citations?: ResolvedCitation[];
  injected_chunk_ids?: string[];
  created_at: string;
}

export type MessageRead = ChatMessageRead;

export interface MessageCreate {
  role: MessageRole;
  content: string;
}

// 6. Query & Rate Limiting Types
export interface QueryRequest {
  notebook_id?: string;
  query: string;
  source_ids?: string[];
}

export interface QueryResponse {
  answer: string;
  citations: ResolvedCitation[];
  refusal: boolean;
}

export interface RateLimitStatus {
  queryCount: number;
  maxQueries: number; // 60 queries/hr
  windowStart: string;
  retryAfterSeconds?: number;
  isRateLimited?: boolean;
  isLocked?: boolean;
}

// 7. Inter-Pane Focus Event (Decoupling Bridge)
export interface ViewerFocusTarget {
  sourceId: string;
  pageNumber?: number;
  bboxes?: number[][]; // Multi-line: [[x0, y0, x1, y1], ...] in [0.0, 1.0]
  startSeconds?: number;
  quote?: string;
  timestamp: number; // Disambiguates consecutive clicks on identical citation
}

// 8. Streaming Event Types (CIT-11)
export type SSEEvent =
  | { type: 'token'; content: string }
  | { type: 'citation'; citation: ResolvedCitation }
  | { type: 'refusal'; message: string }
  | { type: 'content'; text: string; citations: ResolvedCitation[] }
  | { type: 'done'; total_citations?: number }
  | { type: 'error'; message: string; code?: string };
