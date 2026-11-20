import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

describe('Notebook & Workspace Store Verification', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    localStorage.clear();
  });

  it('test_active_notebook_persistence', () => {
    useWorkspaceStore.getState().setActiveNotebookId('nb-phys-101');
    expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-phys-101');
    expect(localStorage.getItem('studylm_active_notebook_id')).toBe('nb-phys-101');
  });

  it('test_last_active_notebook_restoration', () => {
    // User profile contains last_active_notebook_id
    useAuthStore.getState().setUser({
      id: 'usr-1',
      email: 'alex@example.com',
      name: 'Alex',
      avatar_url: null,
      is_active: true,
      last_active_notebook_id: 'nb-restored',
      created_at: '2026-10-11T10:00:00Z',
    });

    const user = useAuthStore.getState().user;
    if (user?.last_active_notebook_id) {
      useWorkspaceStore.getState().setActiveNotebookId(user.last_active_notebook_id);
    }

    expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-restored');
  });

  it('test_cross_tenant_state_purge', () => {
    // 1. Populate workspace for Tenant A
    useAuthStore.getState().setToken('tenant-a-jwt');
    useAuthStore.getState().setUser({
      id: 'usr-a',
      email: 'a@example.com',
      name: 'User A',
      is_active: true,
      created_at: '2026-10-11T00:00:00Z',
    });
    useWorkspaceStore.getState().setActiveNotebookId('nb-tenant-a');
    useWorkspaceStore.getState().setActiveSourceId('src-tenant-a');
    useWorkspaceStore.getState().dispatchFocusTarget({
      sourceId: 'src-tenant-a',
      pageNumber: 3,
      bboxes: [[0.1, 0.2, 0.3, 0.4]],
    });

    expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-tenant-a');
    expect(useWorkspaceStore.getState().activeFocusTarget).not.toBeNull();

    // 2. Tenant A logs out
    useAuthStore.getState().logout();

    // 3. Assert full purge: zero residual tenant A data
    const workspace = useWorkspaceStore.getState();
    expect(workspace.activeNotebookId).toBeNull();
    expect(workspace.activeSourceId).toBeNull();
    expect(workspace.activeFocusTarget).toBeNull();
    expect(localStorage.getItem('studylm_active_notebook_id')).toBeNull();
    expect(localStorage.getItem('studylm_auth_token')).toBeNull();
  });

  it('test_viewer_focus_target_dispatch', () => {
    const timestampBefore = Date.now();
    useWorkspaceStore.getState().dispatchFocusTarget({
      sourceId: 'src-chem-4',
      pageNumber: 15,
      bboxes: [
        [0.1, 0.1, 0.5, 0.2],
        [0.1, 0.25, 0.6, 0.35],
      ],
      quote: 'Reaction rate increases with temperature.',
    });

    const state = useWorkspaceStore.getState();
    expect(state.activeSourceId).toBe('src-chem-4');
    expect(state.activeFocusTarget).toBeDefined();
    expect(state.activeFocusTarget?.sourceId).toBe('src-chem-4');
    expect(state.activeFocusTarget?.pageNumber).toBe(15);
    expect(state.activeFocusTarget?.bboxes?.length).toBe(2);
    expect(state.activeFocusTarget?.quote).toBe('Reaction rate increases with temperature.');
    expect(state.activeFocusTarget?.timestamp).toBeGreaterThanOrEqual(timestampBefore);
  });
});
