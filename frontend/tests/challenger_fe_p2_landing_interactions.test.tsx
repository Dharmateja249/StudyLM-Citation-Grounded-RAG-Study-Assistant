import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeroSection } from '@/components/landing/HeroSection';
import { FaqSection } from '@/components/landing/FaqSection';

describe('Challenger Empirical Stress-Test: Hero Preview Card & FAQ Accordions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Hero Preview Card: Adversarial Verification', () => {
    it('adversarial_test_citation_switching_across_all_triggers_and_wraparound', () => {
      render(<HeroSection />);

      const quoteEl = screen.getByTestId('hero-inspector-quote');
      const sourceEl = screen.getByTestId('hero-inspector-source');
      const prevBtn = screen.getByRole('button', { name: /Previous Citation/i });
      const nextBtn = screen.getByRole('button', { name: /Next Citation/i });

      // Initial state: Citation 1
      expect(sourceEl).toHaveTextContent('Memory & Learning.pdf');
      expect(quoteEl).toHaveTextContent(/Actively retrieving information/i);

      // 1. Next button wrap-around check: 1 -> 2 -> 3 -> 1
      fireEvent.click(nextBtn);
      expect(sourceEl).toHaveTextContent('Cognitive Psychology.pdf');
      expect(quoteEl).toHaveTextContent(/Familiarity with a text/i);

      fireEvent.click(nextBtn);
      expect(sourceEl).toHaveTextContent('Retrieval practice');
      expect(quoteEl).toHaveTextContent(/Feedback then helps you correct/i);

      fireEvent.click(nextBtn); // Wrap to 1
      expect(sourceEl).toHaveTextContent('Memory & Learning.pdf');
      expect(quoteEl).toHaveTextContent(/Actively retrieving information/i);

      // 2. Prev button wrap-around check: 1 -> 3 -> 2 -> 1
      fireEvent.click(prevBtn); // Wrap to 3
      expect(sourceEl).toHaveTextContent('Retrieval practice');
      expect(quoteEl).toHaveTextContent(/Feedback then helps you correct/i);

      fireEvent.click(prevBtn); // To 2
      expect(sourceEl).toHaveTextContent('Cognitive Psychology.pdf');
      expect(quoteEl).toHaveTextContent(/Familiarity with a text/i);

      fireEvent.click(prevBtn); // To 1
      expect(sourceEl).toHaveTextContent('Memory & Learning.pdf');
      expect(quoteEl).toHaveTextContent(/Actively retrieving information/i);

      // 3. Bottom pill triggers: pill 2, pill 3, pill 1
      const pill1 = screen.getByTestId('hero-citation-pill-1');
      const pill2 = screen.getByTestId('hero-citation-pill-2');
      const pill3 = screen.getByTestId('hero-citation-pill-3');

      fireEvent.click(pill2);
      expect(sourceEl).toHaveTextContent('Cognitive Psychology.pdf');
      expect(pill2.className).toContain('bg-[#8B83FF]');
      expect(pill1.className).not.toContain('bg-[#8B83FF]');

      fireEvent.click(pill3);
      expect(sourceEl).toHaveTextContent('Retrieval practice');
      expect(pill3.className).toContain('bg-[#8B83FF]');
      expect(pill2.className).not.toContain('bg-[#8B83FF]');

      fireEvent.click(pill1);
      expect(sourceEl).toHaveTextContent('Memory & Learning.pdf');
      expect(pill1.className).toContain('bg-[#8B83FF]');
      expect(pill3.className).not.toContain('bg-[#8B83FF]');
    });

    it('adversarial_test_quote_and_excerpt_multimodal_synchronization', () => {
      render(<HeroSection />);

      const sourceEl = screen.getByTestId('hero-inspector-source');
      const quoteEl = screen.getByTestId('hero-inspector-quote');
      const excerptContainer = screen.getByTestId('hero-excerpt-highlight');
      const pill3 = screen.getByTestId('hero-citation-3');
      const pill2 = screen.getByTestId('hero-citation-2');
      const pill1 = screen.getByTestId('hero-citation-1');

      // Citation 1 check: PDF source
      expect(sourceEl).toHaveTextContent('Memory & Learning.pdf');
      expect(screen.getByText('Chapter 3 · Retrieval practice · Page 12 of 24')).toBeInTheDocument();
      expect(screen.getByText('3.2 RETRIEVAL AS A LEARNING EVENT')).toBeInTheDocument();
      expect(screen.getByText('PASSAGE REFERENCED BY CITATION 1')).toBeInTheDocument();
      expect(screen.getByText('Evidence 1 of 3')).toBeInTheDocument();
      expect(excerptContainer).toHaveTextContent('Repeated study can increase familiarity with a text.');
      expect(excerptContainer).toHaveTextContent('The important distinction is between recognizing an explanation');
      expect(quoteEl).toHaveTextContent('“Actively retrieving information from memory improves retention on a later test more than repeated study.”');
      expect(screen.getByText('12 / 24')).toBeInTheDocument();

      // Check button highlight classes
      expect(pill1.className).toContain('scale-105');
      expect(pill1.className).toContain('bg-[#8B83FF]');
      expect(pill2.className).not.toContain('scale-105');
      expect(pill3.className).not.toContain('scale-105');

      // Switch to Citation 2
      fireEvent.click(pill2);
      expect(sourceEl).toHaveTextContent('Cognitive Psychology.pdf');
      expect(screen.getByText('Chapter 6 · Familiarity vs Recall · Page 48 of 120')).toBeInTheDocument();
      expect(screen.getByText('6.1 RECOGNITION VERSUS PRODUCTION')).toBeInTheDocument();
      expect(screen.getByText('PASSAGE REFERENCED BY CITATION 2')).toBeInTheDocument();
      expect(screen.getByText('Evidence 2 of 3')).toBeInTheDocument();
      expect(excerptContainer).toHaveTextContent('Students often conflate fluent reading with actual mastery');
      expect(excerptContainer).toHaveTextContent('Testing forces direct retrieval paths');
      expect(quoteEl).toHaveTextContent('“Familiarity with a text is different from being able to recall it.”');
      expect(screen.getByText('48 / 120')).toBeInTheDocument();

      expect(pill2.className).toContain('scale-105');
      expect(pill2.className).toContain('bg-[#8B83FF]');
      expect(pill1.className).not.toContain('scale-105');
      expect(pill3.className).not.toContain('scale-105');

      // Switch to Citation 3: Video source
      fireEvent.click(pill3);
      expect(sourceEl).toHaveTextContent('Retrieval practice');
      expect(screen.getByText('YouTube lecture · 18:42')).toBeInTheDocument();
      expect(screen.getByText('LECTURE TIMESTAMP 18:42 — FEEDBACK LOOPS')).toBeInTheDocument();
      expect(screen.getByText('PASSAGE REFERENCED BY CITATION 3')).toBeInTheDocument();
      expect(screen.getByText('Evidence 3 of 3')).toBeInTheDocument();
      expect(excerptContainer).toHaveTextContent('Without immediate targeted feedback');
      expect(excerptContainer).toHaveTextContent('Re-evaluating the source material immediately after recall');
      expect(quoteEl).toHaveTextContent('“Feedback then helps you correct what you missed before the next attempt. Use feedback to correct gaps after an attempt to recall.”');
      expect(screen.getByText('18:42')).toBeInTheDocument();

      expect(pill3.className).toContain('scale-105');
      expect(pill3.className).toContain('bg-[#8B83FF]');
      expect(pill1.className).not.toContain('scale-105');
      expect(pill2.className).not.toContain('scale-105');
    });

    it('adversarial_test_rapid_repeated_clicks_and_idempotency', () => {
      render(<HeroSection />);

      const pill1 = screen.getByTestId('hero-citation-1');
      const pill3 = screen.getByTestId('hero-citation-3');
      const quoteEl = screen.getByTestId('hero-inspector-quote');

      // 50 rapid clicks on the already active Citation 1
      for (let i = 0; i < 50; i++) {
        fireEvent.click(pill1);
      }
      expect(quoteEl).toHaveTextContent(/Actively retrieving information/i);

      // Rapidly toggle back and forth between 1 and 3
      for (let i = 0; i < 20; i++) {
        fireEvent.click(pill3);
        expect(quoteEl).toHaveTextContent(/Feedback then helps you correct/i);
        fireEvent.click(pill1);
        expect(quoteEl).toHaveTextContent(/Actively retrieving information/i);
      }
    });

    it('adversarial_test_defaultCitation_prop_and_out_of_range_handling', () => {
      // 1. Initialized with Citation 2
      const { unmount: unmount2 } = render(<HeroSection defaultCitation={2} />);
      expect(screen.getByTestId('hero-inspector-source')).toHaveTextContent('Cognitive Psychology.pdf');
      expect(screen.getByTestId('hero-inspector-quote')).toHaveTextContent(/Familiarity with a text/i);
      unmount2();

      // 2. Initialized with Citation 3
      const { unmount: unmount3 } = render(<HeroSection defaultCitation={3} />);
      expect(screen.getByTestId('hero-inspector-source')).toHaveTextContent('Retrieval practice');
      expect(screen.getByTestId('hero-inspector-quote')).toHaveTextContent(/Feedback then helps you correct/i);
      unmount3();

      // 3. Initialized with out-of-range value (e.g. 99 as any)
      const { unmount: unmountFallback } = render(<HeroSection defaultCitation={99 as any} />);
      // Should safely fallback to Citation 1 without crashing
      expect(screen.getByTestId('hero-inspector-source')).toHaveTextContent('Memory & Learning.pdf');
      expect(screen.getByTestId('hero-inspector-quote')).toHaveTextContent(/Actively retrieving information/i);
      unmountFallback();
    });

    it('adversarial_test_cta_buttons_with_and_without_handlers', () => {
      const handleGetStarted = vi.fn();
      const handleExploreDemo = vi.fn();

      // With handlers provided
      const { unmount } = render(
        <HeroSection onGetStarted={handleGetStarted} onExploreDemo={handleExploreDemo} />
      );

      const getStartedBtn = screen.getByTestId('hero-get-started-btn');
      const exploreDemoBtn = screen.getByTestId('hero-explore-demo-btn');

      fireEvent.click(getStartedBtn);
      expect(handleGetStarted).toHaveBeenCalledTimes(1);

      fireEvent.click(exploreDemoBtn);
      expect(handleExploreDemo).toHaveBeenCalledTimes(1);
      unmount();

      // Without handlers provided (should not throw when clicked)
      render(<HeroSection />);
      expect(() => {
        fireEvent.click(screen.getByTestId('hero-get-started-btn'));
        fireEvent.click(screen.getByTestId('hero-explore-demo-btn'));
      }).not.toThrow();
    });

    it('adversarial_test_user_keyboard_tab_and_activation', async () => {
      const user = userEvent.setup();
      render(<HeroSection />);

      const pill1 = screen.getByTestId('hero-citation-1');
      const pill2 = screen.getByTestId('hero-citation-2');
      const quoteEl = screen.getByTestId('hero-inspector-quote');

      // Click pill 2 via keyboard
      pill2.focus();
      expect(document.activeElement).toBe(pill2);
      await user.keyboard('{Enter}');
      expect(quoteEl).toHaveTextContent(/Familiarity with a text is different/i);

      pill1.focus();
      expect(document.activeElement).toBe(pill1);
      await user.keyboard(' ');
      expect(quoteEl).toHaveTextContent(/Actively retrieving information/i);
    });
  });

  describe('FAQ Accordions: Adversarial Verification', () => {
    it('adversarial_test_rapid_toggle_concurrency_and_multi_open', () => {
      render(<FaqSection />);

      const triggers = [0, 1, 2, 3, 4].map((i) =>
        screen.getByTestId(`faq-accordion-trigger-${i}`)
      );

      // 1. Rapid toggling test on single item (50 clicks)
      // An even number of clicks (50) must end in collapsed state
      for (let i = 0; i < 50; i++) {
        fireEvent.click(triggers[0]);
      }
      expect(triggers[0]).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('faq-accordion-content-0')).not.toBeInTheDocument();

      // 51st click must end in expanded state
      fireEvent.click(triggers[0]);
      expect(triggers[0]).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('faq-accordion-content-0')).toBeInTheDocument();

      // Collapse it back
      fireEvent.click(triggers[0]);
      expect(triggers[0]).toHaveAttribute('aria-expanded', 'false');

      // 2. Open all 5 accordions simultaneously
      triggers.forEach((trigger, i) => {
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId(`faq-accordion-content-${i}`)).toBeInTheDocument();
      });

      // Verify all 5 are open at the same time
      for (let i = 0; i < 5; i++) {
        expect(triggers[i]).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByTestId(`faq-accordion-content-${i}`)).toBeInTheDocument();
      }

      // 3. Close all 5 accordions
      triggers.forEach((trigger, i) => {
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId(`faq-accordion-content-${i}`)).not.toBeInTheDocument();
      });
    });

    it('adversarial_test_aria_expanded_and_aria_controls_synchronization', () => {
      render(<FaqSection />);

      // Verify every accordion trigger and its controlled content
      for (let i = 0; i < 5; i++) {
        const trigger = screen.getByTestId(`faq-accordion-trigger-${i}`);
        const expectedControlsId = `faq-answer-${i}`;
        const expectedTriggerId = `faq-trigger-${i}`;

        // Initial closed state
        expect(trigger).toHaveAttribute('id', expectedTriggerId);
        expect(trigger).toHaveAttribute('aria-controls', expectedControlsId);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId(`faq-accordion-content-${i}`)).not.toBeInTheDocument();

        // Plus icon when closed (lucide-plus SVG)
        expect(trigger.querySelector('svg.lucide-plus')).toBeInTheDocument();
        expect(trigger.querySelector('svg.lucide-minus')).not.toBeInTheDocument();

        // Expand
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');

        // Minus icon when open (lucide-minus SVG)
        expect(trigger.querySelector('svg.lucide-minus')).toBeInTheDocument();
        expect(trigger.querySelector('svg.lucide-plus')).not.toBeInTheDocument();

        const content = screen.getByTestId(`faq-accordion-content-${i}`);
        expect(content).toBeInTheDocument();
        expect(content).toHaveAttribute('id', expectedControlsId);
        expect(content).toHaveAttribute('aria-labelledby', expectedTriggerId);
        expect(content).toHaveAttribute('role', 'region');

        // Collapse
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByTestId(`faq-accordion-content-${i}`)).not.toBeInTheDocument();
        expect(trigger.querySelector('svg.lucide-plus')).toBeInTheDocument();
      }
    });

    it('adversarial_test_keyboard_navigation_arrows_home_end_and_activation', () => {
      render(<FaqSection />);

      const triggers = [0, 1, 2, 3, 4].map((i) =>
        screen.getByTestId(`faq-accordion-trigger-${i}`)
      );

      // Focus trigger 0
      triggers[0].focus();
      expect(document.activeElement).toBe(triggers[0]);

      // 1. ArrowDown navigation: 0 -> 1 -> 2 -> 3 -> 4
      fireEvent.keyDown(triggers[0], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(triggers[1]);

      fireEvent.keyDown(triggers[1], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(triggers[2]);

      fireEvent.keyDown(triggers[2], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(triggers[3]);

      fireEvent.keyDown(triggers[3], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(triggers[4]);

      // 2. ArrowDown wrap-around: 4 -> 0
      fireEvent.keyDown(triggers[4], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(triggers[0]);

      // 3. ArrowUp wrap-around: 0 -> 4
      fireEvent.keyDown(triggers[0], { key: 'ArrowUp' });
      expect(document.activeElement).toBe(triggers[4]);

      // 4. ArrowUp navigation: 4 -> 3 -> 2
      fireEvent.keyDown(triggers[4], { key: 'ArrowUp' });
      expect(document.activeElement).toBe(triggers[3]);

      fireEvent.keyDown(triggers[3], { key: 'ArrowUp' });
      expect(document.activeElement).toBe(triggers[2]);

      // 5. Home key: from 2 -> 0
      fireEvent.keyDown(triggers[2], { key: 'Home' });
      expect(document.activeElement).toBe(triggers[0]);

      // 6. End key: from 0 -> 4
      fireEvent.keyDown(triggers[0], { key: 'End' });
      expect(document.activeElement).toBe(triggers[4]);

      // 7. Native activation on focused trigger via Click
      expect(triggers[4]).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(triggers[4]);
      expect(triggers[4]).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('faq-accordion-content-4')).toBeInTheDocument();

      fireEvent.click(triggers[4]);
      expect(triggers[4]).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('faq-accordion-content-4')).not.toBeInTheDocument();
    });

    it('adversarial_test_faq_keyboard_activation_enter_and_space', async () => {
      const user = userEvent.setup();
      render(<FaqSection />);

      const trigger1 = screen.getByTestId('faq-accordion-trigger-1');
      const trigger3 = screen.getByTestId('faq-accordion-trigger-3');

      // Expand trigger 1 using Enter key
      trigger1.focus();
      expect(document.activeElement).toBe(trigger1);
      await user.keyboard('{Enter}');
      expect(trigger1).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('faq-accordion-content-1')).toBeInTheDocument();

      // Collapse trigger 1 using Enter key
      await user.keyboard('{Enter}');
      expect(trigger1).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('faq-accordion-content-1')).not.toBeInTheDocument();

      // Expand trigger 3 using Space key
      trigger3.focus();
      expect(document.activeElement).toBe(trigger3);
      await user.keyboard(' ');
      expect(trigger3).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('faq-accordion-content-3')).toBeInTheDocument();

      // Collapse trigger 3 using Space key
      await user.keyboard(' ');
      expect(trigger3).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('faq-accordion-content-3')).not.toBeInTheDocument();
    });

    it('adversarial_test_interleaved_multi_item_toggling_isolation', () => {
      render(<FaqSection />);

      const triggers = [0, 1, 2, 3, 4].map((i) =>
        screen.getByTestId(`faq-accordion-trigger-${i}`)
      );

      // Open 0, 2, 4
      fireEvent.click(triggers[0]);
      fireEvent.click(triggers[2]);
      fireEvent.click(triggers[4]);

      expect(triggers[0]).toHaveAttribute('aria-expanded', 'true');
      expect(triggers[1]).toHaveAttribute('aria-expanded', 'false');
      expect(triggers[2]).toHaveAttribute('aria-expanded', 'true');
      expect(triggers[3]).toHaveAttribute('aria-expanded', 'false');
      expect(triggers[4]).toHaveAttribute('aria-expanded', 'true');

      // Verify specific answers are rendered for 0, 2, 4
      expect(screen.getByTestId('faq-accordion-content-0')).toHaveTextContent(/StudyLM indexes your uploaded materials/i);
      expect(screen.getByTestId('faq-accordion-content-2')).toHaveTextContent(/When StudyLM answers, it embeds interactive citation chips/i);
      expect(screen.getByTestId('faq-accordion-content-4')).toHaveTextContent(/Because every answer is accompanied by verified quote cards/i);

      // Close 2
      fireEvent.click(triggers[2]);
      expect(triggers[2]).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('faq-accordion-content-2')).not.toBeInTheDocument();
      // Ensure 0 and 4 remain untouched
      expect(triggers[0]).toHaveAttribute('aria-expanded', 'true');
      expect(triggers[4]).toHaveAttribute('aria-expanded', 'true');

      // Open 1
      fireEvent.click(triggers[1]);
      expect(triggers[1]).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByTestId('faq-accordion-content-1')).toHaveTextContent(/Standard chat AIs rely on pre-trained weights/i);
    });

    it('adversarial_test_unhandled_keys_do_not_hijack_focus', () => {
      render(<FaqSection />);

      const trigger0 = screen.getByTestId('faq-accordion-trigger-0');
      trigger0.focus();
      expect(document.activeElement).toBe(trigger0);

      // Pressing other keys like 'Tab', 'Escape', 'a' shouldn't move focus or crash
      fireEvent.keyDown(trigger0, { key: 'Escape' });
      expect(document.activeElement).toBe(trigger0);

      fireEvent.keyDown(trigger0, { key: 'a' });
      expect(document.activeElement).toBe(trigger0);
    });
  });
});
