'use client';

import React, { useState } from 'react';
import { Video, X, Loader2, AlertCircle } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { SourceRead } from '@/types/api';

export interface YouTubeImportModalProps {
  isOpen: boolean;
  notebookId: string;
  isLocked?: boolean;
  onClose: () => void;
  onImportSuccess?: (source: SourceRead) => void;
  onImportError?: (error: string) => void;
}

export function YouTubeImportModal({
  isOpen,
  notebookId,
  isLocked = false,
  onClose,
  onImportSuccess,
  onImportError,
}: YouTubeImportModalProps) {
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrorMessage(null);

    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setErrorMessage('Please enter a valid YouTube video URL');
      return;
    }

    if (!trimmedUrl.includes('youtube.com') && !trimmedUrl.includes('youtu.be')) {
      setErrorMessage('URL must be a valid YouTube link (e.g. https://www.youtube.com/watch?v=...)');
      return;
    }

    if (isLocked) {
      setErrorMessage('Maximum 20 sources reached for this notebook');
      return;
    }

    try {
      setIsSubmitting(true);
      const createdSource = await apiClient.createYouTubeSource(notebookId, { url: trimmedUrl });
      setUrl('');
      onImportSuccess?.(createdSource);
      onClose();
    } catch (err: unknown) {
      const errorText =
        err instanceof Error ? err.message : 'Failed to import YouTube video.';
      setErrorMessage(errorText);
      onImportError?.(errorText);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="youtube-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      data-testid="youtube-import-modal"
    >
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl animate-in fade-in zoom-in-95">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 text-foreground mb-4">
          <Video className="h-5 w-5 text-red-500" />
          <h3 id="youtube-modal-title" className="text-base font-semibold">
            Import YouTube Lecture
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="youtube-url-input"
              className="block text-xs font-medium text-foreground mb-1.5"
            >
              YouTube Video URL
            </label>
            <input
              id="youtube-url-input"
              type="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isSubmitting || isLocked}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              data-testid="youtube-url-input"
              autoFocus
            />
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive"
              data-testid="youtube-import-error"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={isSubmitting || isLocked}
              title={isLocked ? 'Maximum 20 sources reached' : 'Add Source'}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              data-testid="submit-youtube-btn"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Add Source'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
