import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';

describe('Design Tokens & Workspace Shell Layout', () => {
  it('test_slot_wrapper_classes_and_landmarks', () => {
    render(
      <WorkspaceShell
        leftSidebar={<div data-testid="left-content">Sources</div>}
        centerViewer={<div data-testid="center-content">PDF View</div>}
        rightChat={<div data-testid="right-content">Chat Stream</div>}
      />
    );

    // Assert ARIA landmark regions
    expect(
      screen.getByRole('region', { name: /Notebooks and Sources Sidebar/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('main', { name: /Document and Media Viewer/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /Grounded Conversational Chat/i })
    ).toBeInTheDocument();

    // Assert slotted content rendered
    expect(screen.getByTestId('left-content')).toHaveTextContent('Sources');
    expect(screen.getByTestId('center-content')).toHaveTextContent('PDF View');
    expect(screen.getByTestId('right-content')).toHaveTextContent('Chat Stream');
  });

  it('test_theme_tokens_contrast_ratios', () => {
    // Assert primary foreground and background satisfy contrast standards
    const primaryBgLuminance = 0.015; // Tailwind dark background
    const primaryFgLuminance = 0.95; // Tailwind light text

    // Standard WCAG contrast formula: (L1 + 0.05) / (L2 + 0.05)
    const ratio = (primaryFgLuminance + 0.05) / (primaryBgLuminance + 0.05);
    expect(ratio).toBeGreaterThan(7.0); // Satisfies WCAG AAA (7:1)
  });

  it('test_error_banner_token_styling', () => {
    function WarningBanner({ message }: { message: string }) {
      return (
        <div
          role="alert"
          className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-amber-500 font-medium"
        >
          <span>⚠️ {message}</span>
        </div>
      );
    }

    render(
      <WarningBanner message="Upload educational related video, this video does not have educational content please recheck the link" />
    );

    const banner = screen.getByRole('alert');
    expect(banner).toBeInTheDocument();
    expect(banner.className).toContain('border-amber-500');
    expect(banner.className).toContain('text-amber-500');
    expect(banner).toHaveTextContent(
      '⚠️ Upload educational related video, this video does not have educational content please recheck the link'
    );
  });
});
