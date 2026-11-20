'use client';

/**
 * Session Resumption Hook
 * File: frontend/src/hooks/useSessionResume.ts
 *
 * Implements:
 * - Automatic restoration of active notebook and active source upon reload/mount
 * - Fallback hierarchy: localStorage -> user.last_active_notebook_id -> first available notebook
 * - Auto-selection of first ready source if no cached source exists
 * - Syncing activeSourceId changes to localStorage
 * - Cross-tenant purge resilience
 */

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { apiClient } from '@/lib/api/client';
import { NotebookRead } from '@/types/api';

const NOTEBOOK_KEY = 'studylm_active_notebook_id';
const SOURCE_KEY = 'studylm_active_source_id';

const safeStorage = {
  getItem: (key: string): string | null => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(key, value);
      } catch {}
    }
  },
  removeItem: (key: string): void => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  },
};

export interface SessionResumeState {
  isResuming: boolean;
  isResumed: boolean;
  resumedNotebookId: string | null;
  resumedSourceId: string | null;
  error: string | null;
  notebooks: NotebookRead[];
}

export function useSessionResume(): SessionResumeState {
  const token = useAuthStore((s) => s.token);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setUser = useAuthStore((s) => s.setUser);
  const setActiveNotebookId = useWorkspaceStore((s) => s.setActiveNotebookId);
  const setActiveSourceId = useWorkspaceStore((s) => s.setActiveSourceId);
  const activeSourceId = useWorkspaceStore((s) => s.activeSourceId);

  const [state, setState] = useState<SessionResumeState>({
    isResuming: true,
    isResumed: false,
    resumedNotebookId: null,
    resumedSourceId: null,
    error: null,
    notebooks: [],
  });

  const hasResumedRef = useRef(false);

  // 1. Core Resumption Sequence
  useEffect(() => {
    let isCancelled = false;

    async function resumeSession() {
      if (!isAuthenticated && !token) {
        setState({
          isResuming: false,
          isResumed: false,
          resumedNotebookId: null,
          resumedSourceId: null,
          error: null,
          notebooks: [],
        });
        return;
      }

      setState((prev) => ({ ...prev, isResuming: true, error: null }));

      try {
        // A. Resolve User Profile if missing
        let currentUser = useAuthStore.getState().user;
        if (!currentUser && token) {
          try {
            currentUser = await apiClient.getProfile();
            if (!isCancelled) setUser(currentUser);
          } catch {
            // Profile fetch failure is handled by apiClient auth interceptors
          }
        }

        // B. Fetch Available Notebooks
        const userNotebooks = await apiClient.getNotebooks();
        if (isCancelled) return;

        if (userNotebooks.length === 0) {
          setActiveNotebookId(null);
          setActiveSourceId(null);
          safeStorage.removeItem(NOTEBOOK_KEY);
          safeStorage.removeItem(SOURCE_KEY);
          setState({
            isResuming: false,
            isResumed: true,
            resumedNotebookId: null,
            resumedSourceId: null,
            error: null,
            notebooks: [],
          });
          return;
        }

        // C. Resolve Target Notebook
        const currentActiveNbId = useWorkspaceStore.getState().activeNotebookId;
        const cachedNotebookId = safeStorage.getItem(NOTEBOOK_KEY) || currentActiveNbId;
        let targetNotebook: NotebookRead | undefined;

        if (cachedNotebookId) {
          targetNotebook = userNotebooks.find((nb) => nb.id === cachedNotebookId && nb.status !== 'deleting');
        }

        if (!targetNotebook && currentUser?.last_active_notebook_id) {
          targetNotebook = userNotebooks.find((nb) => nb.id === currentUser.last_active_notebook_id && nb.status !== 'deleting');
        }

        if (!targetNotebook) {
          targetNotebook = userNotebooks.find((nb) => nb.status !== 'deleting') || userNotebooks[0];
        }

        const resolvedNotebookId = targetNotebook.id;
        setActiveNotebookId(resolvedNotebookId);
        safeStorage.setItem(NOTEBOOK_KEY, resolvedNotebookId);

        // D. Fetch Sources for the Resolved Notebook
        const sources = await apiClient.getSources(resolvedNotebookId);
        if (isCancelled) return;

        const readySources = sources.filter(
          (s) => s.status !== 'deleting' && s.status !== 'error'
        );

        // E. Resolve Target Source
        const currentActiveSrcId = useWorkspaceStore.getState().activeSourceId;
        const cachedSourceId = safeStorage.getItem(SOURCE_KEY) || currentActiveSrcId;
        let targetSource = readySources.find((s) => s.id === cachedSourceId);

        if (!targetSource && readySources.length > 0) {
          targetSource = readySources[0];
        }

        const resolvedSourceId = targetSource ? targetSource.id : null;
        if (resolvedSourceId) {
          setActiveSourceId(resolvedSourceId);
          safeStorage.setItem(SOURCE_KEY, resolvedSourceId);
        } else {
          setActiveSourceId(null);
          safeStorage.removeItem(SOURCE_KEY);
        }

        if (!isCancelled) {
          hasResumedRef.current = true;
          setState({
            isResuming: false,
            isResumed: true,
            resumedNotebookId: resolvedNotebookId,
            resumedSourceId: resolvedSourceId,
            error: null,
            notebooks: userNotebooks,
          });
        }
      } catch (err: unknown) {
        if (!isCancelled) {
          setState({
            isResuming: false,
            isResumed: false,
            resumedNotebookId: null,
            resumedSourceId: null,
            error: err instanceof Error ? err.message : 'Session resume failed',
            notebooks: [],
          });
        }
      }
    }

    resumeSession();

    return () => {
      isCancelled = true;
    };
  }, [token, isAuthenticated, setUser, setActiveNotebookId, setActiveSourceId]);

  // 2. Persist activeSourceId on user selection
  useEffect(() => {
    if (activeSourceId) {
      safeStorage.setItem(SOURCE_KEY, activeSourceId);
    }
  }, [activeSourceId]);

  return state;
}
