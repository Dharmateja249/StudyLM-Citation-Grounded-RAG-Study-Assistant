/**
 * Phase 3: Sentence-Buffered Markdown & Citation Pill Tests
 * File: frontend/tests/phase3/test_sentence_buffered_markdown.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { GroundedMarkdown } from '@/components/chat/GroundedMarkdown';
import { CitationChip } from '@/components/chat/CitationChip';
import { mockCitations } from '../mocks/fixtures';
import { useWorkspaceStore } from '@/stores/workspaceStore';

describe('Phase 3: Grounded Markdown & Interactive Citation Pills', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
  });

  it('test_markdown_replaces_cite_tokens_with_interactive_pills', () => {
    render(
      <GroundedMarkdown
        content="Newton's second law states that F = ma [[cite:1]]."
        citations={mockCitations}
      />
    );

    // Pill badge [1] must exist
    const pill = screen.getByTestId('citation-pill');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('[1]');

    // Raw syntax [[cite:1]] must NOT be visible
    expect(screen.queryByText('[[cite:1]]')).not.toBeInTheDocument();
  });

  it('test_unverified_citation_renders_warning_tag', () => {
    render(
      <GroundedMarkdown
        content="This ungrounded hypothesis is unsupported [Citation Unverified]."
      />
    );

    const warningBadge = screen.getByTestId('unverified-citation-badge');
    expect(warningBadge).toBeInTheDocument();
    expect(warningBadge).toHaveTextContent('[Citation Unverified]');
    expect(warningBadge).toHaveAttribute('title', 'Citation not found in source notes');
  });

  it('test_citation_pill_hovercard_displays_payload_quote', async () => {
    render(<CitationChip markerId={1} citation={mockCitations[0]} />);

    const pill = screen.getByTestId('citation-pill');
    fireEvent.mouseEnter(pill);

    await waitFor(() => {
      const hovercard = screen.getByTestId('citation-hovercard');
      expect(hovercard).toBeInTheDocument();
      expect(screen.getByTestId('citation-source-title')).toHaveTextContent(
        'Mechanics_Lecture_01.pdf'
      );
      expect(screen.getByTestId('citation-page-number')).toHaveTextContent('Page 42');
      expect(screen.getByTestId('citation-quote')).toHaveTextContent(
        "Newton's second law states that the acceleration of an object"
      );
    });
  });

  it('test_citation_pill_click_dispatches_sync_event', () => {
    const syncListener = vi.fn();
    window.addEventListener('SELECT_CITATION', syncListener);

    render(<CitationChip markerId={1} citation={mockCitations[0]} />);

    const pill = screen.getByTestId('citation-pill');
    fireEvent.click(pill);

    // Assert WorkspaceStore focus target update
    const focusTarget = useWorkspaceStore.getState().activeFocusTarget;
    expect(focusTarget).not.toBeNull();
    expect(focusTarget?.sourceId).toBe('src-pdf-001');
    expect(focusTarget?.pageNumber).toBe(42);
    expect(focusTarget?.bboxes).toEqual([
      [0.12, 0.35, 0.88, 0.38],
      [0.12, 0.39, 0.65, 0.42],
    ]);

    // Assert inter-pane window event was emitted
    expect(syncListener).toHaveBeenCalledTimes(1);
    const eventDetail = syncListener.mock.calls[0][0].detail;
    expect(eventDetail.sourceId).toBe('src-pdf-001');
    expect(eventDetail.pageNumber).toBe(42);

    window.removeEventListener('SELECT_CITATION', syncListener);
  });
});
