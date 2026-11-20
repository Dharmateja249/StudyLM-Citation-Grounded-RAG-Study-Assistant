'use client';

/**
 * Interactive Citation Chip & Hovercard Component
 * File: frontend/src/components/chat/CitationChip.tsx
 *
 * Implements:
 * - Interactive [N] citation pill
 * - Hovercard displaying source title, page number / timestamp, verbatim quote
 * - Single-direction event bus dispatch to workspaceStore.dispatchFocusTarget
 * - Window SELECT_CITATION custom event dispatch for inter-pane testing
 */

import React, { useState, useRef } from 'react';
import { ResolvedCitation } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { FileText, Video, ExternalLink, AlertTriangle } from 'lucide-react';

export interface CitationChipProps {
  markerId: number;
  citation?: ResolvedCitation;
  className?: string;
}

export function CitationChip({ markerId, citation, className = '' }: CitationChipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!citation) return;

    // 1. Dispatch focus target to global Zustand store
    useWorkspaceStore.getState().dispatchFocusTarget({
      sourceId: citation.source_id,
      pageNumber: citation.page_number ?? undefined,
      bboxes: citation.bboxes,
      startSeconds: citation.start_seconds ?? undefined,
      quote: citation.quote,
      timestamp: Date.now(),
    });

    // 2. Dispatch window event for external subscribers
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('SELECT_CITATION', {
          detail: {
            markerId,
            citation,
            sourceId: citation.source_id,
            pageNumber: citation.page_number,
            bboxes: citation.bboxes,
            startSeconds: citation.start_seconds,
            quote: citation.quote,
          },
        })
      );
    }
  };

  // Format timestamp MM:SS for YouTube
  const formatSeconds = (sec?: number | null) => {
    if (sec === null || sec === undefined) return '';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!citation) {
    return (
      <span
        data-testid="citation-pill"
        data-marker-id={markerId}
        data-unverified="true"
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 text-xs font-mono font-medium rounded border border-amber-500/30 bg-amber-500/10 text-amber-500 cursor-help ${className}`}
        title="Citation not found in source notes"
        aria-label={`Unverified citation [${markerId}]`}
      >
        <AlertTriangle className="w-3 h-3 text-amber-500 inline mr-0.5" />
        [{markerId}?]
      </span>
    );
  }

  const isVideo = citation.source_type === 'youtube';

  return (
    <span
      className="relative inline-flex items-center align-baseline whitespace-nowrap"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        role="button"
        data-testid="citation-pill"
        data-marker-id={markerId}
        onClick={handleClick}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        aria-label={`Citation [${markerId}]: ${citation.source_title}`}
        className={`citation-pill inline-flex items-center justify-center text-xs font-mono font-semibold px-1.5 py-0.5 mx-0.5 rounded cursor-pointer transition-colors border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/60 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${className}`}
      >
        [{markerId}]
      </button>

      {/* Authoritative Citation Hovercard */}
      {isOpen && (
        <div
          role="tooltip"
          data-testid="citation-hovercard"
          className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 text-xs rounded-lg shadow-xl border border-border bg-popover text-popover-foreground transition-all duration-150 animate-in fade-in zoom-in-95 pointer-events-auto"
        >
          <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground border-b border-border/50 pb-1.5">
            {isVideo ? (
              <Video className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            )}
            <span
              data-testid="citation-source-title"
              className="font-medium text-foreground truncate flex-1"
              title={citation.source_title}
            >
              {citation.source_title}
            </span>
            {citation.page_number && (
              <span
                data-testid="citation-page-number"
                className="px-1 py-0.2 rounded bg-muted text-[10px] font-mono text-muted-foreground flex-shrink-0"
              >
                Page {citation.page_number}
              </span>
            )}
            {citation.start_seconds !== undefined && citation.start_seconds !== null && (
              <span
                data-testid="citation-timestamp"
                className="px-1 py-0.2 rounded bg-muted text-[10px] font-mono text-muted-foreground flex-shrink-0"
              >
                {formatSeconds(citation.start_seconds)}
              </span>
            )}
          </div>

          <blockquote
            data-testid="citation-quote"
            className="italic text-muted-foreground bg-muted/40 p-2 rounded border-l-2 border-amber-500 text-[11px] leading-relaxed line-clamp-4"
          >
            &ldquo;{citation.quote}&rdquo;
          </blockquote>

          <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="text-amber-500/80 font-medium">Click pill to open inspector</span>
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
          </div>
        </div>
      )}
    </span>
  );
}
