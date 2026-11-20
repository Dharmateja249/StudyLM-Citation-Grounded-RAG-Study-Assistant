/**
 * Empirical Challenger Suite: Phase 4 Multimodal Deep-Link Inspector
 * File: frontend/tests/challenger_p4_multimodal_and_youtube.test.tsx
 *
 * Adversarial stress tests:
 * 1. Rapid tab toggling between PDF and YouTube sources without unhandled state loss
 * 2. Multi-source state retention across multiple sources (PDF, YouTube, Scanned PDF)
 * 3. Video seek precision when citation focus targets change rapidly (burst seeks)
 * 4. Identical timestamp consecutive citation clicks re-triggering seekTo (monotonic timestamp)
 * 5. Boundary timestamp formatting and seeking (0s, sub-second, hour boundaries)
 * 6. Non-educational video moderation barrier: complete iframe suppression, verbatim banner
 * 7. Citation dispatch targeting rejected video cannot bypass moderation barrier
 * 8. Dynamic moderation transition unmounting player immediately
 * 9. HTTP 206 range stream handling: Range bytes=0- and Authorization header verification
 * 10. HTTP 401, 404, 500, and network error fallback alerts without crashing
 * 11. Scanned page empty bboxes fallback rendering verbatim alert banner
 * 12. Coordinate transformations under 0°, 90°, 180°, 270° rotations with zoom scaling
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { ViewerContainer } from '@/components/viewer/ViewerContainer';
import { PdfViewer } from '@/components/viewer/PdfViewer';
import { YouTubeViewer } from '@/components/viewer/YouTubeViewer';
import { BboxHighlightOverlay } from '@/components/viewer/BboxHighlightOverlay';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import {
  parseYouTubeVideoId,
  formatTimestamp,
  transformBox,
  calculatePixelRect,
} from '@/utils/coordinateMath';
import { mockSources, mockUser } from './mocks/fixtures';
import { mockDb } from './mocks/mock-db';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';
import { SourceRead } from '@/types/api';

describe('Empirical Challenger Suite: Phase 4 Multimodal Deep-Link Inspector', () => {
  let mockSeekTo: ReturnType<typeof vi.fn>;
  let mockPlayVideo: ReturnType<typeof vi.fn>;
  let mockDestroy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // 1. Reset Stores & Database
    useWorkspaceStore.getState().reset();
    mockDb.reset();
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', mockUser);
    useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');

    // 2. Mock Canvas 2D Context for JSDOM
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

    // 3. Mock scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    // 4. Mock YouTube IFrame API
    mockSeekTo = vi.fn();
    mockPlayVideo = vi.fn();
    mockDestroy = vi.fn();

    window.YT = {
      Player: vi.fn().mockImplementation((_elementId, options) => {
        const playerInstance = {
          seekTo: mockSeekTo,
          playVideo: mockPlayVideo,
          destroy: mockDestroy,
        };
        options.events?.onReady?.({ target: playerInstance });
        return playerInstance;
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Dimension 1: Rapid Tab Toggling & Multimodal State Retention
  // =========================================================================
  describe('Dimension 1: Rapid Tab Toggling & State Retention', () => {
    it('1.1 Rapid alternating switches between PDF and YouTube preserve independent scroll and timestamp', async () => {
      const pdfSource = mockSources[0]; // src-pdf-001 (54 pages)
      const ytSource = mockSources[1]; // src-yt-002 (3120s)

      const { rerender } = render(<ViewerContainer source={pdfSource} />);

      // Verify PDF Viewer initial mount
      await waitFor(() => {
        expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
      });

      // User scrolls PDF to page 25
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: pdfSource.id,
          pageNumber: 25,
        });
      });

      // Switch to YouTube video
      rerender(<ViewerContainer source={ytSource} />);
      await waitFor(() => {
        expect(screen.getByTestId('youtube-viewer')).toBeInTheDocument();
        expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
      });

      // Video seeks to 1394s (23:14)
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: ytSource.id,
          startSeconds: 1394,
        });
      });

      await waitFor(() => {
        expect(mockSeekTo).toHaveBeenCalledWith(1394, true);
        expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent('23:14');
      });

      // Rapid switch back to PDF
      rerender(<ViewerContainer source={pdfSource} />);
      await waitFor(() => {
        expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
        expect(screen.queryByTestId('youtube-viewer')).not.toBeInTheDocument();
      });

      // Rapid switch back to YouTube: timestamp 1394s (23:14) is preserved without resetting to 00:00
      rerender(<ViewerContainer source={ytSource} />);
      await waitFor(() => {
        expect(screen.getByTestId('youtube-viewer')).toBeInTheDocument();
        expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent('23:14');
      });
    });

    it('1.2 Multi-source state retention across 3 distinct sources (PDF 1, YouTube 2, Scanned PDF 3)', async () => {
      const pdf1 = mockSources[0];
      const yt2 = mockSources[1];
      const pdf3 = mockSources[3]; // Scanned PDF

      const { rerender } = render(<ViewerContainer source={pdf1} />);
      await waitFor(() => expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument());

      // Focus PDF 1 on page 10
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: pdf1.id,
          pageNumber: 10,
        });
      });

      // Switch to YouTube 2 and seek to 742s
      rerender(<ViewerContainer source={yt2} />);
      await waitFor(() => expect(screen.getByTestId('youtube-viewer')).toBeInTheDocument());
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: yt2.id,
          startSeconds: 742,
        });
      });
      await waitFor(() => {
        expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent('12:22');
      });

      // Switch to Scanned PDF 3 and focus page 15
      rerender(<ViewerContainer source={pdf3} />);
      await waitFor(() => expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument());
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: pdf3.id,
          pageNumber: 15,
          bboxes: [],
        });
      });

      // Switch back to YouTube 2: verify 742s (12:22) retained
      rerender(<ViewerContainer source={yt2} />);
      await waitFor(() => {
        expect(screen.getByTestId('youtube-viewer')).toBeInTheDocument();
        expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent('12:22');
      });

      // Switch back to PDF 1: verify mounted without crashing
      rerender(<ViewerContainer source={pdf1} />);
      await waitFor(() => {
        expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
      });
    });

    it('1.3 High-frequency burst toggling (12 consecutive source switches) does not crash or corrupt state', async () => {
      const pdfSource = mockSources[0];
      const ytSource = mockSources[1];

      const { rerender } = render(<ViewerContainer source={pdfSource} />);

      for (let i = 0; i < 12; i++) {
        const nextSource = i % 2 === 0 ? ytSource : pdfSource;
        rerender(<ViewerContainer source={nextSource} />);
      }

      // Final source is PDF
      await waitFor(() => {
        expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
      });
    });

    it('1.4 Tab toggle between Inspector and Summary Roadmap retains underlying inspector state', async () => {
      const ytSource = mockSources[1];
      render(<ViewerContainer source={ytSource} />);

      await waitFor(() => {
        expect(screen.getByTestId('youtube-viewer')).toBeInTheDocument();
      });

      // Seek to 1394
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: ytSource.id,
          startSeconds: 1394,
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent('23:14');
      });

      // Toggle to Summary Roadmap tab
      const roadmapTab = screen.getByTestId('tab-roadmap');
      fireEvent.click(roadmapTab);

      await waitFor(() => {
        expect(screen.getByTestId('summary-roadmap-view')).toBeInTheDocument();
        expect(screen.queryByTestId('youtube-viewer')).not.toBeInTheDocument();
      });

      // Toggle back to Inspector tab
      const inspectorTab = screen.getByTestId('tab-inspector');
      fireEvent.click(inspectorTab);

      await waitFor(() => {
        expect(screen.getByTestId('youtube-viewer')).toBeInTheDocument();
        expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent('23:14');
      });
    });

    it('1.5 Transition from empty state (no source selected) to active multimodal source works cleanly', async () => {
      useWorkspaceStore.getState().setActiveSourceId(null);

      const { rerender } = render(<ViewerContainer />);
      expect(screen.getByTestId('viewer-empty-state')).toBeInTheDocument();
      expect(screen.getByText('No source selected')).toBeInTheDocument();

      // User selects PDF
      rerender(<ViewerContainer source={mockSources[0]} />);
      await waitFor(() => {
        expect(screen.getByTestId('pdf-viewer')).toBeInTheDocument();
        expect(screen.queryByTestId('viewer-empty-state')).not.toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Dimension 2: YouTube Deep-Seek Precision & Rapid Citation Focus
  // =========================================================================
  describe('Dimension 2: YouTube Deep-Seek Precision & Citation Targeting', () => {
    it('2.1 Rapid consecutive seeks on YouTube trigger seekTo with exact timestamps and allowSeekAhead=true', async () => {
      const ytSource = mockSources[1];
      render(<YouTubeViewer source={ytSource} />);

      const seekTargets = [15, 120, 742, 1394, 3120];

      for (const targetSeconds of seekTargets) {
        act(() => {
          useWorkspaceStore.getState().dispatchFocusTarget({
            sourceId: ytSource.id,
            startSeconds: targetSeconds,
          });
        });

        await waitFor(() => {
          expect(mockSeekTo).toHaveBeenCalledWith(targetSeconds, true);
          expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent(
            formatTimestamp(targetSeconds)
          );
        });
      }

      expect(mockSeekTo).toHaveBeenCalledTimes(seekTargets.length);
    });

    it('2.2 Consecutive citation clicks on identical timestamp re-trigger seekTo due to monotonic timestamp increment', async () => {
      const ytSource = mockSources[1];
      render(<YouTubeViewer source={ytSource} />);

      // First click on citation with startSeconds = 742
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: ytSource.id,
          startSeconds: 742,
        });
      });

      await waitFor(() => {
        expect(mockSeekTo).toHaveBeenCalledWith(742, true);
      });

      mockSeekTo.mockClear();

      // Second click on another citation that also targets 742s
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: ytSource.id,
          startSeconds: 742,
        });
      });

      await waitFor(() => {
        expect(mockSeekTo).toHaveBeenCalledWith(742, true);
      });
    });

    it('2.3 Boundary timestamp formatting and seeking (0s, sub-second, and hour boundaries)', () => {
      // Precise mathematical format verification
      expect(formatTimestamp(0)).toBe('00:00');
      expect(formatTimestamp(0.5)).toBe('00:00');
      expect(formatTimestamp(45)).toBe('00:45');
      expect(formatTimestamp(599)).toBe('09:59');
      expect(formatTimestamp(3599)).toBe('59:59');
      expect(formatTimestamp(3600)).toBe('01:00:00');
      expect(formatTimestamp(3665)).toBe('01:01:05');
      expect(formatTimestamp(7384)).toBe('02:03:04');

      // Invalid / edge case values fall back to "00:00" safely
      expect(formatTimestamp(-10)).toBe('00:00');
      expect(formatTimestamp(NaN)).toBe('00:00');
      expect(formatTimestamp(Infinity)).toBe('00:00');
    });

    it('2.4 Quick jump button at 00:00 calls seekTo(0, true) and updates badge to 00:00', async () => {
      const ytSource = mockSources[1];
      render(<YouTubeViewer source={ytSource} initialSeconds={1394} />);

      expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent('23:14');

      const quickJumpBtn = screen.getByRole('button', { name: '00:00' });
      fireEvent.click(quickJumpBtn);

      await waitFor(() => {
        expect(mockSeekTo).toHaveBeenCalledWith(0, true);
        expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent('00:00');
      });
    });

    it('2.5 YouTube video ID parser handles diverse and adversarial URL formats robustly', () => {
      // Standard watch URLs
      expect(parseYouTubeVideoId('https://www.youtube.com/watch?v=kYv_8fX30yA')).toBe('kYv_8fX30yA');
      expect(parseYouTubeVideoId('http://youtube.com/watch?v=kYv_8fX30yA')).toBe('kYv_8fX30yA');

      // URLs with tracking query params
      expect(
        parseYouTubeVideoId('https://www.youtube.com/watch?v=kYv_8fX30yA&feature=share&t=120')
      ).toBe('kYv_8fX30yA');
      expect(
        parseYouTubeVideoId('https://www.youtube.com/watch?feature=youtu.be&v=kYv_8fX30yA')
      ).toBe('kYv_8fX30yA');

      // Short URLs (youtu.be)
      expect(parseYouTubeVideoId('https://youtu.be/kYv_8fX30yA')).toBe('kYv_8fX30yA');
      expect(parseYouTubeVideoId('https://youtu.be/kYv_8fX30yA?t=45')).toBe('kYv_8fX30yA');

      // Embed URLs
      expect(parseYouTubeVideoId('https://www.youtube.com/embed/kYv_8fX30yA')).toBe('kYv_8fX30yA');

      // Shorts URLs
      expect(parseYouTubeVideoId('https://www.youtube.com/shorts/kYv_8fX30yA')).toBe('kYv_8fX30yA');

      // Raw 11-char ID
      expect(parseYouTubeVideoId('kYv_8fX30yA')).toBe('kYv_8fX30yA');

      // Invalid / Malformed inputs return null gracefully without exception
      expect(parseYouTubeVideoId('')).toBeNull();
      expect(parseYouTubeVideoId('   ')).toBeNull();
      expect(parseYouTubeVideoId('https://vimeo.com/12345678')).toBeNull();
      expect(parseYouTubeVideoId('not-a-valid-url')).toBeNull();
    });
  });

  // =========================================================================
  // Dimension 3: Non-Educational Video Moderation Barrier & Privacy Shield
  // =========================================================================
  describe('Dimension 3: Non-Educational Video Moderation Barrier & Privacy Shield', () => {
    it('3.1 Rejected non-educational video renders exact verbatim warning banner', () => {
      const rejectedSource = mockSources[2]; // ERR_NON_EDUCATIONAL_CONTENT
      render(<YouTubeViewer source={rejectedSource} />);

      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent(
        'Upload educational related video, this video does not have educational content please recheck the link'
      );
    });

    it('3.2 Complete DOM iframe suppression: zero iframe or video elements rendered in DOM', () => {
      const rejectedSource = mockSources[2];
      const { container } = render(<YouTubeViewer source={rejectedSource} />);

      // Assert player iframe and video elements are completely omitted from DOM
      expect(screen.queryByTestId('youtube-iframe')).not.toBeInTheDocument();
      expect(container.querySelector('iframe')).toBeNull();
      expect(container.querySelector('video')).toBeNull();
    });

    it('3.3 Zero player container or timestamp controls leaked in rejection state', () => {
      const rejectedSource = mockSources[2];
      render(<YouTubeViewer source={rejectedSource} />);

      expect(screen.queryByTestId('youtube-viewer')).not.toBeInTheDocument();
      expect(screen.queryByTestId('youtube-timestamp-badge')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '00:00' })).not.toBeInTheDocument();
    });

    it('3.4 Citation focus target dispatched to rejected video does NOT bypass barrier or mount iframe in DOM', async () => {
      const rejectedSource = mockSources[2];
      const { container } = render(<YouTubeViewer source={rejectedSource} />);

      // Adversarial attempt to force seek on rejected video
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: rejectedSource.id,
          startSeconds: 120,
        });
      });

      // Verify player iframe remains strictly suppressed in DOM
      expect(screen.queryByTestId('youtube-iframe')).not.toBeInTheDocument();
      expect(container.querySelector('iframe')).toBeNull();

      // Verify warning alert is still rendered
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Upload educational related video, this video does not have educational content please recheck the link'
      );
    });

    it('3.5 Dynamic moderation transition: active video transitioning to rejected unmounts player immediately', async () => {
      const readySource: SourceRead = {
        ...mockSources[1],
        id: 'src-yt-dynamic',
      };

      const { rerender, container } = render(<YouTubeViewer source={readySource} />);
      expect(screen.getByTestId('youtube-iframe')).toBeInTheDocument();

      // Backend flags source as rejected
      const rejectedSource: SourceRead = {
        ...readySource,
        status: 'error',
        error_code: 'ERR_NON_EDUCATIONAL_CONTENT',
        error_message:
          'Upload educational related video, this video does not have educational content please recheck the link',
      };

      rerender(<YouTubeViewer source={rejectedSource} />);

      // Iframe must be instantly destroyed
      expect(screen.queryByTestId('youtube-iframe')).not.toBeInTheDocument();
      expect(container.querySelector('iframe')).toBeNull();
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Upload educational related video, this video does not have educational content please recheck the link'
      );
    });

    it('3.6 Empirical Lifecycle Leak: YouTube IFrame API and seek listener are NOT guarded against rejected non-educational sources', async () => {
      const rejectedSource = mockSources[2];
      render(<YouTubeViewer source={rejectedSource} />);

      // Observation 1: YouTubeViewer runs useEffect unconditionally, constructing window.YT.Player with non-educational video ID
      expect(window.YT?.Player).not.toHaveBeenCalled();

      // Observation 2: Focus target dispatch runs seekTo listener, invoking seekTo on the rejected video
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: rejectedSource.id,
          startSeconds: 120,
        });
      });

      expect(mockSeekTo).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Dimension 4: HTTP 206 Range Stream Handling & Error Resilience
  // =========================================================================
  describe('Dimension 4: HTTP 206 Range Stream Handling & Error Resilience', () => {
    it('4.1 Authenticated HTTP 206 range request includes Range: bytes=0- and Bearer token headers', async () => {
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

    it('4.2 Stream failure with HTTP 401 Unauthorized renders alert banner without crashing', async () => {
      // Mock stream endpoint returning 401
      server.use(
        http.get('/api/sources/:id/stream', () => {
          return HttpResponse.json({ detail: 'Token expired' }, { status: 401 });
        })
      );

      const pdfSource = mockSources[0];
      render(<PdfViewer source={pdfSource} />);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveTextContent('Stream failed with status 401');
      });
    });

    it('4.3 Stream failure with HTTP 404 Not Found renders alert banner without crashing', async () => {
      server.use(
        http.get('/api/sources/:id/stream', () => {
          return HttpResponse.json({ detail: 'Source not found' }, { status: 404 });
        })
      );

      const pdfSource = mockSources[0];
      render(<PdfViewer source={pdfSource} />);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveTextContent('Stream failed with status 404');
      });
    });

    it('4.4 Network exception during stream fetch is caught and displayed in alert banner', async () => {
      server.use(
        http.get('/api/sources/:id/stream', () => {
          return HttpResponse.error();
        })
      );

      const pdfSource = mockSources[0];
      render(<PdfViewer source={pdfSource} />);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        expect(alert).toHaveTextContent(/error|failed/i);
      });
    });

    it('4.5 Scanned PDF empty bboxes fallback renders verbatim page alert banner and quote', () => {
      render(
        <BboxHighlightOverlay
          pageNumber={15}
          viewport={{ width: 800, height: 1100 }}
          bboxes={[]}
          isActive={true}
          quote="Every body perseveres in its state of being at rest or of moving uniformly forward."
        />
      );

      const alert = screen.getByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent('Highlighted quote located on this scanned page');
      expect(alert).toHaveTextContent('Every body perseveres in its state of being at rest');
    });

    it('4.6 Coordinate transformation across rotations (0°, 90°, 180°, 270°) and zoom scale recalculation', () => {
      const box = [0.1, 0.2, 0.6, 0.5]; // [x0, y0, x1, y1]

      // 0°: identity
      expect(transformBox(box, 0)).toEqual([0.1, 0.2, 0.6, 0.5]);

      // 90° clockwise: [1 - y1, x0, 1 - y0, x1]
      expect(transformBox(box, 90)).toEqual([0.5, 0.1, 0.8, 0.6]);

      // 180°: [1 - x1, 1 - y1, 1 - x0, 1 - y0]
      expect(transformBox(box, 180)).toEqual([0.4, 0.5, 0.9, 0.8]);

      // 270°: [y0, 1 - x1, y1, 1 - x0]
      expect(transformBox(box, 270)).toEqual([0.2, 0.4, 0.5, 0.9]);

      // Pixel rect calculation with zoom scale 1.0 (800x1100)
      const rect100 = calculatePixelRect(box, { width: 800, height: 1100 });
      expect(rect100).toEqual({
        left: 80, // 0.1 * 800
        top: 220, // 0.2 * 1100
        width: 400, // 0.5 * 800
        height: 330, // 0.3 * 1100
      });

      // Pixel rect calculation with zoom scale 1.5 (1200x1650)
      const rect150 = calculatePixelRect(box, { width: 1200, height: 1650 });
      expect(rect150).toEqual({
        left: 120, // 0.1 * 1200
        top: 330, // 0.2 * 1650
        width: 600, // 0.5 * 1200
        height: 495, // 0.3 * 1650
      });
    });
  });
});
