'use client';

import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { LandingPage } from '@/components/landing/LandingPage';
import { SignInModal } from '@/components/auth/SignInModal';
import { LoginOnboardingModal } from '@/components/onboarding/LoginOnboardingModal';

export default function Home() {
  const [isMounted, setIsMounted] = useState(false);
  const { isAuthenticated, user, setSession } = useAuthStore();
  const {
    isSignInModalOpen,
    setSignInModalOpen,
    isOnboardingOpen,
    setOnboardingOpen,
    currentView,
    setCurrentView,
  } = useWorkspaceStore();

  useEffect(() => {
    setIsMounted(true);

    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      const userId = params.get('user_id');
      const email = params.get('email');
      const name = params.get('name');
      const avatar = params.get('avatar');
      const viewParam = params.get('view');

      if (token) {
        setSession(token, {
          id: userId || 'google-user',
          email: email || 'user@studylm.ai',
          name: name || 'Google User',
          avatar_url: avatar || undefined,
          is_active: true,
          created_at: new Date().toISOString(),
        });
        setCurrentView('workspace');
        window.history.replaceState({}, '', window.location.pathname);
      } else if (viewParam === 'landing' || viewParam === 'home') {
        setCurrentView('landing');
      } else if (viewParam === 'workspace') {
        setCurrentView('workspace');
      }

      const handlePopState = () => {
        const currentParams = new URLSearchParams(window.location.search);
        const v = currentParams.get('view');
        if (v === 'landing' || v === 'home') {
          setCurrentView('landing');
        } else if (v === 'workspace') {
          setCurrentView('workspace');
        }
      };

      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }
  }, [setSession, setCurrentView]);

  // Respect currentView selection; if explicitly 'landing', always show landing page regardless of auth status
  const isLandingView =
    !isMounted ||
    currentView === 'landing' ||
    (!isAuthenticated && currentView !== 'workspace');

  const handleOpenWorkspace = () => {
    setCurrentView('workspace');
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
    }
  };

  const handleSignInClick = () => {
    setSignInModalOpen(true);
  };

  const handleGetStarted = () => {
    if (!isAuthenticated) {
      setSession('demo-jwt-token-alex-student', {
        id: 'usr-default-001',
        email: 'student@university.edu',
        name: 'Alex Student',
        avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=face',
        is_active: true,
        created_at: new Date().toISOString(),
      });
    }
    setCurrentView('workspace');
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
    }
  };

  return (
    <>
      {isLandingView ? (
        <LandingPage
          isAuthenticated={isMounted ? isAuthenticated : false}
          userEmail={isMounted ? user?.email : undefined}
          onOpenWorkspace={handleOpenWorkspace}
          onSignInClick={handleSignInClick}
          onGetStarted={handleGetStarted}
          onExploreDemo={handleOpenWorkspace}
        />
      ) : (
        <WorkspaceShell />
      )}

      {/* Phase 3 Auth & Onboarding Modals */}
      <SignInModal
        isOpen={isSignInModalOpen}
        onClose={() => setSignInModalOpen(false)}
        onDemoSignInSuccess={() => {
          setSignInModalOpen(false);
          setOnboardingOpen(true);
        }}
      />
      <LoginOnboardingModal
        isOpen={isOnboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onComplete={() => {
          setOnboardingOpen(false);
          setCurrentView('workspace');
          if (typeof window !== 'undefined') {
            window.history.pushState({}, '', '/');
          }
        }}
      />
    </>
  );
}
