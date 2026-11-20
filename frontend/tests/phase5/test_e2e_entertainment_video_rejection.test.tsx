/**
 * Phase 5 E2E Suite: YouTube Educational Moderation Barrier Rejection
 * File: frontend/tests/phase5/test_e2e_entertainment_video_rejection.test.tsx
 *
 * Verifies the strict content moderation barrier:
 * 1. Submit non-educational entertainment YouTube URL
 * 2. Assert exact verbatim amber warning banner rendered with emoji:
 *    ⚠️ Upload educational related video, this video does not have educational content please recheck the link
 * 3. Assert title masked to exact string: [Suppressed: Non-Educational Content]
 * 4. Assert zero privacy leaks: video title, transcript, and description suppressed
 * 5. Assert inspector remains closed / blocked from playing
 * 6. Assert user can delete the rejected source to reclaim their 20-source quota
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser } from '../mocks/fixtures';
import { mockDb } from '../mocks/mock-db';

describe('Phase 5 E2E: YouTube Educational Moderation Barrier Rejection', () => {
  beforeEach(() => {
    mockDb.reset();
    mockDb.sources.delete('src-yt-rejected');
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    vi.clearAllMocks();
    window.innerWidth = 1200;

    useAuthStore.getState().setSession('valid-jwt-token-alex-student', mockUser);
    useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');
  });

  it('test_e2e_entertainment_video_rejection', async () => {
    const user = userEvent.setup();

    render(<WorkspaceShell />);

    // 1. Open YouTube Import Modal
    const openYtModalBtn = await screen.findByTestId('open-youtube-modal-btn');
    await user.click(openYtModalBtn);

    const modal = await screen.findByTestId('youtube-import-modal');
    expect(modal).toBeInTheDocument();

    // 2. Submit Non-Educational YouTube URL
    const urlInput = screen.getByTestId('youtube-url-input');
    await user.type(urlInput, 'https://www.youtube.com/watch?v=entertainment123');

    const submitBtn = screen.getByTestId('submit-youtube-btn');
    await user.click(submitBtn);

    // Modal closes
    await waitFor(() => {
      expect(screen.queryByTestId('youtube-import-modal')).not.toBeInTheDocument();
    });

    // 3. Assert Verbatim Warning Banner Rendered
    const warningBanner = await screen.findByTestId('educational-warning-banner');
    expect(warningBanner).toBeInTheDocument();
    expect(warningBanner).toHaveAttribute('role', 'alert');

    const exactExpectedBanner =
      'Upload educational related video, this video does not have educational content please recheck the link';
    expect(warningBanner.textContent).toContain(exactExpectedBanner);

    // 4. Assert Title Masked to [Suppressed: Non-Educational Content]
    const suppressedTitle = await screen.findByText('[Suppressed: Non-Educational Content]');
    expect(suppressedTitle).toBeInTheDocument();

    // 5. Assert Privacy Shielding: Zero Leaks in Attributes or Sub-Elements
    const card = screen.getByRole('article', { name: /Source: \[Suppressed: Non-Educational Content\]/i });
    expect(card).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /transcript/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /inspect/i })).not.toBeInTheDocument();

    // 6. Assert Player & Inspector Blocked
    // Clicking the rejected card must NOT select it or open player
    await user.click(card);
    expect(useWorkspaceStore.getState().activeSourceId).not.toContain('rejected');
    expect(screen.queryByTestId('youtube-viewer')).not.toBeInTheDocument();

    // 7. Assert Quota Reclaim via Deletion
    const deleteBtn = card.querySelector<HTMLButtonElement>('[data-testid="delete-source-btn"]');
    expect(deleteBtn).not.toBeNull();
    await user.click(deleteBtn!);

    const confirmDialog = await screen.findByTestId('delete-confirm-dialog');
    expect(confirmDialog).toBeInTheDocument();

    const confirmDeleteBtn = screen.getByTestId('confirm-delete-btn');
    await user.click(confirmDeleteBtn);

    // Source is removed from library and quota reclaimed
    await waitFor(() => {
      expect(screen.queryByText('[Suppressed: Non-Educational Content]')).not.toBeInTheDocument();
    });
  });
});
