import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSessionResume } from '@/hooks/useSessionResume';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser, mockNotebooks } from '../mocks/fixtures';
import { mockDb } from '../mocks/mock-db';

describe('Phase 5: Session Resumption Hook (useSessionResume)', () => {
  beforeEach(() => {
    mockDb.reset();
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    vi.clearAllMocks();
  });

  it('restores active notebook and active source from localStorage on mount', async () => {
    localStorage.setItem('studylm_active_notebook_id', 'nb-physics-101');
    localStorage.setItem('studylm_active_source_id', 'src-yt-002');
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', mockUser);

    const { result } = renderHook(() => useSessionResume());

    await waitFor(() => {
      expect(result.current.isResumed).toBe(true);
    });

    expect(result.current.resumedNotebookId).toBe('nb-physics-101');
    expect(result.current.resumedSourceId).toBe('src-yt-002');
    expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-physics-101');
    expect(useWorkspaceStore.getState().activeSourceId).toBe('src-yt-002');
  });

  it('falls back to user.last_active_notebook_id when localStorage lacks notebook key', async () => {
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', {
      ...mockUser,
      last_active_notebook_id: 'nb-bio-201',
    });

    const { result } = renderHook(() => useSessionResume());

    await waitFor(() => {
      expect(result.current.isResumed).toBe(true);
    });

    expect(result.current.resumedNotebookId).toBe('nb-bio-201');
    expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-bio-201');
  });

  it('falls back to first available notebook when cached notebook ID is invalid or deleted', async () => {
    localStorage.setItem('studylm_active_notebook_id', 'nb-deleted-nonexistent');
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', {
      ...mockUser,
      last_active_notebook_id: undefined,
    });

    const { result } = renderHook(() => useSessionResume());

    await waitFor(() => {
      expect(result.current.isResumed).toBe(true);
    });

    expect(result.current.resumedNotebookId).toBe(mockNotebooks[0].id);
    expect(useWorkspaceStore.getState().activeNotebookId).toBe(mockNotebooks[0].id);
  });

  it('auto-selects first ready source when no source is cached in localStorage', async () => {
    localStorage.setItem('studylm_active_notebook_id', 'nb-physics-101');
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', mockUser);

    const { result } = renderHook(() => useSessionResume());

    await waitFor(() => {
      expect(result.current.isResumed).toBe(true);
    });

    expect(result.current.resumedNotebookId).toBe('nb-physics-101');
    // First ready source in nb-physics-101 is src-pdf-001
    expect(result.current.resumedSourceId).toBe('src-pdf-001');
    expect(useWorkspaceStore.getState().activeSourceId).toBe('src-pdf-001');
    expect(localStorage.getItem('studylm_active_source_id')).toBe('src-pdf-001');
  });

  it('cleans up state and purges storage keys on cross-tenant reset', () => {
    localStorage.setItem('studylm_active_notebook_id', 'nb-physics-101');
    localStorage.setItem('studylm_active_source_id', 'src-pdf-001');
    useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');
    useWorkspaceStore.getState().setActiveSourceId('src-pdf-001');

    act(() => {
      useWorkspaceStore.getState().reset();
    });

    expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
    expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
    expect(localStorage.getItem('studylm_active_notebook_id')).toBeNull();
    expect(localStorage.getItem('studylm_active_source_id')).toBeNull();
  });
});
