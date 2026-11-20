'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Menu, X, ArrowUpRight, LogOut, ChevronDown, LayoutDashboard } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

export interface LandingNavbarProps {
  isAuthenticated?: boolean;
  userEmail?: string | null;
  onSignInClick?: () => void;
  onOpenWorkspace?: () => void;
  onGetStarted?: () => void;
}

export function LandingNavbar({
  isAuthenticated = false,
  userEmail,
  onSignInClick,
  onOpenWorkspace,
  onGetStarted,
}: LandingNavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  const { user, logout } = useAuthStore();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    }
    if (isAccountMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isAccountMenuOpen]);

  const navLinks = [
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Features', href: '#features' },
    { label: 'Use Cases', href: '#use-cases' },
    { label: 'FAQ', href: '#faq' },
  ];

  const displayName = user?.name || userEmail || 'Account';
  const displayEmail = user?.email || userEmail || '';
  const initial = (user?.name?.charAt(0) || userEmail?.charAt(0) || 'U').toUpperCase();

  return (
    <header
      role="banner"
      data-testid="landing-navbar"
      className="sticky top-0 z-50 w-full backdrop-blur-md bg-[#191C23]/80 border-b border-[#30343E] transition-colors"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <a
          href="#"
          className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-[#F3F4F6] hover:opacity-90 transition-opacity"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-[#8B83FF] shadow-[0_0_8px_#8B83FF] animate-pulse" />
          <span>StudyLM</span>
        </a>

        {/* Desktop Nav Links */}
        <nav className="hidden md:flex items-center gap-8" aria-label="Main Navigation">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-[#A1A6B3] hover:text-[#F3F4F6] transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop Action Buttons */}
        <div className="hidden md:flex items-center gap-3">
          {isAuthenticated ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="navbar-workspace-btn"
                onClick={onOpenWorkspace}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors shadow-sm cursor-pointer"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span>Open Workspace</span>
              </button>

              {/* Manage Account Dropdown Menu */}
              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  data-testid="navbar-account-btn"
                  aria-label="Manage Account"
                  aria-expanded={isAccountMenuOpen}
                  onClick={() => setIsAccountMenuOpen((prev) => !prev)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#30343E] bg-[#242238]/60 hover:bg-[#242238] hover:border-[#8B83FF]/40 text-[#F3F4F6] transition-all cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#8B83FF] to-[#D0BCFF] text-[#191C23] flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden shadow-inner">
                    {user?.avatar_url && !avatarError ? (
                      <img
                        src={user.avatar_url}
                        alt={displayName}
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarError(true)}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      initial
                    )}
                  </div>
                  <span className="text-xs font-medium max-w-[120px] truncate">
                    {displayName}
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[#A1A6B3] transition-transform ${
                      isAccountMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {/* Floating Account Card */}
                {isAccountMenuOpen && (
                  <div
                    data-testid="navbar-account-dropdown"
                    className="absolute right-0 mt-2 w-64 rounded-2xl bg-[#1E212A] border border-[#30343E] shadow-2xl p-3 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                  >
                    <div className="flex items-center gap-3 p-2 border-b border-[#30343E] pb-3 mb-2">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#8B83FF] to-[#D0BCFF] text-[#191C23] flex items-center justify-center font-bold text-sm shrink-0 overflow-hidden shadow-inner">
                        {user?.avatar_url && !avatarError ? (
                          <img
                            src={user.avatar_url}
                            alt={displayName}
                            referrerPolicy="no-referrer"
                            onError={() => setAvatarError(true)}
                            className="w-full h-full rounded-full object-cover"
                          />
                        ) : (
                          initial
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-[#F3F4F6] truncate">
                          {displayName}
                        </div>
                        {displayEmail && (
                          <div
                            className="text-xs text-[#A1A6B3] truncate"
                            title={displayEmail}
                          >
                            {displayEmail}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <button
                        type="button"
                        data-testid="account-dropdown-workspace-btn"
                        onClick={() => {
                          setIsAccountMenuOpen(false);
                          onOpenWorkspace?.();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-[#F3F4F6] hover:bg-[#2A2E39] transition-colors cursor-pointer text-left"
                      >
                        <LayoutDashboard className="w-4 h-4 text-[#8B83FF]" />
                        <span>Go to Workspace</span>
                      </button>

                      <button
                        type="button"
                        data-testid="account-dropdown-logout-btn"
                        onClick={() => {
                          setIsAccountMenuOpen(false);
                          logout();
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors cursor-pointer text-left"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                data-testid="navbar-signin-btn"
                onClick={onSignInClick}
                className="text-sm font-medium text-[#A1A6B3] hover:text-[#F3F4F6] transition-colors px-3 py-2 cursor-pointer"
              >
                Sign In
              </button>
              <button
                type="button"
                data-testid="navbar-get-started-btn"
                onClick={onGetStarted || onSignInClick}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors shadow-sm cursor-pointer"
              >
                <span>Get Started</span>
                <ArrowUpRight className="w-4 h-4" />
              </button>
            </>
          )}
        </div>

        {/* Mobile Menu Button */}
        <div className="flex md:hidden">
          <button
            type="button"
            data-testid="navbar-mobile-toggle"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="p-2 rounded-lg text-[#A1A6B3] hover:text-[#F3F4F6] hover:bg-[#242238] transition-colors"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#30343E] bg-[#111318] px-4 pt-3 pb-6 space-y-4">
          <div className="flex flex-col space-y-3">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="text-base text-[#A1A6B3] hover:text-[#F3F4F6] py-1 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="pt-4 border-t border-[#30343E] flex flex-col gap-3">
            {isAuthenticated ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1E212A] border border-[#30343E]">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#8B83FF] to-[#D0BCFF] text-[#191C23] flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden shadow-inner">
                    {user?.avatar_url && !avatarError ? (
                      <img
                        src={user.avatar_url}
                        alt={displayName}
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarError(true)}
                        className="w-full h-full rounded-full object-cover"
                      />
                    ) : (
                      initial
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#F3F4F6] truncate">
                      {displayName}
                    </div>
                    {displayEmail && (
                      <div className="text-xs text-[#A1A6B3] truncate">
                        {displayEmail}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="navbar-mobile-workspace-btn"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onOpenWorkspace?.();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors cursor-pointer"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span>Open Workspace</span>
                </button>

                <button
                  type="button"
                  data-testid="navbar-mobile-logout-btn"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  data-testid="navbar-mobile-signin-btn"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onSignInClick?.();
                  }}
                  className="w-full text-center px-4 py-2.5 rounded-xl text-sm font-medium border border-[#30343E] text-[#F3F4F6] hover:bg-[#242238] transition-colors"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  data-testid="navbar-mobile-get-started-btn"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    (onGetStarted || onSignInClick)?.();
                  }}
                  className="w-full text-center px-4 py-2.5 rounded-xl text-sm font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors"
                >
                  Get Started →
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
