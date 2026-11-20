import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { MobileBottomNav, MobileTab } from '@/components/layout/MobileBottomNav';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { mockUser, mockSources } from '../mocks/fixtures';

describe('Phase 5: Mobile Bottom Navigation Bar (<768px) & Smart Jump Engine', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().reset();
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', mockUser);
    useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 100 }),
    });
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('test_mobile_bottom_nav_component_renders_and_switches_tabs', () => {
    let currentTab: MobileTab = 'sources';
    const handleTabChange = vi.fn((tab: MobileTab) => {
      currentTab = tab;
    });

    const { rerender } = render(
      <MobileBottomNav activeTab={currentTab} onTabChange={handleTabChange} />
    );

    expect(screen.getByTestId('mobile-bottom-nav')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-sources')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('mobile-tab-chat')).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByTestId('mobile-tab-inspector')).toHaveAttribute('aria-selected', 'false');

    // Click Chat tab
    fireEvent.click(screen.getByTestId('mobile-tab-chat'));
    expect(handleTabChange).toHaveBeenCalledWith('chat');

    rerender(<MobileBottomNav activeTab="chat" onTabChange={handleTabChange} />);
    expect(screen.getByTestId('mobile-tab-chat')).toHaveAttribute('aria-selected', 'true');

    // Click Inspector tab
    fireEvent.click(screen.getByTestId('mobile-tab-inspector'));
    expect(handleTabChange).toHaveBeenCalledWith('inspector');
  });

  it('test_mobile_bottom_nav_renders_on_mobile_viewport', () => {
    window.innerWidth = 500;
    render(<WorkspaceShell />);

    expect(screen.getByTestId('workspace-mobile-layout')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-bottom-nav')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-sources')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-chat')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-inspector')).toBeInTheDocument();
  });

  it('test_mobile_tab_switching_dynamically_routes_surface', () => {
    window.innerWidth = 500;
    render(<WorkspaceShell />);

    // Default mobile surface is Inspector
    expect(screen.getByTestId('mobile-surface-inspector')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-surface-sources')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-surface-chat')).not.toBeInTheDocument();

    // Switch to Sources
    fireEvent.click(screen.getByTestId('mobile-tab-sources'));
    expect(screen.getByTestId('mobile-surface-sources')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-surface-inspector')).not.toBeInTheDocument();

    // Switch to Chat
    fireEvent.click(screen.getByTestId('mobile-tab-chat'));
    expect(screen.getByTestId('mobile-surface-chat')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-surface-sources')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-surface-inspector')).not.toBeInTheDocument();

    // Switch back to Inspector
    fireEvent.click(screen.getByTestId('mobile-tab-inspector'));
    expect(screen.getByTestId('mobile-surface-inspector')).toBeInTheDocument();
  });

  it('test_smart_jump_on_citation_focus_automatically_switches_tab_to_inspector', () => {
    window.innerWidth = 500;
    render(<WorkspaceShell />);

    // User is on the Chat tab
    fireEvent.click(screen.getByTestId('mobile-tab-chat'));
    expect(screen.getByTestId('mobile-surface-chat')).toBeInTheDocument();

    // User taps a citation pill in chat (dispatches focus target into workspaceStore)
    act(() => {
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: mockSources[0].id,
        pageNumber: 12,
        bboxes: [[0.1, 0.2, 0.8, 0.4]],
      });
    });

    // Smart Jump must immediately switch the active mobile tab to Inspector
    expect(screen.getByTestId('mobile-surface-inspector')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-surface-chat')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-inspector')).toHaveAttribute('aria-selected', 'true');
  });

  it('test_smart_jump_dismisses_any_open_mobile_drawer', () => {
    window.innerWidth = 500;
    render(<WorkspaceShell />);

    // User opens the left drawer
    fireEvent.click(screen.getByTestId('mobile-toggle-left'));
    expect(screen.getByTestId('mobile-left-drawer')).toBeInTheDocument();

    // Citation focus arrives
    act(() => {
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: mockSources[0].id,
        pageNumber: 3,
        bboxes: [[0.2, 0.3, 0.7, 0.5]],
      });
    });

    // Drawer is automatically dismissed and Inspector surface is displayed
    expect(screen.queryByTestId('mobile-left-drawer')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-surface-inspector')).toBeInTheDocument();
  });

  it('test_desktop_viewport_hides_mobile_layout', () => {
    window.innerWidth = 1200;
    render(<WorkspaceShell />);

    expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-mobile-layout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-bottom-nav')).not.toBeInTheDocument();
  });
});
