'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  transformBox,
  calculatePixelRect,
  ViewportDimensions,
} from '@/utils/coordinateMath';

export interface BboxHighlightOverlayProps {
  pageNumber: number;
  viewport: ViewportDimensions;
  rotation?: number;
  bboxes?: number[][];
  isActive?: boolean;
  quote?: string;
  className?: string;
}

export function BboxHighlightOverlay({
  pageNumber,
  viewport,
  rotation = 0,
  bboxes = [],
  isActive = false,
  quote,
  className = '',
}: BboxHighlightOverlayProps) {
  const hasBboxes = Array.isArray(bboxes) && bboxes.length > 0;
  const showScannedBanner = isActive && (!bboxes || bboxes.length === 0);

  return (
    <div
      data-testid={`bbox-overlay-page-${pageNumber}`}
      className={`pdf-highlight-overlay absolute inset-0 pointer-events-none overflow-hidden select-none ${className}`}
    >
      {/* 1. Scanned Page Fallback Alert Banner */}
      {showScannedBanner && (
        <div
          role="alert"
          data-testid="scanned-page-banner"
          className="scanned-page-banner absolute top-2 left-2 right-2 z-20 p-2.5 bg-amber-500/20 border border-amber-500 text-amber-950 dark:text-amber-100 rounded shadow-md text-xs font-medium flex items-center gap-2 pointer-events-auto transition-opacity"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-semibold block sm:inline">
              Highlighted quote located on this scanned page
            </span>
            {quote && (
              <span className="block text-[11px] opacity-85 mt-0.5 truncate italic">
                &ldquo;{quote}&rdquo;
              </span>
            )}
          </div>
        </div>
      )}

      {/* 2. Multi-Line Bounding Box Highlight Rectangles */}
      {hasBboxes &&
        bboxes.map((box, index) => {
          const transformed = transformBox(box, rotation);
          const rect = calculatePixelRect(transformed, viewport);

          return (
            <div
              key={`bbox-${pageNumber}-${index}`}
              data-testid={`pdf-highlight-${index}`}
              className={`pdf-highlight absolute border rounded-sm pointer-events-auto transition-all duration-300 ${
                isActive
                  ? 'border-amber-500 shadow-[0_0_12px_rgba(251,191,36,0.6)] animate-pulse'
                  : 'border-yellow-400/80 shadow-sm'
              }`}
              style={{
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                backgroundColor: isActive
                  ? 'rgba(251, 191, 36, 0.35)'
                  : 'rgba(253, 224, 71, 0.25)',
              }}
              title={quote || `Highlight on page ${pageNumber}`}
            />
          );
        })}
    </div>
  );
}
