/**
 * Phase 3: Conversational Chat Thread & History Restoration Tests
 * File: frontend/tests/phase3/test_chat_input_and_history.test.tsx
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser } from '../mocks/fixtures';

describe('Phase 3: Chat Input, Thread History & Summarize Shortcuts', () => {
  beforeEach(() => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');
    useAuthStore.getState().setUser(mockUser);
    useWorkspaceStore.getState().reset();
  });

  it('test_submitting_query_appends_user_bubble_immediately', async () => {
    render(<ChatContainer notebookId="nb-physics-101" />);

    const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    const sendBtn = screen.getByTestId('send-message-button');

    fireEvent.change(input, { target: { value: 'How does friction affect acceleration?' } });
    fireEvent.click(sendBtn);

    // User message bubble appears immediately in feed
    expect(
      screen.getByText('How does friction affect acceleration?')
    ).toBeInTheDocument();

    // Input clears
    expect(input.value).toBe('');
  });

  it('test_chat_history_restoration_on_notebook_select', async () => {
    render(<ChatContainer notebookId="nb-physics-101" />);

    // Waits for mock messages from nb-physics-101 to load
    await waitFor(() => {
      expect(screen.getByText("What is Newton's second law?")).toBeInTheDocument();
      expect(
        screen.getByText(
          /Newton's second law defines the relationship between net force, mass, and acceleration/i
        )
      ).toBeInTheDocument();
      expect(screen.getByTestId('citation-pill')).toBeInTheDocument();
    });
  });

  it('test_summarize_source_shortcut_triggers_summary_flow', async () => {
    render(<ChatContainer notebookId="nb-physics-101" />);

    const summarizeBtn = screen.getByTestId('summarize-shortcut-button');
    fireEvent.click(summarizeBtn);

    // Dispatches summary query
    await waitFor(() => {
      expect(
        screen.getByText(/Summarize this document and provide key takeaways/i)
      ).toBeInTheDocument();
    });
  });
});
