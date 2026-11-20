'use client';

/**
 * Master Grounded Chat Container
 * File: frontend/src/components/chat/ChatContainer.tsx
 *
 * Implements:
 * - Session message restoration from GET /api/notebooks/:id/messages
 * - Real-time SSE query dispatch via useSSEStream
 * - Calibrated refusal handling & 429 lockout integration
 * - Document summarization shortcut trigger
 * - Starter prompt chips submission
 * - Empty source scope query guard
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { apiClient } from '@/lib/api/client';
import { ChatMessageRead } from '@/types/api';
import { useSSEStream } from '@/lib/api/sseStream';
import { ChatMessageList } from './ChatMessageList';
import { ChatInput } from './ChatInput';
import { RateLimitIndicator } from './RateLimitIndicator';
import { AlertTriangle } from 'lucide-react';

export interface ChatContainerProps {
  notebookId?: string | null;
  className?: string;
}

export function ChatContainer({
  notebookId: propNotebookId,
  className = '',
}: ChatContainerProps) {
  const storeNotebookId = useWorkspaceStore((s) => s.activeNotebookId);
  const selectedSourceIds = useWorkspaceStore((s) => s.selectedSourceIds);
  const totalSourceCount = useWorkspaceStore((s) => s.totalSourceCount);
  const setActiveCitations = useWorkspaceStore((s) => s.setActiveCitations);

  const activeNotebookId = propNotebookId !== undefined ? propNotebookId : storeNotebookId;

  const [messages, setMessages] = useState<ChatMessageRead[]>([]);
  const [, setIsLoadingHistory] = useState(false);

  const {
    isStreaming,
    streamingText,
    streamingCitations,
    refusalMessage,
    streamQuery,
  } = useSSEStream();

  // Synchronize streaming citations into workspace store
  useEffect(() => {
    if (streamingCitations && streamingCitations.length > 0) {
      setActiveCitations(streamingCitations);
    }
  }, [streamingCitations, setActiveCitations]);

  // Load message history on notebook change
  useEffect(() => {
    let isCancelled = false;
    if (!activeNotebookId) {
      setMessages([]);
      return;
    }

    setIsLoadingHistory(true);
    apiClient
      .getMessages(activeNotebookId)
      .then((history) => {
        if (!isCancelled) {
          setMessages(history);
          // Restore citations from the latest assistant message with citations
          const lastAssistant = [...history]
            .reverse()
            .find((m) => m.role === 'assistant' && m.citations && m.citations.length > 0);
          if (lastAssistant?.citations) {
            setActiveCitations(lastAssistant.citations);
          }
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setMessages([]);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingHistory(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeNotebookId, setActiveCitations]);

  // Handle user query submission
  const handleSendMessage = useCallback(
    async (queryText: string) => {
      if (!activeNotebookId || !queryText.trim()) return;

      // Empty source scope guard: block query if notebook has sources but none are selected
      if (totalSourceCount > 0 && selectedSourceIds.length === 0) {
        return;
      }

      // 1. Optimistic user bubble & immediate query counter increment
      const userMessage: ChatMessageRead = {
        id: `msg-${Date.now()}`,
        notebook_id: activeNotebookId,
        role: 'user',
        content: queryText.trim(),
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      const currentQuota = useWorkspaceStore.getState().rateLimit;
      useWorkspaceStore.getState().setRateLimitStatus({
        queryCount: (currentQuota?.queryCount ?? 0) + 1,
      });

      // 2. Persist user message to backend
      apiClient.createMessage(activeNotebookId, {
        role: 'user',
        content: queryText.trim(),
      }).catch(() => {});

      // 3. Initiate SSE stream forwarding selectedSourceIds
      try {
        const result = await streamQuery(activeNotebookId, queryText, selectedSourceIds);
        if (result && result.text) {
          const assistantMsg: ChatMessageRead = {
            id: `msg-${Date.now()}-assistant`,
            notebook_id: activeNotebookId,
            role: 'assistant',
            content: result.text,
            citations: result.citations,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          if (result.citations && result.citations.length > 0) {
            setActiveCitations(result.citations);
          }
          apiClient.createMessage(activeNotebookId, {
            role: 'assistant',
            content: result.text,
            citations: result.citations,
          } as any).catch(() => {});
        }
      } catch {
        // Handled via useSSEStream error state
      }
    },
    [activeNotebookId, selectedSourceIds, totalSourceCount, streamQuery, setActiveCitations]
  );

  // Summarize shortcut flow
  const handleSummarize = useCallback(() => {
    handleSendMessage('Summarize this document and provide key takeaways.');
  }, [handleSendMessage]);

  const isEmptyScopeBlocked = totalSourceCount > 0 && selectedSourceIds.length === 0;

  return (
    <div
      data-testid="chat-container"
      className={`flex flex-col h-full bg-card text-foreground overflow-hidden ${className}`}
    >
      {/* Rate Limit Header Indicator */}
      <RateLimitIndicator />

      {/* Empty Source Scope Alert Guard */}
      {isEmptyScopeBlocked && (
        <div
          role="alert"
          data-testid="empty-source-scope-alert"
          className="mx-4 mt-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-500 text-xs flex items-center gap-2 animate-in fade-in"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span data-testid="empty-scope-alert">
            Please select at least one source to query
          </span>
        </div>
      )}

      {/* Message Feed */}
      <ChatMessageList
        messages={messages}
        isStreaming={isStreaming}
        streamingText={streamingText}
        streamingCitations={streamingCitations}
        refusalMessage={refusalMessage}
        onSelectPrompt={handleSendMessage}
      />

      {/* Prompt Input */}
      <ChatInput
        onSendMessage={handleSendMessage}
        onSummarize={handleSummarize}
        isStreaming={isStreaming}
        disabled={!activeNotebookId || isEmptyScopeBlocked}
      />
    </div>
  );
}
