'use client';

import React, { useState } from 'react';
import { BookOpen, X, Loader2 } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { NotebookRead } from '@/types/api';

export interface NotebookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (notebook: NotebookRead) => void;
}

export function NotebookModal({ isOpen, onClose, onCreated }: NotebookModalProps) {
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      setIsSubmitting(true);
      const created = await apiClient.createNotebook({
        title: title.trim() || 'Untitled Notebook',
      });
      setTitle('');
      onCreated(created);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create notebook');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-notebook-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      data-testid="new-notebook-modal"
    >
      <div className="relative w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl animate-in fade-in zoom-in-95">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute right-4 top-4 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 mb-4 text-foreground">
          <BookOpen className="h-5 w-5 text-primary" />
          <h3 id="new-notebook-title" className="text-base font-semibold">
            Create New Notebook
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="notebook-title-input"
              className="block text-xs font-medium text-foreground mb-1.5"
            >
              Notebook Title
            </label>
            <input
              id="notebook-title-input"
              type="text"
              placeholder="e.g. Physics 101: Classical Mechanics"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSubmitting}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              data-testid="notebook-title-input"
              autoFocus
            />
          </div>

          {error && (
            <div className="text-xs text-destructive" role="alert">
              {error}
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
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              data-testid="create-notebook-submit-btn"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Notebook'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
