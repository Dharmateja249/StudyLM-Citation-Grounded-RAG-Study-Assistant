import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import {
  NotebookRead,
  NotebookCreate,
  NotebookUpdate,
  SourceRead,
  MessageRead,
  MessageCreate,
  UserProfileResponse,
  QueryRequest,
  QueryResponse,
  DeletionResponse,
} from '@/types/api';

// Typed API Error Classes
export class ApiError extends Error {
  status: number;
  code?: string;
  data?: unknown;

  constructor(message: string, status: number, code?: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends ApiError {
  constructor(message = 'Conflict occurred') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class AuthenticationError extends ApiError {
  constructor(message = 'Authentication required or session expired') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'AuthenticationError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = 'Access forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class RateLimitError extends ApiError {
  retryAfterSeconds: number;

  constructor(message = 'Rate limit exceeded: Maximum 60 queries per hour.', retryAfterSeconds = 3600) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class PayloadTooLargeError extends ApiError {
  constructor(message = 'Payload exceeds maximum allowed size of 52428800 bytes (50MB)') {
    super(message, 413, 'PAYLOAD_TOO_LARGE');
    this.name = 'PayloadTooLargeError';
  }
}

function isFormDataObject(val: unknown): boolean {
  if (!val || typeof val !== 'object') return false;
  return (
    (typeof FormData !== 'undefined' && val instanceof FormData) ||
    (val as { constructor?: { name?: string } }).constructor?.name === 'FormData' ||
    typeof (val as { append?: unknown }).append === 'function'
  );
}

const BASE_URL = '/api';

export class ApiClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${BASE_URL}${endpoint}`;
    const headers = new Headers(options.headers || {});

    // 1. Bearer Token Injection
    const token = useAuthStore.getState().token;
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (!headers.has('Content-Type') && !isFormDataObject(options.body)) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle Success
    if (response.ok) {
      if (response.status === 204) {
        return {} as T;
      }
      return (await response.json()) as T;
    }

    // Parse Error Payload
    let errorDetail = '';
    let errorCode: string | undefined;
    try {
      const errorJson = await response.json();
      errorDetail = errorJson.detail || errorJson.error_message || errorJson.message || '';
      errorCode = errorJson.error_code || errorJson.code;
    } catch {
      errorDetail = response.statusText;
    }

    // 2. Intercept 401 Unauthorized (Expired / Missing JWT)
    if (response.status === 401) {
      useAuthStore.getState().handleExpiredSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('SESSION_EXPIRED'));
      }
      throw new AuthenticationError(errorDetail || 'Session expired. Please log in again.');
    }

    // 3. Intercept 403 Forbidden (SEC-08 Deactivated Account)
    if (response.status === 403) {
      if (errorDetail.toLowerCase().includes('pending deletion') || errorDetail.toLowerCase().includes('deactivated')) {
        useAuthStore.getState().triggerDeactivatedState(errorDetail);
      }
      throw new ForbiddenError(errorDetail || 'Forbidden: Access denied');
    }

    // 4. Intercept 404 Not Found (Anti-Enumeration Defense)
    if (response.status === 404) {
      throw new NotFoundError(errorDetail || 'Resource not found');
    }

    // 5. Intercept 409 Conflict (e.g. Deletion Race)
    if (response.status === 409) {
      throw new ConflictError(errorDetail || 'Conflict: Resource state conflict');
    }

    // 6. Intercept 413 Payload Too Large (50MB client/server guard)
    if (response.status === 413) {
      throw new PayloadTooLargeError(errorDetail || 'Payload exceeds maximum 50MB');
    }

    // 7. Intercept 429 Too Many Requests (Rate Limit Interceptor)
    if (response.status === 429) {
      const retryHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = retryHeader ? parseInt(retryHeader, 10) || 3600 : 3600;

      useWorkspaceStore.getState().setRateLimitStatus({
        isRateLimited: true,
        isLocked: true,
        retryAfterSeconds,
      });

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('RATE_LIMIT_TRIGGERED', {
            detail: { retryAfterSeconds },
          })
        );
      }

      throw new RateLimitError(
        errorDetail || 'Rate limit exceeded: Maximum 60 queries per hour.',
        retryAfterSeconds
      );
    }

    // Default Error
    throw new ApiError(errorDetail || `Request failed with status ${response.status}`, response.status, errorCode);
  }

  // --- Auth & User Profile ---
  async getProfile(): Promise<UserProfileResponse> {
    return this.request<UserProfileResponse>('/auth/me', { method: 'GET' });
  }

  async deleteAccount(): Promise<DeletionResponse> {
    return this.request<DeletionResponse>('/users/me', { method: 'DELETE' });
  }

  // --- Notebooks ---
  async getNotebooks(): Promise<NotebookRead[]> {
    return this.request<NotebookRead[]>('/notebooks', { method: 'GET' });
  }

  async getNotebook(id: string): Promise<NotebookRead> {
    return this.request<NotebookRead>(`/notebooks/${id}`, { method: 'GET' });
  }

  async createNotebook(data?: NotebookCreate): Promise<NotebookRead> {
    return this.request<NotebookRead>('/notebooks', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  }

  async updateNotebook(id: string, data: NotebookUpdate): Promise<NotebookRead> {
    return this.request<NotebookRead>(`/notebooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteNotebook(id: string): Promise<{ status: string; id: string }> {
    return this.request<{ status: string; id: string }>(`/notebooks/${id}`, {
      method: 'DELETE',
    });
  }

  // --- Messages ---
  async getMessages(notebookId: string): Promise<MessageRead[]> {
    return this.request<MessageRead[]>(`/notebooks/${notebookId}/messages`, {
      method: 'GET',
    });
  }

  async createMessage(notebookId: string, data: MessageCreate): Promise<MessageRead> {
    return this.request<MessageRead>(`/notebooks/${notebookId}/messages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // --- Sources ---
  async getSources(notebookId: string): Promise<SourceRead[]> {
    return this.request<SourceRead[]>(`/notebooks/${notebookId}/sources`, {
      method: 'GET',
    });
  }

  async getSource(id: string): Promise<SourceRead> {
    return this.request<SourceRead>(`/sources/${id}`, { method: 'GET' });
  }

  async deleteSource(id: string): Promise<{ status: string; id: string }> {
    return this.request<{ status: string; id: string }>(`/sources/${id}`, {
      method: 'DELETE',
    });
  }

  async createSource(
    notebookId: string,
    data: FormData | { url: string; title?: string }
  ): Promise<SourceRead> {
    const isFormData = isFormDataObject(data);
    return this.request<SourceRead>(`/notebooks/${notebookId}/sources`, {
      method: 'POST',
      body: isFormData ? (data as FormData) : JSON.stringify(data),
    });
  }

  async createYouTubeSource(
    notebookId: string,
    data: { url: string; title?: string }
  ): Promise<SourceRead> {
    return this.request<SourceRead>(`/notebooks/${notebookId}/sources/youtube`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // --- Query ---
  async queryNotebook(notebookId: string, data: QueryRequest): Promise<QueryResponse> {
    const res = await this.request<QueryResponse>(`/notebooks/${notebookId}/query`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    const curQuota = useWorkspaceStore.getState().rateLimit;
    useWorkspaceStore.getState().setRateLimitStatus({
      queryCount: (curQuota?.queryCount ?? 0) + 1,
    });
    return res;
  }
}

export const apiClient = new ApiClient();
