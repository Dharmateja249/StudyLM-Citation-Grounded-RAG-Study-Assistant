import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';

describe('Phase 5: Composite 3-Pane Workspace Layout & Responsive Engine', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', {
      id: 'usr-default-001',
      email: 'student@university.edu',
      name: 'Alex Student',
      is_active: true,
      created_at: '2026-09-01T08:00:00Z',
    });
    useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');

    // Default desktop width
    window.innerWidth = 1200;
  });

  it('test_resizable_pane_drag_persists_widths', () => {
    render(<WorkspaceShell />);

    // Verify desktop layout mounts with all 3 slots
    expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();
    expect(screen.getByTestId('left-sidebar-slot')).toBeInTheDocument();
    expect(screen.getByTestId('center-viewer-slot')).toBeInTheDocument();
    expect(screen.getByTestId('right-chat-slot')).toBeInTheDocument();

    // Verify resize handle interaction and state updates
    act(() => {
      useWorkspaceStore.getState().setPanelSizes(25, 30);
    });

    const state = useWorkspaceStore.getState();
    expect(state.leftPanelSize).toBe(25);
    expect(state.rightPanelSize).toBe(30);
  });

  it('test_mobile_drawer_collapses_left_and_right_panes', () => {
    // Set screen width to mobile (< 768px)
    window.innerWidth = 500;

    render(<WorkspaceShell />);

    // Renders mobile layout header
    expect(screen.getByTestId('workspace-mobile-layout')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-toggle-left')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-toggle-right')).toBeInTheDocument();

    // Side panes are collapsed by default into drawers
    expect(screen.queryByTestId('mobile-left-drawer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-right-drawer')).not.toBeInTheDocument();

    // Toggle Left Drawer
    fireEvent.click(screen.getByTestId('mobile-toggle-left'));
    expect(screen.getByTestId('mobile-left-drawer')).toBeInTheDocument();

    // Toggle Right Drawer
    fireEvent.click(screen.getByTestId('mobile-toggle-right'));
    expect(screen.getByTestId('mobile-right-drawer')).toBeInTheDocument();
  });

  it('test_keyboard_shortcuts_panel_toggle', () => {
    render(<WorkspaceShell />);

    expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);
    expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);

    // Press Cmd+B (or Ctrl+B) to toggle left sidebar
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(true);

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);

    // Press Cmd+J (or Ctrl+J) to toggle right chat
    fireEvent.keyDown(window, { key: 'j', metaKey: true });
    expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(true);

    fireEvent.keyDown(window, { key: 'j', ctrlKey: true });
    expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);
  });

  it('test_keyboard_shortcut_cmd_k_focuses_notebook_switcher', () => {
    render(<WorkspaceShell />);

    const switcherBtn = screen.getByTestId('notebook-switcher-btn');
    expect(document.activeElement).not.toBe(switcherBtn);

    // Press Cmd+K
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(switcherBtn);
  });

  it('test_keyboard_shortcuts_input_focus_shielding', () => {
    render(<WorkspaceShell />);

    expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);

    // Create and focus an input element
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Pressing Ctrl+B while typing in input must NOT toggle left panel
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true });
    expect(useWorkspaceStore.getState().leftPanelCollapsed).toBe(false);

    // Pressing Ctrl+J while typing in input must NOT toggle right panel
    fireEvent.keyDown(input, { key: 'j', ctrlKey: true });
    expect(useWorkspaceStore.getState().rightPanelCollapsed).toBe(false);

    document.body.removeChild(input);
  });

  it('test_resizable_pane_drag_persists_in_localstorage', () => {
    render(<WorkspaceShell />);

    act(() => {
      useWorkspaceStore.getState().setPanelSizes(28, 32);
    });

    expect(useWorkspaceStore.getState().leftPanelSize).toBe(28);
    expect(useWorkspaceStore.getState().rightPanelSize).toBe(32);
    expect(localStorage.getItem('studylm_panel_sizes')).toBe(JSON.stringify({ left: 28, right: 32 }));
  });

  it('test_mobile_drawer_escape_key_dismissal', () => {
    window.innerWidth = 500;
    render(<WorkspaceShell />);

    // Open left drawer
    fireEvent.click(screen.getByTestId('mobile-toggle-left'));
    expect(screen.getByTestId('mobile-left-drawer')).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('mobile-left-drawer')).not.toBeInTheDocument();
  });

  it('test_mobile_drawer_auto_dismisses_on_citation_focus', () => {
    window.innerWidth = 500;
    render(<WorkspaceShell />);

    // Open right chat drawer
    fireEvent.click(screen.getByTestId('mobile-toggle-right'));
    expect(screen.getByTestId('mobile-right-drawer')).toBeInTheDocument();

    // Dispatch a citation focus target
    act(() => {
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-pdf-001',
        pageNumber: 42,
      });
    });

    // Chat drawer automatically dismisses so student can view target in viewer
    expect(screen.queryByTestId('mobile-right-drawer')).not.toBeInTheDocument();
  });
});
