'use client';

import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  ChevronDown,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  AlertTriangle,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { NotebookRead } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { NotebookModal } from './NotebookModal';

export interface NotebookSelectorProps {
  initialNotebooks?: NotebookRead[];
  onNotebookSelect?: (notebookId: string) => void;
  className?: string;
}

export function NotebookSelector({
  initialNotebooks,
  onNotebookSelect,
  className = '',
}: NotebookSelectorProps) {
  const { activeNotebookId, setActiveNotebookId, setActiveSourceId } = useWorkspaceStore();
  const token = useAuthStore((s) => s.token);
  const [notebooks, setNotebooks] = useState<NotebookRead[]>(initialNotebooks || []);
  const [isOpen, setIsOpen] = useState(false);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialNotebooks) {
      if (!token) {
        setNotebooks([]);
        return;
      }
      apiClient
        .getNotebooks()
        .then((data) => {
          setNotebooks(data);
          if (!activeNotebookId && data.length > 0) {
            setActiveNotebookId(data[0].id);
          }
        })
        .catch(() => {});
    }
  }, [initialNotebooks, activeNotebookId, setActiveNotebookId, token]);

  const activeNotebook = notebooks.find((nb) => nb.id === activeNotebookId);

  const handleSelectNotebook = (id: string) => {
    setActiveNotebookId(id);
    onNotebookSelect?.(id);
    setIsOpen(false);
  };

  const handleStartRename = (nb: NotebookRead, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(nb.id);
    setEditTitle(nb.title);
  };

  const handleSaveRename = async (nbId: string, e?: React.FormEvent) => {
    e?.preventDefault();
    if (!editTitle.trim()) return;

    try {
      const updated = await apiClient.updateNotebook(nbId, { title: editTitle.trim() });
      setNotebooks((prev) => prev.map((nb) => (nb.id === nbId ? updated : nb)));
      setEditingId(null);
    } catch {}
  };

  const handleConfirmDeleteNotebook = async (nbId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setNotebooks((prev) => prev.filter((nb) => nb.id !== nbId));
      if (activeNotebookId === nbId) {
        setActiveNotebookId(null);
        setActiveSourceId(null);
      }
      setDeleteConfirmId(null);
      await apiClient.deleteNotebook(nbId);
    } catch {}
  };

  return (
    <div className={`relative flex flex-col gap-2 ${className}`} data-testid="notebook-selector">
      {/* Selector Trigger Button */}
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-label="Select Notebook"
          className="flex flex-1 items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-left text-sm font-semibold shadow-sm hover:bg-accent/10 transition-colors"
          data-testid="notebook-switcher-btn"
        >
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen className="h-4 w-4 shrink-0 text-primary" />
            <span className="truncate text-foreground" data-testid="active-notebook-title">
              {activeNotebook?.title || 'Select Notebook'}
            </span>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Quick New Notebook Button */}
        <button
          type="button"
          onClick={() => setIsNewModalOpen(true)}
          title="New Notebook"
          aria-label="New Notebook"
          className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
          data-testid="new-notebook-trigger-btn"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          role="menu"
          aria-label="Notebooks List"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg animate-in fade-in zoom-in-95"
          data-testid="notebook-dropdown-menu"
        >
          {notebooks.map((nb) => (
            <div
              key={nb.id}
              role="menuitem"
              onClick={() => handleSelectNotebook(nb.id)}
              className={`group flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
                nb.id === activeNotebookId
                  ? 'bg-primary/10 font-semibold text-primary'
                  : 'text-foreground hover:bg-muted'
              }`}
              data-testid={`notebook-option-${nb.id}`}
            >
              {editingId === nb.id ? (
                <form
                  onSubmit={(e) => handleSaveRename(nb.id, e)}
                  onClick={(e) => e.stopPropagation()}
                  className="flex flex-1 items-center gap-1"
                >
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-xs text-foreground"
                    data-testid="inline-rename-input"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="rounded p-0.5 text-primary hover:bg-primary/20"
                    data-testid="save-rename-btn"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(null);
                    }}
                    className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </form>
              ) : (
                <>
                  <span className="truncate flex-1" title={nb.title}>
                    {nb.title}
                  </span>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => handleStartRename(nb, e)}
                      title="Rename Notebook"
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                      data-testid={`rename-notebook-${nb.id}`}
                    >
                      <Edit2 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirmId(nb.id);
                      }}
                      title="Delete Notebook"
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                      data-testid={`delete-notebook-${nb.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                setIsNewModalOpen(true);
              }}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
              data-testid="dropdown-new-notebook-btn"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create New Notebook</span>
            </button>
          </div>
        </div>
      )}

      {/* Cascading Deletion Confirmation Modal */}
      {deleteConfirmId && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="delete-nb-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          data-testid="notebook-delete-confirm-modal"
        >
          <div className="w-full max-w-sm rounded-xl border border-destructive/30 bg-card p-5 shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
              <div>
                <h4 id="delete-nb-title" className="text-sm font-semibold text-foreground">
                  Delete Notebook & Cascade?
                </h4>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  Deleting this notebook will permanently remove all associated sources and notes. This action cannot be undone.
                </p>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmId(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                data-testid="cancel-delete-nb-btn"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(e) => handleConfirmDeleteNotebook(deleteConfirmId, e)}
                className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground hover:bg-destructive/90"
                data-testid="confirm-delete-nb-btn"
              >
                Delete Notebook
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Notebook Modal */}
      <NotebookModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreated={(newNb) => {
          setNotebooks((prev) => [newNb, ...prev]);
          setActiveNotebookId(newNb.id);
        }}
      />
    </div>
  );
}
