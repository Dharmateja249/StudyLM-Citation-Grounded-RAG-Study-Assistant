'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  FileText,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';
import { SourceRead } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { PdfPageCanvas } from './PdfPageCanvas';

export interface PdfViewerProps {
  source: SourceRead;
  initialPage?: number;
  initialScrollTop?: number;
  onStateChange?: (state: { page: number; scrollY: number }) => void;
  className?: string;
}

export function PdfViewer({
  source,
  initialPage = 1,
  initialScrollTop = 0,
  onStateChange,
  className = '',
}: PdfViewerProps) {
  const { activeFocusTarget } = useWorkspaceStore();
  const token = useAuthStore((state) => state.token);

  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [isStreamLoaded, setIsStreamLoaded] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const totalPages = source.page_count && source.page_count > 0 ? source.page_count : 1;

  // 1. Authenticated HTTP 206 Partial Content Stream Request
  useEffect(() => {
    let isMounted = true;
    async function loadStream() {
      try {
        setIsStreamLoaded(false);
        setStreamError(null);

        const headers: Record<string, string> = {
          Range: 'bytes=0-',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        // Fetch authenticated stream from API route
        const streamUrl = `/api/sources/${source.id}/stream`;
        const res = await fetch(streamUrl, {
          method: 'GET',
          headers,
        });

        if (!isMounted) return;

        if (res.status === 206 || res.status === 200) {
          setIsStreamLoaded(true);
        } else {
          setStreamError(`Stream failed with status ${res.status}`);
        }
      } catch (err) {
        if (!isMounted) return;
        setStreamError(err instanceof Error ? err.message : 'Network error loading stream');
      }
    }

    loadStream();
    return () => {
      isMounted = false;
    };
  }, [source.id, token]);

  // 2. Restore Initial Scroll Position
  useEffect(() => {
    if (initialScrollTop > 0 && containerRef.current) {
      containerRef.current.scrollTop = initialScrollTop;
    }
  }, [initialScrollTop]);

  // 3. Scroll to Active Page helper
  const scrollToPage = useCallback((pageNum: number) => {
    const targetEl = document.getElementById(`pdf-page-${pageNum}`);
    if (targetEl && typeof targetEl.scrollIntoView === 'function') {
      targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setCurrentPage(pageNum);
  }, []);

  // 4. Auto-Scroll to Active Citation Page when Focus Target updates
  useEffect(() => {
    if (
      activeFocusTarget &&
      activeFocusTarget.sourceId === source.id &&
      activeFocusTarget.pageNumber
    ) {
      scrollToPage(activeFocusTarget.pageNumber);
    }
  }, [activeFocusTarget, source.id, scrollToPage]);

  // 5. Track Scroll and report state change
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollY = target.scrollTop;
    onStateChange?.({ page: currentPage, scrollY });
  };

  // 6. Pinch-to-zoom with mouse wheel (Ctrl + Wheel) or trackpad pinch gesture
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const zoomDelta = -e.deltaY * 0.005;
        setZoomScale((prev) => {
          const next = Math.min(3.0, Math.max(0.4, prev + zoomDelta));
          return Number(next.toFixed(2));
        });
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const handleZoomIn = () => setZoomScale((prev) => Math.min(3.0, Number((prev + 0.15).toFixed(2))));
  const handleZoomOut = () => setZoomScale((prev) => Math.max(0.4, Number((prev - 0.15).toFixed(2))));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);

  const baseViewport = { width: 800 * zoomScale, height: 1100 * zoomScale };

  return (
    <div
      data-testid="pdf-viewer"
      role="region"
      aria-label={`PDF Viewer: ${source.title}`}
      className={`flex flex-col h-full w-full bg-muted/20 overflow-hidden ${className}`}
    >
      {/* Viewer Header Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-primary shrink-0" />
          <span className="text-xs font-medium truncate max-w-[200px]" title={source.title}>
            {source.title}
          </span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            {totalPages} pages
          </span>
        </div>

        {/* Page Navigation & Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous Page"
            disabled={currentPage <= 1}
            onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
            className="p-1 rounded hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono px-1">
            {currentPage} / {totalPages}
          </span>
          <button
            type="button"
            aria-label="Next Page"
            disabled={currentPage >= totalPages}
            onClick={() => scrollToPage(Math.min(totalPages, currentPage + 1))}
            className="p-1 rounded hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-border mx-1" />

          {/* Zoom & Rotation */}
          <button
            type="button"
            aria-label="Zoom Out"
            onClick={handleZoomOut}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono w-10 text-center">
            {Math.round(zoomScale * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom In"
            onClick={handleZoomIn}
            className="p-1 rounded hover:bg-muted transition-colors"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-border mx-1" />

          <button
            type="button"
            aria-label="Rotate 90 Degrees"
            onClick={handleRotate}
            className="p-1 rounded hover:bg-muted transition-colors"
            title="Rotate 90° Clockwise"
          >
            <RotateCw className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-border mx-1" />

          {/* Close PDF Viewer */}
          <button
            type="button"
            data-testid="close-pdf-viewer-btn"
            aria-label="Close PDF Viewer"
            onClick={() => {
              useWorkspaceStore.getState().setActiveSourceId(null);
              useWorkspaceStore.getState().clearFocusTarget();
            }}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Close PDF Viewer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stream Status Banners */}
      {streamError && (
        <div
          role="alert"
          className="px-4 py-2 bg-destructive/10 border-b border-destructive text-destructive text-xs flex items-center gap-2"
        >
          <AlertCircle className="w-4 h-4" />
          <span>{streamError}</span>
        </div>
      )}

      {/* Continuous Page Stack Viewport */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-auto p-4 flex flex-col items-center gap-6"
      >
        {!isStreamLoaded && !streamError && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground my-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Connecting HTTP 206 range stream...</span>
          </div>
        )}

        {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
          const isTarget = activeFocusTarget?.sourceId === source.id && activeFocusTarget.pageNumber === pageNum;
          const pageBboxes = isTarget ? activeFocusTarget.bboxes : undefined;
          const pageQuote = isTarget ? activeFocusTarget.quote : undefined;

          return (
            <PdfPageCanvas
              key={`page-canvas-${pageNum}`}
              sourceId={source.id}
              pageNumber={pageNum}
              viewport={baseViewport}
              rotation={rotation}
              isActive={isTarget}
              bboxes={pageBboxes}
              quote={pageQuote}
            />
          );
        })}
      </div>
    </div>
  );
}
