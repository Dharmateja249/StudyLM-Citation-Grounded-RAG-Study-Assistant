import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SourceCard } from '@/components/sidebar/SourceCard';
import { NotebookSelector } from '@/components/sidebar/NotebookSelector';
import { LeftSidebar } from '@/components/sidebar/LeftSidebar';
import { SourceRead, NotebookRead } from '@/types/api';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { apiClient } from '@/lib/api/client';
import { mockUser } from './mocks/fixtures';
import { mockDb } from './mocks/mock-db';

describe('Adversarial Challenge: Source Lifecycle State Machine & Cascading Deletion', () => {
  beforeEach(() => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');
    useAuthStore.getState().setUser(mockUser);
    useWorkspaceStore.getState().reset();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Dimension 1: 5 Lifecycle State Badges & Polymorphic Rendering', () => {
    it('1.1 [processing] state renders spinner, skeleton, correct badge, and resists card click selection', async () => {
      const processingSource: SourceRead = {
        id: 'src-proc-stress',
        user_id: 'usr-1',
        notebook_id: 'nb-1',
        title: 'Massive_Physics_Volume.pdf',
        source_type: 'pdf',
        storage_key_or_url: 'key-proc',
        status: 'processing',
        reindexing: false,
        summary_status: 'pending',
        created_at: new Date().toISOString(),
      };

      const selectSpy = vi.fn();
      render(<SourceCard source={processingSource} onSelect={selectSpy} />);

      // Verify pulsing spinner and skeleton
      expect(screen.getByTestId('pulsing-spinner')).toBeInTheDocument();
      expect(screen.getByTestId('processing-skeleton')).toBeInTheDocument();

      // Verify badge text
      const badge = screen.getByTestId('status-badge-processing');
      expect(badge).toHaveTextContent('Ingesting & indexing...');
      expect(badge).toHaveClass('animate-pulse');

      // Verify card click is inert during processing
      const card = screen.getByTestId('source-card-src-proc-stress');
      await userEvent.click(card);
      expect(selectSpy).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
    });

    it('1.2 [ready] state renders correct polymorphic icons and metadata for PDF, YouTube, and Image', async () => {
      // PDF Source
      const pdfSource: SourceRead = {
        id: 'src-ready-pdf',
        user_id: 'usr-1',
        notebook_id: 'nb-1',
        title: 'Mechanics_Ch1.pdf',
        source_type: 'pdf',
        storage_key_or_url: 'key-pdf',
        page_count: 54,
        status: 'ready',
        reindexing: false,
        summary_status: 'ready',
        created_at: new Date().toISOString(),
      };

      const { unmount } = render(<SourceCard source={pdfSource} />);
      expect(screen.getByTestId('status-badge-ready')).toHaveTextContent('ready');
      expect(screen.getByText('54 pages')).toBeInTheDocument();
      expect(screen.getByRole('article')).toHaveAttribute('data-status', 'ready');

      // Click selects source
      await userEvent.click(screen.getByTestId('source-card-src-ready-pdf'));
      expect(useWorkspaceStore.getState().activeSourceId).toBe('src-ready-pdf');
      unmount();

      // YouTube Source
      const ytSource: SourceRead = {
        id: 'src-ready-yt',
        user_id: 'usr-1',
        notebook_id: 'nb-1',
        title: 'MIT Lecture 01',
        source_type: 'youtube',
        storage_key_or_url: 'https://youtube.com/watch?v=valid123',
        duration_seconds: 904, // 15:04
        status: 'ready',
        reindexing: false,
        summary_status: 'ready',
        created_at: new Date().toISOString(),
      };

      const { unmount: unmountYt } = render(<SourceCard source={ytSource} />);
      expect(screen.getByTestId('status-badge-ready')).toBeInTheDocument();
      expect(screen.getByText('15:04')).toBeInTheDocument();
      unmountYt();

      // Image Source
      const imageSource: SourceRead = {
        id: 'src-ready-img',
        user_id: 'usr-1',
        notebook_id: 'nb-1',
        title: 'Circuit_Diagram.png',
        source_type: 'image',
        storage_key_or_url: 'key-img',
        file_size_bytes: 3670016, // ~3.5 MB
        status: 'ready',
        reindexing: false,
        summary_status: 'ready',
        created_at: new Date().toISOString(),
      };

      render(<SourceCard source={imageSource} />);
      expect(screen.getByTestId('status-badge-ready')).toBeInTheDocument();
      expect(screen.getByText('3.5 MB')).toBeInTheDocument();
    });

    it('1.3 [deleting] state renders faded opacity, disables interactions, and removes delete button', async () => {
      const deletingSource: SourceRead = {
        id: 'src-deleting-stress',
        user_id: 'usr-1',
        notebook_id: 'nb-1',
        title: 'Obsolete_Notes.pdf',
        source_type: 'pdf',
        storage_key_or_url: 'key-del',
        status: 'deleting',
        reindexing: false,
        summary_status: 'pending',
        created_at: new Date().toISOString(),
      };

      const selectSpy = vi.fn();
      render(<SourceCard source={deletingSource} onSelect={selectSpy} />);

      const card = screen.getByTestId('source-card-src-deleting-stress');
      expect(card).toHaveClass('opacity-50');
      expect(card).toHaveClass('pointer-events-none');
      expect(screen.getByTestId('status-badge-deleting')).toHaveTextContent('deleting');

      // Delete action button must be absent so double-delete race cannot be triggered
      expect(screen.queryByTestId('delete-source-btn')).not.toBeInTheDocument();

      // Click must be inert
      await userEvent.click(card);
      expect(selectSpy).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
    });

    it('1.4 [reindexing] state renders secondary purple badge without conflicting with ready state', async () => {
      const reindexingSource: SourceRead = {
        id: 'src-reindex-stress',
        user_id: 'usr-1',
        notebook_id: 'nb-1',
        title: 'Embeddings_V2.pdf',
        source_type: 'pdf',
        storage_key_or_url: 'key-reindex',
        page_count: 120,
        status: 'ready',
        reindexing: true,
        summary_status: 'ready',
        created_at: new Date().toISOString(),
      };

      render(<SourceCard source={reindexingSource} />);

      // Secondary reindexing badge must be present
      expect(screen.getByTestId('reindexing-badge')).toBeInTheDocument();
      expect(screen.getByText(/Re-indexing.../i)).toBeInTheDocument();

      // Primary ready badge is hidden to prevent badge clutter
      expect(screen.queryByTestId('status-badge-ready')).not.toBeInTheDocument();

      // Card is still selectable and deletable while reindexing
      await userEvent.click(screen.getByTestId('source-card-src-reindex-stress'));
      expect(useWorkspaceStore.getState().activeSourceId).toBe('src-reindex-stress');
      expect(screen.getByTestId('delete-source-btn')).toBeInTheDocument();
    });

    it('1.5 [error] state cleanly differentiates generic error vs non-educational suppression', async () => {
      // Case A: Generic corruption error
      const corruptSource: SourceRead = {
        id: 'src-err-generic',
        user_id: 'usr-1',
        notebook_id: 'nb-1',
        title: 'Damaged_File.pdf',
        source_type: 'pdf',
        storage_key_or_url: 'key-corrupt',
        status: 'error',
        reindexing: false,
        error_code: 'ERR_CORRUPT_FILE',
        error_message: 'File corrupted at byte 1024',
        summary_status: 'error',
        created_at: new Date().toISOString(),
      };

      const { unmount } = render(<SourceCard source={corruptSource} />);
      expect(screen.getByTestId('status-badge-error')).toHaveTextContent('error');
      expect(screen.getByTestId('generic-error-banner')).toHaveTextContent('File corrupted at byte 1024');
      // Delete button remains active to clean up broken source
      expect(screen.getByTestId('delete-source-btn')).toBeInTheDocument();
      unmount();

      // Case B: Non-educational YouTube rejection
      const nonEduSource: SourceRead = {
        id: 'src-err-non-edu',
        user_id: 'usr-1',
        notebook_id: 'nb-1',
        title: 'Entertainment Music Video',
        source_type: 'youtube',
        storage_key_or_url: 'https://youtube.com/watch?v=music123',
        status: 'error',
        reindexing: false,
        error_code: 'ERR_NON_EDUCATIONAL_CONTENT',
        error_message: 'Upload educational related video, this video does not have educational content please recheck the link',
        summary_status: 'error',
        created_at: new Date().toISOString(),
      };

      render(<SourceCard source={nonEduSource} />);

      // Title must be suppressed
      const titleElem = screen.getByTestId('source-title');
      expect(titleElem).toHaveTextContent('[Suppressed: Non-Educational Content]');

      // Exact verbatim amber banner must render
      const banner = screen.getByTestId('educational-warning-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(
        'Upload educational related video, this video does not have educational content please recheck the link'
      );

      // Generic error badge should not show for educational moderation
      expect(screen.queryByTestId('status-badge-error')).not.toBeInTheDocument();

      // Card click must NOT select the non-educational source
      await userEvent.click(screen.getByTestId('source-card-src-err-non-edu'));
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();

      // User CAN delete to reclaim 20-source quota
      expect(screen.getByTestId('delete-source-btn')).toBeInTheDocument();
    });
  });

  describe('Dimension 2: Cascading Deletion Dialog & Verbatim Warning Verification', () => {
    it('2.1 modal renders exact verbatim warning: "Deleting this notebook will permanently remove all associated sources and notes."', async () => {
      const mockNotebooks: NotebookRead[] = [
        {
          id: 'nb-adv-1',
          user_id: mockUser.id,
          title: 'Quantum Computing',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ];

      useWorkspaceStore.getState().setActiveNotebookId('nb-adv-1');
      render(<NotebookSelector initialNotebooks={mockNotebooks} />);

      // Open dropdown
      await userEvent.click(screen.getByTestId('notebook-switcher-btn'));

      // Click delete icon
      await userEvent.click(screen.getByTestId('delete-notebook-nb-adv-1'));

      // Check modal role, aria attributes, and verbatim warning
      const modal = screen.getByTestId('notebook-delete-confirm-modal');
      expect(modal).toHaveAttribute('role', 'alertdialog');
      expect(modal).toHaveAttribute('aria-modal', 'true');

      const expectedWarning =
        'Deleting this notebook will permanently remove all associated sources and notes.';
      expect(modal.textContent).toContain(expectedWarning);

      // Verify exact verbatim match within the description paragraph
      const warningParagraph = modal.querySelector('p');
      expect(warningParagraph?.textContent?.trim()).toContain(expectedWarning);
    });

    it('2.2 cancelling deletion dialog dismisses modal and prevents API call', async () => {
      const deleteApiSpy = vi.spyOn(apiClient, 'deleteNotebook');
      const mockNotebooks: NotebookRead[] = [
        {
          id: 'nb-cancel-test',
          user_id: mockUser.id,
          title: 'Preserved Notebook',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ];

      useWorkspaceStore.getState().setActiveNotebookId('nb-cancel-test');
      render(<NotebookSelector initialNotebooks={mockNotebooks} />);

      await userEvent.click(screen.getByTestId('notebook-switcher-btn'));
      await userEvent.click(screen.getByTestId('delete-notebook-nb-cancel-test'));

      expect(screen.getByTestId('notebook-delete-confirm-modal')).toBeInTheDocument();

      // Click Cancel button
      await userEvent.click(screen.getByTestId('cancel-delete-nb-btn'));

      // Modal dismissed
      expect(screen.queryByTestId('notebook-delete-confirm-modal')).not.toBeInTheDocument();

      // API was NOT invoked
      expect(deleteApiSpy).not.toHaveBeenCalled();

      // Active notebook is still preserved
      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-cancel-test');
    });
  });

  describe('Dimension 3: State Isolation & activeNotebookId / activeSourceId Reset', () => {
    it('3.1 confirming deletion of active notebook clears activeNotebookId, activeSourceId, and activeFocusTarget', async () => {
      const deleteApiSpy = vi.spyOn(apiClient, 'deleteNotebook').mockResolvedValueOnce({
        id: 'nb-active-del',
        status: 'deleting',
      });

      const mockNotebooks: NotebookRead[] = [
        {
          id: 'nb-active-del',
          user_id: mockUser.id,
          title: 'Active Notebook to Delete',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ];

      // Setup populated workspace state
      useWorkspaceStore.getState().setActiveNotebookId('nb-active-del');
      useWorkspaceStore.getState().setActiveSourceId('src-dependent-1');
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-dependent-1',
        pageNumber: 12,
        quote: 'Isolated citation quote',
      });

      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-active-del');
      expect(useWorkspaceStore.getState().activeSourceId).toBe('src-dependent-1');
      expect(useWorkspaceStore.getState().activeFocusTarget).not.toBeNull();
      expect(localStorage.getItem('studylm_active_notebook_id')).toBe('nb-active-del');

      render(<NotebookSelector initialNotebooks={mockNotebooks} />);

      await userEvent.click(screen.getByTestId('notebook-switcher-btn'));
      await userEvent.click(screen.getByTestId('delete-notebook-nb-active-del'));
      await userEvent.click(screen.getByTestId('confirm-delete-nb-btn'));

      await waitFor(() => {
        expect(deleteApiSpy).toHaveBeenCalledWith('nb-active-del');
      });

      // Assert complete state purge
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
      expect(localStorage.getItem('studylm_active_notebook_id')).toBeNull();
    });

    it('3.2 deleting non-active notebook does NOT clear current active notebook or its sources', async () => {
      const deleteApiSpy = vi.spyOn(apiClient, 'deleteNotebook').mockResolvedValueOnce({
        id: 'nb-secondary',
        status: 'deleting',
      });

      const mockNotebooks: NotebookRead[] = [
        {
          id: 'nb-primary',
          user_id: mockUser.id,
          title: 'Primary Active Notebook',
          status: 'active',
          created_at: new Date().toISOString(),
        },
        {
          id: 'nb-secondary',
          user_id: mockUser.id,
          title: 'Secondary Notebook',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ];

      useWorkspaceStore.getState().setActiveNotebookId('nb-primary');
      useWorkspaceStore.getState().setActiveSourceId('src-primary-1');

      render(<NotebookSelector initialNotebooks={mockNotebooks} />);

      await userEvent.click(screen.getByTestId('notebook-switcher-btn'));
      // Delete nb-secondary, not the active nb-primary
      await userEvent.click(screen.getByTestId('delete-notebook-nb-secondary'));
      await userEvent.click(screen.getByTestId('confirm-delete-nb-btn'));

      await waitFor(() => {
        expect(deleteApiSpy).toHaveBeenCalledWith('nb-secondary');
      });

      // Active state must remain intact
      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-primary');
      expect(useWorkspaceStore.getState().activeSourceId).toBe('src-primary-1');
      expect(localStorage.getItem('studylm_active_notebook_id')).toBe('nb-primary');
    });

    it('3.3 switching between notebooks enforces cross-notebook source & citation isolation', async () => {
      const mockNotebooks: NotebookRead[] = [
        {
          id: 'nb-A',
          user_id: mockUser.id,
          title: 'Notebook A',
          status: 'active',
          created_at: new Date().toISOString(),
        },
        {
          id: 'nb-B',
          user_id: mockUser.id,
          title: 'Notebook B',
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ];

      useWorkspaceStore.getState().setActiveNotebookId('nb-A');
      useWorkspaceStore.getState().setActiveSourceId('src-A-1');
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-A-1',
        pageNumber: 3,
        quote: 'Citation from Notebook A',
      });

      render(<NotebookSelector initialNotebooks={mockNotebooks} />);

      // Switch to Notebook B
      await userEvent.click(screen.getByTestId('notebook-switcher-btn'));
      await userEvent.click(screen.getByTestId('notebook-option-nb-B'));

      // activeNotebookId is now nb-B
      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-B');
      expect(localStorage.getItem('studylm_active_notebook_id')).toBe('nb-B');

      // State isolation guarantee: activeSourceId and activeFocusTarget from nb-A MUST be cleared
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
    });

    it('3.4 switching notebooks in LeftSidebar does NOT leak prior notebook sources or inflate quota', async () => {
      mockDb.reset();
      useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');

      render(<LeftSidebar />);

      // Initially on nb-physics-101: wait for physics sources to load
      await waitFor(() => {
        expect(screen.getByText('Mechanics_Lecture_01.pdf')).toBeInTheDocument();
      });

      // Switch to Cellular Biology 201 (nb-bio-201, which has 0 sources)
      await userEvent.click(screen.getByTestId('notebook-switcher-btn'));
      await userEvent.click(screen.getByTestId('notebook-option-nb-bio-201'));

      // Invariant: Cellular Biology 201 should NOT contain Mechanics_Lecture_01.pdf
      await waitFor(() => {
        expect(screen.queryByText('Mechanics_Lecture_01.pdf')).not.toBeInTheDocument();
      });

      // Quota counter should be 0 / 20 Sources
      expect(screen.getByTestId('quota-counter')).toHaveTextContent('0 / 20 Sources');
    });
  });

  describe('Dimension 4: Single Source Deletion Confirmation & Optimistic Reclaim', () => {
    it('4.1 inline confirmation prevents accidental clicks and calls onDelete upon confirmation', async () => {
      const deleteSpy = vi.fn();
      const source: SourceRead = {
        id: 'src-inline-test',
        user_id: 'usr-1',
        notebook_id: 'nb-1',
        title: 'Single_Source.pdf',
        source_type: 'pdf',
        storage_key_or_url: 'key-test',
        status: 'ready',
        reindexing: false,
        summary_status: 'ready',
        created_at: new Date().toISOString(),
      };

      render(<SourceCard source={source} onDelete={deleteSpy} />);

      // Initial state: no confirmation dialog
      expect(screen.queryByTestId('delete-confirm-dialog')).not.toBeInTheDocument();

      // Click trash icon
      await userEvent.click(screen.getByTestId('delete-source-btn'));

      // Confirm dialog appears
      const dialog = screen.getByTestId('delete-confirm-dialog');
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute('role', 'alertdialog');

      // Cancel
      await userEvent.click(screen.getByTestId('cancel-delete-btn'));
      expect(screen.queryByTestId('delete-confirm-dialog')).not.toBeInTheDocument();
      expect(deleteSpy).not.toHaveBeenCalled();

      // Click trash again, then confirm
      await userEvent.click(screen.getByTestId('delete-source-btn'));
      await userEvent.click(screen.getByTestId('confirm-delete-btn'));

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      expect(deleteSpy).toHaveBeenCalledWith('src-inline-test');
    });
  });
});
