/**
 * StudyLM Zod Validation Schemas
 * File: frontend/src/types/schemas.ts
 *
 * Runtime validation schemas matching frontend/src/types/api.ts and backend/app/models.py
 */

import { z } from 'zod';

// =========================================================================
// 1. Core Source & Ingestion Schemas
// =========================================================================

export const SourceTypeSchema = z.enum(['pdf', 'image', 'youtube']);

export const SourceStatusSchema = z.enum(['processing', 'ready', 'error', 'deleting']);

export const SummaryStatusSchema = z.enum(['pending', 'ready', 'error']);

export const SourceErrorCodeSchema = z.string();

export const SentenceSpanSchema = z.object({
  sentence_id: z.string(),
  text: z.string(),
  bboxes: z.array(z.array(z.number())),
  start_seconds: z.number().nullable().optional(),
  end_seconds: z.number().nullable().optional(),
});

export const SourceReadSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  notebook_id: z.string(),
  title: z.string(),
  source_type: SourceTypeSchema,
  storage_key_or_url: z.string(),
  file_size_bytes: z.number().nullable().optional(),
  page_count: z.number().nullable().optional(),
  estimated_tokens: z.number().nullable().optional(),
  duration_seconds: z.number().nullable().optional(),
  active_ingest_run_id: z.string().nullable().optional(),
  status: SourceStatusSchema,
  reindexing: z.boolean(),
  error_code: SourceErrorCodeSchema.nullable().optional(),
  error_message: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  summary_status: SummaryStatusSchema,
  created_at: z.string(),
});

export const SourceCreateSchema = z.object({
  title: z.string(),
  source_type: SourceTypeSchema,
  storage_key_or_url: z.string(),
});

// =========================================================================
// 2. Notebook & Multi-Tenancy Schemas
// =========================================================================

export const NotebookStatusSchema = z.enum(['active', 'deleting', 'error']);

export const NotebookReadSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  title: z.string(),
  status: NotebookStatusSchema,
  created_at: z.string(),
});

export const NotebookCreateSchema = z.object({
  title: z.string().optional(),
});

export const NotebookUpdateSchema = z.object({
  title: z.string().optional(),
});

// =========================================================================
// 3. User & Auth Schemas
// =========================================================================

export const UserProfileResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  avatar_url: z.string().nullable().optional(),
  is_active: z.boolean(),
  last_active_notebook_id: z.string().nullable().optional(),
  created_at: z.string(),
});

export const UserReadSchema = UserProfileResponseSchema;

export const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  user: UserProfileResponseSchema,
});

export const DeletionResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
});

// =========================================================================
// 4. Authoritative Citation & Grounding Schemas
// =========================================================================

export const ResolvedCitationSchema = z.object({
  marker_id: z.number(),
  source_id: z.string(),
  source_title: z.string(),
  source_type: SourceTypeSchema,
  page_number: z.number().nullable().optional(),
  bboxes: z.array(z.array(z.number())),
  start_seconds: z.number().nullable().optional(),
  deep_link: z.string(),
  quote: z.string(),
});

// =========================================================================
// 5. Message & Chat History Schemas
// =========================================================================

export const MessageRoleSchema = z.enum(['user', 'assistant']);

export const ChatMessageReadSchema = z.object({
  id: z.string(),
  notebook_id: z.string(),
  role: MessageRoleSchema,
  content: z.string(),
  citations: z.array(ResolvedCitationSchema).optional(),
  injected_chunk_ids: z.array(z.string()).optional(),
  created_at: z.string(),
});

export const MessageReadSchema = ChatMessageReadSchema;

export const MessageCreateSchema = z.object({
  role: MessageRoleSchema,
  content: z.string(),
});

// =========================================================================
// 6. Query & Rate Limiting Schemas
// =========================================================================

export const QueryRequestSchema = z.object({
  notebook_id: z.string().optional(),
  query: z.string(),
  source_ids: z.array(z.string()).optional(),
});

export const QueryResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(ResolvedCitationSchema),
  refusal: z.boolean(),
});

export const RateLimitStatusSchema = z.object({
  queryCount: z.number(),
  maxQueries: z.number(),
  windowStart: z.string(),
  retryAfterSeconds: z.number().optional(),
  isRateLimited: z.boolean().optional(),
  isLocked: z.boolean().optional(),
});

// =========================================================================
// 7. Inter-Pane Focus Event Schema
// =========================================================================

export const ViewerFocusTargetSchema = z.object({
  sourceId: z.string(),
  pageNumber: z.number().optional(),
  bboxes: z.array(z.array(z.number())).optional(),
  startSeconds: z.number().optional(),
  quote: z.string().optional(),
  timestamp: z.number(),
});

// =========================================================================
// 8. Streaming Event Schemas
// =========================================================================

export const SSETokenEventSchema = z.object({
  type: z.literal('token'),
  content: z.string(),
});

export const SSECitationEventSchema = z.object({
  type: z.literal('citation'),
  citation: ResolvedCitationSchema,
});

export const SSERefusalEventSchema = z.object({
  type: z.literal('refusal'),
  message: z.string(),
});

export const SSEContentEventSchema = z.object({
  type: z.literal('content'),
  text: z.string(),
  citations: z.array(ResolvedCitationSchema),
});

export const SSEDoneEventSchema = z.object({
  type: z.literal('done'),
  total_citations: z.number().optional(),
});

export const SSEErrorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
});

export const SSEEventSchema = z.discriminatedUnion('type', [
  SSETokenEventSchema,
  SSECitationEventSchema,
  SSERefusalEventSchema,
  SSEContentEventSchema,
  SSEDoneEventSchema,
  SSEErrorEventSchema,
]);

// =========================================================================
// Type exports inferred from schemas for validation convenience
// =========================================================================

export type SourceTypeValidated = z.infer<typeof SourceTypeSchema>;
export type SourceStatusValidated = z.infer<typeof SourceStatusSchema>;
export type SentenceSpanValidated = z.infer<typeof SentenceSpanSchema>;
export type SourceReadValidated = z.infer<typeof SourceReadSchema>;
export type NotebookReadValidated = z.infer<typeof NotebookReadSchema>;
export type UserProfileResponseValidated = z.infer<typeof UserProfileResponseSchema>;
export type TokenResponseValidated = z.infer<typeof TokenResponseSchema>;
export type ResolvedCitationValidated = z.infer<typeof ResolvedCitationSchema>;
export type ChatMessageReadValidated = z.infer<typeof ChatMessageReadSchema>;
export type MessageReadValidated = z.infer<typeof MessageReadSchema>;
export type QueryResponseValidated = z.infer<typeof QueryResponseSchema>;
export type RateLimitStatusValidated = z.infer<typeof RateLimitStatusSchema>;
export type ViewerFocusTargetValidated = z.infer<typeof ViewerFocusTargetSchema>;
export type SSEEventValidated = z.infer<typeof SSEEventSchema>;
