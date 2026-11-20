import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ViewerContainer } from '@/components/viewer/ViewerContainer';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { mockSources } from '../mocks/fixtures';

describe('Phase 4: Multimodal Inspector Switcher & State Retention', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', {
      id: 'usr-default-001',
      email: 'student@university.edu',
      name: 'Alex Student',
      is_active: true,
      created_at: '2026-09-01T08:00:00Z',
    });
    useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      stroke: vi.fn(),
    });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('test_switching_from_pdf_to_youtube_citation_updates_view', async () => {
    const pdfSource = mockSources[0]; // src-pdf-001
    const ytSource = mockSources[1]; // src-yt-002

    act(() => {
      useWorkspaceStore.getState().setActiveSourceId(pdfSource.id);
    });

    render(<WorkspaceShell />);

    // 1. Initial State: PDF Viewer is mounted
    await waitFor(() => {
      expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
    });

    // 2. Click YouTube citation targeting ytSource
    act(() => {
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: ytSource.id,
        startSeconds: 742,
      });
    });

    // 3. Right Pane automatically switches to YouTube Viewer
    await waitFor(() => {
      expect(screen.getByTestId('youtube-viewer')).toBeInTheDocument();
      expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
    });
  });

  it('test_retaining_last_inspected_state_per_source', async () => {
    const pdfSource = mockSources[0];
    const ytSource = mockSources[1];

    const { rerender } = render(<ViewerContainer source={pdfSource} />);

    // 1. PDF initially on page 1, dispatch focus target for page 42
    act(() => {
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: pdfSource.id,
        pageNumber: 42,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
    });

    // 2. Switch to YouTube source
    rerender(<ViewerContainer source={ytSource} />);
    await waitFor(() => {
      expect(screen.getByTestId('youtube-viewer')).toBeInTheDocument();
    });

    // 3. Switch back to PDF source
    rerender(<ViewerContainer source={pdfSource} />);
    await waitFor(() => {
      expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
    });
  });

  it('test_empty_state_when_no_source_selected', () => {
    useWorkspaceStore.getState().setActiveSourceId(null);

    render(<ViewerContainer />);

    expect(screen.getByTestId('viewer-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No source selected')).toBeInTheDocument();
  });

  it('test_summary_roadmap_tab_toggle', async () => {
    const pdfSource = mockSources[0];
    render(<ViewerContainer source={pdfSource} />);

    await waitFor(() => {
      expect(screen.getByTestId('tab-roadmap')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('tab-roadmap'));

    await waitFor(() => {
      expect(screen.getByTestId('summary-roadmap-view')).toBeInTheDocument();
      expect(screen.getByText(/Comprehensive introduction to classical/)).toBeInTheDocument();
    });
  });
});
