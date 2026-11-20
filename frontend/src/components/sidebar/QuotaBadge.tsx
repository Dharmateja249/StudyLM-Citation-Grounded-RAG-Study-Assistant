'use client';

import React from 'react';
import { Database, Lock, AlertCircle } from 'lucide-react';

export interface QuotaBadgeProps {
  currentCount: number;
  maxLimit?: number;
  errorMessage?: string | null;
  className?: string;
}

export function QuotaBadge({
  currentCount,
  maxLimit = 20,
  errorMessage,
  className = '',
}: QuotaBadgeProps) {
  const isLocked = currentCount >= maxLimit;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`} data-testid="quota-badge-container">
      <div
        className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
          isLocked
            ? 'border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            : 'border border-border bg-muted/50 text-muted-foreground'
        }`}
        title={isLocked ? 'Maximum 20 sources reached' : `${currentCount} of ${maxLimit} sources used`}
        data-testid="quota-badge"
      >
        <div className="flex items-center gap-1.5">
          {isLocked ? (
            <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          ) : (
            <Database className="h-3.5 w-3.5" />
          )}
          <span>Sources</span>
        </div>
        <span
          className={`font-mono text-xs font-bold ${
            isLocked ? 'text-amber-700 dark:text-amber-300' : 'text-foreground'
          }`}
          data-testid="quota-counter"
        >
          {currentCount} / {maxLimit} Sources
        </span>
      </div>

      {/* Backend 400 Quota Error Alert Banner */}
      {errorMessage && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive"
          data-testid="quota-error-alert"
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="leading-tight">{errorMessage}</span>
        </div>
      )}
    </div>
  );
}
