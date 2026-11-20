'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { X, Sparkles } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export interface SignInModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
  onGoogleSignIn?: () => void;
  onDemoSignInSuccess?: () => void;
}

export function SignInModal({
  isOpen,
  onClose,
  onSuccess,
  onGoogleSignIn,
  onDemoSignInSuccess,
}: SignInModalProps) {
  const storeIsOpen = useWorkspaceStore((s) => s.isSignInModalOpen);
  const setStoreIsOpen = useWorkspaceStore((s) => s.setSignInModalOpen);
  const setOnboardingOpen = useWorkspaceStore((s) => s.setOnboardingOpen);
  const { login } = useAuthStore();

  const isModalOpen = isOpen !== undefined ? isOpen : storeIsOpen;
  const modalContentRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      setStoreIsOpen(false);
    }
  }, [onClose, setStoreIsOpen]);

  // Focus management: autofocus close button on mount/open
  useEffect(() => {
    if (isModalOpen) {
      closeBtnRef.current?.focus();
    }
  }, [isModalOpen]);

  // Keyboard navigation & focus trapping
  useEffect(() => {
    if (!isModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === 'Tab' && modalContentRef.current) {
        const focusableElements = modalContentRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !modalContentRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !modalContentRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, handleClose]);

  if (!isModalOpen) return null;

  const handleGoogleClick = () => {
    if (onGoogleSignIn) {
      onGoogleSignIn();
      return;
    }
    if (typeof window !== 'undefined' && window.location) {
      if (typeof window.location.assign === 'function') {
        window.location.assign('/api/v1/auth/google/login');
      }
      try {
        window.location.href = '/api/v1/auth/google/login';
      } catch {}
    }
  };

  const handleDemoSignIn = () => {
    login({
      id: 'usr-default-001',
      email: 'student@university.edu',
      name: 'Alex Student',
      token: 'mock-jwt-token-alex-dev',
    });
    handleClose();
    setOnboardingOpen(true);
    onDemoSignInSuccess?.();
    onSuccess?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-modal-title"
      aria-describedby="signin-modal-description"
      data-testid="signin-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop Blur Overlay */}
      <div
        data-testid="signin-modal-backdrop"
        className="fixed inset-0 bg-[#111318]/90 backdrop-blur-md cursor-pointer transition-opacity"
        onClick={handleClose}
      />

      {/* Modal Dialog Content */}
      <div
        ref={modalContentRef}
        data-testid="signin-modal-content"
        className="relative z-10 w-full max-w-md rounded-3xl border border-[#30343E] bg-[#111318] p-8 shadow-2xl animate-in fade-in zoom-in-95 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          ref={closeBtnRef}
          type="button"
          data-testid="signin-modal-close-btn"
          aria-label="Close dialog"
          onClick={handleClose}
          className="absolute right-6 top-6 p-1.5 rounded-full text-[#A1A6B3] hover:text-[#F3F4F6] hover:bg-[#242238] transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Brand Indicator */}
        <div className="flex items-center gap-2.5 mb-6">
          <span className="w-2.5 h-2.5 rounded-full bg-[#8B83FF] shadow-[0_0_8px_#8B83FF]" />
          <span className="text-sm font-semibold tracking-wide text-[#F3F4F6] uppercase">StudyLM</span>
        </div>

        {/* Title & Description */}
        <div className="mb-6">
          <h2 id="signin-modal-title" className="text-2xl font-bold tracking-tight text-[#F3F4F6]">
            Sign In to StudyLM
          </h2>
          <p id="signin-modal-description" className="mt-2 text-sm text-[#A1A6B3]">
            Continue to your grounded study workspace with verified citations.
          </p>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          {/* Continue with Google */}
          <button
            type="button"
            data-testid="google-signin-btn"
            onClick={handleGoogleClick}
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 rounded-xl border border-[#30343E] bg-[#191C23] hover:bg-[#242238] hover:border-[#8B83FF]/40 text-[#F3F4F6] font-medium transition-colors shadow-sm cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          {/* Divider */}
          <div className="relative my-4 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#30343E]" />
            </div>
            <span className="relative bg-[#111318] px-3 text-xs uppercase tracking-wider text-[#737B8C]">
              or
            </span>
          </div>

          {/* Quick Dev / Demo Sign-In */}
          <div>
            <button
              type="button"
              data-testid="dev-demo-signin-btn"
              onClick={handleDemoSignIn}
              className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors shadow-md shadow-[#8B83FF]/20 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-[#191C23]" />
              <span>Quick Dev / Demo Sign-In</span>
            </button>
            <p className="mt-2 text-center text-xs text-[#737B8C]">
              1-click test session as Alex Student (student@university.edu)
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
