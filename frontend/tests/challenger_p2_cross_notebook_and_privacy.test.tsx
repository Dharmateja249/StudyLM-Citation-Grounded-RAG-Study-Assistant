import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { SourceList } from '@/components/sidebar/SourceList';
import { SourceCard } from '@/components/sidebar/SourceCard';
import { SourceRead } from '@/types/api';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser } from './mocks/fixtures';
import { mockDb } from './mocks/mock-db';

describe('Empirical Challenge: Privacy Shielding Leakage & Cross-Notebook Source Accumulation', () => {
  beforeEach(() => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');
    useAuthStore.getState().setUser(mockUser);
    useWorkspaceStore.getState().reset();
    mockDb.reset();
  });

  describe('Challenge 1: Privacy Shielding Inspection (Adversarial Title Leakage)', () => {
    it('empirical check: does non-educational source leak raw title into DOM attributes?', () => {
      const privateTitle = 'Secret Personal Home Video [CONFIDENTIAL]';
      const nonEduSource: SourceRead = {
        id: 'src-privacy-audit',
        user_id: mockUser.id,
        notebook_id: 'nb-audit-1',
        title: privateTitle,
        source_type: 'youtube',
        storage_key_or_url: 'https://www.youtube.com/watch?v=entertainment123',
        status: 'error',
        reindexing: false,
        error_code: 'ERR_NON_EDUCATIONAL_CONTENT',
        error_message:
          'Upload educational related video, this video does not have educational content please recheck the link',
        summary_status: 'error',
        created_at: new Date().toISOString(),
      };

      const { container } = render(<SourceCard source={nonEduSource} />);

      // The visible text is masked:
      const titleElem = screen.getByTestId('source-title');
      expect(titleElem.textContent).toBe('[Suppressed: Non-Educational Content]');

      // Inspect HTML attributes for privacy leaks:
      const titleAttr = titleElem.getAttribute('title');
      const articleAriaLabel = container.querySelector('[role="article"]')?.getAttribute('aria-label');
      const deleteAriaLabel = screen.getByTestId('delete-source-btn').getAttribute('aria-label');

      // Assert whether privateTitle leaked into DOM attributes
      const titleAttrLeaked = titleAttr === privateTitle;
      const articleAriaLeaked = articleAriaLabel?.includes(privateTitle) ?? false;
      const deleteAriaLeaked = deleteAriaLabel?.includes(privateTitle) ?? false;

      // EMPIRICAL VERIFICATION:
      // If any of these are true, the title is NOT completely suppressed from the workspace DOM!
      expect({
        titleAttrLeaked,
        articleAriaLeaked,
        deleteAriaLeaked,
      }).toEqual({
        titleAttrLeaked: false,
        articleAriaLeaked: false,
        deleteAriaLeaked: false,
      });
    });
  });

  describe('Challenge 2: Cross-Notebook Source Leakage & Quota Poisoning', () => {
    it('empirical check: does switching notebooks accumulate sources and poison the 20-source quota?', async () => {
      // Setup Notebook A with 12 sources in mockDb
      const sourcesA: SourceRead[] = Array.from({ length: 12 }, (_, i) => ({
        id: `src-nbA-${i}`,
        user_id: mockUser.id,
        notebook_id: 'nb-A',
        title: `Notebook A Doc ${i + 1}.pdf`,
        source_type: 'pdf' as const,
        storage_key_or_url: `key-A-${i}`,
        status: 'ready' as const,
        reindexing: false,
        summary_status: 'ready' as const,
        created_at: new Date().toISOString(),
      }));

      // Setup Notebook B with 10 sources in mockDb
      const sourcesB: SourceRead[] = Array.from({ length: 10 }, (_, i) => ({
        id: `src-nbB-${i}`,
        user_id: mockUser.id,
        notebook_id: 'nb-B',
        title: `Notebook B Doc ${i + 1}.pdf`,
        source_type: 'pdf' as const,
        storage_key_or_url: `key-B-${i}`,
        status: 'ready' as const,
        reindexing: false,
        summary_status: 'ready' as const,
        created_at: new Date().toISOString(),
      }));

      // Register in mockDb
      mockDb.notebooks.set('nb-A', {
        id: 'nb-A',
        user_id: mockUser.id,
        title: 'Notebook A',
        status: 'active',
        created_at: new Date().toISOString(),
      });
      mockDb.notebooks.set('nb-B', {
        id: 'nb-B',
        user_id: mockUser.id,
        title: 'Notebook B',
        status: 'active',
        created_at: new Date().toISOString(),
      });

      sourcesA.forEach((s) => mockDb.sources.set(s.id, s));
      sourcesB.forEach((s) => mockDb.sources.set(s.id, s));

      // 1. Mount SourceList on Notebook A
      const { rerender } = render(<SourceList notebookId="nb-A" />);

      // Wait for Notebook A sources to load
      await waitFor(() => {
        expect(screen.getByTestId('quota-counter')).toHaveTextContent('12 / 20 Sources');
      });

      // 2. Switch user to Notebook B
      rerender(<SourceList notebookId="nb-B" />);

      // Wait for Notebook B sources to load
      await waitFor(() => {
        // INVARIANT: Notebook B only has 10 sources!
        // Quota counter MUST say "10 / 20 Sources", NOT "22 / 20 Sources"!
        expect(screen.getByTestId('quota-counter')).toHaveTextContent('10 / 20 Sources');
      });

      // Furthermore, Notebook B must NOT be locked!
      expect(screen.getByTestId('file-upload-dropzone')).toHaveAttribute('data-locked', 'false');
    });
  });
});
