/**
 * Empirical Challenger Suite: Phase 4 Multimodal Deep-Link Inspector
 * File: frontend/tests/challenger_p4_coordinate_and_overlay.test.tsx
 *
 * Adversarial stress tests:
 * 1. Rotation geometry across all 4 angles (0°, 90°, 180°, 270°) + cyclic group symmetry.
 * 2. Extreme boundary coordinates: top-left [0,0,0.1,0.1], bottom-right [0.9,0.9,1,1], full page [0,0,1,1].
 * 3. Zero-size point boxes [0,0,0,0], [0.5,0.5,0.5,0.5], [1,1,1,1] and hairline slivers.
 * 4. IEEE 754 floating-point precision stabilization (avoiding 0.30000000000000004 artifacts).
 * 5. Multi-line sentence wrapping (2, 3, 4 lines) across 0° and 90° rotations.
 * 6. Scanned page banner 8-case truth table: empty [] vs null vs undefined vs populated, active vs inactive.
 * 7. YouTube timestamp formatting oracle & adversarial video ID parser matrix.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  transformBox,
  transformBboxes,
  calculatePixelRect,
  calculatePixelRects,
  normalizeBox,
  normalizeBboxes,
  isValidBox,
  normalizeRotation,
  formatTimestamp,
  parseYouTubeVideoId,
} from '@/utils/coordinateMath';
import { BboxHighlightOverlay } from '@/components/viewer/BboxHighlightOverlay';

describe('Empirical Challenger Suite: Phase 4 Coordinate Math & Bbox Overlay', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Dimension 1: Rotation Geometry & Extreme Boundary Coordinates
  // =========================================================================
  describe('Dimension 1: Rotation Geometry & Extreme Boundary Coordinates', () => {
    const boxTopLeft = [0.0, 0.0, 0.1, 0.1];
    const boxBottomRight = [0.9, 0.9, 1.0, 1.0];
    const boxFullPage = [0.0, 0.0, 1.0, 1.0];

    it('test_rotation_0_extreme_corners', () => {
      expect(transformBox(boxTopLeft, 0)).toEqual([0.0, 0.0, 0.1, 0.1]);
      expect(transformBox(boxBottomRight, 0)).toEqual([0.9, 0.9, 1.0, 1.0]);
      expect(transformBox(boxFullPage, 0)).toEqual([0.0, 0.0, 1.0, 1.0]);
    });

    it('test_rotation_90_extreme_corners', () => {
      // 90 deg clockwise: [1 - y1, x0, 1 - y0, x1]
      // Top-left: [1 - 0.1, 0, 1 - 0, 0.1] = [0.9, 0.0, 1.0, 0.1] (moves to top-right)
      expect(transformBox(boxTopLeft, 90)).toEqual([0.9, 0.0, 1.0, 0.1]);
      // Bottom-right: [1 - 1, 0.9, 1 - 0.9, 1] = [0.0, 0.9, 0.1, 1.0] (moves to bottom-left)
      expect(transformBox(boxBottomRight, 90)).toEqual([0.0, 0.9, 0.1, 1.0]);
      // Full page: [1 - 1, 0, 1 - 0, 1] = [0, 0, 1, 1]
      expect(transformBox(boxFullPage, 90)).toEqual([0.0, 0.0, 1.0, 1.0]);
    });

    it('test_rotation_180_extreme_corners', () => {
      // 180 deg: [1 - x1, 1 - y1, 1 - x0, 1 - y0]
      // Top-left: [1 - 0.1, 1 - 0.1, 1 - 0, 1 - 0] = [0.9, 0.9, 1.0, 1.0] (moves to bottom-right)
      expect(transformBox(boxTopLeft, 180)).toEqual([0.9, 0.9, 1.0, 1.0]);
      // Bottom-right: [1 - 1, 1 - 1, 1 - 0.9, 1 - 0.9] = [0.0, 0.0, 0.1, 0.1] (moves to top-left)
      expect(transformBox(boxBottomRight, 180)).toEqual([0.0, 0.0, 0.1, 0.1]);
      // Full page: [0, 0, 1, 1]
      expect(transformBox(boxFullPage, 180)).toEqual([0.0, 0.0, 1.0, 1.0]);
    });

    it('test_rotation_270_extreme_corners', () => {
      // 270 deg: [y0, 1 - x1, y1, 1 - x0]
      // Top-left: [0, 1 - 0.1, 0.1, 1 - 0] = [0.0, 0.9, 0.1, 1.0] (moves to bottom-left)
      expect(transformBox(boxTopLeft, 270)).toEqual([0.0, 0.9, 0.1, 1.0]);
      // Bottom-right: [0.9, 1 - 1, 1, 1 - 0.9] = [0.9, 0.0, 1.0, 0.1] (moves to top-right)
      expect(transformBox(boxBottomRight, 270)).toEqual([0.9, 0.0, 1.0, 0.1]);
      // Full page: [0, 0, 1, 1]
      expect(transformBox(boxFullPage, 270)).toEqual([0.0, 0.0, 1.0, 1.0]);
    });

    it('test_zero_size_boxes_across_all_rotations', () => {
      const centerPoint = [0.5, 0.5, 0.5, 0.5];
      expect(transformBox(centerPoint, 0)).toEqual([0.5, 0.5, 0.5, 0.5]);
      expect(transformBox(centerPoint, 90)).toEqual([0.5, 0.5, 0.5, 0.5]);
      expect(transformBox(centerPoint, 180)).toEqual([0.5, 0.5, 0.5, 0.5]);
      expect(transformBox(centerPoint, 270)).toEqual([0.5, 0.5, 0.5, 0.5]);

      const originPoint = [0.0, 0.0, 0.0, 0.0];
      expect(transformBox(originPoint, 0)).toEqual([0.0, 0.0, 0.0, 0.0]);
      expect(transformBox(originPoint, 90)).toEqual([1.0, 0.0, 1.0, 0.0]);
      expect(transformBox(originPoint, 180)).toEqual([1.0, 1.0, 1.0, 1.0]);
      expect(transformBox(originPoint, 270)).toEqual([0.0, 1.0, 0.0, 1.0]);

      // Pixel rect calculation on zero-size box produces width=0, height=0
      const viewport = { width: 1000, height: 1000 };
      const pixelOrigin = calculatePixelRect(transformBox(originPoint, 90), viewport);
      expect(pixelOrigin).toEqual({ left: 1000, top: 0, width: 0, height: 0 });
    });

    it('test_hairline_slivers_and_aspect_inversion', () => {
      // Horizontal hairline across center
      const horizontalHairline = [0.0, 0.5, 1.0, 0.501];
      const viewport = { width: 1000, height: 2000 };

      // At 0 deg: width = 1000px, height = 2px
      const rect0 = calculatePixelRect(transformBox(horizontalHairline, 0), viewport);
      expect(rect0.width).toBe(1000);
      expect(rect0.height).toBe(2);

      // At 90 deg: transforms to vertical hairline:
      // [1 - 0.501, 0.0, 1 - 0.5, 1.0] = [0.499, 0.0, 0.5, 1.0]
      const transformed90 = transformBox(horizontalHairline, 90);
      expect(transformed90).toEqual([0.499, 0.0, 0.5, 1.0]);
      const rect90 = calculatePixelRect(transformed90, viewport);
      expect(rect90.left).toBe(499);
      expect(rect90.top).toBe(0);
      expect(rect90.width).toBe(1); // (0.5 - 0.499) * 1000 = 1px
      expect(rect90.height).toBe(2000); // 1.0 * 2000 = 2000px
    });

    it('test_four_fold_cyclic_group_symmetry', () => {
      const arbitraryBox = [0.123, 0.456, 0.789, 0.912];

      // 4 successive 90 deg rotations must return EXACTLY the original box
      let current = arbitraryBox;
      for (let i = 0; i < 4; i++) {
        current = transformBox(current, 90);
      }
      expect(current).toEqual(arbitraryBox);

      // Two 180 deg rotations return original box
      const double180 = transformBox(transformBox(arbitraryBox, 180), 180);
      expect(double180).toEqual(arbitraryBox);

      // 270 deg then 90 deg returns original box
      const cycle360 = transformBox(transformBox(arbitraryBox, 270), 90);
      expect(cycle360).toEqual(arbitraryBox);
    });

    it('test_arbitrary_modular_rotations', () => {
      const box = [0.2, 0.3, 0.8, 0.7];
      expect(transformBox(box, 360)).toEqual(transformBox(box, 0));
      expect(transformBox(box, 720)).toEqual(transformBox(box, 0));
      expect(transformBox(box, -360)).toEqual(transformBox(box, 0));
      expect(transformBox(box, -90)).toEqual(transformBox(box, 270));
      expect(transformBox(box, -180)).toEqual(transformBox(box, 180));
      expect(transformBox(box, -270)).toEqual(transformBox(box, 90));
      expect(transformBox(box, 450)).toEqual(transformBox(box, 90));
      expect(transformBox(box, 630)).toEqual(transformBox(box, 270));
    });
  });

  // =========================================================================
  // Dimension 2: Floating-Point Precision Stabilization
  // =========================================================================
  describe('Dimension 2: Floating-Point Precision Stabilization', () => {
    it('test_ieee754_subtraction_stabilization', () => {
      // Numbers known to produce IEEE 754 precision artifacts:
      // In raw JS:
      // 1 - 0.7 = 0.30000000000000004
      // 1 - 0.8 = 0.19999999999999996
      // 1 - 0.9 = 0.09999999999999998
      // 1 - 0.14 = 0.8600000000000001
      // 1 - 0.28 = 0.7200000000000001
      // 1 - 0.57 = 0.43000000000000005

      const boxWithArtifacts = [0.14, 0.28, 0.7, 0.8];

      // At 90 deg: [1 - y1, x0, 1 - y0, x1]
      // [1 - 0.8, 0.14, 1 - 0.28, 0.7] = [0.2, 0.14, 0.72, 0.7]
      const rot90 = transformBox(boxWithArtifacts, 90);
      expect(rot90[0]).toBe(0.2); // Not 0.19999999999999996
      expect(rot90[1]).toBe(0.14);
      expect(rot90[2]).toBe(0.72); // Not 0.7200000000000001
      expect(rot90[3]).toBe(0.7);

      // At 180 deg: [1 - x1, 1 - y1, 1 - x0, 1 - y0]
      // [1 - 0.7, 1 - 0.8, 1 - 0.14, 1 - 0.28] = [0.3, 0.2, 0.86, 0.72]
      const rot180 = transformBox(boxWithArtifacts, 180);
      expect(rot180[0]).toBe(0.3); // Not 0.30000000000000004
      expect(rot180[1]).toBe(0.2); // Not 0.19999999999999996
      expect(rot180[2]).toBe(0.86); // Not 0.8600000000000001
      expect(rot180[3]).toBe(0.72); // Not 0.7200000000000001

      // At 270 deg: [y0, 1 - x1, y1, 1 - x0]
      // [0.28, 1 - 0.7, 0.8, 1 - 0.14] = [0.28, 0.3, 0.8, 0.86]
      const rot270 = transformBox(boxWithArtifacts, 270);
      expect(rot270[0]).toBe(0.28);
      expect(rot270[1]).toBe(0.3); // Not 0.30000000000000004
      expect(rot270[2]).toBe(0.8);
      expect(rot270[3]).toBe(0.86); // Not 0.8600000000000001
    });

    it('test_viewport_pixel_scaling_with_irrational_viewports', () => {
      const box = [0.1, 0.2, 0.6, 0.7];
      const oddViewport = { width: 833.333333333, height: 1177.666666667 };
      const pixelRect = calculatePixelRect(box, oddViewport);

      expect(Number.isFinite(pixelRect.left)).toBe(true);
      expect(Number.isFinite(pixelRect.top)).toBe(true);
      expect(Number.isFinite(pixelRect.width)).toBe(true);
      expect(Number.isFinite(pixelRect.height)).toBe(true);
      expect(pixelRect.width).toBeGreaterThan(0);
      expect(pixelRect.height).toBeGreaterThan(0);
    });

    it('test_validation_and_box_normalization', () => {
      // Inverted box coordinates: [x1, y1, x0, y0]
      expect(normalizeBox([0.8, 0.9, 0.2, 0.1])).toEqual([0.2, 0.1, 0.8, 0.9]);

      // Out of bounds values clamped to [0.0, 1.0]
      expect(normalizeBox([-0.5, -0.2, 1.5, 2.0])).toEqual([0.0, 0.0, 1.0, 1.0]);

      // Invalid arrays fallback
      expect(normalizeBox([1, 2])).toEqual([0, 0, 0, 0]);
      expect(normalizeBox([NaN, 0, 1, 1])).toEqual([0, 0, 0, 0]);
      expect(normalizeBboxes('not an array' as any)).toEqual([]);
      expect(normalizeBboxes([ [0.1, 0.2, 0.3, 0.4], [1, 2] ])).toEqual([[0.1, 0.2, 0.3, 0.4]]);
    });
  });

  // =========================================================================
  // Dimension 3: Multi-Line Wrapping Bounding Box Overlay Rendering
  // =========================================================================
  describe('Dimension 3: Multi-Line Wrapping & Overlay Rendering', () => {
    const multiLineBboxes = [
      [0.35, 0.20, 0.95, 0.24], // Line 1: starts indented, ends at right margin
      [0.10, 0.25, 0.95, 0.29], // Line 2: full line width
      [0.10, 0.30, 0.95, 0.34], // Line 3: full line width
      [0.10, 0.35, 0.55, 0.39], // Line 4: partial ending line
    ];
    const viewport = { width: 1000, height: 1200 };

    it('test_multiline_sentence_renders_distinct_non_overlapping_rectangles', () => {
      const { container } = render(
        <BboxHighlightOverlay
          pageNumber={7}
          viewport={viewport}
          bboxes={multiLineBboxes}
          isActive={true}
          quote="Four lines of dense scholarly text spanning a complex paragraph."
        />
      );

      const highlights = container.querySelectorAll('.pdf-highlight');
      expect(highlights).toHaveLength(4);

      // Verify all 4 elements have distinct top positions (vertical stacking)
      const topPositions = Array.from(highlights).map((el) => (el as HTMLElement).style.top);
      expect(new Set(topPositions).size).toBe(4);

      // Verify Line 1 geometry: left = 350px (0.35 * 1000), width = 600px (0.6 * 1000), top = 240px (0.2 * 1200)
      const line1 = highlights[0] as HTMLElement;
      expect(line1.style.left).toBe('350px');
      expect(line1.style.top).toBe('240px');
      expect(line1.style.width).toBe('600px');
      expect(line1.style.height).toBe('48px'); // (0.24 - 0.20) * 1200 = 48px

      // Verify active styles: amber pulse animation & shadow
      expect(line1.className).toContain('border-amber-500');
      expect(line1.className).toContain('animate-pulse');
      expect(line1.className).toContain('shadow-[0_0_12px_rgba(251,191,36,0.6)]');
      expect(line1.style.backgroundColor).toBe('rgba(251, 191, 36, 0.35)');

      // Verify Line 4 geometry: left = 100px, width = 450px
      const line4 = highlights[3] as HTMLElement;
      expect(line4.style.left).toBe('100px');
      expect(line4.style.width).toBe('450px');
    });

    it('test_multiline_sentence_rotation_90_geometry', () => {
      const { container } = render(
        <BboxHighlightOverlay
          pageNumber={7}
          viewport={viewport}
          rotation={90}
          bboxes={multiLineBboxes}
          isActive={true}
        />
      );

      const highlights = container.querySelectorAll('.pdf-highlight');
      expect(highlights).toHaveLength(4);

      // In 90 deg rotation, lines rotate to vertical columns: distinct LEFT positions
      const leftPositions = Array.from(highlights).map((el) => (el as HTMLElement).style.left);
      expect(new Set(leftPositions).size).toBe(4);

      // Verify Line 1 rotated:
      // Original Line 1: [0.35, 0.20, 0.95, 0.24]
      // 90 deg: [1 - 0.24, 0.35, 1 - 0.20, 0.95] = [0.76, 0.35, 0.80, 0.95]
      // left = 760px, top = 420px, width = 40px, height = 720px
      const line1 = highlights[0] as HTMLElement;
      expect(line1.style.left).toBe('760px');
      expect(line1.style.top).toBe('420px');
      expect(line1.style.width).toBe('40px');
      expect(line1.style.height).toBe('720px');
    });

    it('test_inactive_multiline_highlights_render_without_pulse', () => {
      const { container } = render(
        <BboxHighlightOverlay
          pageNumber={7}
          viewport={viewport}
          bboxes={multiLineBboxes}
          isActive={false}
        />
      );

      const highlights = container.querySelectorAll('.pdf-highlight');
      expect(highlights).toHaveLength(4);

      const line1 = highlights[0] as HTMLElement;
      expect(line1.className).toContain('border-yellow-400/80');
      expect(line1.className).not.toContain('animate-pulse');
      expect(line1.style.backgroundColor).toBe('rgba(253, 224, 71, 0.25)');
    });
  });

  // =========================================================================
  // Dimension 4: Scanned Page Fallback Banner 8-Case Truth Table
  // =========================================================================
  describe('Dimension 4: Scanned Page Banner Triggers Matrix', () => {
    const viewport = { width: 800, height: 1100 };
    const populatedBboxes = [[0.1, 0.2, 0.8, 0.3]];

    // Case 1: isActive: true, bboxes: [] -> BANNER MUST RENDER
    it('Case 1: isActive=true with bboxes=[] renders banner with quote', () => {
      render(
        <BboxHighlightOverlay
          pageNumber={42}
          viewport={viewport}
          bboxes={[]}
          isActive={true}
          quote="Historical scan of Newton's Principia Mathematica"
        />
      );

      const banner = screen.getByRole('alert');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent('Highlighted quote located on this scanned page');
      expect(banner).toHaveTextContent('Historical scan of Newton\'s Principia Mathematica');
    });

    // Case 2: isActive: true, bboxes: null -> BANNER MUST RENDER
    it('Case 2: isActive=true with bboxes=null renders banner', () => {
      render(
        <BboxHighlightOverlay
          pageNumber={42}
          viewport={viewport}
          bboxes={null as any}
          isActive={true}
          quote="OCR unavailable for this manuscript"
        />
      );

      const banner = screen.getByRole('alert');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent('Highlighted quote located on this scanned page');
    });

    // Case 3: isActive: true, bboxes: undefined -> BANNER MUST RENDER
    it('Case 3: isActive=true with bboxes=undefined renders banner', () => {
      render(
        <BboxHighlightOverlay
          pageNumber={42}
          viewport={viewport}
          bboxes={undefined}
          isActive={true}
        />
      );

      const banner = screen.getByRole('alert');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent('Highlighted quote located on this scanned page');
    });

    // Case 4: isActive: true, bboxes populated -> BANNER MUST NOT RENDER (highlights render)
    it('Case 4: isActive=true with populated bboxes suppresses banner and renders highlight', () => {
      const { container } = render(
        <BboxHighlightOverlay
          pageNumber={42}
          viewport={viewport}
          bboxes={populatedBboxes}
          isActive={true}
          quote="Populated quote text"
        />
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      const highlights = container.querySelectorAll('.pdf-highlight');
      expect(highlights).toHaveLength(1);
    });

    // Case 5: isActive: false, bboxes: [] -> BANNER MUST NOT RENDER
    it('Case 5: isActive=false with bboxes=[] does NOT render banner', () => {
      render(
        <BboxHighlightOverlay
          pageNumber={42}
          viewport={viewport}
          bboxes={[]}
          isActive={false}
        />
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    // Case 6: isActive: false, bboxes: null -> BANNER MUST NOT RENDER
    it('Case 6: isActive=false with bboxes=null does NOT render banner', () => {
      render(
        <BboxHighlightOverlay
          pageNumber={42}
          viewport={viewport}
          bboxes={null as any}
          isActive={false}
        />
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    // Case 7: isActive: false, bboxes: undefined -> BANNER MUST NOT RENDER
    it('Case 7: isActive=false with bboxes=undefined does NOT render banner', () => {
      render(
        <BboxHighlightOverlay
          pageNumber={42}
          viewport={viewport}
          bboxes={undefined}
          isActive={false}
        />
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    // Case 8: isActive: false, bboxes populated -> BANNER MUST NOT RENDER (inactive highlights render)
    it('Case 8: isActive=false with populated bboxes does NOT render banner', () => {
      const { container } = render(
        <BboxHighlightOverlay
          pageNumber={42}
          viewport={viewport}
          bboxes={populatedBboxes}
          isActive={false}
        />
      );

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      const highlights = container.querySelectorAll('.pdf-highlight');
      expect(highlights).toHaveLength(1);
    });
  });

  // =========================================================================
  // Dimension 5: YouTube Timestamps & Video ID URL Parsing Stress
  // =========================================================================
  describe('Dimension 5: YouTube Timestamp & URL Parser Robustness', () => {
    it('test_timestamp_formatting_oracle', () => {
      expect(formatTimestamp(0)).toBe('00:00');
      expect(formatTimestamp(9)).toBe('00:09');
      expect(formatTimestamp(59)).toBe('00:59');
      expect(formatTimestamp(60)).toBe('01:00');
      expect(formatTimestamp(75)).toBe('01:15');
      expect(formatTimestamp(1394)).toBe('23:14'); // 23 min, 14 sec
      expect(formatTimestamp(3599)).toBe('59:59');
      expect(formatTimestamp(3600)).toBe('01:00:00');
      expect(formatTimestamp(3665)).toBe('01:01:05');
      expect(formatTimestamp(86399)).toBe('23:59:59');
      expect(formatTimestamp(86400)).toBe('24:00:00');

      // Floating-point seconds truncated cleanly
      expect(formatTimestamp(1394.85)).toBe('23:14');

      // Negative or invalid seconds fallback
      expect(formatTimestamp(-10)).toBe('00:00');
      expect(formatTimestamp(NaN)).toBe('00:00');
      expect(formatTimestamp(Infinity)).toBe('00:00');
    });

    it('test_youtube_video_id_parser_adversarial_matrix', () => {
      const canonicalId = 'dQw4w9WgXcQ';

      // 1. Raw 11-char ID
      expect(parseYouTubeVideoId(canonicalId)).toBe(canonicalId);
      expect(parseYouTubeVideoId('  dQw4w9WgXcQ  ')).toBe(canonicalId);

      // 2. Standard watch URL
      expect(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${canonicalId}`)).toBe(canonicalId);
      expect(parseYouTubeVideoId(`http://www.youtube.com/watch?v=${canonicalId}`)).toBe(canonicalId);
      expect(parseYouTubeVideoId(`www.youtube.com/watch?v=${canonicalId}`)).toBe(canonicalId);

      // 3. Watch URL with additional parameters in various orders
      expect(
        parseYouTubeVideoId(`https://www.youtube.com/watch?feature=share&v=${canonicalId}&t=120s`)
      ).toBe(canonicalId);
      expect(
        parseYouTubeVideoId(`https://www.youtube.com/watch?t=50&v=${canonicalId}`)
      ).toBe(canonicalId);

      // 4. Short URLs (youtu.be)
      expect(parseYouTubeVideoId(`https://youtu.be/${canonicalId}`)).toBe(canonicalId);
      expect(parseYouTubeVideoId(`https://youtu.be/${canonicalId}?t=30s`)).toBe(canonicalId);

      // 5. Embed URLs
      expect(parseYouTubeVideoId(`https://www.youtube.com/embed/${canonicalId}`)).toBe(canonicalId);

      // 6. Shorts URLs
      expect(parseYouTubeVideoId(`https://www.youtube.com/shorts/${canonicalId}`)).toBe(canonicalId);

      // 7. Invalid inputs return null
      expect(parseYouTubeVideoId('')).toBeNull();
      expect(parseYouTubeVideoId('not-a-youtube-url')).toBeNull();
      expect(parseYouTubeVideoId('https://vimeo.com/123456789')).toBeNull();
      expect(parseYouTubeVideoId(null as any)).toBeNull();
      expect(parseYouTubeVideoId(undefined as any)).toBeNull();
    });
  });
});
