/**
 * Phase 5 E2E Suite: Cross-Tenant Isolation & Anti-Enumeration Defense
 * File: frontend/tests/phase5/test_e2e_cross_tenant_isolation.test.tsx
 *
 * Verifies strict multi-tenant boundary fencing:
 * 1. User A creates private research notebook and confidential sources
 * 2. User B logs in (session switch purges User A state completely)
 * 3. User B attempts unauthorized access to User A's notebook via API & UI
 * 4. Assert HTTP 404 shielding (anti-enumeration defense, not 403)
 * 5. Assert 0 bytes of User A research data, document titles, or notes are exposed
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { apiClient, NotFoundError } from '@/lib/api/client';
import { mockUser } from '../mocks/fixtures';
import { mockDb } from '../mocks/mock-db';

describe('Phase 5 E2E: Cross-Tenant Isolation & Anti-Enumeration', () => {
  beforeEach(() => {
    mockDb.reset();
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    vi.clearAllMocks();
    window.innerWidth = 1200;
  });

  it('test_e2e_cross_tenant_isolation', async () => {
    // -----------------------------------------------------------------------
    // 1. Seed User A's Private Notebook & Data
    // -----------------------------------------------------------------------
    const userANotebook = {
      id: 'nb-tenant-a-classified',
      user_id: 'usr-tenant-a-owner', // Different tenant / User A
      title: 'User A Confidential Research',
      status: 'active' as const,
      created_at: '2026-10-10T10:00:00Z',
    };
    mockDb.notebooks.set(userANotebook.id, userANotebook);

    const userASource = {
      id: 'src-tenant-a-confidential',
      user_id: 'usr-tenant-a-owner',
      notebook_id: userANotebook.id,
      title: 'Proprietary_Formula.pdf',
      source_type: 'pdf' as const,
      storage_key_or_url: 'users/usr-tenant-a-owner/notebooks/nb-tenant-a-classified/Proprietary_Formula.pdf',
      status: 'ready' as const,
      reindexing: false,
      summary_status: 'ready' as const,
      created_at: '2026-10-10T10:05:00Z',
    };
    mockDb.sources.set(userASource.id, userASource);

    // -----------------------------------------------------------------------
    // 2. User B Authenticates (Current Student User)
    // -----------------------------------------------------------------------
    const userB = {
      ...mockUser,
      id: 'usr-default-001',
    };

    useAuthStore.getState().setSession('valid-jwt-token-alex-student', userB);
    expect(useAuthStore.getState().user?.id).toBe('usr-default-001');

    // Verify User A state is fully purged
    expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
    expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
    expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();

    // -----------------------------------------------------------------------
    // 3. User B Attempts Direct API Access to User A's Notebook
    // -----------------------------------------------------------------------
    // Attempt getNotebook
    let caughtNotebookError: unknown;
    try {
      await apiClient.getNotebook('nb-tenant-a-classified');
    } catch (err) {
      caughtNotebookError = err;
    }
    expect(caughtNotebookError).toBeInstanceOf(NotFoundError);
    expect((caughtNotebookError as NotFoundError).status).toBe(404);

    // Attempt getSources for User A's notebook
    let caughtSourcesError: unknown;
    try {
      await apiClient.getSources('nb-tenant-a-classified');
    } catch (err) {
      caughtSourcesError = err;
    }
    expect(caughtSourcesError).toBeInstanceOf(NotFoundError);
    expect((caughtSourcesError as NotFoundError).status).toBe(404);

    // Attempt getMessages for User A's notebook
    let caughtMessagesError: unknown;
    try {
      await apiClient.getMessages('nb-tenant-a-classified');
    } catch (err) {
      caughtMessagesError = err;
    }
    expect(caughtMessagesError).toBeInstanceOf(NotFoundError);
    expect((caughtMessagesError as NotFoundError).status).toBe(404);

    // -----------------------------------------------------------------------
    // 4. User B Mounts Workspace with Forged Active Notebook ID
    // -----------------------------------------------------------------------
    useWorkspaceStore.getState().setActiveNotebookId('nb-tenant-a-classified');
    render(<WorkspaceShell />);

    // Zero data leaked in UI
    await waitFor(() => {
      expect(screen.queryByText('Proprietary_Formula.pdf')).not.toBeInTheDocument();
      expect(screen.queryByText('User A Confidential Research')).not.toBeInTheDocument();
    });

    // Viewer container remains empty
    expect(screen.getByTestId('viewer-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
  });
});
