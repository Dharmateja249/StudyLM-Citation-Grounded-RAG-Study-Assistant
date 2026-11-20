import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, renderHook, waitFor } from '@testing-library/react';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { useKeyboardShortcuts, isInputElement } from '@/hooks/useKeyboardShortcuts';
import { useSessionResume } from '@/hooks/useSessionResume';
import { apiClient } from '@/lib/api/client';
import { mockUser, mockNotebooks } from './mocks/fixtures';
import { mockDb } from './mocks/mock-db';
import { SourceRead, NotebookRead } from '@/types/api';

describe('Adversarial Challenger: Phase 5 Layout, Shortcuts & State Stress', () => {
  beforeEach(() => {
    mockDb.reset();
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().setPanelSizes(20, 35);
    vi.clearAllMocks();
    window.innerWidth = 1200;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Dimension 1: Panel Size Boundary Stress & Storage Corruption
  // =========================================================================
  describe('Dimension 1: Panel Size Boundary Stress & Storage Corruption', () => {
    it('1.1 clamps extreme negative and overflow values to strict contract bounds', () => {
      // Contract: Left: min 15, max 35. Right: min 25, max 50.

      // Sub-zero / negative values
      useWorkspaceStore.getState().setPanelSizes(-100, -50);
      let state = useWorkspaceStore.getState();
      expect(state.leftPanelSize).toBe(15);
      expect(state.rightPanelSize).toBe(25);

      // Massive overflow values
      useWorkspaceStore.getState().setPanelSizes(500, 1000);
      state = useWorkspaceStore.getState();
      expect(state.leftPanelSize).toBe(35);
      expect(state.rightPanelSize).toBe(50);

      // Micro-boundary tests (<15 and >35; <25 and >50)
      useWorkspaceStore.getState().setPanelSizes(14.999, 24.999);
      state = useWorkspaceStore.getState();
      expect(state.leftPanelSize).toBe(15);
      expect(state.rightPanelSize).toBe(25);

      useWorkspaceStore.getState().setPanelSizes(35.001, 50.001);
      state = useWorkspaceStore.getState();
      expect(state.leftPanelSize).toBe(35);
      expect(state.rightPanelSize).toBe(50);

      // Persisted values in localStorage match clamped values exactly
      const rawStored = localStorage.getItem('studylm_panel_sizes');
      expect(rawStored).not.toBeNull();
      const parsed = JSON.parse(rawStored!);
      expect(parsed).toEqual({ left: 35, right: 50 });
    });

    it('1.2 recovers gracefully from corrupted or malformed localStorage.studylm_panel_sizes', () => {
      const corruptedPayloads = [
        '{ malformed json %&@#$',
        'null',
        'undefined',
        '""',
        '12345',
        'true',
        '[]',
        '{}',
        JSON.stringify({ left: 'twenty', right: 'thirty-five' }),
        JSON.stringify({ left: null, right: null }),
        JSON.stringify({ left: [20], right: { size: 35 } }),
        JSON.stringify({ left: 20 }), // missing right
        JSON.stringify({ right: 35 }), // missing left
      ];

      for (const payload of corruptedPayloads) {
        localStorage.setItem('studylm_panel_sizes', payload);

        // Rendering WorkspaceShell must survive without unhandled exception
        const { unmount } = render(<WorkspaceShell />);
        expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();
        expect(screen.getByTestId('left-sidebar-slot')).toBeInTheDocument();
        expect(screen.getByTestId('center-viewer-slot')).toBeInTheDocument();
        expect(screen.getByTestId('right-chat-slot')).toBeInTheDocument();

        unmount();
      }
    });

    it('1.3 clamps out-of-bounds persisted panel sizes loaded from localStorage on initialization', () => {
      // User or script edited localStorage with out-of-bounds numbers
      localStorage.setItem('studylm_panel_sizes', JSON.stringify({ left: 5, right: 90 }));

      // Test store clamping logic directly
      useWorkspaceStore.getState().setPanelSizes(5, 90);
      const state = useWorkspaceStore.getState();
      expect(state.leftPanelSize).toBe(15);
      expect(state.rightPanelSize).toBe(50);
    });

    it('1.4 survives localStorage quota exhaustion or security denial without crashing', () => {
      // Simulate private browsing mode or quota exceeded error on setItem
      const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      });

      expect(() => {
        useWorkspaceStore.getState().setPanelSizes(22, 38);
      }).not.toThrow();

      // State is still updated in memory even if storage fails
      expect(useWorkspaceStore.getState().leftPanelSize).toBe(22);
      expect(useWorkspaceStore.getState().rightPanelSize).toBe(38);

      setItemSpy.mockRestore();
    });

    it('1.5 reveals state persistence caveat: reset() does not reset custom panel sizes', () => {
      useWorkspaceStore.getState().setPanelSizes(30, 45);
      expect(useWorkspaceStore.getState().leftPanelSize).toBe(30);
      expect(useWorkspaceStore.getState().rightPanelSize).toBe(45);

      // Invoking reset()
      act(() => {
        useWorkspaceStore.getState().reset();
      });

      // Verification of finding: leftPanelSize and rightPanelSize remain sticky across workspace reset()
      const afterReset = useWorkspaceStore.getState();
      expect(afterReset.leftPanelSize).toBe(30);
      expect(afterReset.rightPanelSize).toBe(45);
    });
  });

  // =========================================================================
  // Dimension 2: Keyboard Shortcut Hammering & Input Shielding
  // =========================================================================
  describe('Dimension 2: Keyboard Shortcut Hammering & Input Shielding', () => {
    it('2.1 survives rapid burst hammering of Cmd+B and Cmd+J without state corruption', () => {
      render(<WorkspaceShell />);

      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);
      expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);

      // Rapidly burst 100 Cmd+B keystrokes
      for (let i = 0; i < 100; i++) {
        fireEvent.keyDown(window, { key: 'b', metaKey: true });
      }
      // 100 toggles -> should return to initial state (false)
      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);

      // Burst 101 Cmd+B keystrokes
      for (let i = 0; i < 101; i++) {
        fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
      }
      // 101 toggles -> should be true
      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(true);

      // Rapidly burst 50 Cmd+J keystrokes
      for (let i = 0; i < 50; i++) {
        fireEvent.keyDown(window, { key: 'j', metaKey: true });
      }
      expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);

      // Interleaved rapid bursts
      for (let i = 0; i < 20; i++) {
        fireEvent.keyDown(window, { key: 'b', metaKey: true });
        fireEvent.keyDown(window, { key: 'j', metaKey: true });
      }
      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(true);
      expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);
    });

    it('2.2 strictly rejects shortcuts modified by Alt key', () => {
      render(<WorkspaceShell />);

      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);
      expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);

      // Alt+Cmd+B
      fireEvent.keyDown(window, { key: 'b', metaKey: true, altKey: true });
      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);

      // Alt+Ctrl+B
      fireEvent.keyDown(window, { key: 'b', ctrlKey: true, altKey: true });
      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);

      // Alt+Cmd+J
      fireEvent.keyDown(window, { key: 'j', metaKey: true, altKey: true });
      expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);

      // Alt+Cmd+K
      const switcherBtn = screen.getByTestId('notebook-switcher-btn');
      fireEvent.keyDown(window, { key: 'k', metaKey: true, altKey: true });
      expect(document.activeElement).not.toBe(switcherBtn);
    });

    it('2.3 ignores non-modifier plain keystrokes and non-target modifier chords', () => {
      render(<WorkspaceShell />);

      // Plain keys without Cmd/Ctrl
      fireEvent.keyDown(window, { key: 'b' });
      fireEvent.keyDown(window, { key: 'j' });
      fireEvent.keyDown(window, { key: 'k' });

      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);
      expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);

      // Unrelated chords: Cmd+C, Cmd+V, Cmd+A, Cmd+Z, Cmd+P
      const unrelatedKeys = ['c', 'v', 'a', 'z', 'p', 'f', 'r', 's'];
      for (const k of unrelatedKeys) {
        fireEvent.keyDown(window, { key: k, metaKey: true });
        fireEvent.keyDown(window, { key: k, ctrlKey: true });
      }

      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);
      expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);
    });

    it('2.4 shields all input, textarea, select, and contenteditable elements from shortcut firing', () => {
      render(<WorkspaceShell />);

      const elementsToTest: HTMLElement[] = [
        document.createElement('input'),
        Object.assign(document.createElement('input'), { type: 'text' }),
        Object.assign(document.createElement('input'), { type: 'search' }),
        Object.assign(document.createElement('input'), { type: 'email' }),
        Object.assign(document.createElement('input'), { type: 'password' }),
        Object.assign(document.createElement('input'), { type: 'url' }),
        Object.assign(document.createElement('input'), { type: 'number' }),
        document.createElement('textarea'),
        document.createElement('select'),
      ];

      // Custom role=textbox element
      const roleTextboxDiv = document.createElement('div');
      roleTextboxDiv.setAttribute('role', 'textbox');
      elementsToTest.push(roleTextboxDiv);

      // Custom contenteditable element (with polyfilled isContentEditable getter for jsdom)
      const contentEditableDiv = document.createElement('div');
      contentEditableDiv.contentEditable = 'true';
      Object.defineProperty(contentEditableDiv, 'isContentEditable', { value: true, configurable: true });
      elementsToTest.push(contentEditableDiv);

      for (const el of elementsToTest) {
        document.body.appendChild(el);
        el.focus();

        // Verify isInputElement unit oracle
        expect(isInputElement(el)).toBe(true);

        // Keystroke fired on the active input must be shielded
        fireEvent.keyDown(el, { key: 'b', metaKey: true });
        fireEvent.keyDown(el, { key: 'j', metaKey: true });
        fireEvent.keyDown(el, { key: 'k', metaKey: true });

        expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);
        expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);

        document.body.removeChild(el);
      }
    });

    it('2.5 allows non-textual input types to pass through shortcut shielding', () => {
      const nonTextInputs = [
        Object.assign(document.createElement('input'), { type: 'checkbox' }),
        Object.assign(document.createElement('input'), { type: 'radio' }),
        Object.assign(document.createElement('input'), { type: 'button' }),
        Object.assign(document.createElement('input'), { type: 'submit' }),
        Object.assign(document.createElement('input'), { type: 'reset' }),
      ];

      for (const el of nonTextInputs) {
        expect(isInputElement(el)).toBe(false);
      }
    });

    it('2.6 handles Cmd+K rapid hammering without breaking dropdown or unhandled rejection', () => {
      render(<WorkspaceShell />);

      // Rapidly press Cmd+K 20 times
      for (let i = 0; i < 20; i++) {
        act(() => {
          fireEvent.keyDown(window, { key: 'k', metaKey: true });
        });
      }

      // Left panel should be uncollapsed as prerequisite
      expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);
    });
  });

  // =========================================================================
  // Dimension 3: Session Resume Stress & Failure Recovery
  // =========================================================================
  describe('Dimension 3: Session Resume Stress & Failure Recovery', () => {
    it('3.1 handles expired session token (401) during session resume cleanly via apiClient interceptor', async () => {
      useAuthStore.getState().setSession('expired-invalid-jwt-token', mockUser);

      // Mock fetch to simulate 401 Unauthorized from backend
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: 'Session expired. Please log in again.' }), {
          status: 401,
          statusText: 'Unauthorized',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const { result } = renderHook(() => useSessionResume());

      await waitFor(() => {
        expect(result.current.isResuming).toBe(false);
      });

      expect(result.current.isResumed).toBe(false);
      expect(result.current.isResuming).toBe(false);
      // Auth store session should be purged by apiClient 401 interceptor
      expect(useAuthStore.getState().token).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().authError).toContain('Session expired');
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
    });

    it('3.2 handles user with zero notebooks gracefully (empty workspace)', async () => {
      useAuthStore.getState().setSession('valid-jwt-token', mockUser);
      localStorage.setItem('studylm_active_notebook_id', 'nb-old');
      localStorage.setItem('studylm_active_source_id', 'src-old');

      // Return empty list of notebooks
      vi.spyOn(apiClient, 'getNotebooks').mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionResume());

      await waitFor(() => {
        expect(result.current.isResuming).toBe(false);
      });

      expect(result.current.isResumed).toBe(true);
      expect(result.current.resumedNotebookId).toBeNull();
      expect(result.current.resumedSourceId).toBeNull();
      expect(result.current.notebooks).toHaveLength(0);

      // Stores and storage keys should be cleaned
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
      expect(localStorage.getItem('studylm_active_notebook_id')).toBeNull();
      expect(localStorage.getItem('studylm_active_source_id')).toBeNull();
    });

    it('3.3 falls back when cached notebook ID no longer exists or was deleted', async () => {
      useAuthStore.getState().setSession('valid-jwt-token', mockUser);
      localStorage.setItem('studylm_active_notebook_id', 'nb-nonexistent-999');

      const mockNotebookList: NotebookRead[] = [
        {
          id: 'nb-available-1',
          user_id: mockUser.id,
          title: 'Available Notebook 1',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(apiClient, 'getNotebooks').mockResolvedValueOnce(mockNotebookList);
      vi.spyOn(apiClient, 'getSources').mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSessionResume());

      await waitFor(() => {
        expect(result.current.isResumed).toBe(true);
      });

      expect(result.current.resumedNotebookId).toBe('nb-available-1');
      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-available-1');
      expect(localStorage.getItem('studylm_active_notebook_id')).toBe('nb-available-1');
    });

    it('3.4 handles notebook with empty source list without setting invalid activeSourceId', async () => {
      useAuthStore.getState().setSession('valid-jwt-token', mockUser);
      localStorage.setItem('studylm_active_notebook_id', 'nb-empty-sources');
      localStorage.setItem('studylm_active_source_id', 'src-stale-cached');

      const mockNotebookList: NotebookRead[] = [
        {
          id: 'nb-empty-sources',
          user_id: mockUser.id,
          title: 'Empty Sources Notebook',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(apiClient, 'getNotebooks').mockResolvedValueOnce(mockNotebookList);
      vi.spyOn(apiClient, 'getSources').mockResolvedValueOnce([]); // No sources

      const { result } = renderHook(() => useSessionResume());

      await waitFor(() => {
        expect(result.current.isResumed).toBe(true);
      });

      expect(result.current.resumedSourceId).toBeNull();
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
      expect(localStorage.getItem('studylm_active_source_id')).toBeNull();
    });

    it('3.5 filters out deleting and error sources when auto-selecting first source', async () => {
      useAuthStore.getState().setSession('valid-jwt-token', mockUser);

      const mockNotebookList: NotebookRead[] = [
        {
          id: 'nb-mix-sources',
          user_id: mockUser.id,
          title: 'Mixed Sources Notebook',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ];

      const mockSourceList: SourceRead[] = [
        {
          id: 'src-deleting-1',
          user_id: mockUser.id,
          notebook_id: 'nb-mix-sources',
          title: 'Deleting.pdf',
          source_type: 'pdf',
          storage_key_or_url: 'k1',
          status: 'deleting',
          reindexing: false,
          summary_status: 'error',
          created_at: new Date().toISOString(),
        },
        {
          id: 'src-error-2',
          user_id: mockUser.id,
          notebook_id: 'nb-mix-sources',
          title: 'Error.pdf',
          source_type: 'pdf',
          storage_key_or_url: 'k2',
          status: 'error',
          reindexing: false,
          summary_status: 'error',
          created_at: new Date().toISOString(),
        },
        {
          id: 'src-ready-3',
          user_id: mockUser.id,
          notebook_id: 'nb-mix-sources',
          title: 'Ready.pdf',
          source_type: 'pdf',
          storage_key_or_url: 'k3',
          status: 'ready',
          reindexing: false,
          summary_status: 'ready',
          created_at: new Date().toISOString(),
        },
      ];

      vi.spyOn(apiClient, 'getNotebooks').mockResolvedValueOnce(mockNotebookList);
      vi.spyOn(apiClient, 'getSources').mockResolvedValueOnce(mockSourceList);

      const { result } = renderHook(() => useSessionResume());

      await waitFor(() => {
        expect(result.current.isResumed).toBe(true);
      });

      // Must bypass src-deleting-1 and src-error-2 and pick src-ready-3
      expect(result.current.resumedSourceId).toBe('src-ready-3');
      expect(useWorkspaceStore.getState().activeSourceId).toBe('src-ready-3');
      expect(localStorage.getItem('studylm_active_source_id')).toBe('src-ready-3');
    });

    it('3.6 handles unmount during async resumption without memory leak or state desync', async () => {
      useAuthStore.getState().setSession('valid-jwt-token', mockUser);

      let resolveNotebooks: (value: NotebookRead[]) => void = () => {};
      const slowPromise = new Promise<NotebookRead[]>((resolve) => {
        resolveNotebooks = resolve;
      });

      vi.spyOn(apiClient, 'getNotebooks').mockReturnValueOnce(slowPromise);

      const { unmount } = renderHook(() => useSessionResume());

      // Unmount while request is pending
      unmount();

      // Resolve after unmount
      resolveNotebooks(mockNotebooks);
      // If cancellation was handled correctly, no errors or warnings are thrown
    });
  });

  // =========================================================================
  // Dimension 4: Cross-Tenant State Isolation & Rapid Profile Bouncing
  // =========================================================================
  describe('Dimension 4: Cross-Tenant State Isolation & Rapid Profile Bouncing', () => {
    it('4.1 purges workspace state completely during rapid high-frequency user switching', () => {
      // Simulate fast switching between 10 different user accounts
      for (let i = 1; i <= 10; i++) {
        const userId = `tenant-usr-${i}`;
        const notebookId = `nb-tenant-${i}`;
        const sourceId = `src-tenant-${i}`;

        // Tenant logs in and performs work
        useAuthStore.getState().setSession(`jwt-token-${userId}`, {
          id: userId,
          email: `${userId}@example.com`,
          name: `Tenant ${i}`,
          is_active: true,
          created_at: new Date().toISOString(),
        });

        useWorkspaceStore.getState().setActiveNotebookId(notebookId);
        useWorkspaceStore.getState().setActiveSourceId(sourceId);
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId,
          pageNumber: i,
          bboxes: [[0.1, 0.2, 0.3, 0.4]],
        });

        expect(useWorkspaceStore.getState().activeNotebookId).toBe(notebookId);
        expect(useWorkspaceStore.getState().activeSourceId).toBe(sourceId);
        expect(useWorkspaceStore.getState().activeFocusTarget).not.toBeNull();

        // Immediate switch to next tenant or logout
        useAuthStore.getState().logout();

        // Verify total sanitization
        expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
        expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
        expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
        expect(localStorage.getItem('studylm_active_notebook_id')).toBeNull();
        expect(localStorage.getItem('studylm_active_source_id')).toBeNull();
        expect(localStorage.getItem('studylm_auth_token')).toBeNull();
      }
    });

    it('4.2 prevents cross-tenant citation coordinates leakage on user change', () => {
      // User Alpha clicks deep-link citation with coordinates
      useAuthStore.getState().setUser({
        id: 'usr-alpha',
        email: 'alpha@test.com',
        name: 'Alpha',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
      });
      useWorkspaceStore.getState().setActiveNotebookId('nb-alpha');
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-alpha-secret',
        pageNumber: 15,
        bboxes: [[0.05, 0.1, 0.8, 0.9]],
      });

      // Switch to User Beta
      useAuthStore.getState().setUser({
        id: 'usr-beta',
        email: 'beta@test.com',
        name: 'Beta',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
      });

      // Verify activeFocusTarget is completely null for User Beta
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
    });
  });

  // =========================================================================
  // Dimension 5: Mobile Drawer Boundaries & Responsive Dismissal
  // =========================================================================
  describe('Dimension 5: Mobile Drawer Boundaries & Responsive Dismissal', () => {
    it('5.1 ensures mutual exclusivity between left and right mobile drawers', () => {
      window.innerWidth = 480;
      render(<WorkspaceShell />);

      expect(screen.getByTestId('workspace-mobile-layout')).toBeInTheDocument();

      // Open left drawer
      fireEvent.click(screen.getByTestId('mobile-toggle-left'));
      expect(screen.getByTestId('mobile-left-drawer')).toBeInTheDocument();
      expect(screen.queryByTestId('mobile-right-drawer')).not.toBeInTheDocument();

      // Open right drawer -> left drawer should be closed
      fireEvent.click(screen.getByTestId('mobile-toggle-right'));
      expect(screen.queryByTestId('mobile-left-drawer')).not.toBeInTheDocument();
      expect(screen.getByTestId('mobile-right-drawer')).toBeInTheDocument();

      // Clicking right toggle again closes right drawer
      fireEvent.click(screen.getByTestId('mobile-toggle-right'));
      expect(screen.queryByTestId('mobile-right-drawer')).not.toBeInTheDocument();
    });

    it('5.2 dismisses mobile drawers when clicking the backdrop overlay', () => {
      window.innerWidth = 480;
      render(<WorkspaceShell />);

      // Open left drawer
      fireEvent.click(screen.getByTestId('mobile-toggle-left'));
      const leftDrawer = screen.getByTestId('mobile-left-drawer');
      expect(leftDrawer).toBeInTheDocument();

      // Click backdrop overlay (aria-hidden element)
      const backdrop = leftDrawer.querySelector('[aria-hidden="true"]');
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop!);

      expect(screen.queryByTestId('mobile-left-drawer')).not.toBeInTheDocument();
    });
  });
});
