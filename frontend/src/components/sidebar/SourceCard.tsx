'use client';

import React, { useState } from 'react';
import {
  FileText,
  Video,
  FileImage,
  Trash2,
  AlertTriangle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { SourceRead } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { EducationalWarningBanner } from './EducationalWarningBanner';

export interface SourceCardProps {
  source: SourceRead;
  isActive?: boolean;
  onSelect?: (sourceId: string) => void;
  onDelete?: (sourceId: string) => void;
}

export function SourceCard({
  source,
  isActive = false,
  onSelect,
  onDelete,
}: SourceCardProps) {
  const { setActiveSourceId, selectedSourceIds, toggleSourceScope } = useWorkspaceStore();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isNonEducational = source.error_code === 'ERR_NON_EDUCATIONAL_CONTENT';
  const displayTitle = isNonEducational
    ? '[Suppressed: Non-Educational Content]'
    : source.title;
  const isProcessing = source.status === 'processing';
  const isDeleting = source.status === 'deleting';
  const isError = source.status === 'error';
  const isReady = source.status === 'ready';
  const isReindexing = source.reindexing;
  const isScoped = selectedSourceIds.includes(source.id);

  // Format Duration, Page Count, or File Size
  const formatMetadata = () => {
    if (source.source_type === 'youtube' && source.duration_seconds) {
      const minutes = Math.floor(source.duration_seconds / 60);
      const seconds = source.duration_seconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    if (source.page_count) {
      return `${source.page_count} pages`;
    }
    if (source.file_size_bytes) {
      return `${(source.file_size_bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return null;
  };

  const metadataText = formatMetadata();

  const handleCardClick = () => {
    if (isDeleting || isNonEducational || isProcessing) return;
    if (onSelect) {
      onSelect(source.id);
    } else {
      setActiveSourceId(source.id);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
    onDelete?.(source.id);
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(false);
  };

  return (
    <div
      role="article"
      aria-label={`Source: ${displayTitle}`}
      tabIndex={isDeleting || isNonEducational ? -1 : 0}
      onClick={handleCardClick}
      className={`group relative flex flex-col gap-2 rounded-lg border p-3 text-left transition-all ${
        isActive
          ? 'border-primary bg-primary/5 shadow-sm'
          : 'border-border bg-card hover:border-primary/40 hover:bg-accent/10'
      } ${isDeleting ? 'opacity-50 pointer-events-none' : ''} ${
        isError ? 'border-destructive/50 bg-destructive/5' : ''
      }`}
      data-testid={`source-card-${source.id}`}
      data-status={source.status}
    >
      {/* Top Header Row: Icon, Title, Status Badges, Delete Action */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          {/* Scope Checkbox */}
          {!isDeleting && !isNonEducational && (
            <label
              data-testid="source-scope-checkbox"
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 shrink-0 flex items-center cursor-pointer"
            >
              <input
                type="checkbox"
                checked={isScoped}
                onChange={(e) => {
                  e.stopPropagation();
                  toggleSourceScope(source.id);
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Include ${displayTitle} in query scope`}
                data-testid={`source-scope-checkbox-${source.id}`}
                className="h-3.5 w-3.5 rounded border-border text-[#8B83FF] focus:ring-[#8B83FF]/40 cursor-pointer accent-[#8B83FF]"
              />
            </label>
          )}

          {/* Source Icon */}
          <div className="mt-0.5 shrink-0 text-muted-foreground">
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" data-testid="pulsing-spinner" />
            ) : source.source_type === 'youtube' ? (
              <Video className="h-4 w-4 text-red-500" />
            ) : source.source_type === 'image' ? (
              <FileImage className="h-4 w-4 text-blue-500" />
            ) : (
              <FileText className="h-4 w-4 text-amber-500" />
            )}
          </div>

          {/* Title & Metadata */}
          <div className="min-w-0 flex-1">
            <h4
              className={`truncate text-xs font-semibold leading-tight ${
                isNonEducational
                  ? 'text-amber-800 dark:text-amber-300 font-mono italic'
                  : 'text-foreground'
              }`}
              title={displayTitle}
              data-testid="source-title"
            >
              {displayTitle}
            </h4>

            {/* Subtitle / Metadata (suppressed for non-educational) */}
            {!isNonEducational && (
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                {metadataText && <span>{metadataText}</span>}
                {isReindexing && (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-1.5 py-0.5 font-medium text-purple-700 dark:text-purple-300"
                    data-testid="reindexing-badge"
                  >
                    <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                    Re-indexing...
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Status Badge & Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* 5 Lifecycle State Badges */}
          {isProcessing && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 animate-pulse"
              data-testid="status-badge-processing"
            >
              Ingesting & indexing...
            </span>
          )}
          {isReady && !isReindexing && (
            <span
              className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300"
              data-testid="status-badge-ready"
            >
              ready
            </span>
          )}
          {isDeleting && (
            <span
              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              data-testid="status-badge-deleting"
            >
              deleting
            </span>
          )}
          {isError && !isNonEducational && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive"
              data-testid="status-badge-error"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              error
            </span>
          )}

          {/* Delete Action Trigger (Remains enabled for non-educational so user can reclaim quota) */}
          {!isDeleting && (
            <button
              type="button"
              onClick={handleDeleteClick}
              aria-label={`Delete source ${displayTitle}`}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
              data-testid="delete-source-btn"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Processing Pulsing Skeleton */}
      {isProcessing && (
        <div className="mt-1 space-y-1.5" data-testid="processing-skeleton">
          <div className="h-2 w-full animate-pulse rounded bg-muted" />
          <div className="h-2 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      )}

      {/* Two-Tier YouTube Educational Moderation Barrier UI */}
      {isNonEducational && (
        <div className="mt-1">
          <EducationalWarningBanner
            message={
              source.error_message ||
              '⚠️ Upload educational related video, this video does not have educational content please recheck the link'
            }
          />
        </div>
      )}

      {/* Generic Error Message (non-educational already has banner) */}
      {isError && !isNonEducational && source.error_message && (
        <div
          role="alert"
          className="mt-1 flex items-start gap-1.5 rounded bg-destructive/10 p-2 text-[11px] text-destructive"
          data-testid="generic-error-banner"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{source.error_message}</span>
        </div>
      )}

      {/* Inline Deletion Confirmation Dialog */}
      {showDeleteConfirm && (
        <div
          role="alertdialog"
          aria-label="Confirm Source Deletion"
          className="mt-2 rounded border border-destructive/30 bg-background p-2.5 text-xs shadow-md"
          data-testid="delete-confirm-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="font-medium text-foreground">
            Are you sure you want to delete this source? This will remove its indexed vectors.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={handleCancelDelete}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
              data-testid="cancel-delete-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="rounded bg-destructive px-2 py-1 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-btn"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
