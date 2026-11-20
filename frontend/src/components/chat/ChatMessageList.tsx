'use client';

/**
 * Conversational Message List & Grounded Thread
 * File: frontend/src/components/chat/ChatMessageList.tsx
 *
 * Implements:
 * - User and assistant chat bubbles
 * - Calibrated refusal warning alert ("I don't have enough information in your notes to answer that.")
 * - Grounded markdown with interactive citation pills
 * - Real-time streaming bubble with typing indicator
 * - Auto-scroll to bottom on new content
 */

import React, { useEffect, useRef } from 'react';
import { ChatMessageRead, ResolvedCitation } from '@/types/api';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { GroundedMarkdown } from './GroundedMarkdown';
import { User, Bot, AlertCircle, Loader2, Sparkles } from 'lucide-react';

const STARTER_CHIPS = [
  {
    id: 'summarize',
    text: 'Summarize this material',
    testId: 'starter-chip-summarize',
    aliasTestId: 'starter-prompt-chip-summarize-this-material',
  },
  {
    id: 'compare',
    text: 'Compare viewpoints',
    testId: 'starter-chip-compare',
    aliasTestId: 'starter-prompt-chip-compare-viewpoints',
  },
  {
    id: 'questions',
    text: 'Generate practice questions',
    testId: 'starter-chip-questions',
    aliasTestId: 'starter-prompt-chip-generate-practice-questions',
  },
  {
    id: 'analogies',
    text: 'Explain with simple analogies',
    testId: 'starter-chip-analogies',
    aliasTestId: 'starter-prompt-chip-explain-with-simple-analogies',
  },
];

export interface ChatMessageListProps {
  messages: ChatMessageRead[];
  isStreaming?: boolean;
  streamingText?: string;
  streamingCitations?: ResolvedCitation[];
  refusalMessage?: string | null;
  onSelectPrompt?: (prompt: string) => void;
  className?: string;
}

export function ChatMessageList({
  messages,
  isStreaming = false,
  streamingText = '',
  streamingCitations = [],
  refusalMessage = null,
  onSelectPrompt,
  className = '',
}: ChatMessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingText, isStreaming]);

  return (
    <div
      data-testid="chat-message-list"
      className={`flex-1 overflow-y-auto p-4 space-y-4 ${className}`}
    >
      {messages.length === 0 && !isStreaming && (
        <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted-foreground">
          <Bot className="w-10 h-10 mb-3 text-muted-foreground/60" />
          <h3 className="font-semibold text-foreground text-sm mb-1">
            Grounded Conversational Workspace
          </h3>
          <p className="text-xs max-w-sm mb-4">
            Ask any question about your uploaded PDF documents or YouTube lectures. Every answer is
            strictly grounded with verifiable citations.
          </p>

          {/* Clickable Starter Prompt Chips */}
          <div
            className="flex flex-wrap gap-2 justify-center max-w-md"
            data-testid="starter-prompt-chips"
          >
            {STARTER_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => onSelectPrompt?.(chip.text)}
                data-testid={chip.testId}
                data-testid-alias={chip.aliasTestId}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border bg-card hover:bg-primary/10 hover:border-primary/40 text-xs font-medium text-foreground transition-all cursor-pointer shadow-sm hover:shadow"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#8B83FF]" />
                <span>{chip.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Render Message History */}
      {messages.map((msg) => {
        const isUser = msg.role === 'user';
        return (
          <div
            key={msg.id}
            data-testid={isUser ? 'user-message-bubble' : 'assistant-message-bubble'}
            className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
          >
            {!isUser && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary">
                <Bot className="w-4 h-4" />
              </div>
            )}

            <div
              onClick={() => {
                if (!isUser && msg.citations && msg.citations.length > 0) {
                  useWorkspaceStore.getState().setActiveCitations(msg.citations);
                }
              }}
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                isUser
                  ? 'bg-primary text-primary-foreground rounded-tr-sm'
                  : 'bg-muted/60 text-foreground border border-border/50 rounded-tl-sm hover:border-primary/40 transition-colors cursor-pointer'
              }`}
            >
              {isUser ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <GroundedMarkdown content={msg.content} citations={msg.citations} />
              )}
            </div>

            {isUser && (
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-muted-foreground">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        );
      })}

      {/* Real-Time Streaming Assistant Bubble */}
      {isStreaming && (
        <div
          data-testid="streaming-assistant-bubble"
          className="flex gap-3 justify-start"
        >
          <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-primary animate-pulse">
            <Bot className="w-4 h-4" />
          </div>

          <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm bg-muted/60 text-foreground border border-border/50 rounded-tl-sm">
            {streamingText ? (
              <GroundedMarkdown content={streamingText} citations={streamingCitations} />
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Consulting notes & sources...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Calibrated Retrieval Refusal Banner */}
      {refusalMessage && (
        <div
          data-testid="calibrated-refusal-notice"
          className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-medium"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0 text-amber-500" />
          <span>{refusalMessage}</span>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
