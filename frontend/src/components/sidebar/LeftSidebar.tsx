'use client';

import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { NotebookSelector } from './NotebookSelector';
import { NotebookModal } from './NotebookModal';
import { SourceList } from './SourceList';
import { LogOut, Loader2, Sparkles, Plus, Home } from 'lucide-react';

export interface LeftSidebarProps {
  className?: string;
}

export function LeftSidebar({ className = '' }: LeftSidebarProps) {
  const { activeNotebookId, setActiveNotebookId, setCurrentView } = useWorkspaceStore();
  const { user, isAuthenticated, isLoading, loginWithGoogle, logout } = useAuthStore();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  useEffect(() => {
    setAvatarError(false);
  }, [user?.avatar_url]);

  const handleDevLogin = async () => {
    await loginWithGoogle('mock_google_token_dev-123_student@studylm.ai_Alex Student');
  };

  return (
    <div
      className={`flex h-full w-full flex-col divide-y divide-border bg-card ${className}`}
      data-testid="left-sidebar"
    >
      {/* Top Header: StudyLM Logo Button & Notebook Selector */}
      <div className="p-3 flex flex-col gap-3 shrink-0" data-testid="sidebar-header">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setCurrentView('landing');
              if (typeof window !== 'undefined') {
                window.history.pushState({}, '', '/?view=landing');
              }
            }}
            data-testid="sidebar-logo-btn"
            className="flex items-center gap-2 text-sm font-bold text-foreground hover:opacity-80 transition-opacity cursor-pointer group"
            title="Return to Homepage"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#8B83FF] shadow-[0_0_8px_#8B83FF] group-hover:scale-110 transition-transform" />
            <span>StudyLM</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCurrentView('landing');
              if (typeof window !== 'undefined') {
                window.history.pushState({}, '', '/?view=landing');
              }
            }}
            data-testid="sidebar-home-btn"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer border border-border/50 shadow-sm"
            title="Return to Homepage"
            aria-label="Return to Homepage"
          >
            <Home className="w-3.5 h-3.5 text-[#8B83FF]" />
            <span>Home</span>
          </button>
        </div>
        <NotebookSelector />
      </div>

      {/* Middle Scrollable Sources Area */}
      <div className="flex-1 overflow-hidden">
        {activeNotebookId ? (
          <SourceList key={activeNotebookId} notebookId={activeNotebookId} className="h-full" />
        ) : (
          <div
            className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground"
            data-testid="no-active-notebook-notice"
          >
            {isAuthenticated
              ? 'Select or create a notebook to manage sources.'
              : 'Sign in to access and manage your notebooks.'}
          </div>
        )}
      </div>

      {/* Fixed Bottom Bar: Prominent Lavender [＋ Create Notebook] */}
      <div className="p-3 border-t border-border bg-card shrink-0" data-testid="sidebar-bottom-bar">
        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          data-testid="sidebar-create-notebook-btn"
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#8B83FF] hover:bg-[#7A72F0] text-[#111318] font-semibold text-xs tracking-wide shadow-md transition-all cursor-pointer hover:shadow-lg active:scale-[0.99]"
        >
          <Plus className="w-4 h-4 text-[#111318] stroke-[2.5]" />
          <span>Create Notebook</span>
        </button>
      </div>

      {/* Notebook Creation Modal */}
      <NotebookModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(newNb) => {
          setActiveNotebookId(newNb.id);
          setIsCreateModalOpen(false);
        }}
      />

      {/* User / Authentication Bar */}
      <div className="p-3 bg-muted/20 border-t border-border flex items-center justify-between text-xs shrink-0">
        {isAuthenticated && user ? (
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 overflow-hidden mr-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#8B83FF] to-[#D0BCFF] text-[#191C23] flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden shadow-inner">
                {user.avatar_url && !avatarError ? (
                  <img
                    src={user.avatar_url}
                    alt={user.name}
                    referrerPolicy="no-referrer"
                    onError={() => setAvatarError(true)}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  user.name.charAt(0).toUpperCase()
                )}
              </div>
              <div className="truncate">
                <div className="font-medium text-foreground truncate">{user.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{user.email}</div>
              </div>
            </div>
            <button
              onClick={logout}
              title="Sign Out"
              aria-label="Sign Out"
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={handleDevLogin}
            disabled={isLoading}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Sign In as Dev User
          </button>
        )}
      </div>
    </div>
  );
}

// Alias for compatibility
export const SidebarContainer = LeftSidebar;
