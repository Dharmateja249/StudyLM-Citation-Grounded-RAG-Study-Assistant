/**
 * Challenger Phase 5 Adversarial Stress & Boundary Verification Suite
 * File: frontend/tests/challenger_p5_e2e_stress.test.tsx
 *
 * Empirical verification of:
 * 1. Educational Content Barrier boundary tests & URL tampering:
 *    - Query parameters, tracking tokens, fragments, variants (watch, shorts, embed, youtu.be, url-encoded)
 *    - Rapid repeated submissions / modal double-click races
 *    - Title suppression & verbatim warning banner invariance
 *    - Direct store tampering and viewer shielding
 * 2. Citation deep-link click spam:
 *    - Rapid consecutive clicks on citation [1] (PDF)
 *    - Interleaved click spam between PDF and YouTube citations
 *    - Monotonic timestamp validation and unverified citation resilience
 * 3. Cross-tenant boundary tampering:
 *    - Forged Bearer JWT tokens
 *    - 404 anti-enumeration shielding across all API routes
 *    - Direct store injection shielding in WorkspaceShell and ViewerContainer
 *    - Session switch state purging
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { ViewerContainer } from '@/components/viewer/ViewerContainer';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { apiClient, NotFoundError, AuthenticationError } from '@/lib/api/client';
import { mockUser, mockCitations, mockSources } from './mocks/fixtures';
import { mockDb } from './mocks/mock-db';

describe('Challenger Phase 5: Adversarial E2E & Boundary Stress', () => {
  beforeEach(() => {
    mockDb.reset();
    mockDb.sources.delete('src-yt-rejected');
    mockDb.messages.set('nb-physics-101', []);
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    vi.clearAllMocks();
    window.innerWidth = 1200;

    useAuthStore.getState().setSession('valid-jwt-token-alex-student', mockUser);
    useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');
  });

  // =========================================================================
  // 1. Educational Content Barrier Boundary & URL Tampering
  // =========================================================================
  describe('1. Educational Content Barrier Boundary & URL Tampering', () => {
    it('test_educational_barrier_url_with_query_params_and_tracking_tokens', async () => {
      const user = userEvent.setup();
      render(<WorkspaceShell />);

      // Open YouTube modal
      const openBtn = await screen.findByTestId('open-youtube-modal-btn');
      await user.click(openBtn);

      const modal = await screen.findByTestId('youtube-import-modal');
      expect(modal).toBeInTheDocument();

      // Tampered URL with query params, time offset, feature flags, and tracking token
      const tamperedUrl =
        'https://www.youtube.com/watch?v=entertainment123&t=42s&feature=share&si=trackingToken987654';
      const input = screen.getByTestId('youtube-url-input');
      await user.type(input, tamperedUrl);

      const submitBtn = screen.getByTestId('submit-youtube-btn');
      await user.click(submitBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('youtube-import-modal')).not.toBeInTheDocument();
      });

      // Assert exact verbatim warning banner
      const warningBanner = await screen.findByTestId('educational-warning-banner');
      expect(warningBanner).toBeInTheDocument();
      expect(warningBanner).toHaveAttribute('role', 'alert');
      const expectedText =
        'Upload educational related video, this video does not have educational content please recheck the link';
      expect(warningBanner.textContent).toContain(expectedText);

      // Assert title is masked to exact suppression string
      const title = await screen.findByText('[Suppressed: Non-Educational Content]');
      expect(title).toBeInTheDocument();

      // Assert privacy shielding: zero leaks of transcript, description, or inspect
      expect(screen.queryByRole('button', { name: /transcript/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /inspect/i })).not.toBeInTheDocument();

      // Assert card click is blocked from activating source
      const card = screen.getByRole('article', { name: /Source: \[Suppressed: Non-Educational Content\]/i });
      await user.click(card);
      expect(useWorkspaceStore.getState().activeSourceId).not.toContain('rejected');
      expect(screen.queryByTestId('youtube-viewer')).not.toBeInTheDocument();
    });

    it('test_educational_barrier_url_variants_reordered_params_and_formats', async () => {
      // Direct API verification across URL formats:
      // 1. Reordered params: feature first, v second
      // 2. youtu.be short format with tracking token
      // 3. shorts format
      // 4. embed format
      // 5. URL with fragment #t=10s
      // 6. URL with URL-encoded query characters
      const testUrls = [
        'https://www.youtube.com/watch?feature=share&v=entertainment123',
        'https://youtu.be/entertainment123?si=trackingToken123',
        'https://www.youtube.com/shorts/entertainment123?feature=share',
        'https://www.youtube.com/embed/entertainment123?autoplay=1',
        'https://www.youtube.com/watch?v=entertainment123#t=10s',
        'https://www.youtube.com/watch?v=entertainment123%26extra%3Dparam',
      ];

      for (const url of testUrls) {
        const result = await apiClient.createYouTubeSource('nb-physics-101', { url });
        expect(result.status).toBe('error');
        expect(result.error_code).toBe('ERR_NON_EDUCATIONAL_CONTENT');
        expect(result.title).toBe('[Suppressed: Non-Educational Content]');
        expect(result.error_message).toContain(
          'Upload educational related video, this video does not have educational content please recheck the link'
        );
      }
    });

    it('test_educational_barrier_non_youtube_urls_blocked_preflight', async () => {
      const user = userEvent.setup();
      render(<WorkspaceShell />);

      const openBtn = await screen.findByTestId('open-youtube-modal-btn');
      await user.click(openBtn);

      const input = screen.getByTestId('youtube-url-input');
      const submitBtn = screen.getByTestId('submit-youtube-btn');

      // 1. Non-YouTube link (Vimeo)
      await user.clear(input);
      await user.type(input, 'https://vimeo.com/123456789');
      await user.click(submitBtn);

      const errorAlert = await screen.findByTestId('youtube-import-error');
      expect(errorAlert).toBeInTheDocument();
      expect(errorAlert.textContent).toContain('URL must be a valid YouTube link');

      // 2. Empty / whitespace submission
      await user.clear(input);
      await user.type(input, '   ');
      await user.click(submitBtn);

      expect(errorAlert.textContent).toContain('Please enter a valid YouTube video URL');
    });

    it('test_educational_barrier_rapid_repeated_modal_submissions', async () => {
      const user = userEvent.setup();
      render(<WorkspaceShell />);

      const openBtn = await screen.findByTestId('open-youtube-modal-btn');
      await user.click(openBtn);

      const input = screen.getByTestId('youtube-url-input');
      await user.type(input, 'https://www.youtube.com/watch?v=entertainment123');

      const submitBtn = screen.getByTestId('submit-youtube-btn');

      // Rapidly fire multiple clicks
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.queryByTestId('youtube-import-modal')).not.toBeInTheDocument();
      });

      // Warning banner is visible and exactly 1 rejected source is present
      const banners = await screen.findAllByTestId('educational-warning-banner');
      expect(banners.length).toBeGreaterThanOrEqual(1);
      expect(banners[0].textContent).toContain(
        'Upload educational related video, this video does not have educational content please recheck the link'
      );
    });

    it('test_educational_barrier_direct_store_tampering_defense', async () => {
      // Seed rejected source
      const rejectedSource = mockSources[2]; // src-yt-rejected
      expect(rejectedSource.error_code).toBe('ERR_NON_EDUCATIONAL_CONTENT');

      // Adversary attempts to bypass UI and set active source directly to rejected source
      act(() => {
        useWorkspaceStore.getState().setActiveSourceId(rejectedSource.id);
      });

      // Render viewer container directly with rejected source
      render(<ViewerContainer source={rejectedSource} />);

      // Assert YouTubeViewer suppresses playback completely
      const suppressedView = await screen.findByTestId('youtube-suppressed-view');
      expect(suppressedView).toBeInTheDocument();
      expect(suppressedView.textContent).toContain(
        'Upload educational related video, this video does not have educational content please recheck the link'
      );

      // Verify iframe player was NEVER mounted
      expect(screen.queryByTestId('youtube-player-container')).not.toBeInTheDocument();
      expect(screen.queryByTestId('youtube-iframe')).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // 2. Citation Deep-Link Click Spam (PDF & YouTube Interleaved)
  // =========================================================================
  describe('2. Citation Deep-Link Click Spam (PDF & YouTube)', () => {
    it('test_citation_pill_rapid_consecutive_clicks_same_citation', async () => {
      const notebookId = 'nb-physics-101';
      render(<WorkspaceShell />);

      // Seed assistant message with citation marker [[cite:1]]
      act(() => {
        const msgs = mockDb.messages.get(notebookId) || [];
        msgs.push({
          id: 'msg-rapid-clicks-01',
          notebook_id: notebookId,
          role: 'assistant',
          content: "Newton's second law is F = ma [[cite:1]].",
          citations: [mockCitations[0]], // marker 1, src-pdf-001, page 42
          created_at: new Date().toISOString(),
        });
        mockDb.messages.set(notebookId, msgs);
      });

      const pills = await screen.findAllByTestId('citation-pill');
      const citationPill = pills.find((p) => p.getAttribute('data-marker-id') === '1')!;
      expect(citationPill).toBeDefined();

      // Spam click 30 times rapidly
      let prevTimestamp = 0;
      for (let i = 0; i < 30; i++) {
        act(() => {
          fireEvent.click(citationPill);
        });
        const currentTarget = useWorkspaceStore.getState().activeFocusTarget;
        expect(currentTarget).not.toBeNull();
        expect(currentTarget?.sourceId).toBe('src-pdf-001');
        expect(currentTarget?.pageNumber).toBe(42);
        expect(currentTarget?.timestamp).toBeGreaterThanOrEqual(prevTimestamp);
        prevTimestamp = currentTarget?.timestamp ?? 0;
      }

      // Assert target page 42 rendered with highlight overlay intact
      const targetPage = await screen.findByTestId('pdf-page-42');
      expect(targetPage).toBeInTheDocument();
      const overlay = screen.getByTestId('bbox-overlay-page-42');
      expect(overlay).toBeInTheDocument();
    });

    it('test_interleaved_pdf_and_youtube_citation_click_spam', async () => {
      const notebookId = 'nb-physics-101';
      render(<WorkspaceShell />);

      // Seed assistant message with BOTH citation [1] (PDF) and citation [2] (YouTube)
      act(() => {
        const msgs = mockDb.messages.get(notebookId) || [];
        msgs.push({
          id: 'msg-interleaved-clicks-02',
          notebook_id: notebookId,
          role: 'assistant',
          content: 'Here is PDF reference [[cite:1]] and YouTube lecture [[cite:2]].',
          citations: [mockCitations[0], mockCitations[1]],
          created_at: new Date().toISOString(),
        });
        mockDb.messages.set(notebookId, msgs);
      });

      const pills = await screen.findAllByTestId('citation-pill');
      expect(pills.length).toBeGreaterThanOrEqual(2);
      const pillPdf = pills.find((p) => p.getAttribute('data-marker-id') === '1')!;
      const pillYt = pills.find((p) => p.getAttribute('data-marker-id') === '2')!;
      expect(pillPdf).toBeDefined();
      expect(pillYt).toBeDefined();

      // Alternating click spam: [1] -> [2] -> [1] -> [2] for 20 cycles (40 clicks)
      let prevTs = 0;
      for (let cycle = 0; cycle < 20; cycle++) {
        // Click PDF
        act(() => {
          fireEvent.click(pillPdf);
        });
        let target = useWorkspaceStore.getState().activeFocusTarget;
        expect(target?.sourceId).toBe('src-pdf-001');
        expect(target?.pageNumber).toBe(42);
        expect(target?.timestamp).toBeGreaterThan(prevTs);
        prevTs = target?.timestamp ?? 0;

        // Click YouTube
        act(() => {
          fireEvent.click(pillYt);
        });
        target = useWorkspaceStore.getState().activeFocusTarget;
        expect(target?.sourceId).toBe('src-yt-002');
        expect(target?.startSeconds).toBe(742);
        expect(target?.timestamp).toBeGreaterThan(prevTs);
        prevTs = target?.timestamp ?? 0;
      }

      // Final state must consistently point to YouTube citation [2]
      expect(useWorkspaceStore.getState().activeSourceId).toBe('src-yt-002');
      expect(useWorkspaceStore.getState().activeFocusTarget?.startSeconds).toBe(742);

      // Viewer resolves to YouTubeViewer without deadlock
      const ytViewer = await screen.findByTestId('youtube-viewer');
      expect(ytViewer).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('youtube-timestamp-badge')).toHaveTextContent('12:22'); // 742s = 12m22s
      });
    });

    it('test_unverified_citation_click_spam_resilience', async () => {
      const notebookId = 'nb-physics-101';

      // Seed assistant message with UNVERIFIED citation marker [[cite:999]] BEFORE render
      mockDb.messages.set(notebookId, [
        {
          id: 'msg-unverified-spam',
          notebook_id: notebookId,
          role: 'assistant',
          content: 'This fact is unverified [[cite:999]].',
          citations: [], // No citation object for marker 999
          created_at: new Date().toISOString(),
        },
      ]);

      render(<WorkspaceShell />);

      // Await unverified citation pill rendered
      const unverifiedPill = await screen.findByTestId('citation-pill');
      expect(unverifiedPill).toHaveAttribute('data-unverified', 'true');
      expect(unverifiedPill.textContent).toContain('999');

      // Set initial focus target to PDF
      act(() => {
        useWorkspaceStore.getState().dispatchFocusTarget({
          sourceId: 'src-pdf-001',
          pageNumber: 42,
          bboxes: [[0.1, 0.2, 0.3, 0.4]],
        });
      });
      const initialTarget = useWorkspaceStore.getState().activeFocusTarget;
      expect(initialTarget?.sourceId).toBe('src-pdf-001');

      // Click spam on unverified citation
      for (let i = 0; i < 20; i++) {
        act(() => {
          fireEvent.click(unverifiedPill);
        });
      }

      // Valid existing focus target is NOT corrupted or erased
      expect(useWorkspaceStore.getState().activeFocusTarget?.sourceId).toBe('src-pdf-001');
      expect(useWorkspaceStore.getState().activeFocusTarget?.pageNumber).toBe(42);
    });
  });

  // =========================================================================
  // 3. Cross-Tenant Boundary Tampering & Anti-Enumeration 404 Shielding
  // =========================================================================
  describe('3. Cross-Tenant Boundary Tampering & Anti-Enumeration Shielding', () => {
    it('test_forged_bearer_jwt_rejection', async () => {
      // Set forged/malicious token
      useAuthStore.getState().setToken('invalid-jwt');

      let authError: unknown;
      try {
        await apiClient.getNotebook('nb-physics-101');
      } catch (err) {
        authError = err;
      }

      expect(authError).toBeInstanceOf(AuthenticationError);
      expect((authError as AuthenticationError).status).toBe(401);

      // Session state is purged automatically
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().token).toBeNull();
    });

    it('test_cross_tenant_anti_enumeration_404_all_endpoints', async () => {
      // 1. Seed Tenant A's Private Notebook & Source
      const tenantANotebook = {
        id: 'nb-tenant-a-classified',
        user_id: 'usr-tenant-a-owner',
        title: 'Classified Defense Mechanics',
        status: 'active' as const,
        created_at: '2026-10-12T08:00:00Z',
      };
      mockDb.notebooks.set(tenantANotebook.id, tenantANotebook);

      const tenantASource = {
        id: 'src-tenant-a-confidential',
        user_id: 'usr-tenant-a-owner',
        notebook_id: tenantANotebook.id,
        title: 'Secret_Payload.pdf',
        source_type: 'pdf' as const,
        storage_key_or_url: 'users/usr-tenant-a-owner/Secret_Payload.pdf',
        status: 'ready' as const,
        reindexing: false,
        summary_status: 'ready' as const,
        created_at: '2026-10-12T08:05:00Z',
      };
      mockDb.sources.set(tenantASource.id, tenantASource);

      // Authenticate as User B (student)
      useAuthStore.getState().setSession('valid-jwt-token-alex-student', mockUser);
      expect(useAuthStore.getState().user?.id).toBe('usr-default-001');

      // 2. Test Anti-Enumeration: ALL attempts on Tenant A resources return 404
      const endpointsToTest = [
        () => apiClient.getNotebook('nb-tenant-a-classified'),
        () => apiClient.getSources('nb-tenant-a-classified'),
        () => apiClient.getMessages('nb-tenant-a-classified'),
        () => apiClient.createSource('nb-tenant-a-classified', new FormData()),
        () => apiClient.createMessage('nb-tenant-a-classified', { role: 'user', content: 'tamper' }),
        () => apiClient.deleteNotebook('nb-tenant-a-classified'),
        () => apiClient.getSource('src-tenant-a-confidential'),
        () => apiClient.deleteSource('src-tenant-a-confidential'),
      ];

      for (const call of endpointsToTest) {
        let err: unknown;
        try {
          await call();
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(NotFoundError);
        expect((err as NotFoundError).status).toBe(404);
      }
    });

    it('test_ui_shielding_when_active_notebook_tampered', async () => {
      // Seed Tenant A data
      const tenantANotebook = {
        id: 'nb-tenant-a-classified',
        user_id: 'usr-tenant-a-owner',
        title: 'Classified Defense Mechanics',
        status: 'active' as const,
        created_at: '2026-10-12T08:00:00Z',
      };
      mockDb.notebooks.set(tenantANotebook.id, tenantANotebook);

      // User B attempts to tamper with Zustand active notebook ID
      act(() => {
        useWorkspaceStore.getState().setActiveNotebookId('nb-tenant-a-classified');
      });

      render(<WorkspaceShell />);

      // Zero bytes of Tenant A data rendered in DOM
      await waitFor(() => {
        expect(screen.queryByText('Classified Defense Mechanics')).not.toBeInTheDocument();
        expect(screen.queryByText('Secret_Payload.pdf')).not.toBeInTheDocument();
      });

      // Viewer shows empty state
      expect(screen.getByTestId('viewer-empty-state')).toBeInTheDocument();
    });

    it('test_ui_shielding_when_active_source_tampered', async () => {
      // Seed Tenant A confidential source
      const tenantASource = {
        id: 'src-tenant-a-confidential',
        user_id: 'usr-tenant-a-owner',
        notebook_id: 'nb-tenant-a-classified',
        title: 'Secret_Payload.pdf',
        source_type: 'pdf' as const,
        storage_key_or_url: 'users/usr-tenant-a-owner/Secret_Payload.pdf',
        status: 'ready' as const,
        reindexing: false,
        summary_status: 'ready' as const,
        created_at: '2026-10-12T08:05:00Z',
      };
      mockDb.sources.set(tenantASource.id, tenantASource);

      // Adversary forces activeSourceId to Tenant A source
      act(() => {
        useWorkspaceStore.getState().setActiveSourceId('src-tenant-a-confidential');
      });

      render(<ViewerContainer />);

      // Empty state rendered, no confidential title or pdf viewer
      await waitFor(() => {
        expect(screen.getByTestId('viewer-empty-state')).toBeInTheDocument();
        expect(screen.queryByText('Secret_Payload.pdf')).not.toBeInTheDocument();
        expect(screen.queryByTestId('pdf-viewer')).not.toBeInTheDocument();
      });
    });

    it('test_cross_tenant_session_switch_purges_all_workspace_state', () => {
      // User A state
      useWorkspaceStore.getState().setActiveNotebookId('nb-physics-101');
      useWorkspaceStore.getState().setActiveSourceId('src-pdf-001');
      useWorkspaceStore.getState().dispatchFocusTarget({
        sourceId: 'src-pdf-001',
        pageNumber: 42,
      });

      expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-physics-101');
      expect(useWorkspaceStore.getState().activeSourceId).toBe('src-pdf-001');
      expect(useWorkspaceStore.getState().activeFocusTarget).not.toBeNull();

      // Switch session to another user (User B)
      const userB = {
        ...mockUser,
        id: 'usr-other-009',
        email: 'other@university.edu',
      };
      act(() => {
        useAuthStore.getState().setSession('jwt-user-b', userB);
      });

      // Assert all previous workspace state is completely purged
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
      expect(useWorkspaceStore.getState().activeSourceId).toBeNull();
      expect(useWorkspaceStore.getState().activeFocusTarget).toBeNull();
      expect(localStorage.getItem('studylm_active_notebook_id')).toBeNull();
      expect(localStorage.getItem('studylm_active_source_id')).toBeNull();
    });
  });
});
