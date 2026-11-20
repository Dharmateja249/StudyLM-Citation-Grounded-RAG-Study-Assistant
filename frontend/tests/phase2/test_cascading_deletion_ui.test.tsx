import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SourceCard } from '@/components/sidebar/SourceCard';
import { NotebookSelector } from '@/components/sidebar/NotebookSelector';
import { SourceRead, NotebookRead } from '@/types/api';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { mockUser } from '../mocks/fixtures';

describe('Phase 2: Cascading Deletion & Confirmation Races', () => {
  beforeEach(() => {
    useAuthStore.getState().setToken('valid-jwt-token-alex-student');
    useAuthStore.getState().setUser(mockUser);
    useWorkspaceStore.getState().reset();
  });

  it('test_delete_source_requires_confirmation', async () => {
    const deleteSpy = vi.fn();
    const source: SourceRead = {
      id: 'src-test-1',
      user_id: 'usr-1',
      notebook_id: 'nb-1',
      title: 'Linear_Algebra.pdf',
      source_type: 'pdf',
      storage_key_or_url: 'key-1',
      status: 'ready',
      reindexing: false,
      summary_status: 'ready',
      created_at: new Date().toISOString(),
    };

    render(<SourceCard source={source} onDelete={deleteSpy} />);

    // Click trash button
    const deleteBtn = screen.getByTestId('delete-source-btn');
    await userEvent.click(deleteBtn);

    // Verify confirmation dialog appears
    expect(screen.getByTestId('delete-confirm-dialog')).toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();

    // Cancel deletion
    const cancelBtn = screen.getByTestId('cancel-delete-btn');
    await userEvent.click(cancelBtn);
    expect(screen.queryByTestId('delete-confirm-dialog')).not.toBeInTheDocument();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('test_source_delete_optimistic_update', async () => {
    const deleteSpy = vi.fn();
    const source: SourceRead = {
      id: 'src-test-2',
      user_id: 'usr-1',
      notebook_id: 'nb-1',
      title: 'Quantum_Mechanics.pdf',
      source_type: 'pdf',
      storage_key_or_url: 'key-2',
      status: 'ready',
      reindexing: false,
      summary_status: 'ready',
      created_at: new Date().toISOString(),
    };

    render(<SourceCard source={source} onDelete={deleteSpy} />);

    // Trigger delete and confirm
    await userEvent.click(screen.getByTestId('delete-source-btn'));
    await userEvent.click(screen.getByTestId('confirm-delete-btn'));

    expect(deleteSpy).toHaveBeenCalledWith('src-test-2');
  });

  it('test_notebook_deletion_cascade_warning', async () => {
    const mockNotebooks: NotebookRead[] = [
      {
        id: 'nb-cascade-1',
        user_id: mockUser.id,
        title: 'Biology 101',
        status: 'active',
        created_at: new Date().toISOString(),
      },
    ];

    useWorkspaceStore.getState().setActiveNotebookId('nb-cascade-1');
    render(<NotebookSelector initialNotebooks={mockNotebooks} />);

    // Open dropdown
    await userEvent.click(screen.getByTestId('notebook-switcher-btn'));

    // Click delete notebook icon
    const delBtn = screen.getByTestId('delete-notebook-nb-cascade-1');
    await userEvent.click(delBtn);

    // Assert cascading delete warning modal appears with exact warning text
    const modal = screen.getByTestId('notebook-delete-confirm-modal');
    expect(modal).toBeInTheDocument();
    expect(modal).toHaveTextContent(
      'Deleting this notebook will permanently remove all associated sources and notes.'
    );
  });

  it('test_notebook_delete_optimistic_update', async () => {
    const mockNotebooks: NotebookRead[] = [
      {
        id: 'nb-cascade-2',
        user_id: mockUser.id,
        title: 'Chemistry 101',
        status: 'active',
        created_at: new Date().toISOString(),
      },
    ];

    useWorkspaceStore.getState().setActiveNotebookId('nb-cascade-2');
    render(<NotebookSelector initialNotebooks={mockNotebooks} />);

    await userEvent.click(screen.getByTestId('notebook-switcher-btn'));
    await userEvent.click(screen.getByTestId('delete-notebook-nb-cascade-2'));

    // Confirm delete
    await userEvent.click(screen.getByTestId('confirm-delete-nb-btn'));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
    });
  });
});
