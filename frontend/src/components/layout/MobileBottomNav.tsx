'use client';

import React from 'react';
import { Folder, MessageSquare, Eye } from 'lucide-react';

export type MobileTab = 'sources' | 'chat' | 'inspector';

export interface MobileBottomNavProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  className?: string;
}

export function MobileBottomNav({
  activeTab,
  onTabChange,
  className = '',
}: MobileBottomNavProps) {
  const tabs: Array<{ id: MobileTab; label: string; icon: React.ElementType; testId: string }> = [
    {
      id: 'sources',
      label: 'Sources',
      icon: Folder,
      testId: 'mobile-tab-sources',
    },
    {
      id: 'chat',
      label: 'Chat',
      icon: MessageSquare,
      testId: 'mobile-tab-chat',
    },
    {
      id: 'inspector',
      label: 'Inspector',
      icon: Eye,
      testId: 'mobile-tab-inspector',
    },
  ];

  return (
    <nav
      role="tablist"
      aria-label="Mobile Navigation"
      data-testid="mobile-bottom-nav"
      className={`fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-border bg-[#111318]/95 backdrop-blur-md px-2 py-1.5 md:hidden ${className}`}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-testid={tab.testId}
            aria-selected={isActive}
            aria-label={tab.label}
            onClick={() => onTabChange(tab.id)}
            className={`flex flex-1 flex-col items-center justify-center gap-1 py-1 px-2 rounded-xl transition-all cursor-pointer ${
              isActive
                ? 'text-[#8B83FF] bg-[#8B83FF]/10 font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/30 font-medium'
            }`}
          >
            <Icon className={`w-4 h-4 transition-transform ${isActive ? 'scale-110' : ''}`} />
            <span className="text-[10px] tracking-tight">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
