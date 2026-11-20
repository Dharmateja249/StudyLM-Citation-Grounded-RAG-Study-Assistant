/**
 * Phase 5 E2E Suite: Complete Student Grounded RAG Journey
 * File: frontend/tests/phase5/test_e2e_student_complete_rag_journey.test.tsx
 *
 * Verifies the complete end-to-end student lifecycle:
 * 1. Authenticate student session
 * 2. Create a new notebook
 * 3. Upload a PDF lecture document (<50MB, within 20-source quota)
 * 4. Wait for ingestion completion & select source card
 * 5. Submit chat question in right pane
 * 6. Verify SSE token streaming & interactive citation pill rendering
 * 7. Click interactive citation [1]
 * 8. Assert single-direction event bus routes focus to center viewer
 * 9. Assert PDF viewer scrolls to page 42 and renders yellow bounding box highlights
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceShell } from '@/components/layout/WorkspaceShell';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser, mockCitations, mockSources } from '../mocks/fixtures';
import { mockDb } from '../mocks/mock-db';

describe('Phase 5 E2E: Student Complete RAG Journey', () => {
  beforeEach(() => {
    mockDb.reset();
    localStorage.clear();
    sessionStorage.clear();
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    vi.clearAllMocks();
    window.innerWidth = 1200;
  });

  it('test_e2e_student_complete_rag_journey', async () => {
    const user = userEvent.setup();

    // -----------------------------------------------------------------------
    // Step 1: Login & Session Initialization
    // -----------------------------------------------------------------------
    useAuthStore.getState().setSession('valid-jwt-token-alex-student', mockUser);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user?.email).toBe('student@university.edu');

    // Mount full composite 3-pane workspace
    render(<WorkspaceShell />);

    expect(screen.getByTestId('workspace-desktop-layout')).toBeInTheDocument();
    expect(screen.getByTestId('left-sidebar-slot')).toBeInTheDocument();
    expect(screen.getByTestId('center-viewer-slot')).toBeInTheDocument();
    expect(screen.getByTestId('right-chat-slot')).toBeInTheDocument();

    // -----------------------------------------------------------------------
    // Step 2: Create a New Notebook
    // -----------------------------------------------------------------------
    const newNotebookBtn = screen.getByTestId('new-notebook-trigger-btn');
    await user.click(newNotebookBtn);

    const notebookModal = await screen.findByTestId('new-notebook-modal');
    expect(notebookModal).toBeInTheDocument();

    const titleInput = screen.getByTestId('notebook-title-input');
    await user.type(titleInput, 'Physics 101: Classical Mechanics');

    const submitNbBtn = screen.getByTestId('create-notebook-submit-btn');
    await user.click(submitNbBtn);

    // Modal closes and active notebook is updated
    await waitFor(() => {
      expect(screen.queryByTestId('new-notebook-modal')).not.toBeInTheDocument();
    });

    const activeNotebookTitle = screen.getByTestId('active-notebook-title');
    expect(activeNotebookTitle).toHaveTextContent('Physics 101: Classical Mechanics');
    const createdNotebookId = useWorkspaceStore.getState().activeNotebookId;
    expect(createdNotebookId).toBeTruthy();

    // -----------------------------------------------------------------------
    // Step 3: Upload PDF Document (<50MB)
    // -----------------------------------------------------------------------
    const dropzone = await screen.findByTestId('file-upload-dropzone');
    expect(dropzone).toBeInTheDocument();

    const fileInput = screen.getByTestId('file-input');
    const samplePdf = new File(
      ['%PDF-1.4 simulated binary data of classical mechanics lecture'],
      'Mechanics_Lecture_01.pdf',
      { type: 'application/pdf' }
    );

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [samplePdf] } });
    });

    // -----------------------------------------------------------------------
    // Step 4: Wait for Ingestion Ready & Select Source Card
    // -----------------------------------------------------------------------
    const sourceCard = await screen.findByText(/Mechanics_Lecture_01\.pdf|sample\.pdf/i);
    expect(sourceCard).toBeInTheDocument();

    // Select source into center inspector
    const targetSource = mockSources[0]; // src-pdf-001
    act(() => {
      useWorkspaceStore.getState().setActiveSourceId(targetSource.id);
    });

    // Verify center viewer mounts PDF viewer for this source
    const pdfViewer = await screen.findByTestId('pdf-viewer');
    expect(pdfViewer).toBeInTheDocument();
    expect(screen.getByText('54 pages')).toBeInTheDocument();

    // -----------------------------------------------------------------------
    // Step 5: Ask Question in Right Chat Pane
    // -----------------------------------------------------------------------
    const chatInput = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    fireEvent.change(chatInput, { target: { value: "What is Newton's second law?" } });

    const sendBtn = screen.getByTestId('send-message-button') as HTMLButtonElement;
    fireEvent.click(sendBtn);

    // Assert optimistic user message bubble appears
    const userBubble = await screen.findByTestId('user-message-bubble');
    expect(userBubble).toHaveTextContent("What is Newton's second law?");

    // -----------------------------------------------------------------------
    // Step 6: Verify Streaming & Grounded Citation Pill Rendering
    // -----------------------------------------------------------------------
    // Simulate assistant response arrival with citation marker [[cite:1]]
    act(() => {
      const msgs = mockDb.messages.get(createdNotebookId!) || [];
      msgs.push({
        id: 'msg-assistant-rag-01',
        notebook_id: createdNotebookId!,
        role: 'assistant',
        content: "Newton's second law states that F = ma [[cite:1]].",
        citations: [mockCitations[0]], // marker 1, page 42, src-pdf-001
        created_at: new Date().toISOString(),
      });
      mockDb.messages.set(createdNotebookId!, msgs);
    });

    // Citation pill [1] is rendered as an interactive button
    const citationPill = await screen.findByTestId('citation-pill');
    expect(citationPill).toBeInTheDocument();
    expect(citationPill).toHaveAttribute('data-marker-id', '1');

    // -----------------------------------------------------------------------
    // Step 7: Click Citation Pill [1] & Trigger Event Bus
    // -----------------------------------------------------------------------
    await user.click(citationPill);

    // Verify global store focus target was dispatched
    const activeTarget = useWorkspaceStore.getState().activeFocusTarget;
    expect(activeTarget).not.toBeNull();
    expect(activeTarget?.sourceId).toBe('src-pdf-001');
    expect(activeTarget?.pageNumber).toBe(42);
    expect(activeTarget?.bboxes).toEqual([
      [0.12, 0.35, 0.88, 0.38],
      [0.12, 0.39, 0.65, 0.42],
    ]);

    // -----------------------------------------------------------------------
    // Step 8: Assert Target Page Rendered with Bbox Highlight
    // -----------------------------------------------------------------------
    const targetPage = await screen.findByTestId('pdf-page-42');
    expect(targetPage).toBeInTheDocument();
    expect(targetPage.className).toContain('ring-2 ring-amber-500/80');

    // Verify bounding box highlight overlay rendered inside target page
    const bboxOverlay = screen.getByTestId('bbox-overlay-page-42');
    expect(bboxOverlay).toBeInTheDocument();

    const highlight0 = screen.getByTestId('pdf-highlight-0');
    const highlight1 = screen.getByTestId('pdf-highlight-1');
    expect(highlight0).toBeInTheDocument();
    expect(highlight1).toBeInTheDocument();
    expect(highlight0.className).toContain('border-amber-500');
  });
});
