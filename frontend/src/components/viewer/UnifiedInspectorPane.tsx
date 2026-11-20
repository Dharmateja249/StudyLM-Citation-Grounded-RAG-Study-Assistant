'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  ChevronUp,
  ChevronDown,
  Trash2,
  ShieldAlert,
  Loader2,
  Lock,
} from 'lucide-react';
import { SourceRead, ResolvedCitation, ViewerFocusTarget } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { apiClient } from '@/lib/api/client';
import { formatTimestamp } from '@/utils/coordinateMath';
import { ViewerContainer } from './ViewerContainer';

export interface UnifiedInspectorPaneProps {
  source?: SourceRead | null;
  activeSource?: SourceRead | null;
  citations?: ResolvedCitation[];
  activeCitation?: ResolvedCitation | null;
  focusTarget?: ViewerFocusTarget | null;
  onCitationClick?: (citation: ResolvedCitation) => void;
  onDeleteSource?: (sourceId: string) => Promise<void> | void;
  onClose?: () => void;
  className?: string;
}

export function UnifiedInspectorPane({
  source: propSource,
  activeSource: propActiveSource,
  citations: propCitations,
  activeCitation: propActiveCitation,
  focusTarget: propFocusTarget,
  onCitationClick,
  onDeleteSource,
  className = '',
}: UnifiedInspectorPaneProps) {
  const storeActiveSourceId = useWorkspaceStore((s) => s.activeSourceId);
  const storeFocusTarget = useWorkspaceStore((s) => s.activeFocusTarget);
  const storeCitations = useWorkspaceStore((s) => s.activeCitations);
  const setActiveSourceId = useWorkspaceStore((s) => s.setActiveSourceId);
  const dispatchFocusTarget = useWorkspaceStore((s) => s.dispatchFocusTarget);

  const [activeSource, setActiveSource] = useState<SourceRead | null>(
    propActiveSource || propSource || null
  );
  const [isFeedExpanded, setIsFeedExpanded] = useState<boolean>(true);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [selectedMarkerId, setSelectedMarkerId] = useState<number | null>(
    propActiveCitation?.marker_id ?? null
  );

  // 1. Resolve Active Source from props or workspace store
  useEffect(() => {
    if (propActiveSource !== undefined) {
      setActiveSource(propActiveSource);
      return;
    }
    if (propSource !== undefined) {
      setActiveSource(propSource);
      return;
    }
    if (!storeActiveSourceId) {
      setActiveSource(null);
      return;
    }

    let isMounted = true;
    apiClient
      .getSource(storeActiveSourceId)
      .then((fetched) => {
        if (isMounted) setActiveSource(fetched);
      })
      .catch(() => {
        if (isMounted) setActiveSource(null);
      });

    return () => {
      isMounted = false;
    };
  }, [propActiveSource, propSource, storeActiveSourceId]);

  // 2. Resolve Active Citations Feed
  const feedCitations: ResolvedCitation[] =
    propCitations ?? (storeCitations && storeCitations.length > 0 ? storeCitations : []);

  // 3. Listen to SELECT_CITATION window event
  useEffect(() => {
    const handleSelectCitation = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.markerId) {
        setSelectedMarkerId(customEvent.detail.markerId);
      }
    };
    window.addEventListener('SELECT_CITATION', handleSelectCitation);
    return () => window.removeEventListener('SELECT_CITATION', handleSelectCitation);
  }, []);

  const activeFocusTarget = propFocusTarget ?? storeFocusTarget;

  // 4. Handle Citation Card Click
  const handleCitationCardClick = useCallback(
    (citation: ResolvedCitation) => {
      setSelectedMarkerId(citation.marker_id);
      onCitationClick?.(citation);

      dispatchFocusTarget({
        sourceId: citation.source_id,
        pageNumber: citation.page_number ?? undefined,
        bboxes: citation.bboxes,
        startSeconds: citation.start_seconds ?? undefined,
        quote: citation.quote,
      });

      if (activeSource?.id !== citation.source_id) {
        setActiveSourceId(citation.source_id);
      }
    },
    [onCitationClick, dispatchFocusTarget, activeSource?.id, setActiveSourceId]
  );

  // 5. Handle Non-Educational Rejection Delete
  const handleDeleteRejectedSource = async () => {
    if (!activeSource) return;
    setIsDeleting(true);
    try {
      if (onDeleteSource) {
        await onDeleteSource(activeSource.id);
      } else {
        await apiClient.deleteSource(activeSource.id);
      }
      setActiveSourceId(null);
      setActiveSource(null);
    } catch {
      // Handled gracefully
    } finally {
      setIsDeleting(false);
    }
  };

  const isNonEducational =
    activeSource?.status === 'error' &&
    activeSource?.error_code === 'ERR_NON_EDUCATIONAL_CONTENT';

  return (
    <div
      data-testid="unified-inspector-pane"
      role="region"
      aria-label="Unified Inspector Pane"
      className={`flex flex-col h-full w-full bg-background overflow-hidden ${className}`}
    >
      {/* ------------------------------------------------------------- */}
      {/* Top Stack: Expandable Citations Card Feed                      */}
      {/* ------------------------------------------------------------- */}
      <div
        data-testid="citations-feed"
        className="border-b border-border bg-card shrink-0 transition-all"
      >
        {/* Feed Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/60">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#8B83FF]" />
            <span className="text-xs font-semibold text-foreground tracking-tight">
              Verified Citations
            </span>
            <span
              data-testid="citations-count-badge"
              className="px-2 py-0.5 rounded-full bg-primary/10 text-[#8B83FF] text-[11px] font-mono font-medium"
            >
              {feedCitations.length} {feedCitations.length === 1 ? 'citation' : 'citations'}
            </span>
          </div>

          <button
            type="button"
            data-testid="toggle-citations-feed-btn"
            onClick={() => setIsFeedExpanded((prev) => !prev)}
            aria-expanded={isFeedExpanded}
            className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
            title={isFeedExpanded ? 'Collapse Citations Feed' : 'Expand Citations Feed'}
          >
            {isFeedExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Expandable Feed Body */}
        {isFeedExpanded && (
          <div
            data-testid="citations-card-feed"
            className="p-3 max-h-52 overflow-y-auto space-y-2 bg-[#111318]/50"
          >
            {feedCitations.length === 0 ? (
              <div
                data-testid="citations-feed-empty"
                className="p-4 text-center text-xs text-muted-foreground italic"
              >
                No citations for current answer yet. Ask a question or click a citation in chat to inspect evidence.
              </div>
            ) : (
              feedCitations.map((citation) => {
                const isCardActive =
                  (activeFocusTarget?.sourceId === citation.source_id &&
                    ((citation.page_number && activeFocusTarget?.pageNumber === citation.page_number) ||
                     (citation.start_seconds !== undefined && activeFocusTarget?.startSeconds === citation.start_seconds))) ||
                  selectedMarkerId === citation.marker_id;

                return (
                  <div
                    key={`feed-card-${citation.marker_id}-${citation.source_id}`}
                    data-testid="citation-card"
                    data-citation-marker={citation.marker_id}
                    data-active={isCardActive ? 'true' : 'false'}
                    onClick={() => handleCitationCardClick(citation)}
                    className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                      isCardActive
                        ? 'border-[#8B83FF] bg-[#8B83FF]/15 shadow-sm ring-1 ring-[#8B83FF]/40'
                        : 'border-border/60 bg-card hover:bg-muted/40 hover:border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          data-testid="citation-card-marker"
                          className="px-1.5 py-0.5 rounded font-mono font-bold text-[11px] bg-amber-500/20 text-amber-400 border border-amber-500/30"
                        >
                          [{citation.marker_id}]
                        </span>
                        <span
                          data-testid="citation-card-source"
                          className="font-medium text-foreground truncate max-w-[200px]"
                          title={citation.source_title}
                        >
                          {citation.source_title}
                        </span>
                      </div>

                      {citation.source_type === 'pdf' && citation.page_number && (
                        <span
                          data-testid="citation-card-page"
                          className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-[10px]"
                        >
                          Page {citation.page_number}
                        </span>
                      )}
                      {citation.source_type === 'youtube' &&
                        citation.start_seconds !== undefined &&
                        citation.start_seconds !== null && (
                          <span
                            data-testid="citation-card-timestamp"
                            className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-[10px]"
                          >
                            {formatTimestamp(citation.start_seconds)}
                          </span>
                        )}
                    </div>

                    <blockquote
                      data-testid="citation-card-quote"
                      className="italic text-muted-foreground text-[11px] leading-relaxed line-clamp-2 pl-2 border-l-2 border-[#8B83FF]/60"
                    >
                      &ldquo;{citation.quote}&rdquo;
                    </blockquote>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Bottom Stack: Live Viewer or Non-Educational Shield           */}
      {/* ------------------------------------------------------------- */}
      <div
        className="flex-1 overflow-hidden relative"
        data-testid="live-viewer-pane"
      >
        {isNonEducational ? (
          /* Non-Educational YouTube Shield */
          <div
            data-testid="youtube-suppressed-view"
            className="flex flex-col items-center justify-center h-full p-6 text-center bg-card overflow-y-auto"
          >
            <div
              data-testid="youtube-shield-card"
              className="max-w-md w-full p-6 rounded-2xl border border-amber-500/60 bg-amber-500/10 shadow-xl flex flex-col items-center gap-4"
            >
              <div
                data-testid="non-educational-shield"
                className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500"
              >
                <ShieldAlert className="w-7 h-7" />
              </div>

              {/* Exact Verbatim Banner with Emoji */}
              <div
                role="alert"
                data-testid="educational-warning-banner"
                className="text-xs font-semibold text-amber-500 leading-relaxed text-center px-3 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 w-full"
              >
                ⚠️ Upload educational related video, this video does not have educational content please recheck the link
              </div>

              {/* Suppressed Title Mask */}
              <div className="w-full text-center">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                  Source Title
                </span>
                <span
                  data-testid="shield-suppressed-title"
                  className="text-xs font-mono text-muted-foreground bg-muted/60 px-3 py-1 rounded inline-block"
                >
                  [Suppressed: Non-Educational Content]
                </span>
              </div>

              {/* Locked Player Notice */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Lock className="w-3.5 h-3.5 text-amber-500" />
                <span>Player and transcript locked by educational relevance barrier.</span>
              </div>

              {/* Quota Reclaim Delete Button */}
              <button
                type="button"
                data-testid="shield-delete-source-btn"
                onClick={handleDeleteRejectedSource}
                disabled={isDeleting}
                className="mt-2 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-destructive hover:bg-destructive/90 text-destructive-foreground text-xs font-semibold shadow transition-all cursor-pointer disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                <span>Delete & Reclaim Quota</span>
              </button>
            </div>
          </div>
        ) : (
          /* Live Viewer: PdfViewer / YouTubeViewer / Empty State via ViewerContainer */
          <ViewerContainer source={activeSource} />
        )}
      </div>
    </div>
  );
}
