'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

export interface EducationalWarningBannerProps {
  message?: string;
  className?: string;
}

export const DEFAULT_EDUCATIONAL_WARNING_MESSAGE =
  '⚠️ Upload educational related video, this video does not have educational content please recheck the link';

export function EducationalWarningBanner({
  message = DEFAULT_EDUCATIONAL_WARNING_MESSAGE,
  className = '',
}: EducationalWarningBannerProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-start gap-2.5 rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-xs font-medium text-amber-900 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200 ${className}`}
      data-testid="educational-warning-banner"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}
