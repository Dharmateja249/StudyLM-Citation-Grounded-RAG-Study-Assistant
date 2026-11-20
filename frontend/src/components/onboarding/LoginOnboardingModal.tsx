'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, BookOpen, Plus, ArrowRight, UploadCloud, Video, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { apiClient } from '@/lib/api/client';
import { NotebookRead } from '@/types/api';

export interface LoginOnboardingModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onComplete?: (notebookId?: string) => void;
  initialNotebooks?: NotebookRead[];
}

export function LoginOnboardingModal({
  isOpen,
  onClose,
  onComplete,
  initialNotebooks,
}: LoginOnboardingModalProps) {
  const storeIsOpen = useWorkspaceStore((s) => s.isOnboardingOpen);
  const setStoreIsOpen = useWorkspaceStore((s) => s.setOnboardingOpen);
  const setActiveNotebookId = useWorkspaceStore((s) => s.setActiveNotebookId);
  const { user } = useAuthStore();

  const isModalOpen = isOpen !== undefined ? isOpen : storeIsOpen;
  const modalContentRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const [notebooks, setNotebooks] = useState<NotebookRead[]>(initialNotebooks ?? []);
  const [isLoadingNotebooks, setIsLoadingNotebooks] = useState(false);
  const [step, setStep] = useState<'existing' | 'create_title' | 'upload_sources'>('existing');
  const [title, setTitle] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [createdNotebook, setCreatedNotebook] = useState<NotebookRead | null>(null);

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else {
      setStoreIsOpen(false);
    }
  }, [onClose, setStoreIsOpen]);

  // Sync state when modal opens or initialNotebooks change
  useEffect(() => {
    if (!isModalOpen) return;

    if (initialNotebooks !== undefined) {
      setNotebooks(initialNotebooks);
      if (initialNotebooks.length === 0) {
        setStep('create_title');
      } else {
        setStep('existing');
      }
      return;
    }

    let isMounted = true;
    setIsLoadingNotebooks(true);
    apiClient
      .getNotebooks()
      .then((data) => {
        if (!isMounted) return;
        setNotebooks(data);
        if (data.length === 0) {
          setStep('create_title');
        } else {
          setStep('existing');
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setNotebooks([]);
        setStep('create_title');
      })
      .finally(() => {
        if (isMounted) setIsLoadingNotebooks(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isModalOpen, initialNotebooks]);

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

  // Path A: Continue with existing notebook
  const handleContinueExisting = (nb: NotebookRead) => {
    setActiveNotebookId(nb.id);
    handleClose();
    onComplete?.(nb.id);
  };

  // Path B: Create notebook step 1
  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMessage('Please enter a notebook title');
      return;
    }

    try {
      setIsSubmitting(true);
      const newNb = await apiClient.createNotebook({ title: trimmedTitle });
      setCreatedNotebook(newNb);
      setActiveNotebookId(newNb.id);
      setStep('upload_sources');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create notebook';
      setErrorMessage(msg || 'Failed to create notebook');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: Finish onboarding and navigate to workspace
  const handleFinish = () => {
    handleClose();
    onComplete?.(createdNotebook?.id);
  };

  const primaryNotebook =
    notebooks.find((nb) => nb.id === user?.last_active_notebook_id) || notebooks[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-modal-title"
      data-testid="onboarding-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop Blur Overlay */}
      <div
        data-testid="onboarding-modal-backdrop"
        className="fixed inset-0 bg-[#111318]/90 backdrop-blur-md cursor-pointer transition-opacity"
        onClick={handleClose}
      />

      {/* Modal Dialog Content */}
      <div
        ref={modalContentRef}
        data-testid="onboarding-modal-content"
        className="relative z-10 w-full max-w-lg rounded-3xl border border-[#30343E] bg-[#111318] p-8 shadow-2xl animate-in fade-in zoom-in-95 focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          ref={closeBtnRef}
          type="button"
          data-testid="onboarding-modal-close-btn"
          aria-label="Close dialog"
          onClick={handleClose}
          className="absolute right-6 top-6 p-1.5 rounded-full text-[#A1A6B3] hover:text-[#F3F4F6] hover:bg-[#242238] transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* PATH A: Existing User with Notebooks */}
        {step === 'existing' && (
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-[#8B83FF] shadow-[0_0_8px_#8B83FF]" />
              <span className="text-xs font-semibold tracking-wider text-[#8B83FF] uppercase">
                Recent Session
              </span>
            </div>

            <h2 id="onboarding-modal-title" className="text-2xl font-bold tracking-tight text-[#F3F4F6]">
              Welcome back, {user?.name || 'Student'}!
            </h2>
            <p className="mt-2 text-sm text-[#A1A6B3]">
              Jump back into your recent study session or start a new subject.
            </p>

            {isLoadingNotebooks ? (
              <div className="my-8 flex justify-center items-center py-8">
                <Loader2 className="w-6 h-6 text-[#8B83FF] animate-spin" />
              </div>
            ) : primaryNotebook ? (
              <div className="my-6 rounded-2xl border border-[#30343E] bg-[#191C23] p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-[#242238] text-[#8B83FF]">
                      <BookOpen className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-[#F3F4F6]">{primaryNotebook.title}</h3>
                      <p className="text-xs text-[#737B8C]">Ready for grounded inquiries</p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#242238] text-[#8B83FF] border border-[#30343E]">
                    ACTIVE
                  </span>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                  <button
                    type="button"
                    data-testid="onboarding-continue-notebook-btn"
                    onClick={() => handleContinueExisting(primaryNotebook)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors cursor-pointer"
                  >
                    <span>Continue with {primaryNotebook.title} → Open Workspace</span>
                  </button>

                  <button
                    type="button"
                    data-testid="onboarding-create-new-btn"
                    onClick={() => setStep('create_title')}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium border border-[#30343E] text-[#F3F4F6] hover:bg-[#242238] transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4 text-[#8B83FF]" />
                    <span>Create a new notebook</span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* PATH B — STEP 1: Enter Title */}
        {step === 'create_title' && (
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-[#8B83FF] shadow-[0_0_8px_#8B83FF]" />
              <span className="text-xs font-semibold tracking-wider text-[#8B83FF] uppercase">
                Step 1 of 2
              </span>
            </div>

            <h2 id="onboarding-modal-title" className="text-2xl font-bold tracking-tight text-[#F3F4F6]">
              Create a new notebook
            </h2>
            <p className="mt-2 text-sm text-[#A1A6B3]">
              Give your notebook a subject name to organize your sources, notes, and grounded answers.
            </p>

            <form onSubmit={handleCreateSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="onboarding-title-input" className="block text-xs font-medium text-[#A1A6B3] mb-2">
                  Notebook Title
                </label>
                <input
                  id="onboarding-title-input"
                  data-testid="onboarding-notebook-title-input"
                  type="text"
                  placeholder="e.g. Organic Chemistry or Linear Algebra"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={isSubmitting}
                  autoFocus
                  className="w-full rounded-xl border border-[#30343E] bg-[#191C23] px-4 py-3 text-sm text-[#F3F4F6] placeholder:text-[#737B8C] focus:outline-none focus:ring-2 focus:ring-[#8B83FF]"
                />
              </div>

              {errorMessage && (
                <div
                  role="alert"
                  data-testid="onboarding-error-alert"
                  className="p-3 rounded-xl border border-red-500/30 bg-red-950/20 text-xs text-red-400"
                >
                  {errorMessage}
                </div>
              )}

              <div className="pt-2 flex items-center justify-between gap-3">
                {notebooks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setStep('existing')}
                    className="px-4 py-2.5 rounded-xl text-sm text-[#A1A6B3] hover:text-[#F3F4F6] transition-colors"
                  >
                    Back
                  </button>
                )}
                <button
                  type="submit"
                  data-testid="onboarding-notebook-submit-btn"
                  disabled={isSubmitting}
                  className="ml-auto flex items-center gap-2 px-5 py-3 rounded-xl font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <span>Next: Add Sources</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* PATH B — STEP 2: Add Sources Guide */}
        {step === 'upload_sources' && (
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-2.5 h-2.5 rounded-full bg-[#8B83FF] shadow-[0_0_8px_#8B83FF]" />
              <span className="text-xs font-semibold tracking-wider text-[#8B83FF] uppercase">
                Step 2 of 2
              </span>
            </div>

            <h2 id="onboarding-modal-title" className="text-2xl font-bold tracking-tight text-[#F3F4F6]">
              Add sources to {createdNotebook?.title || 'Notebook'}
            </h2>
            <p className="mt-2 text-sm text-[#A1A6B3]">
              Upload course PDFs, research papers, or import YouTube lectures to power verified answers.
            </p>

            <div className="my-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 rounded-2xl border border-[#30343E] bg-[#191C23] flex flex-col items-center text-center">
                <UploadCloud className="w-8 h-8 text-[#8B83FF] mb-2" />
                <h4 className="text-sm font-semibold text-[#F3F4F6]">Course Documents</h4>
                <p className="text-xs text-[#737B8C] mt-1">PDF or image files up to 50MB</p>
              </div>

              <div className="p-4 rounded-2xl border border-[#30343E] bg-[#191C23] flex flex-col items-center text-center">
                <Video className="w-8 h-8 text-red-400 mb-2" />
                <h4 className="text-sm font-semibold text-[#F3F4F6]">Video Lectures</h4>
                <p className="text-xs text-[#737B8C] mt-1">YouTube link with auto-seek</p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                data-testid="onboarding-finish-btn"
                onClick={handleFinish}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-medium bg-[#8B83FF] text-[#191C23] hover:bg-[#7A72F0] transition-colors cursor-pointer"
              >
                <span>Open Workspace →</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
