/**
 * Phase 3: Calibrated Refusal & Rate Limit Interceptor Tests
 * File: frontend/tests/phase3/test_chat_refusal_and_rate_limit.test.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { RateLimitIndicator } from '@/components/chat/RateLimitIndicator';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser } from '../mocks/fixtures';

describe('Phase 3: Calibrated Refusal & Rate Limit 429 UI Handling', () => {
  beforeEach(() => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');
    useAuthStore.getState().setUser(mockUser);
    useWorkspaceStore.getState().reset();
  });

  it('test_calibrated_refusal_renders_clear_notice', async () => {
    render(<ChatContainer notebookId="nb-physics-101" />);

    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    const sendBtn = screen.getByTestId('send-message-button');

    fireEvent.change(input, {
      target: { value: 'Explain quantum gravity refusal in classical notes' },
    });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      const refusalNotice = screen.getByTestId('calibrated-refusal-notice');
      expect(refusalNotice).toBeInTheDocument();
      expect(refusalNotice).toHaveTextContent(
        "I don't have enough information in your notes to answer that."
      );
    });
  });

  it('test_rate_limit_429_disables_chat_input', async () => {
    // Force rate limited state in store
    useWorkspaceStore.getState().setRateLimitStatus({
      isRateLimited: true,
      isLocked: true,
      retryAfterSeconds: 3600,
    });

    render(<ChatContainer notebookId="nb-physics-101" />);

    const input = screen.getByTestId('chat-input');
    const sendBtn = screen.getByTestId('send-message-button');

    expect(input).toBeDisabled();
    expect(sendBtn).toBeDisabled();
    expect(
      screen.getByText(/Hourly rate limit reached \(60 queries\/hr\)/i)
    ).toBeInTheDocument();
  });

  it('test_retry_after_timer_countdown', async () => {
    vi.useFakeTimers();

    useWorkspaceStore.getState().setRateLimitStatus({
      isRateLimited: true,
      isLocked: true,
      retryAfterSeconds: 120, // 2 minutes
    });

    render(<RateLimitIndicator />);

    const countdown = screen.getByTestId('rate-limit-countdown');
    expect(countdown).toHaveTextContent('02:00');

    // Advance by 1 second
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(countdown).toHaveTextContent('01:59');

    // Advance by 59 seconds
    act(() => {
      vi.advanceTimersByTime(59000);
    });
    expect(countdown).toHaveTextContent('01:00');

    vi.useRealTimers();
  });
});
