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

describe('Phase 3: Material 3 Auth Modal & Guided Onboarding Flow', () => {
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

  // 1. Modal Opening / Closing via Buttons and Keyboard Escape
  it('test_signin_modal_opening_and_closing_via_buttons_and_escape', () => {
    const handleClose = vi.fn();

    // Render open SignInModal
    const { rerender } = render(
      <SignInModal isOpen={true} onClose={handleClose} />
    );

    const dialog = screen.getByRole('dialog', { name: /sign in/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByTestId('signin-modal')).toBeInTheDocument();

    // 1. Close via close button click
    const closeBtn = screen.getByTestId('signin-modal-close-btn');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);

    // 2. Close via Escape key press
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(handleClose).toHaveBeenCalledTimes(2);

    // 3. Close via backdrop overlay click
    const backdrop = screen.getByTestId('signin-modal-backdrop');
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(3);

    // 4. Click inside dialog content does NOT trigger close
    const modalContent = screen.getByTestId('signin-modal-content');
    fireEvent.click(modalContent);
    expect(handleClose).toHaveBeenCalledTimes(3);

    // 5. Rerender with isOpen=false removes dialog from DOM
    rerender(<SignInModal isOpen={false} onClose={handleClose} />);
    expect(screen.queryByTestId('signin-modal')).not.toBeInTheDocument();
  });

  // 2. Focus Trap and ARIA Attributes
  it('test_signin_modal_aria_attributes_and_focus_trap', () => {
    render(<SignInModal isOpen={true} onClose={vi.fn()} />);

    const dialog = screen.getByTestId('signin-modal');
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    const titleElement = document.getElementById(labelledBy!);
    expect(titleElement).toBeInTheDocument();
    expect(titleElement?.textContent).toMatch(/Sign In/i);

    // Verify focusable elements
    const closeBtn = screen.getByTestId('signin-modal-close-btn');
    const demoBtn = screen.getByTestId('dev-demo-signin-btn');

    // Focus closeBtn, press Shift+Tab -> wrap to last focusable element (demoBtn)
    closeBtn.focus();
    fireEvent.keyDown(closeBtn, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(demoBtn);

    // Focus demoBtn, press Tab -> wrap to first focusable element (closeBtn)
    demoBtn.focus();
    fireEvent.keyDown(demoBtn, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);
  });

  // 3. 1-Click Quick Dev / Demo Sign-In Button
  it('test_quick_dev_demo_signin_sets_auth_store_and_triggers_onboarding', () => {
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(false);

    useWorkspaceStore.getState().setSignInModalOpen(true);

    render(<SignInModal />);

    const demoBtn = screen.getByTestId('dev-demo-signin-btn');
    act(() => {
      fireEvent.click(demoBtn);
    });

    // Assert student credentials populated in useAuthStore
    const authState = useAuthStore.getState();
    expect(authState.isAuthenticated).toBe(true);
    expect(authState.user?.name).toBe('Alex Student');
    expect(authState.user?.email).toBe('student@university.edu');
    expect(authState.token).toBeTruthy();

    // Assert modal transition: SignIn closes, Onboarding triggers
    expect(useWorkspaceStore.getState().isSignInModalOpen).toBe(false);
    expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(true);
  });

  // 4. Google OAuth Sign-In Button Click Initiates Redirect
  it('test_google_oauth_signin_initiates_redirect', () => {
    const originalLocation = window.location;
    const assignMock = vi.fn();

    // Mock window.location.assign and href setter
    delete (window as unknown as Record<string, unknown>).location;
    (window as unknown as Record<string, unknown>).location = {
      ...originalLocation,
      assign: assignMock,
      href: '',
    };

    render(<SignInModal isOpen={true} onClose={vi.fn()} />);

    const googleBtn = screen.getByTestId('google-signin-btn');
    fireEvent.click(googleBtn);

    const targetUrl = window.location.href || (assignMock.mock.calls[0]?.[0] as string);
    expect(targetUrl).toMatch(/\/api\/v1\/auth\/google\/login/);

    (window as unknown as Record<string, unknown>).location = originalLocation;
  });

  // 5. Onboarding Flow: Path A (Existing User with Notebooks)
  it('test_onboarding_flow_path_a_existing_notebooks', async () => {
    // Authenticate user with existing notebook
    useAuthStore.getState().setSession('valid-token', mockUser);
    useWorkspaceStore.getState().setOnboardingOpen(true);

    const { unmount } = render(
      <LoginOnboardingModal
        isOpen={true}
        initialNotebooks={mockNotebooks}
      />
    );

    // Assert Path A UI elements
    expect(screen.getByText(/Welcome back/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Physics 101: Classical Mechanics/i).length).toBeGreaterThanOrEqual(1);

    const continueBtn = screen.getByTestId('onboarding-continue-notebook-btn');
    const createNewBtn = screen.getByTestId('onboarding-create-new-btn');

    expect(continueBtn).toBeInTheDocument();
    expect(createNewBtn).toBeInTheDocument();

    // Subcase 1: Continue with existing notebook
    fireEvent.click(continueBtn);
    expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-physics-101');
    expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(false);

    // Subcase 2: Click "Create a new notebook" transitions to creation step
    unmount();
    useWorkspaceStore.getState().setOnboardingOpen(true);
    render(
      <LoginOnboardingModal
        isOpen={true}
        initialNotebooks={mockNotebooks}
      />
    );

    const createBtn2 = screen.getByTestId('onboarding-create-new-btn');
    fireEvent.click(createBtn2);

    expect(screen.getByTestId('onboarding-notebook-title-input')).toBeInTheDocument();
  });

  // 6. Onboarding Flow: Path B (New User with 0 Notebooks Guided Wizard)
  it('test_onboarding_flow_path_b_zero_notebooks_guided_wizard', async () => {
    useAuthStore.getState().setSession('valid-token', {
      ...mockUser,
      last_active_notebook_id: undefined,
    });
    mockDb.notebooks.clear();
    useWorkspaceStore.getState().setOnboardingOpen(true);

    server.use(
      http.get('/api/notebooks', () => HttpResponse.json([])),
      http.post('/api/notebooks', async ({ request }) => {
        const body = (await request.json()) as { title?: string };
        return HttpResponse.json({
          id: 'nb-new-wizard-001',
          user_id: mockUser.id,
          title: body.title || 'Untitled Notebook',
          status: 'active',
          created_at: new Date().toISOString(),
        });
      })
    );

    render(<LoginOnboardingModal isOpen={true} />);

    // Step 1: Input Title
    const titleInput = await screen.findByTestId('onboarding-notebook-title-input');
    const submitBtn = screen.getByTestId('onboarding-notebook-submit-btn');

    expect(titleInput).toBeInTheDocument();

    // Empty validation prevents submit
    fireEvent.click(submitBtn);
    expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
    expect(screen.getByTestId('onboarding-error-alert')).toBeInTheDocument();

    // Enter title and submit
    fireEvent.change(titleInput, { target: { value: 'Quantum Computing 101' } });
    fireEvent.click(submitBtn);

    // Creates notebook and advances to Step 2
    await waitFor(() => {
      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-new-wizard-001');
    });

    // Step 2: Source upload guide with Finish / Go to Workspace button
    const finishBtn = await screen.findByTestId('onboarding-finish-btn');
    expect(finishBtn).toBeInTheDocument();
    fireEvent.click(finishBtn);

    expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(false);
  });

  // 7. Modal Edge Cases & Error Resilience
  it('test_modal_edge_cases_and_error_handling', async () => {
    const handleClose = vi.fn();

    // Edge Case 1: Rapid toggle does not crash or leave duplicate handlers
    const { rerender, unmount } = render(
      <SignInModal isOpen={false} onClose={handleClose} />
    );
    await act(async () => {
      rerender(<SignInModal isOpen={true} onClose={handleClose} />);
    });
    await act(async () => {
      rerender(<SignInModal isOpen={false} onClose={handleClose} />);
    });
    await act(async () => {
      rerender(<SignInModal isOpen={true} onClose={handleClose} />);
    });

    expect(screen.getByTestId('signin-modal')).toBeInTheDocument();

    // Edge Case 2: Dismiss without auth preserves unauthenticated state
    const closeBtn = screen.getByTestId('signin-modal-close-btn');
    fireEvent.click(closeBtn);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(false);
    unmount();

    // Edge Case 3: Network failure on notebook creation displays inline error
    useAuthStore.getState().setSession('valid-token', mockUser);
    server.use(
      http.post('/api/notebooks', () => {
        return HttpResponse.json(
          { detail: 'Internal Server Error' },
          { status: 500 }
        );
      })
    );

    render(
      <LoginOnboardingModal
        isOpen={true}
        initialNotebooks={[]}
      />
    );

    const input = screen.getByTestId('onboarding-notebook-title-input');
    const submit = screen.getByTestId('onboarding-notebook-submit-btn');

    fireEvent.change(input, { target: { value: 'Faulty Notebook' } });
    fireEvent.click(submit);

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toBeInTheDocument();
    expect(errorAlert).toHaveTextContent(/Internal Server Error|Failed to create/i);

    // Dialog remains open for user to correct or retry
    expect(screen.getByTestId('onboarding-modal')).toBeInTheDocument();
  });
});
