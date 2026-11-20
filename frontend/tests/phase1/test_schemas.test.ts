import { describe, it, expect } from 'vitest';
import {
  SourceReadSchema,
  SentenceSpanSchema,
  ResolvedCitationSchema,
  NotebookReadSchema,
  ChatMessageReadSchema,
  UserProfileResponseSchema,
  TokenResponseSchema,
  QueryResponseSchema,
  ViewerFocusTargetSchema,
  SSEEventSchema,
} from '@/types/schemas';
import {
  mockSources,
  mockNotebooks,
  mockCitations,
  mockMessages,
  mockUser,
} from '../mocks/fixtures';

describe('Zod Validation Schemas Verification', () => {
  it('test_source_read_schema_validates_fixtures', () => {
    for (const source of mockSources) {
      const parsed = SourceReadSchema.safeParse(source);
      expect(parsed.success).toBe(true);
    }
  });

  it('test_sentence_span_schema_validates_structure', () => {
    const validSpan = {
      sentence_id: 's0',
      text: 'Acceleration is directly proportional to force.',
      bboxes: [[0.1, 0.2, 0.8, 0.25]],
      start_seconds: 12.5,
      end_seconds: 15.0,
    };
    const parsed = SentenceSpanSchema.safeParse(validSpan);
    expect(parsed.success).toBe(true);

    const invalidSpan = {
      sentence_id: 123, // Invalid type
      text: 'Missing bboxes',
    };
    const invalidParsed = SentenceSpanSchema.safeParse(invalidSpan);
    expect(invalidParsed.success).toBe(false);
  });

  it('test_resolved_citation_schema_validates_fixtures', () => {
    for (const citation of mockCitations) {
      const parsed = ResolvedCitationSchema.safeParse(citation);
      expect(parsed.success).toBe(true);
    }
  });

  it('test_notebook_read_schema_validates_fixtures', () => {
    for (const notebook of mockNotebooks) {
      const parsed = NotebookReadSchema.safeParse(notebook);
      expect(parsed.success).toBe(true);
    }
  });

  it('test_chat_message_read_schema_validates_fixtures', () => {
    for (const message of mockMessages) {
      const parsed = ChatMessageReadSchema.safeParse(message);
      expect(parsed.success).toBe(true);
    }
  });

  it('test_user_profile_response_schema_validates_fixture', () => {
    const parsed = UserProfileResponseSchema.safeParse(mockUser);
    expect(parsed.success).toBe(true);
  });

  it('test_token_response_schema_validates_payload', () => {
    const tokenPayload = {
      access_token: 'jwt-mock-token-abc',
      token_type: 'bearer',
      user: mockUser,
    };
    const parsed = TokenResponseSchema.safeParse(tokenPayload);
    expect(parsed.success).toBe(true);
  });

  it('test_query_response_schema_validates_payload', () => {
    const queryPayload = {
      answer: 'Newtonian mechanics governs classical motion.',
      citations: mockCitations,
      refusal: false,
    };
    const parsed = QueryResponseSchema.safeParse(queryPayload);
    expect(parsed.success).toBe(true);
  });

  it('test_viewer_focus_target_schema_validates_event', () => {
    const target = {
      sourceId: 'src-pdf-001',
      pageNumber: 42,
      bboxes: [[0.1, 0.2, 0.3, 0.4]],
      startSeconds: 120,
      quote: 'F = ma',
      timestamp: Date.now(),
    };
    const parsed = ViewerFocusTargetSchema.safeParse(target);
    expect(parsed.success).toBe(true);
  });

  it('test_sse_event_schema_validates_discriminated_union', () => {
    const tokenEvent = { type: 'token', content: 'Force equals ' };
    expect(SSEEventSchema.safeParse(tokenEvent).success).toBe(true);

    const citationEvent = { type: 'citation', citation: mockCitations[0] };
    expect(SSEEventSchema.safeParse(citationEvent).success).toBe(true);

    const refusalEvent = { type: 'refusal', message: 'No evidence found' };
    expect(SSEEventSchema.safeParse(refusalEvent).success).toBe(true);

    const doneEvent = { type: 'done', total_citations: 2 };
    expect(SSEEventSchema.safeParse(doneEvent).success).toBe(true);

    const errorEvent = { type: 'error', message: 'Server fault', code: '500' };
    expect(SSEEventSchema.safeParse(errorEvent).success).toBe(true);

    const invalidEvent = { type: 'unknown_type' };
    expect(SSEEventSchema.safeParse(invalidEvent).success).toBe(false);
  });
});
