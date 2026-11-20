import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';

describe('Adversarial Challenge: State Store Boundaries & Event Bus', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    localStorage.clear();
  });

  // =========================================================================
  // 1. Cross-Tenant State Purge & Rapid User Switching
  // =========================================================================
  describe('Cross-Tenant State Purge Boundaries', () => {
    it('test_cross_tenant_purge_on_explicit_logout', () => {
      // User A populates state
      useAuthStore.getState().setToken('jwt-user-a');
      useAuthStore.getState().setUser({
        id: 'usr-a',
        email: 'usera@example.com',
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

      // Logout
      useAuthStore.getState().logout();

      // Verify full purge
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
      expect(localStorage.getItem('studylm_active_notebook_id')).toBeNull();
      expect(localStorage.getItem('studylm_auth_token')).toBeNull();
    });

    it('test_cross_tenant_purge_on_direct_user_switch_via_setUser', () => {
      // User A active
      useAuthStore.getState().setUser({
        id: 'usr-a',
        email: 'usera@example.com',
        name: 'User A',
        is_active: true,
        created_at: '2026-10-11T00:00:00Z',
      });
      useWorkspaceStore.getState().setActiveNotebookId('nb-tenant-a');
      useWorkspaceStore.getState().setActiveSourceId('src-tenant-a');
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-tenant-a',
        pageNumber: 7,
      });

      // Switch to User B directly
      useAuthStore.getState().setUser({
        id: 'usr-b',
        email: 'userb@example.com',
        name: 'User B',
        is_active: true,
        created_at: '2026-10-11T00:00:00Z',
      });

      // Workspace must be purged
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
      expect(localStorage.getItem('studylm_active_notebook_id')).toBeNull();
    });

    it('test_cross_tenant_purge_on_loginWithGoogle_switch_without_logout', async () => {
      // User A is active
      useAuthStore.getState().setToken('token-a');
      useAuthStore.getState().setUser({
        id: 'usr-a',
        email: 'usera@example.com',
        name: 'User A',
        is_active: true,
        created_at: '2026-10-11T00:00:00Z',
      });
      useWorkspaceStore.getState().setActiveNotebookId('nb-tenant-a');
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-tenant-a',
        pageNumber: 12,
      });

      // User B logs in via loginWithGoogle directly (MSW returns usr-b)
      const success = await useAuthStore.getState().loginWithGoogle('valid-google-id-token');
      expect(success).toBe(true);

      const currentUser = useAuthStore.getState().user;
      expect(currentUser?.id).toBe('usr-default-001'); // Default fixture user ID

      // If currentUser is different from usr-a, verify activeFocusTarget from usr-a is NOT residual
      const focusTarget = useWorkspaceStore.getState().activeFocusTarget;
      expect(focusTarget).toBeNull();
    });

    it('test_cross_tenant_leak_when_incoming_user_has_no_last_active_notebook', async () => {
      // User A is active with notebook and focus target
      useAuthStore.getState().setToken('token-a');
      useAuthStore.getState().setUser({
        id: 'usr-a',
        email: 'usera@example.com',
        name: 'User A',
        is_active: true,
        created_at: '2026-10-11T00:00:00Z',
      });
      useWorkspaceStore.getState().setActiveNotebookId('nb-tenant-a');
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-tenant-a',
        pageNumber: 12,
      });

      // User B logs in (incoming user with NO last_active_notebook_id)
      // Simulate by directly updating user/token as loginWithGoogle would if backend returned user without last_active_notebook_id
      const prevUser = useAuthStore.getState().user;
      const newUserWithoutNotebook = {
        id: 'usr-new-b',
        email: 'newb@example.com',
        name: 'New User B',
        is_active: true,
        last_active_notebook_id: undefined,
        created_at: '2026-10-11T00:00:00Z',
      };

      // In loginWithGoogle:
      // set({ token: ..., user: data.user, ... })
      // Notice: loginWithGoogle does NOT call setUser! It does set({ token, user, ... })
      // If loginWithGoogle did:
      useAuthStore.setState({
        token: 'token-new-b',
        user: newUserWithoutNotebook,
        isAuthenticated: true,
      });
      // And since data.user.last_active_notebook_id is undefined:
      // setActiveNotebookId is NOT called!

      // Check whether User A's notebook or focus target leaked to User B!
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
    });

    it('test_rapid_user_switching_zero_residual_leak', () => {
      // Rapidly toggle between User A and User B 50 times
      for (let i = 0; i < 50; i++) {
        const userId = `usr-${i % 2 === 0 ? 'even' : 'odd'}`;
        useAuthStore.getState().setUser({
          id: userId,
          email: `${userId}@example.com`,
          name: userId,
          is_active: true,
          created_at: '2026-10-11T00:00:00Z',
        });
        useWorkspaceStore.getState().setActiveNotebookId(`nb-${userId}`);
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: `src-${userId}`,
          pageNumber: i,
        });

        // Switch to the other user
        const nextUserId = `usr-${i % 2 === 0 ? 'odd' : 'even'}`;
        useAuthStore.getState().setUser({
          id: nextUserId,
          email: `${nextUserId}@example.com`,
          name: nextUserId,
          is_active: true,
          created_at: '2026-10-11T00:00:00Z',
        });

        // Immediately check that workspace has zero residual data from userId
        expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
        expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
        expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
        expect(localStorage.getItem('studylm_active_notebook_id')).toBeNull();
      }
    });

    it('test_cross_tenant_purge_on_token_expiry_and_deactivation', () => {
      useWorkspaceStore.getState().setActiveNotebookId('nb-temp');
      useWorkspaceStore.getState().dispatchFocusTarget({ sourceId: 'src-temp' });

      // Expire session
      useAuthStore.getState().handleExpiredSession();
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();

      // Repopulate and trigger deactivation
      useWorkspaceStore.getState().setActiveNotebookId('nb-temp-2');
      useWorkspaceStore.getState().dispatchFocusTarget({ sourceId: 'src-temp-2' });

      useAuthStore.getState().triggerDeactivatedState();
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
      expect(useAuthStore.getState().isDeactivated).toBe(true);
    });
  });

  // =========================================================================
  // 2. Dispatched ViewerFocusTarget Timestamp Uniqueness
  // =========================================================================
  describe('ViewerFocusTarget Timestamp Uniqueness & Monotonicity', () => {
    it('test_consecutive_identical_citations_produce_distinct_timestamps', () => {
      // User clicks citation 1
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-pdf-1',
        pageNumber: 42,
        bboxes: [[0.1, 0.2, 0.3, 0.4]],
      });
      const t1 = useWorkspaceStore.getState().activeFocusTarget?.timestamp;

      // User immediately clicks the EXACT SAME citation 1 again (e.g. double-click or re-click)
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-pdf-1',
        pageNumber: 42,
        bboxes: [[0.1, 0.2, 0.3, 0.4]],
      });
      const t2 = useWorkspaceStore.getState().activeFocusTarget?.timestamp;

      expect(t1).toBeDefined();
      expect(t2).toBeDefined();
      // Crucial architectural contract: timestamp disambiguates consecutive clicks on identical citation
      expect(t2).toBeGreaterThan(t1!);
    });

    it('test_burst_citations_dispatch_all_produce_strictly_unique_timestamps', () => {
      const timestamps = new Set<number>();
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: 'src-repeat',
          pageNumber: 1,
        });
        const ts = useWorkspaceStore.getState().activeFocusTarget?.timestamp;
        if (ts !== undefined) {
          timestamps.add(ts);
        }
      }

      // If timestamps are not unique, Set size will be < iterations
      expect(timestamps.size).toBe(iterations);
    });

    it('test_explicit_timestamp_preservation', () => {
      const explicitTs = 1700000000000;
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-explicit',
        timestamp: explicitTs,
      });
      expect(useWorkspaceStore.getState().activeFocusTarget?.timestamp).toBe(explicitTs);
    });
  });

  // =========================================================================
  // 3. Layout Resizer Constraints & Collapse States
  // =========================================================================
  describe('Layout Resizer Constraints & Collapse States', () => {
    it('test_layout_resizer_clamps_within_min_and_max_bounds', () => {
      // Left Panel: minSize 15, maxSize 35
      // Right Panel: minSize 25, maxSize 50
      
      // Extreme values below min
      useWorkspaceStore.getState().setPanelSizes(5, 10);
      const stateLow = useWorkspaceStore.getState();
      expect(stateLow.leftPanelSize).toBeGreaterThanOrEqual(15);
      expect(stateLow.rightPanelSize).toBeGreaterThanOrEqual(25);

      // Extreme values above max
      useWorkspaceStore.getState().setPanelSizes(50, 80);
      const stateHigh = useWorkspaceStore.getState();
      expect(stateHigh.leftPanelSize).toBeLessThanOrEqual(35);
      expect(stateHigh.rightPanelSize).toBeLessThanOrEqual(50);
    });

    it('test_layout_collapse_state_toggles', () => {
      const store = useWorkspaceStore.getState();
      expect(store.leftPanelCollapsed).toBe(false);
      expect(store.rightPanelCollapsed).toBe(false);

      useWorkspaceStore.getState().toggleLeftPanel();
      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(true);

      useWorkspaceStore.getState().toggleRightPanel();
      expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(true);

      useWorkspaceStore.getState().setLeftPanelCollapsed(false);
      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);

      useWorkspaceStore.getState().setRightPanelCollapsed(false);
      expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);
    });

    it('test_workspace_shell_renders_slots_and_landmarks', () => {
      const { container } = render(
        <WorkspaceShell
          leftSidebar={<div data-testid="sidebar-content">Sidebar Content</div>}
          centerViewer={<div data-testid="viewer-content">Viewer Content</div>}
          rightChat={<div data-testid="chat-content">Chat Content</div>}
        />
      );

      expect(screen.getByTestId('sidebar-content')).toBeInTheDocument();
      expect(screen.getByTestId('viewer-content')).toBeInTheDocument();
      expect(screen.getByTestId('chat-content')).toBeInTheDocument();

      // Landmarks
      expect(screen.getByRole('region', { name: /Notebooks and Sources Sidebar/i })).toBeInTheDocument();
      expect(screen.getByRole('main', { name: /Document and Media Viewer/i })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: /Grounded Conversational Chat/i })).toBeInTheDocument();
    });
  });
});
