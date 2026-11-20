'use client';

import React, { useEffect, useMemo } from 'react';
import { CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { SourceRead } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export interface SourceScopeSelectorProps {
  sources?: SourceRead[];
  className?: string;
}

export function SourceScopeSelector({
  sources = [],
  className = '',
}: SourceScopeSelectorProps) {
  const { selectedSourceIds, isScopeCleared, selectAllSources, clearSourceScope } = useWorkspaceStore();

  // Filter queryable sources (exclude deleting and non-educational rejected videos)
  const queryableSources = useMemo(
    () => sources.filter(
      (s) => s.status !== 'deleting' && s.error_code !== 'ERR_NON_EDUCATIONAL_CONTENT'
    ),
    [sources]
  );

  // Auto-select on mount if user hasn't explicitly cleared the scope
  useEffect(() => {
    if (!isScopeCleared && selectedSourceIds.length === 0 && queryableSources.length > 0) {
      selectAllSources(queryableSources.map((s) => s.id));
    }
  }, [isScopeCleared, selectedSourceIds.length, queryableSources, selectAllSources]);

  // Initial render guard before useEffect
  const effectiveSelectedIds =
    !isScopeCleared && selectedSourceIds.length === 0
      ? queryableSources.map((s) => s.id)
      : selectedSourceIds;

  const totalCount = queryableSources.length;
  const selectedCount = queryableSources.filter((s) =>
    effectiveSelectedIds.includes(s.id)
  ).length;

  const allSelected = totalCount > 0 && selectedCount === totalCount;
  const noneSelected = totalCount > 0 && selectedCount === 0;

  const handleToggleSelectAll = () => {
    if (allSelected) {
      clearSourceScope();
    } else {
      selectAllSources(queryableSources.map((s) => s.id));
    }
  };

  if (totalCount === 0) {
    return null;
  }

  return (
    <div
      data-testid="source-scope-selector"
      className={`flex flex-col gap-2 rounded-lg border border-border/80 bg-card/60 p-2.5 text-xs ${className}`}
    >
      {/* Scope Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {allSelected ? (
            <CheckSquare className="h-3.5 w-3.5 text-[#8B83FF]" />
          ) : (
            <Square className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span
            data-testid="source-scope-count"
            className="font-medium text-foreground text-[11px]"
          >
            {selectedCount} of {totalCount} selected
          </span>
        </div>

        <button
          type="button"
          onClick={handleToggleSelectAll}
          data-testid="toggle-select-all-sources-btn"
          aria-label={allSelected ? 'Select None' : 'Select All'}
          className="rounded px-2 py-0.5 text-[11px] font-medium text-[#8B83FF] hover:bg-[#8B83FF]/10 transition-colors cursor-pointer"
        >
          <span data-testid="scope-toggle-all-btn">
            {allSelected ? 'Select None' : 'Select All'}
          </span>
        </button>
      </div>

      {/* Empty Scope Alert Guard */}
      {noneSelected && (
        <div
          role="alert"
          data-testid="empty-source-scope-alert"
          className="flex items-center gap-1.5 rounded bg-amber-500/10 border border-amber-500/30 p-2 text-[11px] text-amber-500 font-medium animate-in fade-in"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span data-testid="empty-scope-alert">
            Please select at least one source to query
          </span>
        </div>
      )}
    </div>
  );
}
