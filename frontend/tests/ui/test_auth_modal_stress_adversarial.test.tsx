import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { mockDb } from '../mocks/mock-db';
import { mockUser, mockNotebooks } from '../mocks/fixtures';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { SignInModal } from '@/components/auth/SignInModal';
import { LoginOnboardingModal } from '@/components/onboarding/LoginOnboardingModal';

describe('Adversarial Stress Verification: Phase 3 Auth & Onboarding Modals', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    mockDb.reset();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. RAPID RE-OPENING / TOGGLING STRESS & MEMORY LEAK PREVENTION
  // =========================================================================
  describe('1. Rapid Re-opening / Toggling & Handler Leak Resistance', () => {
    it('survives 50 rapid sequential open/close toggles without crashing or leaking handlers', async () => {
      const onCloseMock = vi.fn();
      const { rerender } = render(<SignInModal isOpen={false} onClose={onCloseMock} />);

      // Rapidly flip open/closed state 50 times
      for (let i = 0; i < 50; i++) {
        await act(async () => {
          rerender(<SignInModal isOpen={i % 2 === 0} onClose={onCloseMock} />);
        });
      }

      // Ensure modal is open on final step
      await act(async () => {
        rerender(<SignInModal isOpen={true} onClose={onCloseMock} />);
      });

      expect(screen.getByTestId('signin-modal')).toBeInTheDocument();

      // Dispatch exactly 1 Escape key: should trigger onClose EXACTLY ONCE
      // If listeners were leaked across 50 mounts, onClose would be called 25+ times!
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(onCloseMock).toHaveBeenCalledTimes(1);
    });

    it('does not execute listeners or crash when Escape is pressed while modal is closed', () => {
      const onCloseMock = vi.fn();
      render(<SignInModal isOpen={false} onClose={onCloseMock} />);

      expect(screen.queryByTestId('signin-modal')).not.toBeInTheDocument();

      // Dispatch Escape on window
      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
      expect(onCloseMock).not.toHaveBeenCalled();
    });

    it('handles rapid toggling via Zustand useWorkspaceStore without state desynchronization', async () => {
      const { setSignInModalOpen } = useWorkspaceStore.getState();

      render(<SignInModal />);

      // Initial state is closed
      expect(screen.queryByTestId('signin-modal')).not.toBeInTheDocument();

      // 30 rapid Zustand store dispatches
      for (let i = 0; i < 30; i++) {
        act(() => {
          setSignInModalOpen(i % 2 === 0);
        });
      }

      // Explicitly set open
      act(() => {
        setSignInModalOpen(true);
      });
      expect(useWorkspaceStore.getState().isSignInModalOpen).toBe(true);
      expect(screen.getByTestId('signin-modal')).toBeInTheDocument();

      // Close via close button
      const closeBtn = screen.getByTestId('signin-modal-close-btn');
      act(() => {
        fireEvent.click(closeBtn);
      });
      expect(useWorkspaceStore.getState().isSignInModalOpen).toBe(false);
      expect(screen.queryByTestId('signin-modal')).not.toBeInTheDocument();
    });

    it('prevents memory leak on unmounted LoginOnboardingModal when API fetch resolves late', async () => {
      let resolvePromise: (value: unknown) => void;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      server.use(
        http.get('/api/notebooks', async () => {
          await delayedPromise;
          return HttpResponse.json(mockNotebooks);
        })
      );

      const { unmount } = render(<LoginOnboardingModal isOpen={true} />);

      // Unmount before network request completes
      unmount();

      // Resolve API after unmount
      await act(async () => {
        resolvePromise!({});
      });

      // No unhandled rejections or unmounted state update errors
      expect(screen.queryByTestId('onboarding-modal')).not.toBeInTheDocument();
    });

    it('handles concurrent double-click on demo sign-in button gracefully', () => {
      useWorkspaceStore.getState().setSignInModalOpen(true);
      const onDemoSuccess = vi.fn();

      render(<SignInModal onDemoSignInSuccess={onDemoSuccess} />);

      const demoBtn = screen.getByTestId('dev-demo-signin-btn');

      // Click rapidly twice
      act(() => {
        fireEvent.click(demoBtn);
        fireEvent.click(demoBtn);
      });

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().user?.name).toBe('Alex Student');
      expect(useWorkspaceStore.getState().isSignInModalOpen).toBe(false);
      expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(true);
    });
  });

  // =========================================================================
  // 2. BACKDROP CLICK ISOLATION VS DIALOG CONTENT CLICK ISOLATION
  // =========================================================================
  describe('2. Backdrop Click vs Dialog Content Click Isolation', () => {
    it('isolates clicks on all inner elements of SignInModal from backdrop dismissal', () => {
      const handleClose = vi.fn();
      render(<SignInModal isOpen={true} onClose={handleClose} />);

      const content = screen.getByTestId('signin-modal-content');
      const title = screen.getByText(/Sign In to StudyLM/i);
      const description = screen.getByText(/Continue to your grounded study workspace/i);
      const brandLogo = screen.getByText('StudyLM');
      const googleBtn = screen.getByTestId('google-signin-btn');
      const devBtn = screen.getByTestId('dev-demo-signin-btn');
      const divider = screen.getByText('or');

      // Clicks on inner content must NOT call handleClose
      fireEvent.click(content);
      fireEvent.click(title);
      fireEvent.click(description);
      fireEvent.click(brandLogo);
      fireEvent.click(divider);

      expect(handleClose).not.toHaveBeenCalled();

      // Only clicking the backdrop overlay calls handleClose
      const backdrop = screen.getByTestId('signin-modal-backdrop');
      fireEvent.click(backdrop);
      expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('isolates clicks on all inner elements of LoginOnboardingModal across Path A & Path B', async () => {
      const handleClose = vi.fn();

      // Path A: Existing user
      useAuthStore.getState().setSession('valid-token', mockUser);
      const { rerender } = render(
        <LoginOnboardingModal
          isOpen={true}
          onClose={handleClose}
          initialNotebooks={mockNotebooks}
        />
      );

      const content = screen.getByTestId('onboarding-modal-content');
      const welcome = screen.getByText(/Welcome back/i);
      const notebookCard = screen.getAllByText(/Physics 101/i)[0];

      fireEvent.click(content);
      fireEvent.click(welcome);
      fireEvent.click(notebookCard);
      expect(handleClose).not.toHaveBeenCalled();

      // Transition to Path B Step 1
      const createNewBtn = screen.getByTestId('onboarding-create-new-btn');
      fireEvent.click(createNewBtn);

      const titleInput = screen.getByTestId('onboarding-notebook-title-input');
      const stepTitle = screen.getByText(/Create a new notebook/i);

      fireEvent.click(titleInput);
      fireEvent.click(stepTitle);
      expect(handleClose).not.toHaveBeenCalled();

      // Verify backdrop still closes
      const backdrop = screen.getByTestId('onboarding-modal-backdrop');
      fireEvent.click(backdrop);
      expect(handleClose).toHaveBeenCalledTimes(1);

      // Path B Step 2: Source upload step
      server.use(
        http.post('/api/notebooks', () => {
          return HttpResponse.json({
            id: 'nb-step2-test',
            title: 'Cell Biology',
            user_id: mockUser.id,
            status: 'active',
            created_at: new Date().toISOString(),
          });
        })
      );

      rerender(
        <LoginOnboardingModal
          isOpen={true}
          onClose={handleClose}
          initialNotebooks={[]}
        />
      );

      const input = screen.getByTestId('onboarding-notebook-title-input');
      fireEvent.change(input, { target: { value: 'Cell Biology' } });
      const submit = screen.getByTestId('onboarding-notebook-submit-btn');
      fireEvent.click(submit);

      const step2Header = await screen.findByText(/Add sources to Cell Biology/i);
      const courseDocsCard = screen.getByText(/Course Documents/i);
      const videoLecturesCard = screen.getByText(/Video Lectures/i);

      fireEvent.click(step2Header);
      fireEvent.click(courseDocsCard);
      fireEvent.click(videoLecturesCard);
      expect(handleClose).toHaveBeenCalledTimes(1); // Still only 1 from earlier backdrop click
    });
  });

  // =========================================================================
  // 3. CLEAN UNAUTHENTICATED STATE ON DISMISSAL
  // =========================================================================
  describe('3. Dismissal Without Authentication Guarantees Clean State', () => {
    it('leaves auth store and storage strictly unauthenticated when closed via close button', () => {
      useWorkspaceStore.getState().setSignInModalOpen(true);
      render(<SignInModal />);

      const closeBtn = screen.getByTestId('signin-modal-close-btn');
      fireEvent.click(closeBtn);

      const auth = useAuthStore.getState();
      const workspace = useWorkspaceStore.getState();

      expect(auth.isAuthenticated).toBe(false);
      expect(auth.token).toBeNull();
      expect(auth.user).toBeNull();
      expect(workspace.isSignInModalOpen).toBe(false);
      expect(workspace.isOnboardingOpen).toBe(false);
      expect(localStorage.getItem('studylm_auth_token')).toBeNull();
    });

    it('leaves auth store and storage strictly unauthenticated when closed via Escape key', () => {
      useWorkspaceStore.getState().setSignInModalOpen(true);
      render(<SignInModal />);

      fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

      const auth = useAuthStore.getState();
      const workspace = useWorkspaceStore.getState();

      expect(auth.isAuthenticated).toBe(false);
      expect(auth.token).toBeNull();
      expect(auth.user).toBeNull();
      expect(workspace.isSignInModalOpen).toBe(false);
      expect(workspace.isOnboardingOpen).toBe(false);
    });

    it('leaves auth store and storage strictly unauthenticated when closed via backdrop click', () => {
      useWorkspaceStore.getState().setSignInModalOpen(true);
      render(<SignInModal />);

      const backdrop = screen.getByTestId('signin-modal-backdrop');
      fireEvent.click(backdrop);

      const auth = useAuthStore.getState();
      const workspace = useWorkspaceStore.getState();

      expect(auth.isAuthenticated).toBe(false);
      expect(auth.token).toBeNull();
      expect(auth.user).toBeNull();
      expect(workspace.isSignInModalOpen).toBe(false);
      expect(workspace.isOnboardingOpen).toBe(false);
    });

    it('purges modal flags on global logout without zombie state', () => {
      // Set initial authenticated state with open onboarding
      useAuthStore.getState().login({ id: 'usr-1', name: 'Student 1' });
      useWorkspaceStore.getState().setOnboardingOpen(true);
      useWorkspaceStore.getState().setSignInModalOpen(true);

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(true);
      expect(useWorkspaceStore.getState().isSignInModalOpen).toBe(true);

      // Trigger logout
      act(() => {
        useAuthStore.getState().logout();
      });

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
      expect(useWorkspaceStore.getState().isSignInModalOpen).toBe(false);
      expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(false);
    });
  });

  // =========================================================================
  // 4. GOOGLE OAUTH REDIRECTION URL STRUCTURE & SAFE FALLBACK
  // =========================================================================
  describe('4. Google OAuth Redirection URL Structure & Fallback', () => {
    it('redirects to exact /api/v1/auth/google/login when window.location.assign is available', () => {
      const originalLocation = window.location;
      const assignMock = vi.fn();

      delete (window as unknown as Record<string, unknown>).location;
      (window as unknown as Record<string, unknown>).location = {
        ...originalLocation,
        assign: assignMock,
        href: '',
      };

      render(<SignInModal isOpen={true} />);

      const googleBtn = screen.getByTestId('google-signin-btn');
      fireEvent.click(googleBtn);

      expect(assignMock).toHaveBeenCalledWith('/api/v1/auth/google/login');

      (window as unknown as Record<string, unknown>).location = originalLocation;
    });

    it('falls back to window.location.href assignment when assign is undefined', () => {
      const originalLocation = window.location;
      let targetHref = '';

      delete (window as unknown as Record<string, unknown>).location;
      (window as unknown as Record<string, unknown>).location = {
        get href() {
          return targetHref;
        },
        set href(val: string) {
          targetHref = val;
        },
        assign: undefined,
      };

      render(<SignInModal isOpen={true} />);

      const googleBtn = screen.getByTestId('google-signin-btn');
      fireEvent.click(googleBtn);

      expect(targetHref).toBe('/api/v1/auth/google/login');

      (window as unknown as Record<string, unknown>).location = originalLocation;
    });

    it('prioritizes onGoogleSignIn callback prop over browser window redirect', () => {
      const onGoogleSignInMock = vi.fn();
      const originalLocation = window.location;
      const assignMock = vi.fn();

      delete (window as unknown as Record<string, unknown>).location;
      (window as unknown as Record<string, unknown>).location = {
        ...originalLocation,
        assign: assignMock,
        href: '',
      };

      render(<SignInModal isOpen={true} onGoogleSignIn={onGoogleSignInMock} />);

      const googleBtn = screen.getByTestId('google-signin-btn');
      fireEvent.click(googleBtn);

      expect(onGoogleSignInMock).toHaveBeenCalledTimes(1);
      expect(assignMock).not.toHaveBeenCalled();

      (window as unknown as Record<string, unknown>).location = originalLocation;
    });
  });

  // =========================================================================
  // 5. FOCUS TRAP & ACCESSIBILITY BOUNDARY CONDITIONS
  // =========================================================================
  describe('5. Focus Trap & Accessibility Boundaries', () => {
    it('pulls active focus inside the modal dialog when Tab is pressed from outside', () => {
      // Put focus on outside element
      const outsideBtn = document.createElement('button');
      document.body.appendChild(outsideBtn);
      outsideBtn.focus();
      expect(document.activeElement).toBe(outsideBtn);

      render(<SignInModal isOpen={true} />);

      const closeBtn = screen.getByTestId('signin-modal-close-btn');

      // Press Tab while focus was outside -> intercepts and pulls focus to first element
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: false });
      expect(document.activeElement).toBe(closeBtn);

      document.body.removeChild(outsideBtn);
    });

    it('pulls active focus to last focusable element when Shift+Tab is pressed from outside', () => {
      const outsideBtn = document.createElement('button');
      document.body.appendChild(outsideBtn);
      outsideBtn.focus();
      expect(document.activeElement).toBe(outsideBtn);

      render(<SignInModal isOpen={true} />);

      const demoBtn = screen.getByTestId('dev-demo-signin-btn');

      // Press Shift+Tab while focus was outside -> intercepts and pulls focus to last element
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(demoBtn);

      document.body.removeChild(outsideBtn);
    });

    it('traps focus cleanly within LoginOnboardingModal Step 1 form fields', async () => {
      render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={[]}
        />
      );

      const closeBtn = screen.getByTestId('onboarding-modal-close-btn');
      const submitBtn = screen.getByTestId('onboarding-notebook-submit-btn');

      // Shift+Tab from closeBtn wraps to submitBtn
      closeBtn.focus();
      fireEvent.keyDown(closeBtn, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(submitBtn);

      // Tab from submitBtn wraps back to closeBtn
      submitBtn.focus();
      fireEvent.keyDown(submitBtn, { key: 'Tab', shiftKey: false });
      expect(document.activeElement).toBe(closeBtn);
    });
  });

  // =========================================================================
  // 6. ADVERSARIAL NETWORK & VALIDATION EDGE CASES
  // =========================================================================
  describe('6. Validation & Network Failure Resilience', () => {
    it('blocks whitespace-only notebook titles and renders inline error', async () => {
      render(<LoginOnboardingModal isOpen={true} initialNotebooks={[]} />);

      const input = screen.getByTestId('onboarding-notebook-title-input');
      const submit = screen.getByTestId('onboarding-notebook-submit-btn');

      // Whitespace only
      fireEvent.change(input, { target: { value: '    \t   ' } });
      fireEvent.click(submit);

      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent(/Please enter a notebook title/i);
    });

    it('disables submit button during submission preventing duplicate API creation requests', async () => {
      let resolvePromise!: (value: unknown) => void;
      const deferred = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      let requestCount = 0;

      server.use(
        http.post('/api/notebooks', async () => {
          requestCount++;
          await deferred;
          return HttpResponse.json({
            id: 'nb-single-submit',
            title: 'Astrophysics',
            user_id: mockUser.id,
            status: 'active',
            created_at: new Date().toISOString(),
          });
        })
      );

      render(<LoginOnboardingModal isOpen={true} initialNotebooks={[]} />);

      const input = screen.getByTestId('onboarding-notebook-title-input');
      const submit = screen.getByTestId('onboarding-notebook-submit-btn');

      fireEvent.change(input, { target: { value: 'Astrophysics' } });

      // First click
      fireEvent.click(submit);
      expect(submit).toBeDisabled();
      expect(screen.getByText(/Creating\.\.\./i)).toBeInTheDocument();

      // Second click while disabled
      fireEvent.click(submit);

      // Resolve the API call
      await act(async () => {
        resolvePromise({});
      });

      // Assert only 1 request was made
      expect(requestCount).toBe(1);
      await waitFor(() => {
        expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-single-submit');
      });
    });

    it('displays network error message when API call completely fails with Network Error', async () => {
      server.use(
        http.post('/api/notebooks', () => {
          return HttpResponse.error();
        })
      );

      render(<LoginOnboardingModal isOpen={true} initialNotebooks={[]} />);

      const input = screen.getByTestId('onboarding-notebook-title-input');
      const submit = screen.getByTestId('onboarding-notebook-submit-btn');

      fireEvent.change(input, { target: { value: 'Failing Subject' } });
      fireEvent.click(submit);

      const alert = await screen.findByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toMatch(/Failed to create notebook|Network error|Failed to fetch/i);

      // Input is re-enabled so user can retry
      expect(input).not.toBeDisabled();
      expect(submit).not.toBeDisabled();
    });
  });
});
