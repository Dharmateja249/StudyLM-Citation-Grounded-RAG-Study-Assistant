'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BboxHighlightOverlay } from './BboxHighlightOverlay';
import { ViewportDimensions } from '@/utils/coordinateMath';
import { useAuthStore } from '@/stores/authStore';

export interface PdfPageCanvasProps {
  sourceId?: string;
  pageNumber: number;
  viewport?: ViewportDimensions;
  rotation?: number;
  bboxes?: number[][];
  isActive?: boolean;
  quote?: string;
  className?: string;
}

export function PdfPageCanvas({
  sourceId,
  pageNumber,
  viewport = { width: 800, height: 1100 },
  rotation = 0,
  bboxes,
  isActive = false,
  quote,
  className = '',
}: PdfPageCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isVisible, setIsVisible] = useState(isActive);

  // 1. IntersectionObserver for lazy loading pages when scrolled into view
  useEffect(() => {
    if (isActive) {
      setIsVisible(true);
      return;
    }

    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '600px 0px' }
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [isActive]);

  // 2. Render Canvas when visible
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isCancelled = false;
    let retryTimeout: NodeJS.Timeout | null = null;
    let retryCount = 0;

    try {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Render crisp white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        // Render subtle guide watermark as initial placeholder
        ctx.strokeStyle = '#f1f5f9';
        ctx.lineWidth = 1;
        for (let y = 60; y < viewport.height - 40; y += 32) {
          ctx.beginPath();
          ctx.moveTo(60, y);
          ctx.lineTo(viewport.width - 60, y);
          ctx.stroke();
        }

        ctx.fillStyle = '#94a3b8';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Loading page ${pageNumber}...`, viewport.width / 2, viewport.height / 2);

        // Fetch and render high-resolution PyMuPDF page image if visible
        if (isVisible && sourceId && typeof window !== 'undefined' && typeof Image !== 'undefined') {
          const token =
            useAuthStore.getState().token ||
            (typeof window !== 'undefined' ? localStorage.getItem('studylm_auth_token') : null) ||
            '';

          const loadImage = () => {
            const imgUrl = `/api/sources/${sourceId}/pages/${pageNumber}/render${
              token ? `?token=${encodeURIComponent(token)}` : ''
            }`;

            const img = new Image();
            img.onload = () => {
              if (isCancelled) return;
              ctx.clearRect(0, 0, viewport.width, viewport.height);
              ctx.drawImage(img, 0, 0, viewport.width, viewport.height);
            };
            img.onerror = () => {
              if (isCancelled) return;
              if (retryCount < 2) {
                retryCount++;
                retryTimeout = setTimeout(loadImage, 800 * retryCount);
                return;
              }
              // Draw clean page background with page indicator if image load fails
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, viewport.width, viewport.height);
              ctx.fillStyle = '#94a3b8';
              ctx.font = '14px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText(`Page ${pageNumber} Preview`, viewport.width / 2, viewport.height / 2);
            };
            img.src = imgUrl;
          };

          loadImage();
        }
      }
    } catch {
      // JSDOM / headless canvas guard
    }

    return () => {
      isCancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [isVisible, sourceId, pageNumber, viewport.width, viewport.height]);

  return (
    <div
      ref={containerRef}
      id={`pdf-page-${pageNumber}`}
      data-testid={`pdf-page-${pageNumber}`}
      data-page-number={pageNumber}
      className={`pdf-page-container relative mx-auto my-4 bg-white dark:bg-zinc-900 border border-border shadow-md rounded transition-shadow ${
        isActive ? 'ring-2 ring-amber-500/80 shadow-lg' : ''
      } ${className}`}
      style={{
        width: `${viewport.width}px`,
        height: `${viewport.height}px`,
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid={`pdf-canvas-page-${pageNumber}`}
        width={viewport.width}
        height={viewport.height}
        className="pdf-page-canvas block w-full h-full rounded"
      />

      {/* Normalized Bounding Box Overlay Layer */}
      <BboxHighlightOverlay
        pageNumber={pageNumber}
        viewport={viewport}
        rotation={rotation}
        bboxes={bboxes}
        isActive={isActive}
        quote={quote}
      />

      {/* Footer Page Number Tag */}
      <div className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 text-white font-mono text-[11px] rounded select-none pointer-events-none">
        Page {pageNumber}
      </div>
    </div>
  );
}
