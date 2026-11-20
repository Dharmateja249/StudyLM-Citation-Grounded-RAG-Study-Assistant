import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SourceTypeSchema,
  SourceStatusSchema,
  SummaryStatusSchema,
  SentenceSpanSchema,
  SourceReadSchema,
  SourceCreateSchema,
  NotebookStatusSchema,
  NotebookReadSchema,
  NotebookCreateSchema,
  NotebookUpdateSchema,
  UserProfileResponseSchema,
  TokenResponseSchema,
  ResolvedCitationSchema,
  MessageRoleSchema,
  ChatMessageReadSchema,
  QueryRequestSchema,
  QueryResponseSchema,
  RateLimitStatusSchema,
  ViewerFocusTargetSchema,
  SSEEventSchema,
} from '@/types/schemas';
import {
  apiClient,
  ApiError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  PayloadTooLargeError,
  RateLimitError,
} from '@/lib/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { mockUser, mockSources, mockNotebooks, mockCitations, mockMessages } from './mocks/fixtures';

describe('Adversarial Challenge: Zod Boundary Inputs', () => {
  describe('1. Primitive Enums & Sub-schemas', () => {
    it('SourceTypeSchema rejects invalid types and boundaries', () => {
      expect(SourceTypeSchema.safeParse('pdf').success).toBe(true);
      expect(SourceTypeSchema.safeParse('image').success).toBe(true);
      expect(SourceTypeSchema.safeParse('youtube').success).toBe(true);

      // Boundaries
      expect(SourceTypeSchema.safeParse('video').success).toBe(false);
      expect(SourceTypeSchema.safeParse('PDF').success).toBe(false);
      expect(SourceTypeSchema.safeParse('').success).toBe(false);
      expect(SourceTypeSchema.safeParse(null).success).toBe(false);
      expect(SourceTypeSchema.safeParse(undefined).success).toBe(false);
      expect(SourceTypeSchema.safeParse(123).success).toBe(false);
    });

    it('SourceStatusSchema rejects invalid statuses', () => {
      expect(SourceStatusSchema.safeParse('processing').success).toBe(true);
      expect(SourceStatusSchema.safeParse('ready').success).toBe(true);
      expect(SourceStatusSchema.safeParse('error').success).toBe(true);
      expect(SourceStatusSchema.safeParse('deleting').success).toBe(true);

      expect(SourceStatusSchema.safeParse('done').success).toBe(false);
      expect(SourceStatusSchema.safeParse('pending').success).toBe(false);
      expect(SourceStatusSchema.safeParse('failed').success).toBe(false);
      expect(SourceStatusSchema.safeParse({}).success).toBe(false);
    });

    it('SummaryStatusSchema rejects invalid statuses', () => {
      expect(SummaryStatusSchema.safeParse('pending').success).toBe(true);
      expect(SummaryStatusSchema.safeParse('ready').success).toBe(true);
      expect(SummaryStatusSchema.safeParse('error').success).toBe(true);

      expect(SummaryStatusSchema.safeParse('processing').success).toBe(false);
      expect(SummaryStatusSchema.safeParse('success').success).toBe(false);
    });

    it('MessageRoleSchema accepts only user and assistant', () => {
      expect(MessageRoleSchema.safeParse('user').success).toBe(true);
      expect(MessageRoleSchema.safeParse('assistant').success).toBe(true);

      expect(MessageRoleSchema.safeParse('system').success).toBe(false);
      expect(MessageRoleSchema.safeParse('tool').success).toBe(false);
      expect(MessageRoleSchema.safeParse('admin').success).toBe(false);
    });
  });

  describe('2. SentenceSpanSchema Boundaries', () => {
    it('accepts valid span with float bboxes and timestamps', () => {
      const valid = {
        sentence_id: 's0',
        text: 'Hello world',
        bboxes: [[0.1, 0.2, 0.9, 0.35]],
        start_seconds: 12.4,
        end_seconds: 18.2,
      };
      expect(SentenceSpanSchema.safeParse(valid).success).toBe(true);
    });

    it('accepts empty bboxes array (scanned page)', () => {
      const valid = {
        sentence_id: 's0',
        text: 'Hello world',
        bboxes: [],
        start_seconds: null,
        end_seconds: null,
      };
      expect(SentenceSpanSchema.safeParse(valid).success).toBe(true);
    });

    it('rejects 1D bboxes array or non-numeric bboxes', () => {
      const flatBboxes = {
        sentence_id: 's0',
        text: 'Hello world',
        bboxes: [0.1, 0.2, 0.9, 0.35], // 1D array instead of 2D
      };
      expect(SentenceSpanSchema.safeParse(flatBboxes).success).toBe(false);

      const stringBboxes = {
        sentence_id: 's0',
        text: 'Hello world',
        bboxes: [['0.1', '0.2', '0.9', '0.35']],
      };
      expect(SentenceSpanSchema.safeParse(stringBboxes).success).toBe(false);
    });

    it('rejects missing required fields (sentence_id, text, bboxes)', () => {
      expect(SentenceSpanSchema.safeParse({ text: 'No id', bboxes: [] }).success).toBe(false);
      expect(SentenceSpanSchema.safeParse({ sentence_id: 's0', bboxes: [] }).success).toBe(false);
      expect(SentenceSpanSchema.safeParse({ sentence_id: 's0', text: 'No bboxes' }).success).toBe(false);
    });
  });

  describe('3. SourceReadSchema Boundary Inputs', () => {
    it('rejects payload missing critical fields', () => {
      const base = { ...mockSources[0] };
      
      const missingStatus = { ...base, status: undefined };
      expect(SourceReadSchema.safeParse(missingStatus).success).toBe(false);

      const missingReindexing = { ...base, reindexing: undefined };
      expect(SourceReadSchema.safeParse(missingReindexing).success).toBe(false);

      const missingUserId = { ...base, user_id: undefined };
      expect(SourceReadSchema.safeParse(missingUserId).success).toBe(false);

      const missingSummaryStatus = { ...base, summary_status: undefined };
      expect(SourceReadSchema.safeParse(missingSummaryStatus).success).toBe(false);
    });

    it('rejects invalid types on boolean and number fields', () => {
      const base = { ...mockSources[0] };

      expect(SourceReadSchema.safeParse({ ...base, reindexing: 'false' }).success).toBe(false);
      expect(SourceReadSchema.safeParse({ ...base, file_size_bytes: '4096' }).success).toBe(false);
      expect(SourceReadSchema.safeParse({ ...base, page_count: '10' }).success).toBe(false);
    });

    it('properly accepts nullable and optional fields as null or undefined', () => {
      const base = { ...mockSources[0] };
      const nullsAndUndefined = {
        ...base,
        file_size_bytes: null,
        page_count: undefined,
        estimated_tokens: null,
        duration_seconds: null,
        active_ingest_run_id: null,
        error_code: null,
        error_message: null,
        summary: null,
      };
      expect(SourceReadSchema.safeParse(nullsAndUndefined).success).toBe(true);
    });

    it('strips extra unknown fields by default without crashing', () => {
      const withExtra = {
        ...mockSources[0],
        unexpected_injected_field: 'malicious-or-new-prop',
        debug_info: { trace: 'xyz' },
      };
      const parsed = SourceReadSchema.safeParse(withExtra);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as Record<string, unknown>).unexpected_injected_field).toBeUndefined();
      }
    });
  });

  describe('4. ResolvedCitationSchema Boundary Inputs', () => {
    it('rejects missing quote or deep_link', () => {
      const base = { ...mockCitations[0] };
      expect(ResolvedCitationSchema.safeParse({ ...base, quote: undefined }).success).toBe(false);
      expect(ResolvedCitationSchema.safeParse({ ...base, deep_link: undefined }).success).toBe(false);
    });

    it('rejects string marker_id', () => {
      const base = { ...mockCitations[0], marker_id: '1' };
      expect(ResolvedCitationSchema.safeParse(base).success).toBe(false);
    });

    it('accepts null/undefined page_number or start_seconds', () => {
      const ytCitation = {
        marker_id: 2,
        source_id: 'src-2',
        source_title: 'YT Lecture',
        source_type: 'youtube',
        page_number: null,
        bboxes: [],
        start_seconds: 120,
        deep_link: 'https://youtube.com/watch?v=xyz',
        quote: 'Citation quote',
      };
      expect(ResolvedCitationSchema.safeParse(ytCitation).success).toBe(true);
    });
  });

  describe('5. SSEEventSchema Discriminated Union Boundaries', () => {
    it('rejects unknown event type', () => {
      expect(SSEEventSchema.safeParse({ type: 'heartbeat' }).success).toBe(false);
      expect(SSEEventSchema.safeParse({ type: 'ping' }).success).toBe(false);
      expect(SSEEventSchema.safeParse({}).success).toBe(false);
    });

    it('validates each branch and rejects malformed branch payloads', () => {
      // Token branch
      expect(SSEEventSchema.safeParse({ type: 'token', content: 'test' }).success).toBe(true);
      expect(SSEEventSchema.safeParse({ type: 'token' }).success).toBe(false);
      expect(SSEEventSchema.safeParse({ type: 'token', content: 123 }).success).toBe(false);

      // Citation branch
      expect(SSEEventSchema.safeParse({ type: 'citation', citation: mockCitations[0] }).success).toBe(true);
      expect(SSEEventSchema.safeParse({ type: 'citation', citation: { marker_id: 'invalid' } }).success).toBe(false);
      expect(SSEEventSchema.safeParse({ type: 'citation' }).success).toBe(false);

      // Refusal branch
      expect(SSEEventSchema.safeParse({ type: 'refusal', message: 'Not found' }).success).toBe(true);
      expect(SSEEventSchema.safeParse({ type: 'refusal' }).success).toBe(false);

      // Content branch
      expect(
        SSEEventSchema.safeParse({
          type: 'content',
          text: 'Here is answer',
          citations: mockCitations,
        }).success
      ).toBe(true);
      expect(
        SSEEventSchema.safeParse({
          type: 'content',
          text: 'Here is answer',
        }).success
      ).toBe(false);

      // Done branch
      expect(SSEEventSchema.safeParse({ type: 'done' }).success).toBe(true);
      expect(SSEEventSchema.safeParse({ type: 'done', total_citations: 3 }).success).toBe(true);
      expect(SSEEventSchema.safeParse({ type: 'done', total_citations: 'three' }).success).toBe(false);

      // Error branch
      expect(SSEEventSchema.safeParse({ type: 'error', message: 'Fail', code: '500' }).success).toBe(true);
      expect(SSEEventSchema.safeParse({ type: 'error' }).success).toBe(false);
    });
  });

  describe('6. ViewerFocusTargetSchema Boundaries', () => {
    it('accepts valid focus event with monotonic timestamp', () => {
      const target = {
        sourceId: 'src-1',
        pageNumber: 3,
        bboxes: [[0, 0, 1, 1]],
        startSeconds: 0,
        quote: 'test quote',
        timestamp: 123456789,
      };
      expect(ViewerFocusTargetSchema.safeParse(target).success).toBe(true);
    });

    it('requires numeric timestamp', () => {
      const missingTs = { sourceId: 'src-1' };
      expect(ViewerFocusTargetSchema.safeParse(missingTs).success).toBe(false);

      const stringTs = { sourceId: 'src-1', timestamp: '123456789' };
      expect(ViewerFocusTargetSchema.safeParse(stringTs).success).toBe(false);
    });
  });
});

describe('Adversarial Challenge: API Client Interceptors under Simulated Errors', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
  });

  it('401 Unauthorized: purges token, triggers handleExpiredSession, dispatches SESSION_EXPIRED', async () => {
    useAuthStore.getState().setToken('expired-jwt');
    const sessionExpiredSpy = vi.fn();
    window.addEventListener('SESSION_EXPIRED', sessionExpiredSpy);

    server.use(
      http.get('/api/auth/me', () => {
        return HttpResponse.json({ detail: 'Token expired' }, { status: 401 });
      })
    );

    await expect(apiClient.getProfile()).rejects.toThrow(AuthenticationError);
    await expect(apiClient.getProfile()).rejects.toThrow(/Token expired|Session expired/i);

    // Auth state must be wiped
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().authError).toContain('Session expired');
    expect(sessionExpiredSpy).toHaveBeenCalled();

    window.removeEventListener('SESSION_EXPIRED', sessionExpiredSpy);
  });

  it('403 Forbidden (Account Pending Deletion / Deactivated): triggers deactivated state & modal', async () => {
    useAuthStore.getState().setToken('some-token');

    server.use(
      http.get('/api/notebooks', () => {
        return HttpResponse.json({ detail: 'Account pending deletion' }, { status: 403 });
      })
    );

    await expect(apiClient.getNotebooks()).rejects.toThrow(ForbiddenError);
    expect(useAuthStore.getState().isDeactivated).toBe(true);
    expect(useAuthStore.getState().deactivationMessage).toContain('Account pending deletion');
    expect(useAuthStore.getState().token).toBeNull();
  });

  it('403 Forbidden (Standard RBAC/Permission Denied): throws ForbiddenError WITHOUT triggering deactivated modal', async () => {
    useAuthStore.getState().setToken('some-token');

    server.use(
      http.get('/api/notebooks', () => {
        return HttpResponse.json({ detail: 'Permission denied: unauthorized operation' }, { status: 403 });
      })
    );

    await expect(apiClient.getNotebooks()).rejects.toThrow(ForbiddenError);
    expect(useAuthStore.getState().isDeactivated).toBe(false);
  });

  it('404 Not Found (Anti-Enumeration Defense): throws NotFoundError with standard domain semantics', async () => {
    useAuthStore.getState().setToken('valid-token');

    server.use(
      http.get('/api/notebooks/:id', () => {
        return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
      })
    );

    let caughtError: unknown;
    try {
      await apiClient.getNotebook('forbidden-nb-999');
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(NotFoundError);
    expect((caughtError as NotFoundError).status).toBe(404);
    expect((caughtError as NotFoundError).code).toBe('NOT_FOUND');
    expect((caughtError as NotFoundError).message).toContain('Notebook not found');
  });

  it('409 Conflict: throws ConflictError with status 409 and code CONFLICT', async () => {
    useAuthStore.getState().setToken('valid-token');

    server.use(
      http.delete('/api/sources/:id', () => {
        return HttpResponse.json({ detail: 'Source is currently being reindexed' }, { status: 409 });
      })
    );

    let caughtError: unknown;
    try {
      await apiClient.deleteSource('src-conflict');
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ConflictError);
    expect((caughtError as ConflictError).status).toBe(409);
    expect((caughtError as ConflictError).code).toBe('CONFLICT');
    expect((caughtError as ConflictError).message).toContain('being reindexed');
  });

  it('413 Payload Too Large: throws PayloadTooLargeError with status 413 and code PAYLOAD_TOO_LARGE', async () => {
    useAuthStore.getState().setToken('valid-token');

    server.use(
      http.post('/api/notebooks/:id/sources', () => {
        return HttpResponse.json(
          { detail: 'File stream exceeded maximum allowed size of 52428800 bytes (50MB)' },
          { status: 413 }
        );
      })
    );

    let caughtError: unknown;
    try {
      await apiClient.createSource('nb-1', { url: 'https://youtube.com/watch?v=toolarge' });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(PayloadTooLargeError);
    expect((caughtError as PayloadTooLargeError).status).toBe(413);
    expect((caughtError as PayloadTooLargeError).code).toBe('PAYLOAD_TOO_LARGE');
    expect((caughtError as PayloadTooLargeError).message).toContain('50MB');
  });

  it('429 Too Many Requests: sets workspaceStore rate limit and dispatches RATE_LIMIT_TRIGGERED with Retry-After header', async () => {
    useAuthStore.getState().setToken('valid-token');
    const rateLimitSpy = vi.fn();
    window.addEventListener('RATE_LIMIT_TRIGGERED', rateLimitSpy);

    server.use(
      http.post('/api/notebooks/:id/query', () => {
        return HttpResponse.json(
          { detail: 'Rate limit exceeded: Maximum 60 queries per hour.' },
          {
            status: 429,
            headers: { 'Retry-After': '1800' },
          }
        );
      })
    );

    let caughtError: unknown;
    try {
      await apiClient.queryNotebook('nb-1', { query: 'test rate limit' });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(RateLimitError);
    const rlError = caughtError as RateLimitError;
    expect(rlError.status).toBe(429);
    expect(rlError.retryAfterSeconds).toBe(1800);

    const storeRateLimit = useWorkspaceStore.getState().rateLimit;
    expect(storeRateLimit.isRateLimited).toBe(true);
    expect(storeRateLimit.isLocked).toBe(true);
    expect(storeRateLimit.retryAfterSeconds).toBe(1800);

    expect(rateLimitSpy).toHaveBeenCalled();
    const eventDetail = (rateLimitSpy.mock.calls[0][0] as CustomEvent).detail;
    expect(eventDetail.retryAfterSeconds).toBe(1800);

    window.removeEventListener('RATE_LIMIT_TRIGGERED', rateLimitSpy);
  });

  it('429 fallback when Retry-After is absent or malformed', async () => {
    useAuthStore.getState().setToken('valid-token');

    server.use(
      http.post('/api/notebooks/:id/query', () => {
        return HttpResponse.json(
          { detail: 'Rate limit hit without valid retry header' },
          {
            status: 429,
            headers: { 'Retry-After': 'invalid-not-a-number' },
          }
        );
      })
    );

    let caughtError: unknown;
    try {
      await apiClient.queryNotebook('nb-1', { query: 'fallback test' });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(RateLimitError);
    expect((caughtError as RateLimitError).retryAfterSeconds).toBe(3600);
  });

  it('500 Internal Server Error & Non-JSON responses: fallbacks to statusText', async () => {
    useAuthStore.getState().setToken('valid-token');

    server.use(
      http.get('/api/notebooks', () => {
        return new HttpResponse('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'text/html' },
        });
      })
    );

    let caughtError: unknown;
    try {
      await apiClient.getNotebooks();
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(ApiError);
    expect((caughtError as ApiError).status).toBe(502);
    expect((caughtError as ApiError).message).toContain('Bad Gateway');
  });

  it('204 No Content: returns empty object gracefully', async () => {
    useAuthStore.getState().setToken('valid-token');

    server.use(
      http.delete('/api/notebooks/:id', () => {
        return new HttpResponse(null, { status: 204 });
      })
    );

    const result = await apiClient.deleteNotebook('nb-empty');
    expect(result).toEqual({});
  });
});

describe('Adversarial Challenge: MSW v2 Gateway Contract Harness', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
  });

  it('HTTP 206 Partial Content: source stream returns 206 with correct headers on byte range request', async () => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');

    const res = await fetch('/api/sources/src-pdf-001/stream', {
      headers: {
        Authorization: 'Bearer valid-jwt-token-alex-student',
        Range: 'bytes=0-1023',
      },
    });

    expect(res.status).toBe(206);
    expect(res.headers.get('Content-Range')).toBe('bytes 0-1023/4096');
    expect(res.headers.get('Content-Length')).toBe('1024');
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
  });

  it('HTTP 416 Range Not Satisfiable: source stream returns 416 on out-of-bounds byte range', async () => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');

    const res = await fetch('/api/sources/src-pdf-001/stream', {
      headers: {
        Authorization: 'Bearer valid-jwt-token-alex-student',
        Range: 'bytes=5000-6000',
      },
    });

    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */4096');
  });

  it('HTTP 400 Bad Request: source stream rejects streaming YouTube as raw binary', async () => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');

    const res = await fetch('/api/sources/src-yt-002/stream', {
      headers: {
        Authorization: 'Bearer valid-jwt-token-alex-student',
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.detail).toContain('Cannot stream YouTube source as raw binary');
  });

  it('HTTP 409 Conflict: adding source to deleting notebook returns 409', async () => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');

    const res = await fetch('/api/notebooks/nb-deleting/sources', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-jwt-token-alex-student',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=123' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.detail).toContain('pending deletion');
  });

  it('HTTP 413 Payload Too Large: POST with Content-Length > 50MB returns 413', async () => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');

    const res = await fetch('/api/notebooks/nb-physics-101/sources', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-jwt-token-alex-student',
        'Content-Type': 'application/json',
        'Content-Length': '55000000', // > 52428800
      },
      body: JSON.stringify({ url: 'https://youtube.com/watch?v=123' }),
    });

    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.detail).toContain('50MB');
  });

  it('Educational Moderation Barrier Contract: entertainment123 returns error status and exact warning message', async () => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');

    const res = await fetch('/api/notebooks/nb-physics-101/sources', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-jwt-token-alex-student',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=entertainment123' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('error');
    expect(body.error_code).toBe('ERR_NON_EDUCATIONAL_CONTENT');
    expect(body.error_message).toBe(
      'Upload educational related video, this video does not have educational content please recheck the link'
    );
    expect(body.title).toBe('[Suppressed: Non-Educational Content]');
  });

  it('HTTP 429 Rate Limit: query endpoint returns 429 when quota exceeded (60 queries/hr)', async () => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');

    // Fire 60 queries
    for (let i = 0; i < 60; i++) {
      const okRes = await fetch('/api/notebooks/nb-physics-101/query', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer valid-jwt-token-alex-student',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: `Query ${i}` }),
      });
      expect(okRes.status).toBe(200);
    }

    // 61st query must be blocked with 429
    const blockedRes = await fetch('/api/notebooks/nb-physics-101/query', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer valid-jwt-token-alex-student',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'Query 61' }),
    });

    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get('Retry-After')).toBe('3600');
    const body = await blockedRes.json();
    expect(body.detail).toContain('Rate limit exceeded: Maximum 60 queries per hour.');
  });
});

