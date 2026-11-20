/**
 * Phase 3: SSE Stream Parser Unit & Edge-Case Tests
 * File: frontend/tests/phase3/test_sse_stream_parser.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import { parseSseStream, streamChatQuery } from '@/lib/api/sseStream';
import { useAuthStore } from '@/stores/authStore';
import { mockUser, mockCitations } from '../mocks/fixtures';

describe('Phase 3: SSE Stream Engine & Fragmented Boundary Parser', () => {
  it('test_sse_parses_token_stream_incrementally', async () => {
    const tokens = ['Newton', "'s second ", 'law ', 'states ', 'that F = ma.'];
    const chunks = tokens.map((t) => `event: token\ndata: {"content": "${t}"}\n\n`);

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const receivedTokens: string[] = [];
    await parseSseStream(stream, {
      onToken: (tok) => receivedTokens.push(tok),
    });

    expect(receivedTokens).toEqual(tokens);
    expect(receivedTokens.join('')).toBe("Newton's second law states that F = ma.");
  });

  it('test_sse_handles_fragmented_packet_boundaries', async () => {
    // Packets intentionally sliced in the middle of JSON properties and values
    const fragmentedSlices = [
      'event: token\ndata: {"content": "Force eq',
      'uals mass "}\n\nevent: token\ndata: {"content": "times acceleration [[cite:1]]."}\n\n',
      'event: citation\ndata: {"marker_id": 1, "source_id": "src-1", "source_title": "Physics", "page_number": 42, "quote": "F=ma"}\n\n',
      'event: done\ndata: {"total_citations": 1}\n\n',
    ];

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const slice of fragmentedSlices) {
          controller.enqueue(encoder.encode(slice));
        }
        controller.close();
      },
    });

    const receivedTokens: string[] = [];
    const receivedCitations: any[] = [];
    let doneCalled = false;

    await parseSseStream(stream, {
      onToken: (tok) => receivedTokens.push(tok),
      onCitation: (c) => receivedCitations.push(c),
      onDone: () => {
        doneCalled = true;
      },
    });

    expect(receivedTokens.join('')).toBe('Force equals mass times acceleration [[cite:1]].');
    expect(receivedCitations).toHaveLength(1);
    expect(receivedCitations[0].source_title).toBe('Physics');
    expect(receivedCitations[0].page_number).toBe(42);
    expect(doneCalled).toBe(true);
  });

  it('test_sse_resolves_citations_on_done', async () => {
    const citationPayload = mockCitations[0];
    const streamContent = [
      'event: token\ndata: {"content": "Sentence with citation [[cite:1]]."}\n\n',
      `event: citation\ndata: ${JSON.stringify(citationPayload)}\n\n`,
      'event: done\ndata: {"total_citations": 1}\n\n',
    ].join('');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(streamContent));
        controller.close();
      },
    });

    const citations: any[] = [];
    let reportedTotal = 0;

    await parseSseStream(stream, {
      onCitation: (c) => citations.push(c),
      onDone: (total) => {
        reportedTotal = total ?? 0;
      },
    });

    expect(citations).toHaveLength(1);
    expect(citations[0].marker_id).toBe(1);
    expect(citations[0].quote).toBe(citationPayload.quote);
    expect(reportedTotal).toBe(1);
  });

  it('test_sse_handles_server_error_event', async () => {
    const streamContent =
      'event: error\ndata: {"message": "Model inference failed", "code": "ERR_LLM_FAILURE"}\n\n';

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(streamContent));
        controller.close();
      },
    });

    let capturedError: any = null;
    await parseSseStream(stream, {
      onError: (err) => {
        capturedError = err;
      },
    });

    expect(capturedError).not.toBeNull();
    expect(capturedError?.message).toBe('Model inference failed');
    expect(capturedError?.code).toBe('ERR_LLM_FAILURE');
  });

  it('test_sse_mid_stream_token_expiry_401', async () => {
    useAuthStore.getState().setToken('expired-jwt');
    useAuthStore.getState().setUser(mockUser);

    const sessionExpiredSpy = vi.fn();
    window.addEventListener('SESSION_EXPIRED', sessionExpiredSpy);

    await expect(
      streamChatQuery('nb-physics-101', "What is Newton's second law?", {})
    ).rejects.toThrow(/Session expired/i);

    expect(useAuthStore.getState().token).toBeNull();
    expect(sessionExpiredSpy).toHaveBeenCalled();

    window.removeEventListener('SESSION_EXPIRED', sessionExpiredSpy);
  });
});
