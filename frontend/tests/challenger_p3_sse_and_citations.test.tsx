/**
 * Empirical Challenger Suite: Phase 3 SSE Streaming, Citations, Refusal & 429 Lockout
 * File: frontend/tests/challenger_p3_sse_and_citations.test.tsx
 *
 * Adversarial stress tests:
 * 1. Byte-by-byte (1-byte chunks) fragmentation with multi-byte UTF-8, LaTeX & Unicode
 * 2. Arbitrary chunk splitting across CRLF/LF delimiters and JSON boundaries
 * 3. Rapid burst event stream processing (100+ events in single chunk)
 * 4. Mid-stream AbortSignal cancellation and reader lock release
 * 5. Server event: error handling (JSON vs raw string) without unhandled exceptions
 * 6. Malformed JSON fallback and multi-line data buffering
 * 7. Mid-stream HTTP 401 token expiry abort and SESSION_EXPIRED notification
 * 8. Grounded citation AST replacement: dense [[cite:N]], [Citation Unverified], [[cite:unverified]]
 * 9. Unverified citation fallback pill resilience and click-safety
 * 10. Citation hovercard authoritative metadata display (PDF page vs YouTube MM:SS timestamp)
 * 11. Cross-pane sync bus dispatch: activeFocusTarget and SELECT_CITATION window event
 * 12. Calibrated refusal banner with verbatim wording
 * 13. HTTP 429 rate limit input lockout, disabled state, placeholder update, and countdown auto-unlock oracle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { parseSseStream, streamChatQuery } from '@/lib/api/sseStream';
import { GroundedMarkdown } from '@/components/chat/GroundedMarkdown';
import { CitationChip } from '@/components/chat/CitationChip';
import { ChatContainer } from '@/components/chat/ChatContainer';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { ChatInput } from '@/components/chat/ChatInput';
import { RateLimitIndicator } from '@/components/chat/RateLimitIndicator';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { ResolvedCitation } from '@/types/api';
import { mockUser, mockCitations } from './mocks/fixtures';
import { server } from './mocks/server';
import { http, HttpResponse } from 'msw';

describe('Empirical Challenger Suite: Phase 3 SSE Streaming & Citations', () => {
  beforeEach(() => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');
    useAuthStore.getState().setUser(mockUser);
    useWorkspaceStore.getState().reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // Dimension 1: SSE Stream Parser Fragmentation & Robustness
  // =========================================================================
  describe('Dimension 1: SSE Parser Fragmentation & Protocol Robustness', () => {
    it('1.1 Extreme 1-byte slice fragmentation preserves multi-byte UTF-8, LaTeX & emojis', async () => {
      // String with multi-byte characters: Greek alpha/beta, emoji, math symbols
      const complexText = 'Energy $E = mc^2$ \u03B1\u03B2 \u{1F4D6} [[cite:1]].';
      const ssePayload =
        `event: token\ndata: {"content": "${complexText}"}\n\n` +
        `event: citation\ndata: ${JSON.stringify(mockCitations[0])}\n\n` +
        `event: done\ndata: {"total_citations": 1}\n\n`;

      const encoder = new TextEncoder();
      const rawBytes = encoder.encode(ssePayload);

      // Stream emitting exactly 1 byte per chunk
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let i = 0; i < rawBytes.length; i++) {
            controller.enqueue(new Uint8Array([rawBytes[i]]));
          }
          controller.close();
        },
      });

      const tokens: string[] = [];
      const citations: ResolvedCitation[] = [];
      let isDone = false;

      await parseSseStream(stream, {
        onToken: (tok) => tokens.push(tok),
        onCitation: (cite) => citations.push(cite),
        onDone: () => {
          isDone = true;
        },
      });

      expect(tokens.join('')).toBe(complexText);
      expect(citations).toHaveLength(1);
      expect(citations[0].source_id).toBe('src-pdf-001');
      expect(isDone).toBe(true);
    });

    it('1.2 Delimiter split across chunk boundaries (\\r in chunk 1, \\n\\r\\n in chunk 2)', async () => {
      const chunk1 = 'event: token\r\ndata: {"content": "Hello"}\r';
      const chunk2 = '\n\r\nevent: token\r\ndata: {"content": " World"}\r\n\r\n';

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(enc.encode(chunk1));
          controller.enqueue(enc.encode(chunk2));
          controller.close();
        },
      });

      const tokens: string[] = [];
      await parseSseStream(stream, {
        onToken: (t) => tokens.push(t),
      });

      expect(tokens.join('')).toBe('Hello World');
    });

    it('1.3 Burst handling: 50 token events delivered in a single chunk buffer', async () => {
      const count = 50;
      let burstString = '';
      for (let i = 0; i < count; i++) {
        burstString += `event: token\ndata: {"content": "T${i} "}\n\n`;
      }
      burstString += 'event: done\ndata: {}\n\n';

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(burstString));
          controller.close();
        },
      });

      const tokens: string[] = [];
      let doneFired = false;
      await parseSseStream(stream, {
        onToken: (t) => tokens.push(t),
        onDone: () => {
          doneFired = true;
        },
      });

      expect(tokens).toHaveLength(count);
      expect(tokens[0]).toBe('T0 ');
      expect(tokens[count - 1]).toBe(`T${count - 1} `);
      expect(doneFired).toBe(true);
    });

    it('1.4 Mid-stream AbortSignal cancellation terminates reader without leaking lock', async () => {
      const abortCtrl = new AbortController();
      let streamCancelled = false;

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: token\ndata: {"content": "Part1"}\n\n'));
        },
        cancel() {
          streamCancelled = true;
        },
      });

      const tokens: string[] = [];
      const parsePromise = parseSseStream(
        stream,
        {
          onToken: (t) => {
            tokens.push(t);
            // Abort immediately upon receiving first token
            abortCtrl.abort();
          },
        },
        { signal: abortCtrl.signal }
      );

      await parsePromise;

      expect(tokens).toEqual(['Part1']);
      expect(streamCancelled).toBe(true);
      // Reader lock must be released (getting a new reader must succeed)
      expect(() => stream.getReader()).not.toThrow();
    });

    it('1.5 Server event: error handles both JSON payload and unformatted raw string', async () => {
      // Case A: JSON structured error
      const jsonErrorStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: error\ndata: {"message": "GPU worker exhausted", "code": "ERR_WORKER_OOM"}\n\n'
            )
          );
          controller.close();
        },
      });

      let jsonErr: any = null;
      await parseSseStream(jsonErrorStream, {
        onError: (err) => {
          jsonErr = err;
        },
      });
      expect(jsonErr).toEqual({ message: 'GPU worker exhausted', code: 'ERR_WORKER_OOM' });

      // Case B: Raw unformatted string error
      const rawErrorStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('event: error\ndata: Upstream gateway timeout (504)\n\n')
          );
          controller.close();
        },
      });

      let rawErr: any = null;
      await parseSseStream(rawErrorStream, {
        onError: (err) => {
          rawErr = err;
        },
      });
      expect(rawErr?.message).toBe('Upstream gateway timeout (504)');
    });

    it('1.6 Corrupted JSON in data line gracefully falls back without unhandled throw', async () => {
      const corruptedStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'event: token\ndata: {"broken_json: unclosed\n\n' +
                'event: token\ndata: {"content": "Recovered valid token"}\n\n'
            )
          );
          controller.close();
        },
      });

      const tokens: string[] = [];
      await parseSseStream(corruptedStream, {
        onToken: (t) => tokens.push(t),
      });

      // The second valid token must be received even if the first data had unparseable JSON
      expect(tokens).toContain('Recovered valid token');
    });

    it('1.7 HTTP 401 token expiry aborts stream and dispatches SESSION_EXPIRED', async () => {
      // Force 401 mock response
      server.use(
        http.post('/api/notebooks/:id/query/stream', () => {
          return HttpResponse.json({ detail: 'Token signature invalid or expired' }, { status: 401 });
        })
      );

      const sessionExpiredSpy = vi.fn();
      window.addEventListener('SESSION_EXPIRED', sessionExpiredSpy);

      await expect(
        streamChatQuery('nb-test-1', 'Query with expired token', {})
      ).rejects.toThrow(/Session expired/i);

      expect(useAuthStore.getState().token).toBeNull();
      expect(sessionExpiredSpy).toHaveBeenCalledTimes(1);

      window.removeEventListener('SESSION_EXPIRED', sessionExpiredSpy);
    });
  });

  // =========================================================================
  // Dimension 2: Citation Grounding, Replacement & Hovercards
  // =========================================================================
  describe('Dimension 2: Citation Grounding, Replacement & Hovercards', () => {
    it('2.1 Dense adjacent citations [[cite:1]][[cite:2]][[cite:3]] render 3 separate pills', () => {
      const denseText =
        'Grounded multi-source synthesis [[cite:1]][[cite:2]][[cite:3]] from lecture materials.';

      const multiCitations: ResolvedCitation[] = [
        mockCitations[0],
        {
          marker_id: 2,
          source_id: 'src-pdf-002',
          source_title: 'Electrodynamics.pdf',
          source_type: 'pdf',
          page_number: 14,
          quote: "Maxwell's equations govern electromagnetic fields.",
          bboxes: [[0.1, 0.2, 0.8, 0.25]],
          deep_link: '/sources/src-pdf-002/stream#page=14',
        },
        {
          marker_id: 3,
          source_id: 'src-yt-001',
          source_title: 'MIT Physics Lecture 8.01',
          source_type: 'youtube',
          start_seconds: 185,
          quote: 'We observe circular orbital motion under central gravity.',
          bboxes: [],
          deep_link: 'https://youtube.com/watch?v=kYv_8fX30yA&t=185s',
        },
      ];

      render(<GroundedMarkdown content={denseText} citations={multiCitations} />);

      const pills = screen.getAllByTestId('citation-pill');
      expect(pills).toHaveLength(3);
      expect(pills[0]).toHaveTextContent('[1]');
      expect(pills[1]).toHaveTextContent('[2]');
      expect(pills[2]).toHaveTextContent('[3]');

      // Raw syntax must not be visible
      expect(screen.queryByText('[[cite:1]]')).not.toBeInTheDocument();
      expect(screen.queryByText('[[cite:2]]')).not.toBeInTheDocument();
      expect(screen.queryByText('[[cite:3]]')).not.toBeInTheDocument();
    });

    it('2.2 Unverified citation [[cite:999]] renders warning pill [999?] without crashing', () => {
      // Citation array does NOT contain marker 999
      const text = 'Experimental speculation without grounding [[cite:999]].';

      render(<GroundedMarkdown content={text} citations={mockCitations} />);

      const pill = screen.getByTestId('citation-pill');
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveTextContent('[999?]');
      expect(pill).toHaveAttribute('data-unverified', 'true');
      expect(pill).toHaveAttribute('title', 'Citation not found in source notes');

      // Clicking unverified pill should be safe and not throw
      expect(() => fireEvent.click(pill)).not.toThrow();
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
    });

    it('2.3 Unverified badge [Citation Unverified] and [[cite:unverified]] render alert styling', () => {
      const text = 'Result A [Citation Unverified] and Result B [[cite:unverified]].';

      render(<GroundedMarkdown content={text} />);

      const badges = screen.getAllByTestId('unverified-citation-badge');
      expect(badges).toHaveLength(2);
      badges.forEach((b) => {
        expect(b).toHaveTextContent('[Citation Unverified]');
        expect(b).toHaveAttribute('title', 'Citation not found in source notes');
      });
    });

    it('2.4 Hovercard renders authoritative PDF page number and verbatim quote', async () => {
      render(<CitationChip markerId={1} citation={mockCitations[0]} />);

      const pill = screen.getByTestId('citation-pill');
      fireEvent.mouseEnter(pill);

      await waitFor(() => {
        expect(screen.getByTestId('citation-hovercard')).toBeInTheDocument();
        expect(screen.getByTestId('citation-source-title')).toHaveTextContent(
          'Mechanics_Lecture_01.pdf'
        );
        expect(screen.getByTestId('citation-page-number')).toHaveTextContent('Page 42');
        expect(screen.getByTestId('citation-quote')).toHaveTextContent(mockCitations[0].quote);
      });
    });

    it('2.5 Hovercard renders YouTube timestamp MM:SS when start_seconds is provided', async () => {
      const ytCitation: ResolvedCitation = {
        marker_id: 4,
        source_id: 'src-yt-001',
        source_title: 'Quantum Mechanics Lecture 01',
        source_type: 'youtube',
        start_seconds: 125, // 2:05
        bboxes: [],
        deep_link: 'https://youtube.com/watch?v=kYv_8fX30yA&t=125s',
        quote: 'Wave-particle duality observed in double-slit experiment.',
      };

      render(<CitationChip markerId={4} citation={ytCitation} />);

      const pill = screen.getByTestId('citation-pill');
      fireEvent.mouseEnter(pill);

      await waitFor(() => {
        expect(screen.getByTestId('citation-hovercard')).toBeInTheDocument();
        expect(screen.getByTestId('citation-source-title')).toHaveTextContent(
          'Quantum Mechanics Lecture 01'
        );
        expect(screen.getByTestId('citation-timestamp')).toHaveTextContent('2:05');
        expect(screen.getByTestId('citation-quote')).toHaveTextContent(
          'Wave-particle duality observed in double-slit experiment.'
        );
      });
    });

    it('2.6 YouTube timestamp handles exact 0 seconds boundary correctly (0:00)', async () => {
      const ytCitation0: ResolvedCitation = {
        marker_id: 5,
        source_id: 'src-yt-001',
        source_title: 'Intro Video',
        source_type: 'youtube',
        start_seconds: 0,
        bboxes: [],
        deep_link: 'https://youtube.com/watch?v=kYv_8fX30yA&t=0s',
        quote: 'Welcome to this introductory overview.',
      };

      render(<CitationChip markerId={5} citation={ytCitation0} />);

      const pill = screen.getByTestId('citation-pill');
      fireEvent.mouseEnter(pill);

      await waitFor(() => {
        expect(screen.getByTestId('citation-timestamp')).toHaveTextContent('0:00');
      });

      // Clicking also sets startSeconds: 0 in store
      fireEvent.click(pill);
      expect(useWorkspaceStore.getState().activeFocusTarget?.startSeconds).toBe(0);
    });

    it('2.7 Single-direction event bus: pill click dispatches to store AND window SELECT_CITATION', () => {
      const windowListener = vi.fn();
      window.addEventListener('SELECT_CITATION', windowListener);

      render(<CitationChip markerId={1} citation={mockCitations[0]} />);

      const pill = screen.getByTestId('citation-pill');
      fireEvent.click(pill);

      // Verify global Zustand store update
      const target = useWorkspaceStore.getState().activeFocusTarget;
      expect(target).not.toBeNull();
      expect(target?.sourceId).toBe('src-pdf-001');
      expect(target?.pageNumber).toBe(42);
      expect(target?.quote).toBe(mockCitations[0].quote);

      // Verify window custom event emission
      expect(windowListener).toHaveBeenCalledTimes(1);
      const detail = windowListener.mock.calls[0][0].detail;
      expect(detail.markerId).toBe(1);
      expect(detail.sourceId).toBe('src-pdf-001');
      expect(detail.pageNumber).toBe(42);

      window.removeEventListener('SELECT_CITATION', windowListener);
    });

    it('2.8 Malformed tokens like [[cite:]] or [[cite:abc]] render safely as plain text', () => {
      const malformedText = 'Testing [[cite:]] and [[cite:abc]] and unclosed [[cite:1';

      render(<GroundedMarkdown content={malformedText} />);

      // None of these should match the valid regex [[cite:\d+]]
      expect(screen.queryByTestId('citation-pill')).not.toBeInTheDocument();
      expect(screen.getByText(/Testing/)).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Dimension 3: Calibrated Refusal & HTTP 429 Countdown Lockout
  // =========================================================================
  describe('Dimension 3: Calibrated Refusal & HTTP 429 Rate Limiting', () => {
    it('3.1 Calibrated refusal notice displays exact required verbatim wording', () => {
      const exactRefusal = "I don't have enough information in your notes to answer that.";

      render(
        <ChatMessageList
          messages={[]}
          refusalMessage={exactRefusal}
        />
      );

      const notice = screen.getByTestId('calibrated-refusal-notice');
      expect(notice).toBeInTheDocument();
      expect(notice.textContent).toContain(exactRefusal);
    });

    it('3.2 HTTP 429 response locks input, updates placeholder, and disables send button', () => {
      useWorkspaceStore.getState().setRateLimitStatus({
        isRateLimited: true,
        isLocked: true,
        retryAfterSeconds: 3600,
      });

      render(<ChatInput onSendMessage={vi.fn()} />);

      const input = screen.getByTestId('chat-input') as HTMLTextAreaElement;
      const sendBtn = screen.getByTestId('send-message-button');

      expect(input).toBeDisabled();
      expect(sendBtn).toBeDisabled();
      expect(input.placeholder).toBe('Hourly rate limit reached (60 queries/hr)');
    });

    it('3.3 Countdown timer ticks down every second and auto-unlocks at zero', () => {
      vi.useFakeTimers();

      useWorkspaceStore.getState().setRateLimitStatus({
        isRateLimited: true,
        isLocked: true,
        retryAfterSeconds: 3, // 3 seconds to unlock
      });

      render(<RateLimitIndicator />);

      const banner = screen.getByTestId('rate-limit-banner');
      expect(banner).toBeInTheDocument();

      const countdown = screen.getByTestId('rate-limit-countdown');
      expect(countdown).toHaveTextContent('00:03');

      // Tick 1s -> 00:02
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(countdown).toHaveTextContent('00:02');

      // Tick 1s -> 00:01
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(countdown).toHaveTextContent('00:01');

      // Tick 1s -> 00:00: triggers auto unlock
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Store must be unlocked
      const state = useWorkspaceStore.getState().rateLimit;
      expect(state.isLocked).toBe(false);
      expect(state.isRateLimited).toBe(false);
      expect(state.retryAfterSeconds).toBe(0);

      vi.useRealTimers();
    });

    it('3.4 Window RATE_LIMIT_TRIGGERED custom event updates countdown dynamically', () => {
      render(<RateLimitIndicator />);

      // Dispatch window event with 45s countdown
      act(() => {
        window.dispatchEvent(
          new CustomEvent('RATE_LIMIT_TRIGGERED', {
            detail: { retryAfterSeconds: 45 },
          })
        );
      });

      const countdown = screen.getByTestId('rate-limit-countdown');
      expect(countdown).toHaveTextContent('00:45');
    });

    it('3.5 streamChatQuery intercepts HTTP 429 and updates workspace rate limit state', async () => {
      server.use(
        http.post('/api/notebooks/:id/query/stream', () => {
          return new HttpResponse(
            JSON.stringify({ detail: 'Rate limit exceeded: Maximum 60 queries per hour.' }),
            {
              status: 429,
              headers: { 'Retry-After': '1800' },
            }
          );
        })
      );

      const rateLimitSpy = vi.fn();
      window.addEventListener('RATE_LIMIT_TRIGGERED', rateLimitSpy);

      await expect(
        streamChatQuery('nb-test-1', 'Testing 429 interceptor', {})
      ).rejects.toThrow(/Rate limit exceeded/i);

      const rateLimitState = useWorkspaceStore.getState().rateLimit;
      expect(rateLimitState.isLocked).toBe(true);
      expect(rateLimitState.isRateLimited).toBe(true);
      expect(rateLimitState.retryAfterSeconds).toBe(1800);

      expect(rateLimitSpy).toHaveBeenCalledTimes(1);

      window.removeEventListener('RATE_LIMIT_TRIGGERED', rateLimitSpy);
    });

    it('3.6 Empirical investigation: assistant response presence after stream completion', async () => {
      render(<ChatContainer notebookId="nb-physics-101" />);

      // Wait for initial history to load (1 assistant message)
      await waitFor(() => {
        expect(screen.getByText("What is Newton's second law?")).toBeInTheDocument();
      });

      const initialAssistantCount = screen.queryAllByTestId('assistant-message-bubble').length;

      const input = screen.getByTestId('chat-input');
      const sendBtn = screen.getByTestId('send-message-button');

      fireEvent.change(input, { target: { value: 'Explain force and acceleration' } });
      fireEvent.click(sendBtn);

      // User bubble is visible
      expect(screen.getByText('Explain force and acceleration')).toBeInTheDocument();

      // Wait until stream finishes (streaming-assistant-bubble unmounts)
      await waitFor(() => {
        expect(screen.queryByTestId('streaming-assistant-bubble')).not.toBeInTheDocument();
      });

      // The streamed text "Based on your notes" from MSW handler 15:
      // Does it evaporate from the screen because it was never appended to messages?
      const streamedTextInDOM = screen.queryByText(/Based on your notes/i);
      // If streamedTextInDOM is null, the response completely vanished upon stream completion!
      expect(streamedTextInDOM).not.toBeNull();
    });
  });
});

