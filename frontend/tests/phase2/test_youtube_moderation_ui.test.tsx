import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SourceList } from '@/components/sidebar/SourceList';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser } from '../mocks/fixtures';

describe('Phase 2: YouTube Educational Moderation Barrier UI', () => {
  beforeEach(() => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');
    useAuthStore.getState().setUser(mockUser);
    useWorkspaceStore.getState().reset();
  });

  it('test_non_educational_youtube_displays_exact_warning_banner', async () => {
    render(<SourceList notebookId="nb-physics-101" />);

    // Open YouTube modal
    const openBtn = screen.getByRole('button', { name: /Add YouTube/i });
    await userEvent.click(openBtn);

    // Enter non-educational entertainment URL
    const input = screen.getByTestId('youtube-url-input');
    await userEvent.type(input, 'https://www.youtube.com/watch?v=entertainment123');

    const submitBtn = screen.getByTestId('submit-youtube-btn');
    fireEvent.click(submitBtn);

    // Verify exact verbatim warning banner appears
    await waitFor(() => {
      const banners = screen.getAllByTestId('educational-warning-banner');
      expect(banners.length).toBeGreaterThan(0);
      expect(banners[0]).toHaveTextContent(
        'Upload educational related video, this video does not have educational content please recheck the link'
      );
    });
  });

  it('test_non_educational_youtube_suppresses_title_and_transcript', async () => {
    render(<SourceList notebookId="nb-physics-101" />);

    // Open YouTube modal
    const openBtn = screen.getByRole('button', { name: /Add YouTube/i });
    await userEvent.click(openBtn);

    const input = screen.getByTestId('youtube-url-input');
    await userEvent.type(input, 'https://www.youtube.com/watch?v=entertainment123');

    const submitBtn = screen.getByTestId('submit-youtube-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // 1. Must suppress title to [Suppressed: Non-Educational Content]
      const suppressed = screen.getAllByText('[Suppressed: Non-Educational Content]');
      expect(suppressed.length).toBeGreaterThan(0);

      // 2. Must NOT render transcript button
      expect(screen.queryByRole('button', { name: /transcript/i })).not.toBeInTheDocument();

      // 3. Must NOT render inspect actions
      expect(screen.queryByRole('button', { name: /inspect/i })).not.toBeInTheDocument();
    });

    // 4. Clicking the suppressed card must NOT select it as activeSourceId
    const suppressedCard = screen.getAllByText('[Suppressed: Non-Educational Content]')[0].closest('div[role="article"]');
    if (suppressedCard) {
      await userEvent.click(suppressedCard);
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
    }
  });

  it('test_valid_educational_youtube_ingestion_renders_ready', async () => {
    render(<SourceList notebookId="nb-physics-101" />);

    // Open YouTube modal
    const openBtn = screen.getByRole('button', { name: /Add YouTube/i });
    await userEvent.click(openBtn);

    const input = screen.getByTestId('youtube-url-input');
    await userEvent.type(input, 'https://www.youtube.com/watch?v=kYv_8fX30yA');

    const submitBtn = screen.getByTestId('submit-youtube-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // Must render valid title
      expect(screen.getByText('Imported YouTube Lecture')).toBeInTheDocument();
    });

    const readyCard = screen.getByText('Imported YouTube Lecture').closest('div[role="article"]');
    expect(readyCard).toBeInTheDocument();
    if (readyCard) {
      // Must render ready badge
      expect(within(readyCard as HTMLElement).getByTestId('status-badge-ready')).toBeInTheDocument();

      // Selecting it sets activeSourceId
      await userEvent.click(readyCard);
      expect(useWorkspaceStore.getState().activeSourceId).not.toBeNull();
    }
  });

  it('test_reclaim_quota_via_deletion_of_rejected_source', async () => {
    render(<SourceList notebookId="nb-physics-101" />);

    // Submit non-educational URL
    await userEvent.click(screen.getByRole('button', { name: /Add YouTube/i }));
    await userEvent.type(
      screen.getByTestId('youtube-url-input'),
      'https://www.youtube.com/watch?v=entertainment123'
    );
    fireEvent.click(screen.getByTestId('submit-youtube-btn'));

    await waitFor(() => {
      expect(screen.getAllByText('[Suppressed: Non-Educational Content]').length).toBeGreaterThan(0);
    });

    const initialCount = screen.getAllByText('[Suppressed: Non-Educational Content]').length;

    // Delete rejected source
    const suppressedCard = screen.getAllByText('[Suppressed: Non-Educational Content]')[0].closest('div[role="article"]')!;
    const deleteBtn = within(suppressedCard as HTMLElement).getByTestId('delete-source-btn');
    await userEvent.click(deleteBtn);

    // Confirm deletion
    const confirmBtn = screen.getByTestId('confirm-delete-btn');
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      const remaining = screen.queryAllByText('[Suppressed: Non-Educational Content]');
      expect(remaining.length).toBe(initialCount - 1);
    });
  });
});
