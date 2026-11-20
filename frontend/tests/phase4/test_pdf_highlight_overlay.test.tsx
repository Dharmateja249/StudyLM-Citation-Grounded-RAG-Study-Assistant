import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { BboxHighlightOverlay } from '@/components/viewer/BboxHighlightOverlay';
import { PdfViewer } from '@/components/viewer/PdfViewer';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { mockSources } from '../mocks/fixtures';

describe('Phase 4: PDF Bbox Highlight Layer & Page Stack', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', {
      id: 'usr-default-001',
      email: 'student@university.edu',
      name: 'Alex Student',
      is_active: true,
      created_at: '2026-09-01T08:00:00Z',
    });

    // Mock HTMLCanvasElement 2D context
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
    });

    // Mock scrollIntoView in JSDOM
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('test_multiline_sentence_renders_multiple_highlight_rectangles', () => {
    const multiLineBboxes = [
      [0.1, 0.2, 0.9, 0.25],
      [0.1, 0.26, 0.9, 0.31],
      [0.1, 0.32, 0.6, 0.37],
    ];

    const { container } = render(
      <BboxHighlightOverlay
        pageNumber={1}
        viewport={{ width: 800, height: 1100 }}
        bboxes={multiLineBboxes}
        isActive={true}
      />
    );

    const highlights = container.querySelectorAll('.pdf-highlight');
    expect(highlights).toHaveLength(3);

    // Verify first highlight offset
    const firstHighlight = highlights[0] as HTMLElement;
    expect(firstHighlight.style.left).toBe('80px'); // 0.1 * 800
    expect(firstHighlight.style.top).toBe('220px'); // 0.2 * 1100
    expect(firstHighlight.style.width).toBe('640px'); // 0.8 * 800
  });

  it('test_scanned_page_empty_bboxes_renders_page_banner', () => {
    render(
      <BboxHighlightOverlay
        pageNumber={15}
        viewport={{ width: 800, height: 1100 }}
        bboxes={[]}
        isActive={true}
        quote="Every body perseveres in its state of being at rest"
      />
    );

    const banner = screen.getByRole('alert');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('Highlighted quote located on this scanned page');
    expect(banner).toHaveTextContent('Every body perseveres in its state of being at rest');
  });

  it('test_active_citation_scrolls_target_page_into_view', async () => {
    const pdfSource = mockSources[0]; // Mechanics_Lecture_01.pdf
    const { container } = render(<PdfViewer source={pdfSource} />);

    // Page 15 exists in page stack
    const page15 = container.querySelector('#pdf-page-15');
    expect(page15).toBeInTheDocument();

    // Dispatch citation event targeting page 15
    act(() => {
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: pdfSource.id,
        pageNumber: 15,
        bboxes: [[0.1, 0.3, 0.8, 0.35]],
      });
    });

    await waitFor(() => {
      expect(page15?.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: 'smooth', block: 'center' })
      );
    });
  });

  it('test_authenticated_range_stream_headers', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    const pdfSource = mockSources[0];

    render(<PdfViewer source={pdfSource} />);

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/sources/${pdfSource.id}/stream`),
        expect.objectContaining({
          headers: expect.objectContaining({
            Range: 'bytes=0-',
            Authorization: 'Bearer valid-jwt-token-alex-student',
          }),
        })
      );
    });
  });
});
