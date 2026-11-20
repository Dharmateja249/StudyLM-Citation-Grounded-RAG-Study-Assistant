'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Video } from 'lucide-react';
import { SourceRead } from '@/types/api';
import { apiClient } from '@/lib/api/client';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { SourceCard } from './SourceCard';
import { QuotaBadge } from './QuotaBadge';
import { FileUploadDropzone } from './FileUploadDropzone';
import { YouTubeImportModal } from './YouTubeImportModal';
import { SourceScopeSelector } from './SourceScopeSelector';

export interface SourceListProps {
  notebookId: string;
  initialSources?: SourceRead[];
  className?: string;
}

export function SourceList({
  notebookId,
  initialSources,
  className = '',
}: SourceListProps) {
  const { activeSourceId, setActiveSourceId } = useWorkspaceStore();
  const [sources, setSources] = useState<SourceRead[]>(initialSources || []);
  const [isYouTubeModalOpen, setIsYouTubeModalOpen] = useState(false);
  const [quotaError, setQuotaError] = useState<string | null>(null);

  // Synchronize initialSources prop updates (e.g. In tests and storybooks)
  useEffect(() => {
    if (initialSources) {
      setSources(initialSources);
    }
  }, [initialSources]);

  // Clean fetch & async cancellation guard
  useEffect(() => {
    let isCancelled = false;
    if (!initialSources && notebookId) {
      apiClient
        .getSources(notebookId)
        .then((data) => {
          if (!isCancelled) {
            setSources(data);
          }
        })
        .catch(() => {});
    }
    return () => {
      isCancelled = true;
    };
  }, [notebookId, initialSources]);

  // Real-time polling for sources in 'processing' state
  useEffect(() => {
    const hasProcessing = sources.some((s) => s.status === 'processing');
    if (!hasProcessing || !notebookId) return;

    let isSubscribed = true;
    const interval = setInterval(async () => {
      try {
        const freshSources = await apiClient.getSources(notebookId);
        if (isSubscribed) {
          setSources(freshSources);
        }
      } catch {
        // Ignore transient polling errors
      }
    }, 1000);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
    };
  }, [sources, notebookId]);

  const initialNotebookSelectedRef = useRef<string | null>(null);

  useEffect(() => {
    const queryable = sources.filter(
      (s) => s.status !== 'deleting' && s.error_code !== 'ERR_NON_EDUCATIONAL_CONTENT'
    );
    useWorkspaceStore.getState().setTotalSourceCount(queryable.length);
    if (initialNotebookSelectedRef.current !== notebookId && queryable.length > 0) {
      initialNotebookSelectedRef.current = notebookId;
      useWorkspaceStore.getState().selectAllSources(queryable.map((s) => s.id));
    }
  }, [sources, notebookId]);

  const activeNonDeletingSources = sources.filter((s) => s.status !== 'deleting');
  const sourceCount = activeNonDeletingSources.length;
  const isLocked = sourceCount >= 20;

  const handleSourceUploadSuccess = (newSource: SourceRead) => {
    setSources((prev) => [newSource, ...prev]);
    setQuotaError(null);
  };

  const handleUploadError = (error: string) => {
    if (error.toLowerCase().includes('quota') || error.toLowerCase().includes('limit')) {
      setQuotaError(error);
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    // 1. Optimistic update to deleting status
    setSources((prev) =>
      prev.map((s) => (s.id === sourceId ? { ...s, status: 'deleting' as const } : s))
    );
    if (activeSourceId === sourceId) {
      setActiveSourceId(null);
    }

    try {
      await apiClient.deleteSource(sourceId);
      // 2. Remove completely to reclaim quota
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
    } catch {
      setSources((prev) =>
        prev.map((s) => (s.id === sourceId ? { ...s, status: 'error' as const } : s))
      );
    }
  };

  return (
    <div
      className={`flex flex-col gap-4 overflow-y-auto p-3 ${className}`}
      data-testid="source-list-container"
    >
      {/* 20-Source Quota Lock Badge */}
      <QuotaBadge
        currentCount={sourceCount}
        maxLimit={20}
        errorMessage={quotaError}
      />

      {/* Action Toolbar: YouTube Import Trigger */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Source Library
        </span>
        <button
          type="button"
          onClick={() => setIsYouTubeModalOpen(true)}
          disabled={isLocked}
          title={isLocked ? 'Maximum 20 sources reached' : 'Import YouTube Lecture'}
          className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
          data-testid="open-youtube-modal-btn"
        >
          <Video className="h-3.5 w-3.5 text-red-500" />
          <span>Add YouTube</span>
        </button>
      </div>

      {/* 50MB File Upload Dropzone */}
      <FileUploadDropzone
        notebookId={notebookId}
        isLocked={isLocked}
        onUploadSuccess={handleSourceUploadSuccess}
        onUploadError={handleUploadError}
      />

      {/* Source Scope Selector */}
      <SourceScopeSelector sources={activeNonDeletingSources} />

      {/* Source Cards List */}
      <div className="flex flex-col gap-2" data-testid="source-cards-wrapper">
        {sources.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground"
            data-testid="empty-sources-notice"
          >
            No sources yet. Upload a PDF or add a YouTube lecture to get started.
          </div>
        ) : (
          sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              isActive={source.id === activeSourceId}
              onSelect={setActiveSourceId}
              onDelete={handleDeleteSource}
            />
          ))
        )}
      </div>

      {/* YouTube Import Modal */}
      <YouTubeImportModal
        isOpen={isYouTubeModalOpen}
        notebookId={notebookId}
        isLocked={isLocked}
        onClose={() => setIsYouTubeModalOpen(false)}
        onImportSuccess={handleSourceUploadSuccess}
        onImportError={handleUploadError}
      />
    </div>
  );
}
