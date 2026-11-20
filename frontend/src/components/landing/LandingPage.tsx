'use client';

import React from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import { LandingNavbar } from './LandingNavbar';
import { HeroSection } from './HeroSection';
import { HowItWorksSection } from './HowItWorksSection';
import { FeaturesGridSection } from './FeaturesGridSection';
import { UseCasesSection } from './UseCasesSection';
import { ConnectIdeasSection } from './ConnectIdeasSection';
import { FaqSection } from './FaqSection';
import { CtaBannerSection } from './CtaBannerSection';
import { LandingFooter } from './LandingFooter';

export interface LandingPageProps {
  isAuthenticated?: boolean;
  userEmail?: string | null;
  onSignInClick?: () => void;
  onOpenWorkspace?: () => void;
  onGetStarted?: () => void;
  onExploreDemo?: () => void;
  showAuthBanner?: boolean;
}

export function LandingPage({
  isAuthenticated = false,
  userEmail,
  onSignInClick,
  onOpenWorkspace,
  onGetStarted,
  onExploreDemo,
  showAuthBanner,
}: LandingPageProps) {
  const displayAuthBanner = showAuthBanner ?? isAuthenticated;
  const effectiveUserEmail = userEmail || 'Alex Student';
  const { logout } = useAuthStore();
  const effectiveSignInClick =
    onSignInClick || (() => useWorkspaceStore.getState().setSignInModalOpen(true));


  return (
    <div
      data-testid="landing-page"
      className="min-h-screen bg-[#191C23] text-[#F3F4F6] flex flex-col selection:bg-[#8B83FF]/30 selection:text-[#F3F4F6]"
    >
      {/* Authenticated Top Banner */}
      {displayAuthBanner && (
        <aside
          role="banner"
          aria-label="Authenticated Session Notice"
          data-testid="authenticated-user-banner"
          className="w-full bg-[#242238] border-b border-[#30343E] px-4 py-2.5 text-center text-xs text-[#A1A6B3] flex items-center justify-center gap-2 z-50"
        >
          <div data-testid="auth-return-banner" className="flex items-center gap-2 flex-wrap justify-center">
            <span>
              You are signed in as{' '}
              <strong className="text-[#F3F4F6] font-medium truncate max-w-[240px] inline-block align-bottom">
                {effectiveUserEmail}
              </strong>
              .
            </span>
            <button
              type="button"
              data-testid="return-to-workspace-btn"
              onClick={onOpenWorkspace}
              className="text-[#8B83FF] hover:text-[#7A72F0] font-semibold underline underline-offset-2 cursor-pointer transition-colors"
            >
              Return to Workspace →
            </button>
            <span className="text-[#64748B]">•</span>
            <button
              type="button"
              data-testid="banner-logout-btn"
              onClick={logout}
              className="text-[#EF4444] hover:text-[#DC2626] font-medium underline underline-offset-2 cursor-pointer transition-colors"
            >
              Sign out
            </button>
          </div>
        </aside>
      )}

      {/* Navigation Header */}
      <LandingNavbar
        isAuthenticated={isAuthenticated}
        userEmail={userEmail}
        onSignInClick={effectiveSignInClick}
        onOpenWorkspace={onOpenWorkspace}
        onGetStarted={onGetStarted}
      />

      {/* Main Content: 7 Sections */}
      <main className="flex-1">
        <HeroSection
          onGetStarted={onGetStarted || effectiveSignInClick}
          onExploreDemo={onExploreDemo}
        />
        <HowItWorksSection />
        <FeaturesGridSection />
        <UseCasesSection />
        <ConnectIdeasSection />
        <FaqSection />
        <CtaBannerSection onGetStarted={onGetStarted || effectiveSignInClick} />
      </main>

      {/* Footer */}
      <LandingFooter />
    </div>
  );
}
