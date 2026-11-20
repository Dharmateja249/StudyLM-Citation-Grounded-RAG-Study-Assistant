'use client';

import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, FileText, Video, Compass, X } from 'lucide-react';
import { SourceRead } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { apiClient } from '@/lib/api/client';
import { PdfViewer } from './PdfViewer';
import { YouTubeViewer } from './YouTubeViewer';

export interface ViewState {
  page?: number;
  scrollY?: number;
  timestamp?: number;
}

export interface ViewerContainerProps {
  source?: SourceRead | null;
  className?: string;
}

export function ViewerContainer({
  source: propSource,
  className = '',
}: ViewerContainerProps) {
  const { activeSourceId, activeFocusTarget } = useWorkspaceStore();

  const [activeSource, setActiveSource] = useState<SourceRead | null>(propSource || null);
  const [activeTab, setActiveTab] = useState<'inspector' | 'roadmap'>('inspector');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Per-source state retention cache
  const stateCacheRef = useRef<Record<string, ViewState>>({});

  // 1. Resolve Active Source from prop or store
  useEffect(() => {
    if (propSource) {
      setActiveSource(propSource);
      return;
    }

    if (!activeSourceId) {
      setActiveSource(null);
      return;
    }

    let isMounted = true;
    async function fetchSource() {
      try {
        setIsLoading(true);
        const fetched = await apiClient.getSource(activeSourceId!);
        if (isMounted) {
          setActiveSource(fetched);
        }
      } catch {
        if (isMounted) setActiveSource(null);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    fetchSource();
    return () => {
      isMounted = false;
    };
  }, [propSource, activeSourceId]);

  // 2. Empty State
  if (!activeSource && !isLoading) {
    return (
      <div
        data-testid="viewer-empty-state"
        className={`flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground bg-background ${className}`}
      >
        <BookOpen className="w-12 h-12 mb-3 text-muted-foreground/50" />
        <h3 className="text-base font-semibold text-foreground mb-1">
          No source selected
        </h3>
        <p className="text-sm max-w-sm text-muted-foreground">
          Select a document or video from the left sidebar or click an interactive citation pill in chat to inspect sources.
        </p>
      </div>
    );
  }

  if (!activeSource) return null;

  const cachedState = stateCacheRef.current[activeSource.id] || {};

  return (
    <div
      data-testid="viewer-container"
      className={`flex flex-col h-full w-full bg-background overflow-hidden ${className}`}
    >
      {/* Tab Switcher Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-1.5 p-0.5 rounded-lg bg-muted/60 text-xs font-medium">
          <button
            type="button"
            data-testid="tab-inspector"
            onClick={() => setActiveTab('inspector')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
              activeTab === 'inspector'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {activeSource.source_type === 'pdf' ? (
              <FileText className="w-3.5 h-3.5" />
            ) : (
              <Video className="w-3.5 h-3.5" />
            )}
            <span>{activeSource.source_type === 'pdf' ? 'PDF Viewer' : 'YouTube Player'}</span>
          </button>

          <button
            type="button"
            data-testid="tab-roadmap"
            onClick={() => setActiveTab('roadmap')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md transition-all ${
              activeTab === 'roadmap'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Summary Roadmap</span>
          </button>
        </div>

        {/* Close Viewer / Return to Citations List */}
        <button
          type="button"
          data-testid="close-viewer-btn"
          aria-label="Close viewer"
          onClick={() => {
            setActiveSource(null);
            useWorkspaceStore.getState().setActiveSourceId(null);
            useWorkspaceStore.getState().clearFocusTarget();
          }}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title="Close viewer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main View Area */}
      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'inspector' && activeSource.source_type === 'pdf' && (
          <PdfViewer
            key={`pdf-${activeSource.id}`}
            source={activeSource}
            initialPage={cachedState.page ?? 1}
            initialScrollTop={cachedState.scrollY ?? 0}
            onStateChange={(state) => {
              stateCacheRef.current[activeSource.id] = {
                ...stateCacheRef.current[activeSource.id],
                page: state.page,
                scrollY: state.scrollY,
              };
            }}
          />
        )}

        {activeTab === 'inspector' && activeSource.source_type === 'youtube' && (
          <YouTubeViewer
            key={`yt-${activeSource.id}`}
            source={activeSource}
            initialSeconds={cachedState.timestamp ?? 0}
            onStateChange={(state) => {
              stateCacheRef.current[activeSource.id] = {
                ...stateCacheRef.current[activeSource.id],
                timestamp: state.timestamp,
              };
            }}
          />
        )}

        {activeTab === 'roadmap' && (
          <div
            data-testid="summary-roadmap-view"
            className="h-full overflow-y-auto p-6 bg-card"
          >
            <h3 className="text-base font-bold mb-3">{activeSource.title} — Study Guide</h3>
            {activeSource.summary ? (
              <div className="prose dark:prose-invert text-sm leading-relaxed whitespace-pre-wrap">
                {activeSource.summary}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Summary pending ingestion completion.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
