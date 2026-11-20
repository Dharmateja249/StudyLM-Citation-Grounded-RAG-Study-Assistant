import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SourceCard } from '@/components/sidebar/SourceCard';
import { SourceRead } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';

describe('Phase 2: Source Lifecycle State Badges', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
  });

  it('test_processing_source_shows_pulsing_indicator', () => {
    const processingSource: SourceRead = {
      id: 'src-proc-1',
      user_id: 'usr-1',
      notebook_id: 'nb-1',
      title: 'Large_Mechanics.pdf',
      source_type: 'pdf',
      storage_key_or_url: 'key-1',
      status: 'processing',
      reindexing: false,
      summary_status: 'pending',
      created_at: new Date().toISOString(),
    };

    render(<SourceCard source={processingSource} />);

    expect(screen.getByTestId('pulsing-spinner')).toBeInTheDocument();
    expect(screen.getByTestId('status-badge-processing')).toHaveTextContent('Ingesting & indexing...');
    expect(screen.getByTestId('processing-skeleton')).toBeInTheDocument();
  });

  it('test_ready_source_shows_document_icon', () => {
    const readySource: SourceRead = {
      id: 'src-ready-1',
      user_id: 'usr-1',
      notebook_id: 'nb-1',
      title: 'Chapter_01.pdf',
      source_type: 'pdf',
      storage_key_or_url: 'key-ready',
      page_count: 32,
      status: 'ready',
      reindexing: false,
      summary_status: 'ready',
      created_at: new Date().toISOString(),
    };

    render(<SourceCard source={readySource} />);

    expect(screen.getByTestId('status-badge-ready')).toBeInTheDocument();
    expect(screen.getByText('32 pages')).toBeInTheDocument();
    expect(screen.getByText('Chapter_01.pdf')).toBeInTheDocument();
  });

  it('test_reindexing_badge_displays_secondary_badge', () => {
    const reindexingSource: SourceRead = {
      id: 'src-reindex-1',
      user_id: 'usr-1',
      notebook_id: 'nb-1',
      title: 'Vector_Calculus.pdf',
      source_type: 'pdf',
      storage_key_or_url: 'key-reindex',
      status: 'ready',
      reindexing: true,
      summary_status: 'ready',
      created_at: new Date().toISOString(),
    };

    render(<SourceCard source={reindexingSource} />);

    expect(screen.getByTestId('reindexing-badge')).toBeInTheDocument();
    expect(screen.getByText(/Re-indexing.../i)).toBeInTheDocument();
  });

  it('test_deleting_source_is_disabled', () => {
    const deletingSource: SourceRead = {
      id: 'src-del-1',
      user_id: 'usr-1',
      notebook_id: 'nb-1',
      title: 'Old_Draft.pdf',
      source_type: 'pdf',
      storage_key_or_url: 'key-del',
      status: 'deleting',
      reindexing: false,
      summary_status: 'pending',
      created_at: new Date().toISOString(),
    };

    render(<SourceCard source={deletingSource} />);

    const card = screen.getByTestId('source-card-src-del-1');
    expect(card).toHaveClass('opacity-50');
    expect(card).toHaveClass('pointer-events-none');
    expect(screen.getByTestId('status-badge-deleting')).toBeInTheDocument();
  });

  it('test_corrupt_file_renders_error_badge', () => {
    const corruptSource: SourceRead = {
      id: 'src-err-1',
      user_id: 'usr-1',
      notebook_id: 'nb-1',
      title: 'corrupt_scan.pdf',
      source_type: 'pdf',
      storage_key_or_url: 'key-err',
      status: 'error',
      reindexing: false,
      error_code: 'ERR_CORRUPT_FILE',
      error_message: 'Corrupted PDF file header. Could not extract pages.',
      summary_status: 'error',
      created_at: new Date().toISOString(),
    };

    render(<SourceCard source={corruptSource} />);

    expect(screen.getByTestId('status-badge-error')).toBeInTheDocument();
    expect(screen.getByTestId('generic-error-banner')).toHaveTextContent(
      'Corrupted PDF file header. Could not extract pages.'
    );
  });
});
