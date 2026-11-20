import { http, HttpResponse } from 'msw';
import { mockDb } from './mock-db';
import { mockUser, mockDeactivatedUser, mockCitations } from './fixtures';
import { NotebookRead, SourceRead, MessageRead, QueryResponse } from '@/types/api';

const API_PREFIX = '/api';

function authenticate(request: Request): {
  authenticated: boolean;
  userId: string;
  isDeactivated: boolean;
} {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return { authenticated: false, userId: '', isDeactivated: false };
  }
  const token = auth.replace('Bearer ', '').trim();
  if (token === 'deactivated-user-token') {
    return { authenticated: true, userId: mockDeactivatedUser.id, isDeactivated: true };
  }
  if (token === 'expired-jwt' || token === 'invalid-jwt') {
    return { authenticated: false, userId: '', isDeactivated: false };
  }
  return { authenticated: true, userId: mockUser.id, isDeactivated: false };
}

export const handlers = [
  // 0. GET /api/rate-limit
  http.get(`${API_PREFIX}/rate-limit`, () => {
    return HttpResponse.json({
      query_count: 0,
      max_queries: 60,
      is_locked: false,
      retry_after_seconds: 0,
    });
  }),

  // 1. POST /api/auth/google
  http.post(`${API_PREFIX}/auth/google`, async ({ request }) => {
    const body = ((await request.json().catch(() => ({}))) || {}) as { id_token?: string };
    if (!body.id_token) {
      return HttpResponse.json({ detail: 'Google ID token is required' }, { status: 400 });
    }
    if (body.id_token === 'deactivated-id-token' || body.id_token === 'deactivated-user-token') {
      return HttpResponse.json({ detail: 'Account pending deletion' }, { status: 403 });
    }
    if (body.id_token === 'server-error-token') {
      return HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 });
    }
    return HttpResponse.json(
      {
        access_token: 'valid-jwt-token-alex-student',
        token_type: 'bearer',
        user: mockUser,
      },
      { status: 200 }
    );
  }),

  // 2. GET /api/auth/me
  http.get(`${API_PREFIX}/auth/me`, ({ request }) => {
    const { authenticated, isDeactivated } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    if (isDeactivated) {
      return HttpResponse.json({ detail: 'Account pending deletion' }, { status: 403 });
    }
    return HttpResponse.json(mockUser, { status: 200 });
  }),

  // 3. DELETE /api/users/me & /api/auth/me
  http.delete(`${API_PREFIX}/users/me`, ({ request }) => {
    const { authenticated } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    return HttpResponse.json(
      {
        status: 'deleting',
        message: 'Account deactivation accepted. Cascading purge initiated.',
      },
      { status: 200 }
    );
  }),

  // 4. GET /api/notebooks
  http.get(`${API_PREFIX}/notebooks`, ({ request }) => {
    const { authenticated } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const list = Array.from(mockDb.notebooks.values()).filter(
      (nb) => nb.status !== 'deleting'
    );
    return HttpResponse.json(list, { status: 200 });
  }),

  // 5. POST /api/notebooks
  http.post(`${API_PREFIX}/notebooks`, async ({ request }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const body = ((await request.json().catch(() => ({}))) || {}) as { title?: string };
    const newNb: NotebookRead = {
      id: `nb-${Date.now()}`,
      user_id: userId,
      title: body.title?.trim() || 'Untitled Notebook',
      status: 'active',
      created_at: new Date().toISOString(),
    };
    mockDb.notebooks.set(newNb.id, newNb);
    return HttpResponse.json(newNb, { status: 201 });
  }),

  // 6. GET /api/notebooks/:id (Anti-Enumeration 404)
  http.get(`${API_PREFIX}/notebooks/:id`, ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const nb = mockDb.notebooks.get(id);
    if (!nb || nb.user_id !== userId || nb.status === 'deleting') {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }
    return HttpResponse.json(nb, { status: 200 });
  }),

  // 7. PATCH /api/notebooks/:id
  http.patch(`${API_PREFIX}/notebooks/:id`, async ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const nb = mockDb.notebooks.get(id);
    if (!nb || nb.user_id !== userId || nb.status === 'deleting') {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }
    const body = ((await request.json().catch(() => ({}))) || {}) as { title?: string };
    if (body.title !== undefined) {
      nb.title = body.title.trim();
    }
    return HttpResponse.json(nb, { status: 200 });
  }),

  // 8. DELETE /api/notebooks/:id
  http.delete(`${API_PREFIX}/notebooks/:id`, ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const nb = mockDb.notebooks.get(id);
    if (!nb || nb.user_id !== userId || nb.status === 'deleting') {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }
    nb.status = 'deleting';
    return HttpResponse.json({ status: 'deleting', id }, { status: 200 });
  }),

  // 9. GET /api/notebooks/:id/messages
  http.get(`${API_PREFIX}/notebooks/:id/messages`, ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const nb = mockDb.notebooks.get(id);
    if (!nb || nb.user_id !== userId || nb.status === 'deleting') {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }
    const msgs = (mockDb.messages.get(id) || []).map((m) => {
      if (m.role === 'assistant' && (!m.citations || m.citations.length === 0)) {
        return { ...m, citations: mockCitations };
      }
      return m;
    });
    return HttpResponse.json(msgs, { status: 200 });
  }),

  // 10. POST /api/notebooks/:id/messages
  http.post(`${API_PREFIX}/notebooks/:id/messages`, async ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const nb = mockDb.notebooks.get(id);
    if (!nb || nb.user_id !== userId || nb.status === 'deleting') {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }
    const body = ((await request.json().catch(() => ({}))) || {}) as {
      role?: 'user' | 'assistant';
      content?: string;
    };
    if (!body.content || !body.role) {
      return HttpResponse.json({ detail: 'Role and content are required' }, { status: 400 });
    }
    const newMsg: MessageRead = {
      id: `msg-${Date.now()}`,
      notebook_id: id,
      role: body.role,
      content: body.content,
      created_at: new Date().toISOString(),
    };
    const list = mockDb.messages.get(id) || [];
    list.push(newMsg);
    mockDb.messages.set(id, list);
    return HttpResponse.json(newMsg, { status: 201 });
  }),

  // 10b. GET /api/notebooks/:id/sources
  http.get(`${API_PREFIX}/notebooks/:id/sources`, ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const notebookId = params.id as string;
    const nb = mockDb.notebooks.get(notebookId);
    if (!nb || nb.user_id !== userId || nb.status === 'deleting') {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }
    const sources = Array.from(mockDb.sources.values()).filter(
      (s) => s.notebook_id === notebookId && s.status !== 'deleting'
    );
    return HttpResponse.json(sources, { status: 200 });
  }),

  // 11. POST /api/notebooks/:id/sources & /api/sources/upload
  http.post(`${API_PREFIX}/notebooks/:id/sources`, async ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const notebookId = params.id as string;
    const nb = mockDb.notebooks.get(notebookId);

    // 404 Anti-enumeration if not found
    if (!nb || nb.user_id !== userId) {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }

    // 409 Conflict if notebook is deleting
    if (nb.status === 'deleting' || notebookId === 'nb-deleting' || notebookId === 'deleting-nb') {
      return HttpResponse.json({ detail: 'Notebook is pending deletion' }, { status: 409 });
    }

    // 400 Bad Request if 20-source limit reached
    const currentSources = Array.from(mockDb.sources.values()).filter(
      (s) => s.notebook_id === notebookId && s.status !== 'deleting'
    );
    if (currentSources.length >= 20 || notebookId === 'nb-quota-reached') {
      return HttpResponse.json(
        { detail: 'Notebook source limit reached (max 20)' },
        { status: 400 }
      );
    }

    // Check Content-Length header or FormData payload size (50MB limit)
    const cl = request.headers.get('content-length');
    if (cl && parseInt(cl, 10) > 52428800) {
      return HttpResponse.json(
        { detail: 'Payload exceeds maximum allowed size of 52428800 bytes (50MB)' },
        { status: 413 }
      );
    }

    const contentType = request.headers.get('content-type') || '';
    const text = await request.clone().text().catch(() => '');

    if (contentType.includes('multipart/form-data') || text.includes('[object FormData]')) {
      let file: File | null = null;
      let title = 'sample.pdf';
      let fileSize = 1024 * 1024;

      try {
        const formData = await request.formData();
        file = formData.get('file') as File | null;
        if (file && file.size > 52428800) {
          return HttpResponse.json(
            { detail: 'File stream exceeded maximum allowed size of 52428800 bytes (50MB)' },
            { status: 413 }
          );
        }
        if (file && file.size === 0) {
          return HttpResponse.json({ detail: 'Cannot upload an empty file' }, { status: 400 });
        }
        if (file) {
          title = (formData.get('title') as string) || file.name || 'Untitled Source';
          fileSize = file.size;
        }
      } catch {
        // Fallback for serialized FormData in JSDOM environment
      }

      const newSource: SourceRead = {
        id: `src-${Date.now()}`,
        user_id: userId,
        notebook_id: notebookId,
        title,
        source_type: 'pdf',
        storage_key_or_url: `users/${userId}/notebooks/${notebookId}/file`,
        file_size_bytes: fileSize,
        status: 'processing',
        reindexing: false,
        summary_status: 'pending',
        created_at: new Date().toISOString(),
      };
      mockDb.sources.set(newSource.id, newSource);
      return HttpResponse.json(newSource, { status: 201 });
    }

    const jsonBody = ((await request.json().catch(() => ({}))) || {}) as {
      url?: string;
      title?: string;
    };
    if (jsonBody.url && jsonBody.url.includes('entertainment123')) {
      // Educational Barrier rejection trigger
      const rejectedSource: SourceRead = {
        id: `src-yt-rejected-${Date.now()}`,
        user_id: userId,
        notebook_id: notebookId,
        title: '[Suppressed: Non-Educational Content]',
        source_type: 'youtube',
        storage_key_or_url: jsonBody.url,
        status: 'error',
        reindexing: false,
        error_code: 'ERR_NON_EDUCATIONAL_CONTENT',
        error_message:
          'Upload educational related video, this video does not have educational content please recheck the link',
        summary_status: 'error',
        created_at: new Date().toISOString(),
      };
      mockDb.sources.set(rejectedSource.id, rejectedSource);
      return HttpResponse.json(rejectedSource, { status: 201 });
    }

    const createdSrc: SourceRead = {
      id: `src-${Date.now()}`,
      user_id: userId,
      notebook_id: notebookId,
      title: jsonBody.title || 'Imported YouTube Lecture',
      source_type: 'youtube',
      storage_key_or_url: jsonBody.url || 'https://www.youtube.com/watch?v=kYv_8fX30yA',
      status: 'ready',
      reindexing: false,
      summary_status: 'pending',
      created_at: new Date().toISOString(),
    };
    mockDb.sources.set(createdSrc.id, createdSrc);
    return HttpResponse.json(createdSrc, { status: 201 });
  }),

  // 11b. POST /api/notebooks/:id/sources/youtube
  http.post(`${API_PREFIX}/notebooks/:id/sources/youtube`, async ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const notebookId = params.id as string;
    const nb = mockDb.notebooks.get(notebookId);

    if (!nb || nb.user_id !== userId) {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }

    if (nb.status === 'deleting' || notebookId === 'nb-deleting' || notebookId === 'deleting-nb') {
      return HttpResponse.json({ detail: 'Notebook is pending deletion' }, { status: 409 });
    }

    const currentSources = Array.from(mockDb.sources.values()).filter(
      (s) => s.notebook_id === notebookId && s.status !== 'deleting'
    );
    if (currentSources.length >= 20 || notebookId === 'nb-quota-reached') {
      return HttpResponse.json(
        { detail: 'Notebook source limit reached (max 20)' },
        { status: 400 }
      );
    }

    const jsonBody = ((await request.json().catch(() => ({}))) || {}) as {
      url?: string;
      title?: string;
    };
    if (jsonBody.url && jsonBody.url.includes('entertainment123')) {
      const rejectedSource: SourceRead = {
        id: `src-yt-rejected-${Date.now()}`,
        user_id: userId,
        notebook_id: notebookId,
        title: '[Suppressed: Non-Educational Content]',
        source_type: 'youtube',
        storage_key_or_url: jsonBody.url,
        status: 'error',
        reindexing: false,
        error_code: 'ERR_NON_EDUCATIONAL_CONTENT',
        error_message:
          'Upload educational related video, this video does not have educational content please recheck the link',
        summary_status: 'error',
        created_at: new Date().toISOString(),
      };
      mockDb.sources.set(rejectedSource.id, rejectedSource);
      return HttpResponse.json(rejectedSource, { status: 201 });
    }

    const createdSrc: SourceRead = {
      id: `src-${Date.now()}`,
      user_id: userId,
      notebook_id: notebookId,
      title: jsonBody.title || 'Imported YouTube Lecture',
      source_type: 'youtube',
      storage_key_or_url: jsonBody.url || 'https://www.youtube.com/watch?v=kYv_8fX30yA',
      status: 'ready',
      reindexing: false,
      summary_status: 'pending',
      created_at: new Date().toISOString(),
    };
    mockDb.sources.set(createdSrc.id, createdSrc);
    return HttpResponse.json(createdSrc, { status: 201 });
  }),

  // 12. GET /api/sources/:id & DELETE /api/sources/:id
  http.get(`${API_PREFIX}/sources/:id`, ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const src = mockDb.sources.get(id);
    if (!src || src.user_id !== userId || src.status === 'deleting') {
      return HttpResponse.json({ detail: 'Source not found' }, { status: 404 });
    }
    return HttpResponse.json(src, { status: 200 });
  }),

  http.delete(`${API_PREFIX}/sources/:id`, ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const src = mockDb.sources.get(id);
    if (!src || src.user_id !== userId || src.status === 'deleting') {
      return HttpResponse.json({ detail: 'Source not found' }, { status: 404 });
    }
    src.status = 'deleting';
    return HttpResponse.json({ status: 'deleting', id }, { status: 200 });
  }),

  // 13. GET /api/sources/:id/stream (HTTP 206 Partial Content)
  http.get(`${API_PREFIX}/sources/:id/stream`, ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const src = mockDb.sources.get(id);
    if (!src || src.user_id !== userId || src.status === 'deleting') {
      return HttpResponse.json({ detail: 'Source not found' }, { status: 404 });
    }
    if (src.source_type === 'youtube') {
      return HttpResponse.json(
        { detail: 'Cannot stream YouTube source as raw binary' },
        { status: 400 }
      );
    }

    const totalSize = 4096;
    const rangeHeader = request.headers.get('Range');

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        return new HttpResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalSize}` },
        });
      }
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

      if (start > end || start >= totalSize) {
        return new HttpResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalSize}` },
        });
      }

      const chunkSize = end - start + 1;
      const buffer = new Uint8Array(chunkSize);

      return new HttpResponse(buffer, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': 'application/pdf',
        },
      });
    }

    const fullBuffer = new Uint8Array(totalSize);
    return new HttpResponse(fullBuffer, {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(totalSize),
        'Content-Type': 'application/pdf',
      },
    });
  }),

  // 13b. GET /sources/:id/stream (Alias without API prefix)
  http.get('/sources/:id/stream', ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const src = mockDb.sources.get(id);
    if (!src || src.user_id !== userId || src.status === 'deleting') {
      return HttpResponse.json({ detail: 'Source not found' }, { status: 404 });
    }
    if (src.source_type === 'youtube') {
      return HttpResponse.json(
        { detail: 'Cannot stream YouTube source as raw binary' },
        { status: 400 }
      );
    }

    const totalSize = 4096;
    const rangeHeader = request.headers.get('Range');

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
      if (!match) {
        return new HttpResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalSize}` },
        });
      }
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

      if (start > end || start >= totalSize) {
        return new HttpResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${totalSize}` },
        });
      }

      const chunkSize = end - start + 1;
      const buffer = new Uint8Array(chunkSize);

      return new HttpResponse(buffer, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': 'application/pdf',
        },
      });
    }

    const fullBuffer = new Uint8Array(totalSize);
    return new HttpResponse(fullBuffer, {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(totalSize),
        'Content-Type': 'application/pdf',
      },
    });
  }),

  // 14. POST /api/notebooks/:id/query (Rate limit 429 & Grounded answer)
  http.post(`${API_PREFIX}/notebooks/:id/query`, async ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const nb = mockDb.notebooks.get(id);
    if (!nb || nb.user_id !== userId || nb.status === 'deleting') {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }

    const body = ((await request.json().catch(() => ({}))) || {}) as { query?: string };
    if (!body.query || !body.query.trim()) {
      return HttpResponse.json({ detail: 'Query text cannot be empty' }, { status: 400 });
    }

    const currentCount = (mockDb.queryCounts.get(userId) || 0) + 1;
    mockDb.queryCounts.set(userId, currentCount);

    if (currentCount > 60 || mockDb.rateLimitOverride) {
      return HttpResponse.json(
        { detail: 'Rate limit exceeded: Maximum 60 queries per hour.' },
        {
          status: 429,
          headers: {
            'Retry-After': '3600',
          },
        }
      );
    }

    const response: QueryResponse = {
      answer: "Newton's second law states that F = ma [[cite:1]].",
      citations: mockCitations,
      refusal: false,
    };
    return HttpResponse.json(response, { status: 200 });
  }),

  // 15. POST /api/notebooks/:id/query/stream (SSE Stream Engine Mock)
  http.post(`${API_PREFIX}/notebooks/:id/query/stream`, async ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const notebookId = params.id as string;
    const nb = mockDb.notebooks.get(notebookId);
    if (!nb || nb.user_id !== userId || nb.status === 'deleting') {
      return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
    }

    const body = ((await request.json().catch(() => ({}))) || {}) as {
      query?: string;
      source_ids?: string[];
    };
    const query = body.query?.trim() || '';
    if (!query) {
      return HttpResponse.json({ detail: 'Query text cannot be empty' }, { status: 400 });
    }

    // 429 Rate limit check
    const currentCount = (mockDb.queryCounts.get(userId) || 0) + 1;
    mockDb.queryCounts.set(userId, currentCount);
    if (currentCount > 60 || mockDb.rateLimitOverride) {
      return HttpResponse.json(
        { detail: 'Rate limit exceeded: Maximum 60 queries per hour.' },
        {
          status: 429,
          headers: { 'Retry-After': '3600' },
        }
      );
    }

    // Calibrated refusal check
    const isRefusalQuery =
      query.toLowerCase().includes('refusal') ||
      query.toLowerCase().includes('insufficient') ||
      query.toLowerCase().includes('quantum gravity');

    const ssePayload = isRefusalQuery
      ? 'event: refusal\ndata: {"message": "I don\'t have enough information in your notes to answer that."}\n\n' +
        'event: done\ndata: {"total_citations": 0}\n\n'
      : 'event: token\ndata: {"content": "Based on your notes, "}\n\n' +
        'event: token\ndata: {"content": "Newton\'s second law states that F = ma [[cite:1]]."}\n\n' +
        `event: citation\ndata: ${JSON.stringify(mockCitations[0])}\n\n` +
        'event: done\ndata: {"total_citations": 1}\n\n';

    return new HttpResponse(ssePayload, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }),

  // 16. POST /api/sources/:id/summarize
  http.post(`${API_PREFIX}/sources/:id/summarize`, ({ request, params }) => {
    const { authenticated, userId } = authenticate(request);
    if (!authenticated) {
      return HttpResponse.json({ detail: 'Not authenticated' }, { status: 401 });
    }
    const id = params.id as string;
    const src = mockDb.sources.get(id);
    if (!src || src.user_id !== userId || src.status === 'deleting') {
      return HttpResponse.json({ detail: 'Source not found' }, { status: 404 });
    }
    return HttpResponse.json(
      {
        summary:
          src.summary ||
          'Comprehensive summary of classical mechanics, Newton\'s laws, and vector kinematics.',
        summary_status: 'ready',
      },
      { status: 200 }
    );
  }),
];
