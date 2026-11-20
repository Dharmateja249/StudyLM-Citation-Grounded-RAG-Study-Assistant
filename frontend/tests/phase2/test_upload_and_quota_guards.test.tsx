import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { FileUploadDropzone } from '@/components/sidebar/FileUploadDropzone';
import { SourceList } from '@/components/sidebar/SourceList';
import { QuotaBadge } from '@/components/sidebar/QuotaBadge';
import { SourceRead } from '@/types/api';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser } from '../mocks/fixtures';

describe('Phase 2: Upload Pre-Flight Blocker & 20-Source Quota Guards', () => {
  beforeEach(() => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');
    useAuthStore.getState().setUser(mockUser);
    useWorkspaceStore.getState().reset();
  });

  it('test_client_blocks_upload_exceeding_50mb', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    render(<FileUploadDropzone notebookId="nb-physics-101" />);

    // Create 51MB file (51 * 1024 * 1024 + 1 bytes)
    const largeFile = new File(['x'.repeat(100)], 'large_document.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(largeFile, 'size', { value: 51 * 1024 * 1024 + 1 });

    const fileInput = screen.getByTestId('file-input');
    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-message')).toBeInTheDocument();
      expect(screen.getByText(/File exceeds 50MB limit/i)).toBeInTheDocument();
    });

    // INVARIANT: Pre-flight blocker must prevent all network requests!
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('test_twenty_source_quota_locks_upload_ui', () => {
    // Generate 20 mock sources
    const twentySources: SourceRead[] = Array.from({ length: 20 }, (_, i) => ({
      id: `src-mock-${i}`,
      user_id: 'usr-default-001',
      notebook_id: 'nb-quota-test',
      title: `Source Document ${i + 1}.pdf`,
      source_type: 'pdf',
      storage_key_or_url: `key-${i}`,
      status: 'ready',
      reindexing: false,
      summary_status: 'ready',
      created_at: new Date().toISOString(),
    }));

    render(<SourceList notebookId="nb-quota-test" initialSources={twentySources} />);

    // 1. Quota badge shows 20 / 20 Sources
    const quotaCounter = screen.getByTestId('quota-counter');
    expect(quotaCounter).toHaveTextContent('20 / 20 Sources');

    // 2. Dropzone is locked and displays tooltip
    const dropzone = screen.getByTestId('file-upload-dropzone');
    expect(dropzone).toHaveAttribute('data-locked', 'true');
    expect(dropzone).toHaveAttribute('title', 'Maximum 20 sources reached');

    // 3. File input is disabled
    const fileInput = screen.getByTestId('file-input');
    expect(fileInput).toBeDisabled();

    // 4. Add YouTube button is disabled
    const ytBtn = screen.getByTestId('open-youtube-modal-btn');
    expect(ytBtn).toBeDisabled();
    expect(ytBtn).toHaveAttribute('title', 'Maximum 20 sources reached');
  });

  it('test_backend_400_quota_error_renders_quota_toast', () => {
    render(
      <QuotaBadge
        currentCount={20}
        errorMessage="Notebook source limit reached (max 20)"
      />
    );

    expect(screen.getByTestId('quota-error-alert')).toBeInTheDocument();
    expect(screen.getByText('Notebook source limit reached (max 20)')).toBeInTheDocument();
  });

  it('test_drag_and_drop_pdf_upload_progress', async () => {
    const handleSuccess = vi.fn();
    render(<FileUploadDropzone notebookId="nb-physics-101" onUploadSuccess={handleSuccess} />);

    const dropzone = screen.getByTestId('file-upload-dropzone');
    const validFile = new File(['%PDF-1.4 test content'], 'sample.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(validFile, 'size', { value: 1024 * 1024 }); // 1MB

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [validFile],
      },
    });

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'sample.pdf',
          status: 'processing',
        })
      );
    });
  });
});
