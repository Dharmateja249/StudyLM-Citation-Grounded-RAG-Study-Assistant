'use client';

/**
 * Chat Prompt Input & Query Dispatcher
 * File: frontend/src/components/chat/ChatInput.tsx
 *
 * Implements:
 * - Query input textarea with Enter-to-submit and Shift+Enter newline
 * - Input lockout under HTTP 429 rate limit
 * - "Summarize Document" action shortcut
 * - Send action with loading spinner
 */

import React, { useState, useRef, useEffect } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Send, Sparkles, Loader2 } from 'lucide-react';

export interface ChatInputProps {
  onSendMessage: (query: string) => void;
  onSummarize?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ChatInput({
  onSendMessage,
  onSummarize,
  isStreaming = false,
  disabled = false,
  className = '',
}: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { rateLimit } = useWorkspaceStore();

  const isRateLimited = Boolean(rateLimit.isLocked || rateLimit.isRateLimited);
  const isInputDisabled = disabled || isStreaming || isRateLimited;

  useEffect(() => {
    if (!isInputDisabled && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isInputDisabled]);

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = text.trim();
    if (!query || isInputDisabled) return;
    onSendMessage(query);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={`p-3 border-t border-border bg-card/60 flex flex-col gap-2 ${className}`}>
      {/* Action Shortcuts Bar */}
      <div className="flex items-center justify-between text-xs">
        <button
          type="button"
          data-testid="summarize-shortcut-button"
          onClick={onSummarize}
          disabled={isInputDisabled}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/80 disabled:opacity-50 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Summarize Document</span>
        </button>
      </div>

      {/* Input Box */}
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <textarea
          ref={textareaRef}
          data-testid="chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isInputDisabled}
          rows={1}
          placeholder={
            isRateLimited
              ? 'Hourly rate limit reached (60 queries/hr)'
              : 'Ask a question about your notes...'
          }
          className="w-full resize-none rounded-xl border border-input bg-background px-3.5 py-2.5 pr-12 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
        />

        <button
          type="submit"
          role="button"
          data-testid="send-message-button"
          disabled={!text.trim() || isInputDisabled}
          aria-label="Send message"
          className="absolute right-2 p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:hover:bg-primary transition-all cursor-pointer disabled:cursor-not-allowed"
        >
          {isStreaming ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary-foreground" />
          ) : (
            <Send className="w-4 h-4 text-primary-foreground" />
          )}
        </button>
      </form>
    </div>
  );
}
