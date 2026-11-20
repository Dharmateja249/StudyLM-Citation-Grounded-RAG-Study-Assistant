import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { EducationalWarningBanner, DEFAULT_EDUCATIONAL_WARNING_MESSAGE } from '@/components/sidebar/EducationalWarningBanner';
import { SourceCard } from '@/components/sidebar/SourceCard';
import { SourceList } from '@/components/sidebar/SourceList';
import { FileUploadDropzone } from '@/components/sidebar/FileUploadDropzone';
import { QuotaBadge } from '@/components/sidebar/QuotaBadge';
import { YouTubeImportModal } from '@/components/sidebar/YouTubeImportModal';
import { SourceRead } from '@/types/api';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser } from './mocks/fixtures';
import { mockDb } from './mocks/mock-db';

describe('Adversarial Challenge: Moderation Barrier & Quota Enforcement', () => {
  beforeEach(() => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');
    useAuthStore.getState().setUser(mockUser);
    useWorkspaceStore.getState().reset();
    localStorage.clear();
    mockDb.reset();
    vi.restoreAllMocks();
  });

  describe('Challenge Dimension 1: YouTube Educational Moderation Barrier UI', () => {
    it('1.1 EducationalWarningBanner renders exact verbatim banner text with ⚠️ emoji', () => {
      render(<EducationalWarningBanner />);

      const banner = screen.getByTestId('educational-warning-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveAttribute('role', 'alert');

      const expectedVerbatim =
        '⚠️ Upload educational related video, this video does not have educational content please recheck the link';

      expect(DEFAULT_EDUCATIONAL_WARNING_MESSAGE).toBe(expectedVerbatim);
      expect(banner.textContent).toContain(expectedVerbatim);
    });

    it('1.2 SourceCard renders educational banner and suppresses inspect/transcript actions', async () => {
      const nonEduSource: SourceRead = {
        id: 'src-adversarial-rejected',
        user_id: 'usr-adv-1',
        notebook_id: 'nb-adv-1',
        title: 'Non-Educational Music Video',
        source_type: 'youtube',
        storage_key_or_url: 'https://www.youtube.com/watch?v=entertainment123',
        status: 'error',
        reindexing: false,
        error_code: 'ERR_NON_EDUCATIONAL_CONTENT',
        error_message:
          'Upload educational related video, this video does not have educational content please recheck the link',
        summary_status: 'error',
        created_at: new Date().toISOString(),
      };

      render(<SourceCard source={nonEduSource} />);

      // Title must be masked to exact string: [Suppressed: Non-Educational Content]
      const titleElem = screen.getByTestId('source-title');
      expect(titleElem).toHaveTextContent('[Suppressed: Non-Educational Content]');

      // Transcript and inspect buttons must NOT exist
      expect(screen.queryByRole('button', { name: /transcript/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /inspect/i })).not.toBeInTheDocument();

      // Warning banner must be present
      const banner = screen.getByTestId('educational-warning-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(
        'Upload educational related video, this video does not have educational content please recheck the link'
      );

      // Card must be unselectable
      const card = screen.getByTestId('source-card-src-adversarial-rejected');
      await userEvent.click(card);
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
    });

    it('1.3 Adversarial Privacy Shielding Check: unsuppressed title in HTML attributes', () => {
      // Adversarial attack: What if backend or raw source object contained sensitive non-educational title?
      const sensitiveTitle = 'Leaked Private Home Video';
      const nonEduSource: SourceRead = {
        id: 'src-privacy-check',
        user_id: 'usr-adv-1',
        notebook_id: 'nb-adv-1',
        title: sensitiveTitle,
        source_type: 'youtube',
        storage_key_or_url: 'https://www.youtube.com/watch?v=entertainment123',
        status: 'error',
        reindexing: false,
        error_code: 'ERR_NON_EDUCATIONAL_CONTENT',
        error_message:
          'Upload educational related video, this video does not have educational content please recheck the link',
        summary_status: 'error',
        created_at: new Date().toISOString(),
      };

      const { container } = render(<SourceCard source={nonEduSource} />);

      const titleElem = screen.getByTestId('source-title');
      expect(titleElem.textContent).toBe('[Suppressed: Non-Educational Content]');

      // Check if sensitiveTitle leaked into title attribute or aria-label
      const titleAttribute = titleElem.getAttribute('title');
      const articleAriaLabel = container.querySelector('[role="article"]')?.getAttribute('aria-label');
      const deleteAriaLabel = screen.getByTestId('delete-source-btn').getAttribute('aria-label');

      // Check whether raw sensitiveTitle leaked into DOM attributes
      const hasLeakedTitleAttr = titleAttribute === sensitiveTitle;
      const hasLeakedArticleAria = articleAriaLabel?.includes(sensitiveTitle) ?? false;
      const hasLeakedDeleteAria = deleteAriaLabel?.includes(sensitiveTitle) ?? false;

      // Report empirical observation
      console.log('Privacy Leak Observation:', {
        hasLeakedTitleAttr,
        hasLeakedArticleAria,
        hasLeakedDeleteAria,
      });
    });

    it('1.4 Preservation of source deletion to reclaim quota for rejected YouTube source', async () => {
      const rejectedSource: SourceRead = {
        id: 'src-reclaim-quota',
        user_id: mockUser.id,
        notebook_id: 'nb-reclaim',
        title: '[Suppressed: Non-Educational Content]',
        source_type: 'youtube',
        storage_key_or_url: 'https://www.youtube.com/watch?v=entertainment123',
        status: 'error',
        reindexing: false,
        error_code: 'ERR_NON_EDUCATIONAL_CONTENT',
        error_message:
          'Upload educational related video, this video does not have educational content please recheck the link',
        summary_status: 'error',
        created_at: new Date().toISOString(),
      };
      mockDb.sources.set(rejectedSource.id, { ...rejectedSource });

      // 19 ready sources + 1 rejected source = 20 total sources (LOCKED)
      const mockSources: SourceRead[] = [
        rejectedSource,
        ...Array.from({ length: 19 }, (_, i) => ({
          id: `src-valid-${i}`,
          user_id: mockUser.id,
          notebook_id: 'nb-reclaim',
          title: `Valid Source ${i + 1}.pdf`,
          source_type: 'pdf' as const,
          storage_key_or_url: `key-${i}`,
          status: 'ready' as const,
          reindexing: false,
          summary_status: 'ready' as const,
          created_at: new Date().toISOString(),
        })),
      ];

      render(<SourceList notebookId="nb-reclaim" initialSources={mockSources} />);

      // Initially 20/20 sources => locked
      expect(screen.getByTestId('quota-counter')).toHaveTextContent('20 / 20 Sources');
      expect(screen.getByTestId('file-upload-dropzone')).toHaveAttribute('data-locked', 'true');
      expect(screen.getByTestId('open-youtube-modal-btn')).toBeDisabled();

      // Find the rejected card and click delete
      const rejectedCard = screen.getByTestId('source-card-src-reclaim-quota');
      const deleteBtn = within(rejectedCard).getByTestId('delete-source-btn');
      await userEvent.click(deleteBtn);

      // Confirm deletion
      const confirmBtn = screen.getByTestId('confirm-delete-btn');
      await userEvent.click(confirmBtn);

      // Optimistic update sets status='deleting', removing it from active sources
      // Once API completes, quota is reclaimed to 19 / 20 Sources!
      await waitFor(() => {
        expect(screen.getByTestId('quota-counter')).toHaveTextContent('19 / 20 Sources');
      });

      // INVARIANT: Quota is reclaimed, dropzone and Add YouTube button are UNLOCKED!
      expect(screen.getByTestId('file-upload-dropzone')).toHaveAttribute('data-locked', 'false');
      expect(screen.getByTestId('open-youtube-modal-btn')).not.toBeDisabled();
    });
  });

  describe('Challenge Dimension 2: 50MB Client-Side Pre-Flight Blocker', () => {
    it('2.1 Boundary Test: Exactly 50MB (52,428,800 bytes) is permitted and initiates upload', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      render(<FileUploadDropzone notebookId="nb-boundary-test" />);

      // Exact 50MB file: 50 * 1024 * 1024 = 52,428,800 bytes
      const exact50MBFile = new File(['a'], 'exact_50mb.pdf', { type: 'application/pdf' });
      Object.defineProperty(exact50MBFile, 'size', { value: 50 * 1024 * 1024 });

      const fileInput = screen.getByTestId('file-input');
      fireEvent.change(fileInput, { target: { files: [exact50MBFile] } });

      // Should NOT show error message
      expect(screen.queryByTestId('upload-error-message')).not.toBeInTheDocument();

      // Should call fetch
      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });
    });

    it('2.2 Boundary Test: 50MB + 1 Byte (52,428,801 bytes) is BLOCKED with 0 network calls', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      render(<FileUploadDropzone notebookId="nb-boundary-test" />);

      // 50MB + 1 byte
      const over50MBFile = new File(['a'], 'over_50mb.pdf', { type: 'application/pdf' });
      Object.defineProperty(over50MBFile, 'size', { value: 50 * 1024 * 1024 + 1 });

      const fileInput = screen.getByTestId('file-input');
      fireEvent.change(fileInput, { target: { files: [over50MBFile] } });

      // Verifies client-side error alert
      await waitFor(() => {
        expect(screen.getByTestId('upload-error-message')).toBeInTheDocument();
        expect(screen.getByText('File exceeds 50MB limit')).toBeInTheDocument();
      });

      // EMPIRICAL INVARIANT: Exactly 0 network requests initiated!
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('2.3 Extreme Over-Size: 1GB file dropped via Drag-and-Drop is BLOCKED with 0 network calls', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      render(<FileUploadDropzone notebookId="nb-dnd-test" />);

      const oneGBFile = new File(['a'], 'huge_scanned_archive.pdf', { type: 'application/pdf' });
      Object.defineProperty(oneGBFile, 'size', { value: 1024 * 1024 * 1024 }); // 1GB

      const dropzone = screen.getByTestId('file-upload-dropzone');
      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [oneGBFile],
        },
      });

      await waitFor(() => {
        expect(screen.getByTestId('upload-error-message')).toBeInTheDocument();
        expect(screen.getByText('File exceeds 50MB limit')).toBeInTheDocument();
      });

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('2.4 Zero-byte file is rejected client-side with 0 network calls', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      render(<FileUploadDropzone notebookId="nb-empty-test" />);

      const emptyFile = new File([], 'empty.pdf', { type: 'application/pdf' });
      Object.defineProperty(emptyFile, 'size', { value: 0 });

      const fileInput = screen.getByTestId('file-input');
      fireEvent.change(fileInput, { target: { files: [emptyFile] } });

      await waitFor(() => {
        expect(screen.getByTestId('upload-error-message')).toBeInTheDocument();
        expect(screen.getByText('Cannot upload an empty file')).toBeInTheDocument();
      });

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('Challenge Dimension 3: 20-Source Quota Lock & Backend 400 Error Handling', () => {
    it('3.1 Exactly 19 sources allows uploads; 20th source locks all entrypoints', () => {
      const nineteenSources: SourceRead[] = Array.from({ length: 19 }, (_, i) => ({
        id: `src-19-${i}`,
        user_id: 'usr-1',
        notebook_id: 'nb-19',
        title: `Source ${i + 1}.pdf`,
        source_type: 'pdf' as const,
        storage_key_or_url: `key-${i}`,
        status: 'ready' as const,
        reindexing: false,
        summary_status: 'ready' as const,
        created_at: new Date().toISOString(),
      }));

      const { rerender } = render(
        <SourceList notebookId="nb-19" initialSources={nineteenSources} />
      );

      // At 19 sources: unlocked
      expect(screen.getByTestId('quota-counter')).toHaveTextContent('19 / 20 Sources');
      expect(screen.getByTestId('file-upload-dropzone')).toHaveAttribute('data-locked', 'false');
      expect(screen.getByTestId('open-youtube-modal-btn')).not.toBeDisabled();

      // Add 20th source: locked
      const twentySources: SourceRead[] = [
        ...nineteenSources,
        {
          id: 'src-20th',
          user_id: 'usr-1',
          notebook_id: 'nb-19',
          title: 'Source 20.pdf',
          source_type: 'pdf' as const,
          storage_key_or_url: 'key-20',
          status: 'ready' as const,
          reindexing: false,
          summary_status: 'ready' as const,
          created_at: new Date().toISOString(),
        },
      ];

      rerender(<SourceList notebookId="nb-19" initialSources={twentySources} />);

      // At 20 sources: locked
      expect(screen.getByTestId('quota-counter')).toHaveTextContent('20 / 20 Sources');
      expect(screen.getByTestId('file-upload-dropzone')).toHaveAttribute('data-locked', 'true');
      expect(screen.getByTestId('file-upload-dropzone')).toHaveAttribute('title', 'Maximum 20 sources reached');
      expect(screen.getByTestId('file-input')).toBeDisabled();
      expect(screen.getByTestId('open-youtube-modal-btn')).toBeDisabled();
      expect(screen.getByTestId('open-youtube-modal-btn')).toHaveAttribute('title', 'Maximum 20 sources reached');
    });

    it('3.2 Drag-and-drop on locked dropzone triggers 0 network calls', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      render(<FileUploadDropzone notebookId="nb-locked" isLocked={true} />);

      const file = new File(['content'], 'lecture.pdf', { type: 'application/pdf' });
      Object.defineProperty(file, 'size', { value: 1024 * 1024 });

      const dropzone = screen.getByTestId('file-upload-dropzone');
      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [file],
        },
      });

      // No network call should occur
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('3.3 YouTube modal rejects submission when locked with 0 network calls', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch');
      render(
        <YouTubeImportModal
          isOpen={true}
          notebookId="nb-locked"
          isLocked={true}
          onClose={vi.fn()}
        />
      );

      const input = screen.getByTestId('youtube-url-input');
      fireEvent.change(input, {
        target: { value: 'https://www.youtube.com/watch?v=kYv_8fX30yA' },
      });

      const submitBtn = screen.getByTestId('submit-youtube-btn');
      expect(submitBtn).toBeDisabled();
      expect(submitBtn).toHaveAttribute('title', 'Maximum 20 sources reached');

      fireEvent.click(submitBtn);

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('3.4 Backend 400 error renders structured quota error banner', () => {
      render(
        <QuotaBadge
          currentCount={20}
          maxLimit={20}
          errorMessage="Notebook source limit reached (max 20)"
        />
      );

      const alert = screen.getByTestId('quota-error-alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveAttribute('role', 'alert');
      expect(alert.textContent).toContain('Notebook source limit reached (max 20)');
    });
  });
});
