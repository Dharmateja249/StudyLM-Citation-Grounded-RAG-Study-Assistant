/**
 * StudyLM SSE Streaming Client & Incremental Packet Parser
 * File: frontend/src/lib/api/sseStream.ts
 *
 * Implements:
 * - Incremental SSE parser handling fragmented chunk boundaries
 * - Event types: 'token', 'citation', 'refusal', 'content', 'done', 'error'
 * - HTTP 401 token expiration and mid-stream abort handling
 * - HTTP 429 rate-limit interceptor integration
 * - useSSEStream React hook
 */

import { useState, useCallback, useRef } from 'react';
import { ResolvedCitation } from '@/types/api';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { AuthenticationError, RateLimitError } from './client';

export interface ParseSseCallbacks {
  onToken?: (token: string) => void;
  onCitation?: (citation: ResolvedCitation) => void;
  onRefusal?: (message: string) => void;
  onDone?: (totalCitations?: number) => void;
  onError?: (error: { message: string; code?: string }) => void;
  onContent?: (text: string, citations: ResolvedCitation[]) => void;
}

export interface ParseSseOptions {
  signal?: AbortSignal;
}

/**
 * Incrementally parses an SSE ReadableStream, handling fragmented chunks and arbitrary byte boundaries.
 */
export async function parseSseStream(
  stream: ReadableStream<Uint8Array>,
  callbacks: ParseSseCallbacks,
  options?: ParseSseOptions
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let buffer = '';

  const processMessageBlock = (block: string) => {
    if (!block.trim()) return;
    const lines = block.split(/\r?\n/);
    let eventType = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }

    const rawData = dataLines.join('\n').trim();
    if (!rawData) return;

    let parsed: any = null;
    try {
      parsed = JSON.parse(rawData);
    } catch {
      parsed = rawData;
    }

    const effectiveEvent =
      eventType !== 'message'
        ? eventType
        : typeof parsed === 'object' && parsed !== null && parsed.type
        ? parsed.type
        : 'token';

    switch (effectiveEvent) {
      case 'token': {
        const tokenContent =
          typeof parsed === 'object' && parsed !== null
            ? (parsed.content ?? parsed.text ?? parsed.token ?? '')
            : String(parsed);
        if (tokenContent && callbacks.onToken) {
          callbacks.onToken(tokenContent);
        }
        break;
      }
      case 'citation': {
        const citation = (parsed?.citation || parsed) as ResolvedCitation;
        if (citation && callbacks.onCitation) {
          callbacks.onCitation(citation);
        }
        break;
      }
      case 'refusal': {
        const refusalMsg =
          typeof parsed === 'object' && parsed !== null
            ? (parsed.message ??
              parsed.detail ??
              "I don't have enough information in your notes to answer that.")
            : String(parsed);
        if (callbacks.onRefusal) {
          callbacks.onRefusal(refusalMsg);
        }
        break;
      }
      case 'content': {
        const text = parsed?.text ?? parsed?.content ?? '';
        const citations: ResolvedCitation[] = parsed?.citations ?? [];
        if (text && callbacks.onToken) {
          callbacks.onToken(text);
        }
        if (citations.length > 0 && callbacks.onCitation) {
          for (const cite of citations) {
            callbacks.onCitation(cite);
          }
        }
        if (callbacks.onContent) {
          callbacks.onContent(text, citations);
        }
        break;
      }
      case 'done': {
        const total =
          typeof parsed === 'object' && parsed !== null
            ? parsed.total_citations
            : undefined;
        if (typeof parsed === 'object' && parsed !== null && typeof parsed.query_count === 'number') {
          useWorkspaceStore.getState().setRateLimitStatus({
            queryCount: parsed.query_count,
            maxQueries: parsed.max_queries ?? 60,
          });
        }
        if (callbacks.onDone) {
          callbacks.onDone(total);
        }
        break;
      }
      case 'error': {
        const errMsg =
          typeof parsed === 'object' && parsed !== null
            ? (parsed.message ?? parsed.detail ?? 'Stream error occurred')
            : String(parsed);
        const errCode = parsed?.code;
        if (callbacks.onError) {
          callbacks.onError({ message: errMsg, code: errCode });
        }
        break;
      }
      default: {
        if (typeof parsed === 'string' && callbacks.onToken) {
          callbacks.onToken(parsed);
        }
        break;
      }
    }
  };

  try {
    while (true) {
      if (options?.signal?.aborted) {
        await reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer.trim()) {
          processMessageBlock(buffer);
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let delimiterMatch: RegExpMatchArray | null;
      while ((delimiterMatch = buffer.match(/\r?\n\r?\n/)) !== null) {
        const matchIndex = delimiterMatch.index!;
        const matchLength = delimiterMatch[0].length;
        const completeBlock = buffer.slice(0, matchIndex);
        buffer = buffer.slice(matchIndex + matchLength);
        processMessageBlock(completeBlock);
      }
    }
  } catch (err: unknown) {
    if (callbacks.onError) {
      const error = err as Error;
      callbacks.onError({ message: error.message || 'Error reading stream' });
    }
    throw err;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Initiates an authenticated POST request to /api/notebooks/:id/query/stream
 */
export async function streamChatQuery(
  notebookId: string,
  query: string,
  callbacks: ParseSseCallbacks,
  options?: {
    sourceIds?: string[];
    signal?: AbortSignal;
  }
): Promise<void> {
  const token = useAuthStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Cross-realm AbortSignal adapter for Node.js / JSDOM test environments
  let fetchSignal = options?.signal;
  if (fetchSignal) {
    try {
      new Request('http://localhost', { signal: fetchSignal });
    } catch {
      // underlying Request implementation rejected cross-realm signal
      try {
        let RootAC: typeof AbortController | undefined;
        if (typeof process !== 'undefined' && process.versions?.node) {
          const vm = (globalThis as any).require?.('node:vm');
          RootAC = vm?.runInThisContext('AbortController');
        }
        if (RootAC) {
          const bridge = new RootAC();
          if (fetchSignal.aborted) {
            bridge.abort();
          } else {
            fetchSignal.addEventListener('abort', () => bridge.abort());
          }
          fetchSignal = bridge.signal;
        } else {
          fetchSignal = undefined;
        }
      } catch {
        fetchSignal = undefined;
      }
    }
  }
  const response = await fetch(`/api/notebooks/${notebookId}/query/stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      query,
      source_ids: options?.sourceIds,
    }),
    signal: fetchSignal,
  });

  if (response.status === 401) {
    useAuthStore.getState().handleExpiredSession();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('SESSION_EXPIRED'));
    }
    throw new AuthenticationError('Session expired during query stream');
  }

  if (response.status === 429) {
    const retryHeader = response.headers.get('Retry-After');
    const retryAfterSeconds = retryHeader ? parseInt(retryHeader, 10) || 3600 : 3600;
    useWorkspaceStore.getState().setRateLimitStatus({
      isRateLimited: true,
      isLocked: true,
      retryAfterSeconds,
    });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('RATE_LIMIT_TRIGGERED', {
          detail: { retryAfterSeconds },
        })
      );
    }
    throw new RateLimitError(
      'Rate limit exceeded: Maximum 60 queries per hour.',
      retryAfterSeconds
    );
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const message =
      errBody.detail || errBody.message || `Query failed with HTTP ${response.status}`;
    if (callbacks.onError) {
      callbacks.onError({ message });
    }
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error('ReadableStream not supported on response body');
  }

  const queryCountHeader = response.headers.get('x-ratelimit-querycount');
  const maxQueriesHeader = response.headers.get('x-ratelimit-maxqueries');
  if (queryCountHeader) {
    const parsedCount = parseInt(queryCountHeader, 10);
    const parsedMax = maxQueriesHeader ? parseInt(maxQueriesHeader, 10) : 60;
    if (!isNaN(parsedCount)) {
      useWorkspaceStore.getState().setRateLimitStatus({
        queryCount: parsedCount,
        maxQueries: parsedMax,
      });
    }
  }

  await parseSseStream(response.body, callbacks, { signal: options?.signal });
}

/**
 * React hook for consuming SSE chat streams with sentence buffering and live citations.
 */
export function useSSEStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<ResolvedCitation[]>([]);
  const [refusalMessage, setRefusalMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const abortStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const streamQuery = useCallback(
    async (
      notebookId: string,
      query: string,
      sourceIds?: string[]
    ): Promise<{ text: string; citations: ResolvedCitation[] } | null> => {
      abortStream();
      setIsStreaming(true);
      setStreamingText('');
      setStreamingCitations([]);
      setRefusalMessage(null);
      setError(null);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      let fullText = '';
      const citationsMap = new Map<number, ResolvedCitation>();

      try {
        await streamChatQuery(
          notebookId,
          query,
          {
            onToken: (token) => {
              fullText += token;
              setStreamingText((prev) => prev + token);
            },
            onCitation: (citation) => {
              const markerId = citation.marker_id ?? citationsMap.size + 1;
              citationsMap.set(markerId, citation);
              setStreamingCitations((prev) => {
                if (prev.some((c) => c.marker_id === citation.marker_id)) {
                  return prev;
                }
                return [...prev, citation];
              });
            },
            onRefusal: (message) => {
              setRefusalMessage(message);
            },
            onDone: () => {
              setIsStreaming(false);
            },
            onError: (err) => {
              setError(err.message);
              setIsStreaming(false);
            },
          },
          { sourceIds, signal: controller.signal }
        );

        return {
          text: fullText,
          citations: Array.from(citationsMap.values()),
        };
      } catch (err: unknown) {
        const errorObj = err as Error;
        if (errorObj.name !== 'AbortError') {
          setError(errorObj.message || 'Stream connection failed');
          throw err;
        }
        return null;
      } finally {
        setIsStreaming(false);
      }
    },
    [abortStream]
  );

  return {
    isStreaming,
    streamingText,
    streamingCitations,
    refusalMessage,
    error,
    streamQuery,
    abortStream,
    resetStream: () => {
      abortStream();
      setStreamingText('');
      setStreamingCitations([]);
      setRefusalMessage(null);
      setError(null);
    },
  };
}
