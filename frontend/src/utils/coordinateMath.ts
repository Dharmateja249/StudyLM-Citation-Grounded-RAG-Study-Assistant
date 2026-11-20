/**
 * Coordinate Transformation & Geometric Translation Engine
 * File: frontend/src/utils/coordinateMath.ts
 */

export interface PixelRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ViewportDimensions {
  width: number;
  height: number;
}

/**
 * Normalizes floating-point precision to avoid IEEE 754 precision artifacts.
 */
function cleanFloat(value: number): number {
  return Number(value.toFixed(10));
}

/**
 * Normalizes rotation to 0, 90, 180, or 270 degrees.
 */
export function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return normalized as 0 | 90 | 180 | 270;
}

/**
 * Validates whether an array represents a valid 4-element bounding box [x0, y0, x1, y1].
 */
export function isValidBox(box: unknown): box is number[] {
  if (!Array.isArray(box) || box.length !== 4) return false;
  return box.every((val) => typeof val === 'number' && Number.isFinite(val));
}

/**
 * Clamps coordinates to [0.0, 1.0] and ensures x0 <= x1 and y0 <= y1.
 */
export function normalizeBox(box: number[]): number[] {
  if (!isValidBox(box)) return [0, 0, 0, 0];
  const [rawX0, rawY0, rawX1, rawY1] = box;
  const x0 = Math.max(0, Math.min(1, Math.min(rawX0, rawX1)));
  const y0 = Math.max(0, Math.min(1, Math.min(rawY0, rawY1)));
  const x1 = Math.max(0, Math.min(1, Math.max(rawX0, rawX1)));
  const y1 = Math.max(0, Math.min(1, Math.max(rawY0, rawY1)));
  return [cleanFloat(x0), cleanFloat(y0), cleanFloat(x1), cleanFloat(y1)];
}

/**
 * Normalizes a list of multi-line bounding boxes.
 */
export function normalizeBboxes(bboxes?: unknown): number[][] {
  if (!Array.isArray(bboxes)) return [];
  return bboxes.filter(isValidBox).map(normalizeBox);
}

/**
 * Transforms a normalized bounding box [x0, y0, x1, y1] across page rotation.
 * 
 * Exact Transformation Matrices:
 *   0°:   [x0, y0, x1, y1]
 *   90°:  [1 - y1, x0, 1 - y0, x1]
 *   180°: [1 - x1, 1 - y1, 1 - x0, 1 - y0]
 *   270°: [y0, 1 - x1, y1, 1 - x0]
 */
export function transformBox(box: number[], rotation: number): number[] {
  if (!isValidBox(box)) return [0, 0, 0, 0];
  const [x0, y0, x1, y1] = box;
  const rot = normalizeRotation(rotation);

  switch (rot) {
    case 0:
      return [cleanFloat(x0), cleanFloat(y0), cleanFloat(x1), cleanFloat(y1)];
    case 90:
      return [
        cleanFloat(1 - y1),
        cleanFloat(x0),
        cleanFloat(1 - y0),
        cleanFloat(x1),
      ];
    case 180:
      return [
        cleanFloat(1 - x1),
        cleanFloat(1 - y1),
        cleanFloat(1 - x0),
        cleanFloat(1 - y0),
      ];
    case 270:
      return [
        cleanFloat(y0),
        cleanFloat(1 - x1),
        cleanFloat(y1),
        cleanFloat(1 - x0),
      ];
    default:
      return [cleanFloat(x0), cleanFloat(y0), cleanFloat(x1), cleanFloat(y1)];
  }
}

/**
 * Transforms an array of bounding boxes across page rotation.
 */
export function transformBboxes(bboxes: number[][], rotation: number): number[][] {
  return bboxes.map((box) => transformBox(box, rotation));
}

/**
 * Calculates absolute pixel offsets from normalized [0.0, 1.0] box and viewport.
 * 
 * Formulations:
 *   left   = x0 * width
 *   top    = y0 * height
 *   width  = (x1 - x0) * width
 *   height = (y1 - y0) * height
 */
export function calculatePixelRect(
  box: number[],
  viewport: ViewportDimensions
): PixelRect {
  const [x0, y0, x1, y1] = box;
  const left = cleanFloat(x0 * viewport.width);
  const top = cleanFloat(y0 * viewport.height);
  const width = cleanFloat((x1 - x0) * viewport.width);
  const height = cleanFloat((y1 - y0) * viewport.height);

  return { left, top, width, height };
}

/**
 * Maps a list of bounding boxes to pixel rectangles.
 */
export function calculatePixelRects(
  bboxes: number[][],
  viewport: ViewportDimensions
): PixelRect[] {
  return bboxes.map((box) => calculatePixelRect(box, viewport));
}

/**
 * Extracts a YouTube Video ID from watch, embed, short, or raw ID strings.
 */
export function parseYouTubeVideoId(urlOrId: string): string | null {
  if (!urlOrId || typeof urlOrId !== 'string') return null;
  const trimmed = urlOrId.trim();

  // 1. Raw 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // 2. Standard URL Parsing
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

      const pathSegments = url.pathname.split('/').filter(Boolean);
      if (['embed', 'v', 'shorts'].includes(pathSegments[0]) && pathSegments[1]) {
        return pathSegments[1].slice(0, 11);
      }
    } else if (url.hostname === 'youtu.be') {
      const pathSegments = url.pathname.split('/').filter(Boolean);
      if (pathSegments[0]) return pathSegments[0].slice(0, 11);
    }
  } catch {
    // Fallback to regex
  }

  const match = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/
  );
  return match ? match[1] : null;
}

/**
 * Formats a numeric duration in seconds to MM:SS or HH:MM:SS.
 * Example: 1394 -> "23:14", 45 -> "00:45", 3665 -> "01:01:05"
 */
export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }
  return `${pad(minutes)}:${pad(secs)}`;
}
