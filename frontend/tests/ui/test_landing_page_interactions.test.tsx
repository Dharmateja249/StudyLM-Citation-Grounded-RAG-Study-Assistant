import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LandingPage } from '@/components/landing/LandingPage';
import { HeroSection } from '@/components/landing/HeroSection';
import { FaqSection } from '@/components/landing/FaqSection';
import { useAuthStore } from '@/stores/authStore';
import Home from '@/app/page';

describe('Phase 2: 7-Section Landing Page & Interactive Gateway', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    vi.clearAllMocks();
  });

  it('test_renders_all_7_sections_with_landmarks', () => {
    render(<LandingPage />);

    // 1. Assert all 7 section landmarks are present with semantic role="region"
    expect(screen.getByRole('region', { name: /Hero Section/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /How It Works/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Features/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Use Cases/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Connect Ideas/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Frequently Asked Questions/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /Call to Action/i })).toBeInTheDocument();

    // 2. Assert navigation header and footer landmarks
    expect(screen.getByRole('banner', { name: '' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();

    // 3. Assert all 7 headlines are present and match specifications
    expect(
      screen.getByText(/A citation is a starting point\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/From source material to a clearer answer\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Everything stays connected to your material\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/For the questions worth spending time on\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/A clearer view\. Across every source\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Good questions\. Clear answers\./i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your next insight is already/i)
    ).toBeInTheDocument();
  });

  it('test_hero_interactive_workspace_card_citation_switching', () => {
    render(<HeroSection />);

    const quoteContainer = screen.getByTestId('hero-inspector-quote');
    const pill1 = screen.getByTestId('hero-citation-1');
    const pill2 = screen.getByTestId('hero-citation-2');
    const pill3 = screen.getByTestId('hero-citation-3');
    const sourceTitle = screen.getByTestId('hero-inspector-source');

    // Default: Citation 1 active
    expect(sourceTitle).toHaveTextContent(/Memory & Learning\.pdf/i);
    expect(quoteContainer).toHaveTextContent(
      /Actively retrieving information from memory improves retention/i
    );

    // Switch to Citation 2
    fireEvent.click(pill2);
    expect(sourceTitle).toHaveTextContent(/Cognitive Psychology\.pdf/i);
    expect(quoteContainer).toHaveTextContent(
      /Familiarity with a text is different from being able to recall it/i
    );

    // Switch to Citation 3
    fireEvent.click(pill3);
    expect(sourceTitle).toHaveTextContent(/Retrieval practice/i);
    expect(quoteContainer).toHaveTextContent(
      /Feedback then helps you correct what you missed/i
    );

    // Switch back to Citation 1
    fireEvent.click(pill1);
    expect(sourceTitle).toHaveTextContent(/Memory & Learning\.pdf/i);
    expect(quoteContainer).toHaveTextContent(
      /Actively retrieving information from memory improves retention/i
    );
  });

  it('test_faq_accordion_expand_collapse', () => {
    render(<FaqSection />);

    const trigger0 = screen.getByTestId('faq-accordion-trigger-0');

    // Initially closed
    expect(trigger0).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('faq-accordion-content-0')).not.toBeInTheDocument();

    // Click to expand
    fireEvent.click(trigger0);
    expect(trigger0).toHaveAttribute('aria-expanded', 'true');
    const content0 = screen.getByTestId('faq-accordion-content-0');
    expect(content0).toBeInTheDocument();
    expect(content0).toHaveTextContent(/StudyLM indexes your uploaded materials/i);

    // Click again to collapse
    fireEvent.click(trigger0);
    expect(trigger0).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('faq-accordion-content-0')).not.toBeInTheDocument();
  });

  it('test_cta_and_navbar_navigation', () => {
    const handleSignIn = vi.fn();
    const handleGetStarted = vi.fn();

    render(
      <LandingPage
        onSignInClick={handleSignIn}
        onGetStarted={handleGetStarted}
      />
    );

    // Click Navbar Sign In
    const navSignInBtn = screen.getByTestId('navbar-signin-btn');
    fireEvent.click(navSignInBtn);
    expect(handleSignIn).toHaveBeenCalledTimes(1);

    // Click CTA Banner Button
    const ctaBtn = screen.getByTestId('cta-banner-btn');
    fireEvent.click(ctaBtn);
    expect(handleGetStarted).toHaveBeenCalledTimes(1);
  });

  it('test_authenticated_user_banner', () => {
    const handleReturn = vi.fn();

    // 1. Render LandingPage directly with authenticated props
    const { unmount } = render(
      <LandingPage
        isAuthenticated={true}
        userEmail="alex.student@institution.edu"
        onOpenWorkspace={handleReturn}
      />
    );

    const banner = screen.getByTestId('authenticated-user-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent(/alex\.student@institution\.edu/i);

    const returnBtn = screen.getByTestId('return-to-workspace-btn');
    fireEvent.click(returnBtn);
    expect(handleReturn).toHaveBeenCalledTimes(1);

    unmount();

    // 2. Gateway behavior in Home: unauthenticated vs authenticated
    // Unauthenticated -> LandingPage
    useAuthStore.getState().reset();
    const { unmount: unmountHome } = render(<Home />);
    expect(screen.getByTestId('landing-page')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-desktop-layout')).not.toBeInTheDocument();
    unmountHome();

    // Authenticated -> WorkspaceShell
    useAuthStore.getState().setSession('valid-token', {
      id: 'usr-1',
      email: 'alex.student@institution.edu',
      name: 'Alex Student',
      is_active: true,
      created_at: new Date().toISOString(),
    });

    render(<Home />);
    expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();
    expect(screen.queryByTestId('landing-page')).not.toBeInTheDocument();
  });
});
