import '@testing-library/jest-dom/vitest';
import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { server } from './mocks/server';
import { mockDb } from './mocks/mock-db';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

// 1. ResizeObserver Polyfill
class ResizeObserverMock {
  callback?: ResizeObserverCallback;
  constructor(callback?: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
window.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// 2. crypto.randomUUID Polyfill
if (!window.crypto) {
  (window as unknown as { crypto: unknown }).crypto = {};
}
if (!window.crypto.randomUUID) {
  window.crypto.randomUUID = randomUUID;
}
if (!global.crypto) {
  (global as unknown as { crypto: unknown }).crypto = {};
}
if (!global.crypto.randomUUID) {
  global.crypto.randomUUID = randomUUID;
}

// 3. window.matchMedia Polyfill
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// 4. Mock Next.js navigation
vi.mock('next/navigation', () => {
  const push = vi.fn();
  const replace = vi.fn();
  const back = vi.fn();
  const forward = vi.fn();
  const refresh = vi.fn();
  const prefetch = vi.fn();

  return {
    useRouter: () => ({
      push,
      replace,
      back,
      forward,
      refresh,
      prefetch,
    }),
    usePathname: () => '/workspace',
    useSearchParams: () => new URLSearchParams(),
    redirect: (url: string) => push(url),
  };
});

// 5. MSW Server & Store Reset Lifecycle
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  mockDb.reset();
  localStorage.clear();
  sessionStorage.clear();
  useAuthStore.getState().reset();
  useWorkspaceStore.getState().reset();
  vi.clearAllMocks();
});

afterAll(() => {
  server.close();
});
