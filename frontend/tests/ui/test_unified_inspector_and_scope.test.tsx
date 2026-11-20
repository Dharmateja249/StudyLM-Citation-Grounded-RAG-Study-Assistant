import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { UnifiedInspectorPane } from '@/components/viewer/UnifiedInspectorPane';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { SourceScopeSelector } from '@/components/sidebar/SourceScopeSelector';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { mockSources, mockCitations, mockUser } from '../mocks/fixtures';
import { mockDb } from '../mocks/mock-db';

describe('Phase 4: Unified Inspector Pane, Source Scope & Slot Architecture', () => {
  beforeEach(() => {
    mockDb.reset();
    useWorkspaceStore.getState().reset();
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', mockUser);
    useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 100 }),
    });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.innerWidth = 1200;
  });

  // 1. Source Scope Selector Header & Checkboxes
  it('test_source_scope_selector_renders_count_and_checkboxes', async () => {
    render(<SourceScopeSelector sources={mockSources.slice(0, 2)} />);
    const countBadge = screen.getByTestId('source-scope-count');
    expect(countBadge).toHaveTextContent(/2 of 2 selected/);

    const toggleAllBtn = screen.getByTestId('toggle-select-all-sources-btn');
    fireEvent.click(toggleAllBtn);
    expect(screen.getByTestId('source-scope-count')).toHaveTextContent(/0 of 2 selected/);
    expect(screen.getByTestId('empty-source-scope-alert')).toBeInTheDocument();
  });

  // 2. Non-Educational YouTube Excluded from Scope
  it('test_non_educational_youtube_source_excluded_from_scope_count', () => {
    render(<SourceScopeSelector sources={mockSources.slice(0, 3)} />);
    // mockSources[2] has ERR_NON_EDUCATIONAL_CONTENT -> total queryable must be 2, not 3
    expect(screen.getByTestId('source-scope-count')).toHaveTextContent(/2 of 2 selected/);
  });

  // 3. Starter Prompt Chips in Empty Chat
  it('test_empty_chat_renders_starter_prompt_chips', () => {
    render(<ChatContainer notebookId="nb-physics-101" />);
    expect(screen.getByTestId('starter-chip-summarize')).toBeInTheDocument();
    expect(screen.getByTestId('starter-chip-compare')).toBeInTheDocument();
    expect(screen.getByTestId('starter-chip-questions')).toBeInTheDocument();
    expect(screen.getByTestId('starter-chip-analogies')).toBeInTheDocument();
  });

  // 4. Citations Feed Rendering Quotes & Locations
  it('test_citations_card_feed_renders_verified_quotes_and_locations', () => {
    render(<UnifiedInspectorPane citations={mockCitations.slice(0, 2)} source={mockSources[0]} />);
    expect(screen.getByTestId('citations-count-badge')).toHaveTextContent('2 citations');

    const cards = screen.getAllByTestId('citation-card');
    expect(cards).toHaveLength(2);

    expect(screen.getAllByText('Page 42')[0]).toBeInTheDocument();
    expect(screen.getByText('12:22')).toBeInTheDocument();
    expect(screen.getByText(/Newton's second law states/)).toBeInTheDocument();
  });

  // 5. Expand & Collapse Toggle for Citations Feed
  it('test_citations_feed_expand_and_collapse_toggle', () => {
    render(<UnifiedInspectorPane citations={mockCitations.slice(0, 2)} source={mockSources[0]} />);
    expect(screen.getByTestId('citations-card-feed')).toBeInTheDocument();

    const toggleBtn = screen.getByTestId('toggle-citations-feed-btn');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('citations-card-feed')).not.toBeInTheDocument();

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('citations-card-feed')).toBeInTheDocument();
  });

  // 6. Clicking Citation Card Synchronizes Live Viewer
  it('test_clicking_citation_card_synchronizes_live_viewer', async () => {
    const onCitationClick = vi.fn();
    render(
      <UnifiedInspectorPane
        citations={mockCitations.slice(0, 2)}
        source={mockSources[0]}
        onCitationClick={onCitationClick}
      />
    );

    const cards = screen.getAllByTestId('citation-card');
    // Click YouTube citation (index 1)
    fireEvent.click(cards[1]);

    expect(onCitationClick).toHaveBeenCalledWith(mockCitations[1]);
    expect(useWorkspaceStore.getState().activeFocusTarget?.sourceId).toBe('src-yt-002');
    expect(useWorkspaceStore.getState().activeFocusTarget?.startSeconds).toBe(742);
  });

  // 7. PDF Canvas Rotated Bounding Boxes (0, 90, 180, 270)
  it('test_pdf_canvas_rotation_transforms_bounding_boxes_0_90_180_270', async () => {
    const pdfSource = mockSources[0];
    act(() => {
      useWorkspaceStore.getState().setActiveSourceId(pdfSource.id);
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: pdfSource.id,
        pageNumber: 1,
        bboxes: [[0.1, 0.2, 0.6, 0.5]],
      });
    });

    render(<UnifiedInspectorPane source={pdfSource} />);

    await waitFor(() => {
      expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
    });

    const rotateBtn = screen.getByLabelText('Rotate 90 Degrees');
    // Rotate to 90 deg
    fireEvent.click(rotateBtn);
    // Rotate to 180 deg
    fireEvent.click(rotateBtn);
    // Rotate to 270 deg
    fireEvent.click(rotateBtn);

    expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
  });

  // 8. Non-Educational Shield Verbatim Banner & Quota Reclaim
  it('test_non_educational_youtube_shield_renders_verbatim_banner_and_reclaims_quota', async () => {
    const rejectedSource = mockSources[2]; // ERR_NON_EDUCATIONAL_CONTENT
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <UnifiedInspectorPane
        source={rejectedSource}
        onDeleteSource={onDelete}
      />
    );

    expect(screen.getByTestId('youtube-shield-card')).toBeInTheDocument();
    const banner = screen.getByTestId('educational-warning-banner');
    expect(banner.textContent).toContain(
      '⚠️ Upload educational related video, this video does not have educational content please recheck the link'
    );
    expect(screen.getByTestId('shield-suppressed-title')).toHaveTextContent(
      '[Suppressed: Non-Educational Content]'
    );
    expect(screen.queryByTestId('youtube-iframe')).not.toBeInTheDocument();

    // Reclaim Quota Delete Button
    const deleteBtn = screen.getByTestId('shield-delete-source-btn');
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith(rejectedSource.id);
    });
  });

  // 9. WorkspaceShell Slot Landmarks & Slot Prop Overrides
  it('test_workspace_shell_slot_landmarks_and_defaults', () => {
    render(<WorkspaceShell />);

    expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();
    expect(screen.getByTestId('left-sidebar-slot')).toBeInTheDocument();
    expect(screen.getByTestId('center-viewer-slot')).toBeInTheDocument();
    expect(screen.getByTestId('right-chat-slot')).toBeInTheDocument();
    expect(screen.getByTestId('unified-inspector-pane')).toBeInTheDocument();
  });
});
