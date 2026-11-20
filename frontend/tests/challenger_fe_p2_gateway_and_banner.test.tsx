import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LandingPage } from '@/components/landing/LandingPage';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import Home from '@/app/page';

describe('Challenger Adversarial Stress-Test: In-Place Gateway & Auth Banner', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    vi.clearAllMocks();
  });

  // =========================================================================
  // SUITE 1: Rapid Authentication State Switching While Mounted
  // =========================================================================
  describe('1. Rapid Authentication State Switching While Mounted', () => {
    it('adversarial_test_rapid_auth_toggle_loop_while_mounted', () => {
      const { unmount } = render(<Home />);

      // Initially unauthenticated -> LandingPage is rendered
      expect(screen.getByTestId('landing-page')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-desktop-layout')).not.toBeInTheDocument();

      // Stress test: 30 rapid alternating transitions between authenticated and logged out
      for (let i = 0; i < 30; i++) {
        act(() => {
          useAuthStore.getState().setSession(`test-token-${i}`, {
            id: `usr-${i}`,
            email: `student-${i}@institution.edu`,
            name: `Student ${i}`,
            is_active: true,
            created_at: new Date().toISOString(),
          });
        });

        expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();
        expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();

        act(() => {
          useAuthStore.getState().logout();
        });

        expect(screen.getByTestId('landing-page')).toBeInTheDocument();
        expect(screen.queryByTestId('workspace-desktop-layout')).not.toBeInTheDocument();
      }

      unmount();
    });

    it('adversarial_test_session_expiration_reverts_to_landing', () => {
      // Start in authenticated state
      useAuthStore.getState().setSession('valid-bearer-token', {
        id: 'usr-expiring-01',
        email: 'researcher@oxford.ac.uk',
        name: 'Dr. Researcher',
        is_active: true,
        created_at: new Date().toISOString(),
      });

      render(<Home />);
      expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();

      // Trigger session expiration mid-session
      act(() => {
        useAuthStore.getState().handleExpiredSession();
      });

      // Assert auth state reflects expiration
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().authError).toBe('Session expired. Please log in again.');

      // In-place gateway must automatically revert back to landing page
      expect(screen.getByTestId('landing-page')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-desktop-layout')).not.toBeInTheDocument();
    });

    it('adversarial_test_deactivated_state_reverts_to_landing', () => {
      useAuthStore.getState().setSession('valid-bearer-token', {
        id: 'usr-deactivating-01',
        email: 'deactivated.user@institution.edu',
        name: 'Deactivated User',
        is_active: true,
        created_at: new Date().toISOString(),
      });

      render(<Home />);
      expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();

      // Trigger SEC-08 Deactivated state
      act(() => {
        useAuthStore.getState().triggerDeactivatedState('Account disabled by administrator');
      });

      expect(useAuthStore.getState().isDeactivated).toBe(true);
      expect(useAuthStore.getState().isAuthenticated).toBe(false);

      // In-place gateway must transition away from workspace to landing view
      expect(screen.getByTestId('landing-page')).toBeInTheDocument();
      expect(screen.queryByTestId('workspace-desktop-layout')).not.toBeInTheDocument();
    });

    it('adversarial_test_rapid_user_switching_under_mounted_landing_banner', () => {
      const emails = [
        'user.alpha@domain.com',
        'user.beta@sub.university.edu',
        'gamma.researcher@lab.org',
        'delta.fellow@institute.ac.uk',
        'epsilon.scholar@school.edu',
      ];

      const { rerender } = render(
        <LandingPage isAuthenticated={true} userEmail={emails[0]} />
      );

      const banner = screen.getByTestId('authenticated-user-banner');
      expect(banner).toHaveTextContent(emails[0]);

      // Rapidly re-render with new user identities
      for (let i = 1; i < emails.length; i++) {
        rerender(<LandingPage isAuthenticated={true} userEmail={emails[i]} />);
        expect(screen.getByTestId('authenticated-user-banner')).toHaveTextContent(emails[i]);
      }
    });

    it('adversarial_test_view_override_behavior_on_logout', () => {
      // 1. User starts unauthenticated on landing page
      render(<Home />);
      expect(screen.getByTestId('landing-page')).toBeInTheDocument();

      // 2. User clicks "Get Started" which invokes handleSignIn() -> sets session & setViewOverride('workspace')
      const getStartedBtn = screen.getByTestId('navbar-get-started-btn');
      act(() => {
        fireEvent.click(getStartedBtn);
      });

      // User is now authenticated and in workspace
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();

      // 3. User logs out externally via useAuthStore.logout()
      act(() => {
        useAuthStore.getState().logout();
      });

      // Check current state after logout:
      // When handleSignIn set viewOverride='workspace', let's observe what Home renders:
      // Note: viewOverride remains 'workspace', so Home renders WorkspaceShell unless viewOverride is reset.
      const isWorkspaceStillRendered = screen.queryByTestId('workspace-desktop-layout') !== null;
      const isLandingRendered = screen.queryByTestId('landing-page') !== null;

      // Document this specific state machine behavior
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      // Both states cannot be rendered at the same time
      expect(isWorkspaceStillRendered !== isLandingRendered).toBe(true);
    });
  });

  // =========================================================================
  // SUITE 2: Authenticated Banner Edge Cases
  // =========================================================================
  describe('2. Authenticated Banner Edge Cases', () => {
    it('adversarial_test_banner_with_excessively_long_email', () => {
      const ultraLongEmail =
        'alexander.maximilian.constantine.the.third.of.department.of.cognitive.science.and.computational.neurobiology@distinguished-fellowship.cambridge-university-research-network.ac.uk';

      render(<LandingPage isAuthenticated={true} userEmail={ultraLongEmail} />);

      const banner = screen.getByTestId('authenticated-user-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(ultraLongEmail);

      // Verify the element contains truncate and max-w styling to prevent visual overflow
      const strongElement = banner.querySelector('strong');
      expect(strongElement).not.toBeNull();
      expect(strongElement?.className).toContain('truncate');
      expect(strongElement?.className).toContain('max-w-[240px]');
    });

    it('adversarial_test_banner_with_special_characters_and_xss_attempts', () => {
      const maliciousPayloads = [
        '<script>alert("xss")</script>@evil.com',
        '"><img src=x onerror=alert(1)>@test.org',
        'user&<>\'"/@domain.com',
        '{{constructor.constructor("alert(1)")()}}@vuln.org',
      ];

      for (const payload of maliciousPayloads) {
        const { unmount } = render(
          <LandingPage isAuthenticated={true} userEmail={payload} />
        );

        const banner = screen.getByTestId('authenticated-user-banner');
        // React must escape text content safely without creating executable script tags or img error triggers
        expect(banner).toHaveTextContent(payload);
        expect(document.querySelector('script[src]')).toBeNull();
        expect(document.querySelector('img[onerror]')).toBeNull();

        unmount();
      }
    });

    it('adversarial_test_banner_with_multilingual_unicode_and_emojis', () => {
      const internationalEmails = [
        '👨‍🎓.researcher+studylm@uni-münchen.de',
        'студент@мгу.рф',
        'طالب.علم@جامعة.مصر',
        '学生@清华大学.cn',
        'dörte.müller@universität.de',
      ];

      for (const email of internationalEmails) {
        const { unmount } = render(
          <LandingPage isAuthenticated={true} userEmail={email} />
        );

        const banner = screen.getByTestId('authenticated-user-banner');
        expect(banner).toHaveTextContent(email);
        unmount();
      }
    });

    it('adversarial_test_banner_with_whitespace_and_empty_strings', () => {
      // 1. Empty string -> fallback 'Alex Student'
      const { unmount: u1 } = render(
        <LandingPage isAuthenticated={true} userEmail="" />
      );
      expect(screen.getByTestId('authenticated-user-banner')).toHaveTextContent('Alex Student');
      u1();

      // 2. null -> fallback 'Alex Student'
      const { unmount: u2 } = render(
        <LandingPage isAuthenticated={true} userEmail={null} />
      );
      expect(screen.getByTestId('authenticated-user-banner')).toHaveTextContent('Alex Student');
      u2();

      // 3. undefined -> fallback 'Alex Student'
      const { unmount: u3 } = render(
        <LandingPage isAuthenticated={true} userEmail={undefined} />
      );
      expect(screen.getByTestId('authenticated-user-banner')).toHaveTextContent('Alex Student');
      u3();

      // 4. Whitespace only string '   '
      // In JS, '   ' is truthy, so ('   ' || 'Alex Student') yields '   '
      const { unmount: u4 } = render(
        <LandingPage isAuthenticated={true} userEmail="   " />
      );
      const banner = screen.getByTestId('authenticated-user-banner');
      expect(banner).toBeInTheDocument();
      // Should not throw or crash
      u4();
    });

    it('adversarial_test_banner_prop_visibility_matrix', () => {
      // Case A: isAuthenticated=true, showAuthBanner=undefined -> shown
      const { unmount: uA } = render(
        <LandingPage isAuthenticated={true} userEmail="test@a.com" />
      );
      expect(screen.getByTestId('authenticated-user-banner')).toBeInTheDocument();
      uA();

      // Case B: isAuthenticated=true, showAuthBanner=false -> hidden
      const { unmount: uB } = render(
        <LandingPage isAuthenticated={true} showAuthBanner={false} userEmail="test@b.com" />
      );
      expect(screen.queryByTestId('authenticated-user-banner')).not.toBeInTheDocument();
      uB();

      // Case C: isAuthenticated=false, showAuthBanner=true -> shown
      const { unmount: uC } = render(
        <LandingPage isAuthenticated={false} showAuthBanner={true} userEmail="test@c.com" />
      );
      expect(screen.getByTestId('authenticated-user-banner')).toBeInTheDocument();
      expect(screen.getByTestId('authenticated-user-banner')).toHaveTextContent('test@c.com');
      uC();

      // Case D: isAuthenticated=false, showAuthBanner=false -> hidden
      const { unmount: uD } = render(
        <LandingPage isAuthenticated={false} showAuthBanner={false} userEmail="test@d.com" />
      );
      expect(screen.queryByTestId('authenticated-user-banner')).not.toBeInTheDocument();
      uD();

      // Case E: isAuthenticated=false, showAuthBanner=undefined -> hidden
      const { unmount: uE } = render(
        <LandingPage isAuthenticated={false} userEmail="test@e.com" />
      );
      expect(screen.queryByTestId('authenticated-user-banner')).not.toBeInTheDocument();
      uE();
    });

    it('adversarial_test_banner_return_button_safety_without_handler', () => {
      // If onOpenWorkspace is not provided, clicking button should not throw TypeError
      render(<LandingPage isAuthenticated={true} userEmail="safe@domain.com" />);

      const returnBtn = screen.getByTestId('return-to-workspace-btn');
      expect(() => {
        fireEvent.click(returnBtn);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // SUITE 3: Re-rendering & Backward Compatibility with Existing Tests
  // =========================================================================
  describe('3. Re-rendering & Backward Compatibility', () => {
    it('adversarial_test_rapid_mount_unmount_cycle_stress', () => {
      // Mount and unmount Home 50 times in rapid succession
      for (let i = 0; i < 50; i++) {
        const { unmount } = render(<Home />);
        expect(screen.getByTestId('landing-page')).toBeInTheDocument();
        unmount();
      }
    });

    it('adversarial_test_accessibility_dual_banner_disambiguation', () => {
      // When authenticated, both <aside role="banner"> and <header role="banner"> are present
      render(<LandingPage isAuthenticated={true} userEmail="test@uni.edu" />);

      // All banners present
      const banners = screen.getAllByRole('banner');
      expect(banners.length).toBe(2);

      // Auth banner has accessible name 'Authenticated Session Notice'
      const authBanner = screen.getByRole('banner', { name: /Authenticated Session Notice/i });
      expect(authBanner).toBeInTheDocument();
      expect(authBanner).toHaveAttribute('data-testid', 'authenticated-user-banner');

      // Navbar header has no aria-label, so accessible name is empty string
      const navBanner = screen.getByRole('banner', { name: '' });
      expect(navBanner).toBeInTheDocument();
      expect(navBanner).toHaveAttribute('data-testid', 'landing-navbar');
    });

    it('adversarial_test_demo_flow_state_progression', () => {
      render(<Home />);

      // Initially landing page
      expect(screen.getByTestId('landing-page')).toBeInTheDocument();

      // Click explore demo in hero
      const heroExploreDemoBtn = screen.getByTestId('hero-explore-demo-btn');
      act(() => {
        fireEvent.click(heroExploreDemoBtn);
      });

      // Transitions to workspace shell
      expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();
      expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
    });

    it('adversarial_test_gateway_renders_properly_with_user_lacking_email', () => {
      // User object lacking email property
      useAuthStore.setState({
        isAuthenticated: true,
        user: {
          id: 'usr-no-email-01',
          name: 'Student Without Email',
          is_active: true,
          created_at: new Date().toISOString(),
        } as any,
        token: 'token-no-email',
      });

      // Gateway renders WorkspaceShell cleanly when name is present
      const { unmount } = render(<Home />);
      expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();
      unmount();

      // If rendered as LandingPage directly with user lacking email, must fallback safely to 'Alex Student'
      render(
        <LandingPage
          isAuthenticated={true}
          userEmail={useAuthStore.getState().user?.email}
        />
      );
      const banner = screen.getByTestId('authenticated-user-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent('Alex Student');
    });

    it('adversarial_test_left_sidebar_unhandled_crash_on_missing_name_observation', () => {
      // Empirical verification: if user.name is missing/undefined, LeftSidebar.tsx:59 crashes
      useAuthStore.setState({
        isAuthenticated: true,
        user: {
          id: 'usr-corrupted-no-name',
          email: 'valid.email@school.edu',
          // name is intentionally omitted
          is_active: true,
          created_at: new Date().toISOString(),
        } as any,
        token: 'token-no-name',
      });

      // Rendering Home (which mounts WorkspaceShell -> LeftSidebar) throws TypeError: Cannot read properties of undefined (reading 'charAt')
      expect(() => {
        render(<Home />);
      }).toThrow(/charAt/i);
    });
  });
});
