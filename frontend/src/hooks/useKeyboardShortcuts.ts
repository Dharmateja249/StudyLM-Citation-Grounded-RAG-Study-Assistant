'use client';

/**
 * Global Keyboard Navigation Hook
 * File: frontend/src/hooks/useKeyboardShortcuts.ts
 *
 * Implements:
 * - Cmd/Ctrl+B: Toggle left sidebar
 * - Cmd/Ctrl+J: Toggle right chat/inspector
 * - Cmd/Ctrl+K: Focus notebook switcher / quick search
 * - Input focus shielding: ignores keystrokes originating from inputs, textareas, selects, and contenteditable elements
 * - Cross-platform modifier detection (Mac metaKey vs Win/Linux ctrlKey)
 */

import { useEffect, useCallback } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toUpperCase();
  if (tagName === 'INPUT') {
    const inputType = (target as HTMLInputElement).type?.toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(inputType);
  }
  if (tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }
  if (target.isContentEditable || target.getAttribute('role') === 'textbox') {
    return true;
  }
  return false;
}

export interface UseKeyboardShortcutsOptions {
  onOpenQuickSearch?: () => void;
}

export function useKeyboardShortcuts(options?: UseKeyboardShortcutsOptions) {
  const {
    leftPanelCollapsed,
    setLeftPanelCollapsed,
    toggleLeftPanel,
    toggleRightPanel,
  } = useWorkspaceStore();

  const handleFocusNotebookSwitcher = useCallback(() => {
    // If left panel is collapsed, uncollapse it first
    if (leftPanelCollapsed) {
      setLeftPanelCollapsed(false);
    }

    if (options?.onOpenQuickSearch) {
      options.onOpenQuickSearch();
      return;
    }

    // Focus notebook switcher button immediately
    const switcherBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="notebook-switcher-btn"]'
    );
    if (switcherBtn) {
      switcherBtn.focus();
      switcherBtn.click();
    }
  }, [leftPanelCollapsed, setLeftPanelCollapsed, options]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Must have Cmd (Mac) or Ctrl (Win/Linux) and not Alt
      const isCmdOrCtrl = (e.metaKey || e.ctrlKey) && !e.altKey;
      if (!isCmdOrCtrl) return;

      // Shield active input/textarea fields
      if (isInputElement(e.target)) {
        return;
      }

      const key = e.key.toLowerCase();

      if (key === 'b') {
        e.preventDefault();
        toggleLeftPanel();
      } else if (key === 'j') {
        e.preventDefault();
        toggleRightPanel();
      } else if (key === 'k') {
        e.preventDefault();
        handleFocusNotebookSwitcher();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleLeftPanel, toggleRightPanel, handleFocusNotebookSwitcher]);
}
