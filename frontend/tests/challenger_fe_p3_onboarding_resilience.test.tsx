import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from './mocks/server';
import { mockDb } from './mocks/mock-db';
import { mockUser, mockNotebooks } from './mocks/fixtures';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { LoginOnboardingModal } from '@/components/onboarding/LoginOnboardingModal';
import { NotebookRead, UserProfileResponse } from '@/types/api';

describe('Challenger 2: Phase 3 Onboarding Flow & API Resilience Verification', () => {
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
  // 1. Path A: Multiple Notebooks, Fallbacks, and Create-New Transition
  // =========================================================================
  describe('1. Path A Adversarial Resilience (Existing Notebooks & Routing)', () => {
    const multiNotebooks: NotebookRead[] = [
      {
        id: 'nb-ai-101',
        user_id: 'usr-student-001',
        title: 'Artificial Intelligence 101',
        status: 'active',
        created_at: '2026-09-01T10:00:00Z',
      },
      {
        id: 'nb-biochem-202',
        user_id: 'usr-student-001',
        title: 'Molecular Biochemistry 202',
        status: 'active',
        created_at: '2026-09-10T12:00:00Z',
      },
      {
        id: 'nb-quantum-303',
        user_id: 'usr-student-001',
        title: 'Advanced Quantum Mechanics 303',
        status: 'active',
        created_at: '2026-09-15T14:30:00Z',
      },
    ];

    it('test_path_a_multiple_notebooks_selects_last_active_notebook_correctly', async () => {
      // User whose last active notebook is the third one: nb-quantum-303
      const userWithActiveNb: UserProfileResponse = {
        ...mockUser,
        name: 'Samantha Scholar',
        last_active_notebook_id: 'nb-quantum-303',
      };
      useAuthStore.getState().setSession('valid-token-samantha', userWithActiveNb);
      useWorkspaceStore.getState().setOnboardingOpen(true);

      const onComplete = vi.fn();
      const onClose = vi.fn();

      render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={multiNotebooks}
          onComplete={onComplete}
          onClose={onClose}
        />
      );

      // Verify personalized header
      expect(screen.getByText(/Welcome back, Samantha Scholar!/i)).toBeInTheDocument();

      // Verify that the active card displays nb-quantum-303
      expect(screen.getByText('Advanced Quantum Mechanics 303')).toBeInTheDocument();

      // Verify continue button displays the title of the last active notebook
      const continueBtn = screen.getByTestId('onboarding-continue-notebook-btn');
      expect(continueBtn.textContent).toContain('Continue with Advanced Quantum Mechanics 303 → Open Workspace');

      // Click continue
      fireEvent.click(continueBtn);

      // Verify activeNotebookId updated to nb-quantum-303
      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-quantum-303');
      expect(onComplete).toHaveBeenCalledWith('nb-quantum-303');
      expect(onClose).toHaveBeenCalled();
    });

    it('test_path_a_missing_or_corrupt_last_active_notebook_falls_back_to_first', async () => {
      // User with last_active_notebook_id pointing to deleted/corrupted notebook
      const userWithCorruptNb: UserProfileResponse = {
        ...mockUser,
        name: 'Jordan Researcher',
        last_active_notebook_id: 'nb-deleted-or-nonexistent-999',
      };
      useAuthStore.getState().setSession('valid-token-jordan', userWithCorruptNb);

      render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={multiNotebooks}
        />
      );

      // Should safely fallback to multiNotebooks[0]: Artificial Intelligence 101
      expect(screen.getByText(/Welcome back, Jordan Researcher!/i)).toBeInTheDocument();
      expect(screen.getByText('Artificial Intelligence 101')).toBeInTheDocument();

      const continueBtn = screen.getByTestId('onboarding-continue-notebook-btn');
      expect(continueBtn.textContent).toContain('Continue with Artificial Intelligence 101 → Open Workspace');

      fireEvent.click(continueBtn);
      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-ai-101');
    });

    it('test_path_a_transition_to_create_new_and_back_to_existing', async () => {
      useAuthStore.getState().setSession('valid-token', mockUser);

      render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={multiNotebooks}
        />
      );

      // Initially in Path A
      expect(screen.getByTestId('onboarding-continue-notebook-btn')).toBeInTheDocument();
      const createNewBtn = screen.getByTestId('onboarding-create-new-btn');
      expect(createNewBtn).toBeInTheDocument();

      // Transition to create notebook
      fireEvent.click(createNewBtn);

      // Now in Step 1 of create
      expect(screen.getByTestId('onboarding-notebook-title-input')).toBeInTheDocument();
      expect(screen.queryByTestId('onboarding-continue-notebook-btn')).not.toBeInTheDocument();

      // "Back" button must be rendered because user has existing notebooks
      const backBtn = screen.getByText('Back');
      expect(backBtn).toBeInTheDocument();

      // Click "Back" -> reverts to Path A
      fireEvent.click(backBtn);
      expect(screen.getByTestId('onboarding-continue-notebook-btn')).toBeInTheDocument();
      expect(screen.queryByTestId('onboarding-notebook-title-input')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Path B: Input Validation, Whitespace, 200+ Chars, Unicode/HTML Fuzzing
  // =========================================================================
  describe('2. Path B Input Fuzzing & Boundary Stress', () => {
    beforeEach(() => {
      useAuthStore.getState().setSession('valid-token', mockUser);
    });

    it('test_path_b_empty_and_whitespace_only_submission_is_blocked', async () => {
      let apiCallCount = 0;
      server.use(
        http.post('/api/notebooks', () => {
          apiCallCount++;
          return HttpResponse.json({ id: 'unexpected' });
        })
      );

      render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={[]}
        />
      );

      const submitBtn = screen.getByTestId('onboarding-notebook-submit-btn');
      const titleInput = screen.getByTestId('onboarding-notebook-title-input');

      // 1. Submit with empty string
      fireEvent.change(titleInput, { target: { value: '' } });
      fireEvent.click(submitBtn);

      let alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Please enter a notebook title');
      expect(apiCallCount).toBe(0);
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();

      // 2. Submit with whitespace only (tabs, newlines, spaces)
      fireEvent.change(titleInput, { target: { value: '   \t\n   \r\n   ' } });
      fireEvent.click(submitBtn);

      alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Please enter a notebook title');
      expect(apiCallCount).toBe(0);
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
    });

    it('test_path_b_very_long_title_200_plus_chars_handles_cleanly', async () => {
      // 240-character comprehensive academic course title
      const veryLongTitle =
        'Advanced Quantum Electrodynamics and Relativistic Field Theories in Condensed Matter Physics with Topological Insulators and Superconducting Qubits: A Comprehensive Seminar Course for Graduate Students (Spring Semester 2027 Syllabus & Notes)';

      server.use(
        http.post('/api/notebooks', async ({ request }) => {
          const body = (await request.json()) as { title?: string };
          return HttpResponse.json({
            id: 'nb-long-title-999',
            user_id: mockUser.id,
            title: body.title,
            status: 'active',
            created_at: new Date().toISOString(),
          });
        })
      );

      const onComplete = vi.fn();

      render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={[]}
          onComplete={onComplete}
        />
      );

      const titleInput = screen.getByTestId('onboarding-notebook-title-input');
      const submitBtn = screen.getByTestId('onboarding-notebook-submit-btn');

      fireEvent.change(titleInput, { target: { value: veryLongTitle } });
      fireEvent.click(submitBtn);

      // Transitions to Step 2 and displays the long title in the heading
      await waitFor(() => {
        expect(screen.getByText(`Add sources to ${veryLongTitle}`)).toBeInTheDocument();
      });

      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-long-title-999');

      // Step 2 finish button completes setup
      const finishBtn = screen.getByTestId('onboarding-finish-btn');
      fireEvent.click(finishBtn);

      expect(onComplete).toHaveBeenCalledWith('nb-long-title-999');
    });

    it('test_path_b_special_characters_xss_and_unicode_safety', async () => {
      // Adversarial XSS vectors, emojis, mathematical symbols, and HTML entities
      const adversarialTitle =
        '<script>alert("xss")</script> & <b>Bio-Genetics 🧬🔬🧪</b> \u00A9 2026 "Physics" & \'Chemistry\' <img src=x onerror=alert(1)>';

      server.use(
        http.post('/api/notebooks', async ({ request }) => {
          const body = (await request.json()) as { title?: string };
          return HttpResponse.json({
            id: 'nb-xss-safe-001',
            user_id: mockUser.id,
            title: body.title,
            status: 'active',
            created_at: new Date().toISOString(),
          });
        })
      );

      render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={[]}
        />
      );

      const titleInput = screen.getByTestId('onboarding-notebook-title-input');
      const submitBtn = screen.getByTestId('onboarding-notebook-submit-btn');

      fireEvent.change(titleInput, { target: { value: adversarialTitle } });
      fireEvent.click(submitBtn);

      // Text must be rendered safely as text content, not interpreted as executable HTML DOM nodes
      await waitFor(() => {
        const heading = screen.getByText(`Add sources to ${adversarialTitle}`);
        expect(heading).toBeInTheDocument();
        // Ensure no actual script tag or rogue img tag was injected into DOM
        expect(document.querySelector('script[src*="alert"]')).toBeNull();
      });

      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-xss-safe-001');
    });
  });

  // =========================================================================
  // 3. Network Failure Simulation (HTTP 500, 400, Modal Persistence, Retry)
  // =========================================================================
  describe('3. Network Failure Simulation & Inline Error Resilience', () => {
    beforeEach(() => {
      useAuthStore.getState().setSession('valid-token', mockUser);
    });

    it('test_backend_500_displays_role_alert_and_keeps_modal_open', async () => {
      server.use(
        http.post('/api/notebooks', () => {
          return HttpResponse.json(
            { detail: 'Internal Server Error: PostgreSQL connection pool severed' },
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

      const titleInput = screen.getByTestId('onboarding-notebook-title-input');
      const submitBtn = screen.getByTestId('onboarding-notebook-submit-btn');

      fireEvent.change(titleInput, { target: { value: 'Astrophysics 401' } });
      fireEvent.click(submitBtn);

      const alert = await screen.findByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toContain('Internal Server Error: PostgreSQL connection pool severed');

      // Crucial: Modal MUST remain open so user does not lose context
      expect(screen.getByTestId('onboarding-modal')).toBeInTheDocument();
      // Input value is preserved
      expect((titleInput as HTMLInputElement).value).toBe('Astrophysics 401');
      // Submit button is re-enabled for retry
      expect(submitBtn).not.toBeDisabled();
      // Active notebook is not set
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
    });

    it('test_backend_400_validation_error_and_successful_recovery_on_retry', async () => {
      let attempt = 0;
      server.use(
        http.post('/api/notebooks', async ({ request }) => {
          attempt++;
          const body = (await request.json()) as { title?: string };
          if (attempt === 1) {
            return HttpResponse.json(
              { detail: 'Invalid title: Prohibited system keyword' },
              { status: 400 }
            );
          }
          return HttpResponse.json({
            id: 'nb-recovery-200',
            user_id: mockUser.id,
            title: body.title,
            status: 'active',
            created_at: new Date().toISOString(),
          });
        })
      );

      render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={[]}
        />
      );

      const titleInput = screen.getByTestId('onboarding-notebook-title-input');
      const submitBtn = screen.getByTestId('onboarding-notebook-submit-btn');

      // Attempt 1: Fails with 400
      fireEvent.change(titleInput, { target: { value: 'system.admin.root' } });
      fireEvent.click(submitBtn);

      const alert = await screen.findByRole('alert');
      expect(alert).toBeInTheDocument();
      expect(alert.textContent).toContain('Invalid title: Prohibited system keyword');
      expect(screen.getByTestId('onboarding-modal')).toBeInTheDocument();

      // Attempt 2: User fixes the title and submits again
      fireEvent.change(titleInput, { target: { value: 'Neuroscience and Cognitive Psychology' } });
      fireEvent.click(submitBtn);

      // Advances successfully to Step 2
      await waitFor(() => {
        expect(screen.getByText('Add sources to Neuroscience and Cognitive Psychology')).toBeInTheDocument();
      });

      // Error alert is removed
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-recovery-200');
    });
  });

  // =========================================================================
  // 4. Cross-Tenant State Purge & Mid-Onboarding Logout/Switch
  // =========================================================================
  describe('4. Cross-Tenant State Purge & User Switching Mid-Onboarding', () => {
    it('test_mid_onboarding_logout_purges_modal_state_and_unmounts_dialog', async () => {
      useAuthStore.getState().setSession('alex-token', mockUser);
      useWorkspaceStore.getState().setOnboardingOpen(true);
      useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');
      useWorkspaceStore.getState().setSelectedSourceIds(['src-1', 'src-2']);

      const { rerender } = render(<LoginOnboardingModal />);

      // Modal is visible
      expect(screen.getByTestId('onboarding-modal')).toBeInTheDocument();

      // Logout mid-onboarding
      act(() => {
        useAuthStore.getState().logout();
      });

      // Assert complete auth purge
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().token).toBeNull();

      // Assert complete workspace purge
      expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(false);
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().selectedSourceIds).toEqual([]);

      // Modal is unmounted from DOM
      rerender(<LoginOnboardingModal />);
      expect(screen.queryByTestId('onboarding-modal')).not.toBeInTheDocument();
    });

    it('test_user_switch_mid_onboarding_purges_previous_tenant_data_and_loads_new_tenant', async () => {
      // 1. User Alice is logged in with her private notebooks
      const aliceUser: UserProfileResponse = {
        id: 'usr-alice-111',
        name: 'Alice Anderson',
        email: 'alice@mit.edu',
        is_active: true,
        last_active_notebook_id: 'nb-alice-secret',
        created_at: '2026-01-01T00:00:00Z',
      };
      useAuthStore.getState().setSession('alice-token', aliceUser);
      useWorkspaceStore.getState().setActiveNotebookId('nb-alice-secret');
      useWorkspaceStore.getState().setSelectedSourceIds(['src-alice-confidential']);
      useWorkspaceStore.getState().setOnboardingOpen(true);

      const aliceNotebooks: NotebookRead[] = [
        {
          id: 'nb-alice-secret',
          user_id: 'usr-alice-111',
          title: 'Alice Confidential Research',
          status: 'active',
          created_at: '2026-01-01T00:00:00Z',
        },
      ];

      const { unmount } = render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={aliceNotebooks}
        />
      );

      expect(screen.getByText(/Welcome back, Alice Anderson!/i)).toBeInTheDocument();
      expect(screen.getByText('Alice Confidential Research')).toBeInTheDocument();

      unmount();

      // 2. Mid-session, authenticate as Bob (Tenant B)
      const bobUser: UserProfileResponse = {
        id: 'usr-bob-222',
        name: 'Bob Builder',
        email: 'bob@stanford.edu',
        is_active: true,
        last_active_notebook_id: 'nb-bob-civil',
        created_at: '2026-02-01T00:00:00Z',
      };

      act(() => {
        // Switching user via setSession purges previous workspace state
        useAuthStore.getState().setSession('bob-token', bobUser);
      });

      // Assert Alice's state was purged
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().selectedSourceIds).toEqual([]);
      expect(useWorkspaceStore.getState().isOnboardingOpen).toBe(false);

      // 3. Bob opens onboarding modal
      const bobNotebooks: NotebookRead[] = [
        {
          id: 'nb-bob-civil',
          user_id: 'usr-bob-222',
          title: 'Civil Engineering Mechanics',
          status: 'active',
          created_at: '2026-02-01T00:00:00Z',
        },
      ];

      useWorkspaceStore.getState().setOnboardingOpen(true);

      render(
        <LoginOnboardingModal
          isOpen={true}
          initialNotebooks={bobNotebooks}
        />
      );

      // Verify Bob sees his own data and 0 traces of Alice
      expect(screen.getByText(/Welcome back, Bob Builder!/i)).toBeInTheDocument();
      expect(screen.getByText('Civil Engineering Mechanics')).toBeInTheDocument();
      expect(screen.queryByText('Alice Anderson')).not.toBeInTheDocument();
      expect(screen.queryByText('Alice Confidential Research')).not.toBeInTheDocument();

      const continueBtn = screen.getByTestId('onboarding-continue-notebook-btn');
      fireEvent.click(continueBtn);

      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-bob-civil');
    });
  });
});
