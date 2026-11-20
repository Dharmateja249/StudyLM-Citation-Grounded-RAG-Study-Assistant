import { describe, it, expect } from 'vitest';
import {
  transformBox,
  calculatePixelRect,
  normalizeBox,
  isValidBox,
  formatTimestamp,
  parseYouTubeVideoId,
} from '@/utils/coordinateMath';

describe('PDF.js Coordinate Transformation Engine', () => {
  const box = [0.1, 0.2, 0.6, 0.5]; // [x0, y0, x1, y1]

  it('test_transform_box_zero_rotation', () => {
    expect(transformBox(box, 0)).toEqual([0.1, 0.2, 0.6, 0.5]);
  });

  it('test_transform_box_90_degree_rotation', () => {
    // 90 deg clockwise: [1 - y1, x0, 1 - y0, x1]
    // 1 - 0.5 = 0.5; x0 = 0.1; 1 - 0.2 = 0.8; x1 = 0.6
    expect(transformBox(box, 90)).toEqual([0.5, 0.1, 0.8, 0.6]);
  });

  it('test_transform_box_180_degree_rotation', () => {
    // 180 deg: [1 - x1, 1 - y1, 1 - x0, 1 - y0]
    // 1 - 0.6 = 0.4; 1 - 0.5 = 0.5; 1 - 0.1 = 0.9; 1 - 0.2 = 0.8
    expect(transformBox(box, 180)).toEqual([0.4, 0.5, 0.9, 0.8]);
  });

  it('test_transform_box_270_degree_rotation', () => {
    // 270 deg: [y0, 1 - x1, y1, 1 - x0]
    // y0 = 0.2; 1 - 0.6 = 0.4; y1 = 0.5; 1 - 0.1 = 0.9
    expect(transformBox(box, 270)).toEqual([0.2, 0.4, 0.5, 0.9]);
  });

  it('test_percentage_to_pixel_viewport_mapping', () => {
    const viewport = { width: 1000, height: 2000 };
    const pixelRect = calculatePixelRect(box, viewport);
    expect(pixelRect).toEqual({
      left: 100, // 0.1 * 1000
      top: 400, // 0.2 * 2000
      width: 500, // (0.6 - 0.1) * 1000
      height: 600, // (0.5 - 0.2) * 2000
    });
  });

  it('test_arbitrary_rotation_normalization', () => {
    expect(transformBox(box, 360)).toEqual([0.1, 0.2, 0.6, 0.5]);
    expect(transformBox(box, -90)).toEqual([0.2, 0.4, 0.5, 0.9]); // -90 == 270
    expect(transformBox(box, 450)).toEqual([0.5, 0.1, 0.8, 0.6]); // 450 == 90
  });

  it('test_box_validation_and_clamping', () => {
    expect(isValidBox([0, 0, 1, 1])).toBe(true);
    expect(isValidBox([0, 1])).toBe(false);
    expect(isValidBox(['0', '1', '2', '3'])).toBe(false);

    // Clamps inverted or out of bound values
    expect(normalizeBox([-0.2, 1.2, 0.8, 0.4])).toEqual([0, 0.4, 0.8, 1]);
  });
});
