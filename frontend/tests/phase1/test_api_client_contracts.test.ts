import { describe, it, expect, beforeEach } from 'vitest';
import { apiClient } from '@/lib/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

describe('API Client Contracts & Interceptors', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
  });

  it('test_bearer_token_injected_in_all_api_requests', async () => {
    useAuthStore.getState().setToken('bearer-jwt-token-xyz');

    server.use(
      http.get('/api/notebooks/:id', ({ request }) => {
        const auth = request.headers.get('Authorization');
        if (auth !== 'Bearer bearer-jwt-token-xyz') {
          return new HttpResponse(null, { status: 401 });
        }
        return HttpResponse.json({
          id: 'nb-1',
          user_id: 'usr-1',
          title: 'Neurobiology',
          status: 'active',
          created_at: '2026-10-11T12:00:00Z',
        });
      })
    );

    const notebook = await apiClient.getNotebook('nb-1');
    expect(notebook.id).toBe('nb-1');
    expect(notebook.title).toBe('Neurobiology');
  });

  it('test_anti_enumeration_404_handling', async () => {
    useAuthStore.getState().setToken('valid-token');

    server.use(
      http.get('/api/notebooks/:id', () => {
        // Anti-enumeration defense returns 404 for unauthorized access
        return HttpResponse.json({ detail: 'Notebook not found' }, { status: 404 });
      })
    );

    await expect(apiClient.getNotebook('other-tenant-nb')).rejects.toThrow(/not found/i);
  });

  it('test_conflict_409_handling', async () => {
    useAuthStore.getState().setToken('valid-token');

    server.use(
      http.post('/api/notebooks/:id/sources', () => {
        return HttpResponse.json(
          { detail: 'Cannot add sources to a notebook marked for deletion' },
          { status: 409 }
        );
      })
    );

    await expect(
      apiClient.createSource('deleting-nb', { url: 'https://youtube.com/watch?v=123' })
    ).rejects.toThrow(/marked for deletion|conflict/i);
  });

  it('test_rate_limit_429_interceptor', async () => {
    useAuthStore.getState().setToken('valid-token');

    server.use(
      http.post('/api/notebooks/:id/query', () => {
        return HttpResponse.json(
          { detail: 'Rate limit exceeded: Maximum 60 queries per hour.' },
          {
            status: 429,
            headers: { 'Retry-After': '3600' },
          }
        );
      })
    );

    await expect(apiClient.queryNotebook('nb-1', { query: 'test' })).rejects.toThrow(
      /rate limit/i
    );

    const rateLimit = useWorkspaceStore.getState().rateLimit;
    expect(rateLimit.isRateLimited).toBe(true);
    expect(rateLimit.retryAfterSeconds).toBe(3600);
  });
});
