'use client';

/**
 * 60 queries/hr Rate Limit Indicator & Real-Time Countdown Banner
 * File: frontend/src/components/chat/RateLimitIndicator.tsx
 *
 * Implements:
 * - Real-time query quota tracking (X / 60 queries this hour)
 * - HTTP 429 lock banner with live countdown timer (MM:SS)
 * - Automatic unlock dispatch when countdown timer reaches zero
 */

import React, { useState, useEffect } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { AlertCircle, Clock } from 'lucide-react';

export interface RateLimitIndicatorProps {
  className?: string;
}

export function RateLimitIndicator({ className = '' }: RateLimitIndicatorProps) {
  const { rateLimit, setRateLimitStatus } = useWorkspaceStore();
  const [secondsRemaining, setSecondsRemaining] = useState<number>(
    rateLimit.retryAfterSeconds ?? 0
  );

  useEffect(() => {
    setSecondsRemaining(rateLimit.retryAfterSeconds ?? 0);
  }, [rateLimit.retryAfterSeconds, rateLimit.isLocked]);

  // Sync latest rate limit status on mount
  useEffect(() => {
    let isMounted = true;
    fetch('/api/rate-limit')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data && typeof data.query_count === 'number') {
          setRateLimitStatus({
            queryCount: data.query_count,
            maxQueries: data.max_queries || 60,
            isLocked: data.is_locked,
            retryAfterSeconds: data.retry_after_seconds,
          });
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [setRateLimitStatus]);

  // Window event listener for rate limit triggers
  useEffect(() => {
    const handleRateLimitEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ retryAfterSeconds?: number }>;
      const seconds = customEvent.detail?.retryAfterSeconds ?? 3600;
      setSecondsRemaining(seconds);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('RATE_LIMIT_TRIGGERED', handleRateLimitEvent);
      return () => {
        window.removeEventListener('RATE_LIMIT_TRIGGERED', handleRateLimitEvent);
      };
    }
  }, []);

  // Live countdown timer
  useEffect(() => {
    if (!rateLimit.isLocked && !rateLimit.isRateLimited) {
      return;
    }

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [rateLimit.isLocked, rateLimit.isRateLimited]);

  // Decoupled unlock handler when timer reaches zero
  useEffect(() => {
    if (secondsRemaining === 0 && (rateLimit.isLocked || rateLimit.isRateLimited)) {
      setRateLimitStatus({ isLocked: false, isRateLimited: false, retryAfterSeconds: 0 });
    }
  }, [secondsRemaining, rateLimit.isLocked, rateLimit.isRateLimited, setRateLimitStatus]);

  // Format seconds into MM:SS
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isLocked = rateLimit.isLocked || rateLimit.isRateLimited || secondsRemaining > 0;

  if (isLocked) {
    return (
      <div
        data-testid="rate-limit-banner"
        className={`flex items-center justify-between gap-2 px-3 py-2 text-xs rounded-lg border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 font-medium ${className}`}
      >
        <div className="flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span>Hourly rate limit reached (60 queries/hr)</span>
        </div>
        <div className="flex items-center gap-1 font-mono font-semibold bg-red-500/20 px-2 py-0.5 rounded">
          <Clock className="w-3.5 h-3.5" />
          <span data-testid="rate-limit-countdown">{formatTime(secondsRemaining)}</span>
        </div>
      </div>
    );
  }

  // Active query status indicator
  return (
    <div
      data-testid="rate-limit-counter"
      className={`flex items-center justify-between px-3 py-1.5 text-xs text-muted-foreground border-b border-border/40 ${className}`}
    >
      <span>Queries this hour</span>
      <span className="font-mono font-medium text-foreground">
        {rateLimit.queryCount} / {rateLimit.maxQueries}
      </span>
    </div>
  );
}
