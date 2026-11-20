'use client';

import React, { useState, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { Menu, MessageSquare, X } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useSessionResume } from '@/hooks/useSessionResume';
import { LeftSidebar } from '@/components/sidebar/LeftSidebar';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { ViewerContainer } from '@/components/viewer/ViewerContainer';
import { UnifiedInspectorPane } from '@/components/viewer/UnifiedInspectorPane';
import { MobileBottomNav, MobileTab } from './MobileBottomNav';

export interface LeftSidebarSlotProps {
  children?: React.ReactNode;
  isCollapsed?: boolean;
}

export function LeftSidebarSlot({ children, isCollapsed }: LeftSidebarSlotProps) {
  return (
    <aside
      role="region"
      aria-label="Notebooks and Sources Sidebar"
      data-testid="left-sidebar-slot"
      className={`h-full border-r border-border bg-card transition-all overflow-hidden flex flex-col ${
        isCollapsed ? 'w-12 items-center' : 'w-full'
      }`}
    >
      {children ?? <LeftSidebar />}
    </aside>
  );
}

export interface CenterViewerSlotProps {
  children?: React.ReactNode;
  isCollapsed?: boolean;
}

export function CenterViewerSlot({ children, isCollapsed }: CenterViewerSlotProps) {
  return (
    <main
      role="main"
      aria-label="Document and Media Viewer"
      data-testid="center-viewer-slot"
      className={`h-full flex-1 bg-background overflow-hidden flex flex-col ${
        isCollapsed ? 'hidden' : 'w-full'
      }`}
    >
      {children ?? <UnifiedInspectorPane />}
    </main>
  );
}

export interface RightChatSlotProps {
  children?: React.ReactNode;
  isCollapsed?: boolean;
}

export function RightChatSlot({ children, isCollapsed }: RightChatSlotProps) {
  return (
    <aside
      role="region"
      aria-label="Grounded Conversational Chat"
      data-testid="right-chat-slot"
      className={`h-full border-l border-border bg-card transition-all overflow-hidden flex flex-col ${
        isCollapsed ? 'hidden' : 'w-full'
      }`}
    >
      {children ?? <ChatContainer />}
    </aside>
  );
}

export interface WorkspaceShellProps {
  leftSidebar?: React.ReactNode;
  centerViewer?: React.ReactNode;
  rightChat?: React.ReactNode;
}

export function WorkspaceShell({ leftSidebar, centerViewer, rightChat }: WorkspaceShellProps) {
  const {
    leftPanelCollapsed,
    rightPanelCollapsed,
    leftPanelSize,
    rightPanelSize,
    setPanelSizes,
    activeFocusTarget,
  } = useWorkspaceStore();

  const [isMobile, setIsMobile] = useState<boolean>(false);
  const [mobileDrawer, setMobileDrawer] = useState<'none' | 'left' | 'right'>('none');
  const [mobileTab, setMobileTab] = useState<MobileTab>('inspector');

  // Automatic Session Resumption
  useSessionResume();

  // Global Keyboard Shortcuts (Cmd/Ctrl+B, Cmd/Ctrl+J, Cmd/Ctrl+K with input shielding)
  useKeyboardShortcuts();

  // 1. Mobile Responsiveness Detection (< 768px)
  useEffect(() => {
    const checkMobile = () => {
      if (typeof window !== 'undefined') {
        setIsMobile(window.innerWidth < 768);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 2. Smart Jump: Auto-switch mobileTab to inspector & auto-dismiss drawers on citation focus
  useEffect(() => {
    if (isMobile && activeFocusTarget) {
      setMobileTab('inspector');
      setMobileDrawer('none');
    }
  }, [isMobile, activeFocusTarget]);

  // 3. Close mobile drawer on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobile && mobileDrawer !== 'none') {
        setMobileDrawer('none');
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isMobile, mobileDrawer]);

  // Mobile Layout View with Slide-Over Drawers & Bottom Navigation
  if (isMobile) {
    return (
      <div
        data-testid="workspace-mobile-layout"
        className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground pb-14"
      >
        {/* Mobile Header Bar */}
        <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0">
          <button
            type="button"
            data-testid="mobile-toggle-left"
            aria-label="Toggle Sources Drawer"
            onClick={() => setMobileDrawer((prev) => (prev === 'left' ? 'none' : 'left'))}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>

          <span className="text-xs font-semibold tracking-tight">StudyLM Workspace</span>

          <button
            type="button"
            data-testid="mobile-toggle-right"
            aria-label="Toggle Chat Drawer"
            onClick={() => setMobileDrawer((prev) => (prev === 'right' ? 'none' : 'right'))}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
          >
            <MessageSquare className="w-5 h-5" />
          </button>
        </header>

        {/* Primary Mobile Surface: Dynamically routes via mobileTab */}
        <div className="flex-1 overflow-hidden relative">
          {mobileTab === 'sources' && (
            <div data-testid="mobile-surface-sources" className="h-full w-full overflow-hidden">
              <LeftSidebarSlot isCollapsed={false}>{leftSidebar}</LeftSidebarSlot>
            </div>
          )}

          {mobileTab === 'chat' && (
            <div data-testid="mobile-surface-chat" className="h-full w-full overflow-hidden">
              <RightChatSlot isCollapsed={false}>{rightChat}</RightChatSlot>
            </div>
          )}

          {mobileTab === 'inspector' && (
            <div data-testid="mobile-surface-inspector" className="h-full w-full overflow-hidden">
              <CenterViewerSlot>{centerViewer}</CenterViewerSlot>
            </div>
          )}

          {/* Mobile Left Drawer Slide-Over */}
          {mobileDrawer === 'left' && (
            <div
              data-testid="mobile-left-drawer"
              className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex"
            >
              <div className="w-4/5 max-w-xs h-full bg-card shadow-2xl flex flex-col border-r border-border">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold">Sources</span>
                  <button
                    type="button"
                    onClick={() => setMobileDrawer('none')}
                    className="p-1 rounded hover:bg-muted"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <LeftSidebarSlot isCollapsed={false}>{leftSidebar}</LeftSidebarSlot>
                </div>
              </div>
              <div
                className="flex-1"
                onClick={() => setMobileDrawer('none')}
                aria-hidden="true"
              />
            </div>
          )}

          {/* Mobile Right Chat Drawer Slide-Over */}
          {mobileDrawer === 'right' && (
            <div
              data-testid="mobile-right-drawer"
              className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex justify-end"
            >
              <div
                className="flex-1"
                onClick={() => setMobileDrawer('none')}
                aria-hidden="true"
              />
              <div className="w-4/5 max-w-sm h-full bg-card shadow-2xl flex flex-col border-l border-border">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <span className="text-xs font-semibold">Grounded Chat</span>
                  <button
                    type="button"
                    onClick={() => setMobileDrawer('none')}
                    className="p-1 rounded hover:bg-muted"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <RightChatSlot isCollapsed={false}>{rightChat}</RightChatSlot>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Material 3 Bottom Navigation Bar */}
        <MobileBottomNav activeTab={mobileTab} onTabChange={setMobileTab} />
      </div>
    );
  }

  // Desktop Responsive 3-Pane Layout with Resizable Panels
  return (
    <div
      data-testid="workspace-desktop-layout"
      className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground"
    >
      <div className="flex-1 overflow-hidden">
        <PanelGroup
          direction="horizontal"
          autoSaveId="studylm-workspace-panels-v4"
          onLayout={(sizes) => {
            if (sizes.length === 3) {
              setPanelSizes(sizes[0], sizes[2]);
            }
          }}
        >
          {/* Left Sidebar Pane */}
          <Panel
            id="left-sidebar"
            defaultSize={20}
            minSize={15}
            maxSize={35}
            collapsible
          >
            <LeftSidebarSlot isCollapsed={leftPanelCollapsed}>
              {leftSidebar}
            </LeftSidebarSlot>
          </Panel>

          <PanelResizeHandle
            data-testid="resize-handle-left"
            className="w-1.5 bg-border hover:bg-primary/50 transition-colors cursor-col-resize"
          />

          {/* Center Chat Pane */}
          <Panel id="center-chat" defaultSize={50} minSize={30}>
            <RightChatSlot isCollapsed={false}>
              {rightChat}
            </RightChatSlot>
          </Panel>

          <PanelResizeHandle
            data-testid="resize-handle-right"
            className="w-1.5 bg-border hover:bg-primary/50 transition-colors cursor-col-resize"
          />

          {/* Right Citations & Viewer Inspector Pane */}
          <Panel
            id="right-viewer"
            defaultSize={30}
            minSize={25}
            maxSize={50}
            collapsible
          >
            <CenterViewerSlot isCollapsed={rightPanelCollapsed}>
              {centerViewer}
            </CenterViewerSlot>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
