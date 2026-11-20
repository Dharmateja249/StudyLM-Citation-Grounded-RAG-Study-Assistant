import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';

describe('Auth & Session Store Verification', () => {
  beforeEach(() => {
    useAuthStore.getState().reset();
    useWorkspaceStore.getState().reset();
    localStorage.clear();
  });

  it('test_google_oauth_session_initialization', async () => {
    server.use(
      http.post('/api/auth/google', async () => {
        return HttpResponse.json({
          access_token: 'mock-valid-jwt-token',
          token_type: 'bearer',
          user: {
            id: 'usr-123',
            email: 'student@example.edu',
            name: 'Alex Student',
            avatar_url: 'https://lh3.googleusercontent.com/avatar.png',
            is_active: true,
            last_active_notebook_id: 'nb-last-saved',
            created_at: '2026-10-11T12:00:00Z',
          },
        });
      })
    );

    const success = await useAuthStore.getState().loginWithGoogle('valid-google-id-token');
    expect(success).toBe(true);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.token).toBe('mock-valid-jwt-token');
    expect(state.user?.email).toBe('student@example.edu');
    expect(state.user?.name).toBe('Alex Student');
    expect(state.isDeactivated).toBe(false);
    expect(localStorage.getItem('studylm_auth_token')).toBe('mock-valid-jwt-token');

    // Asserts session resume restored last active notebook
    expect(useWorkspaceStore.getState().activeNotebookId).toBe('nb-last-saved');
  });

  it('test_unauthenticated_session_redirects_to_login', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.user).toBeNull();
  });

  it('test_expired_jwt_triggers_token_refresh_or_logout', () => {
    useAuthStore.getState().setToken('expired-jwt');
    useWorkspaceStore.getState().setActiveNotebookId('nb-active');

    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    // Call expired session handler
    useAuthStore.getState().handleExpiredSession();

    const authState = useAuthStore.getState();
    expect(authState.isAuthenticated).toBe(false);
    expect(authState.token).toBeNull();
    expect(authState.user).toBeNull();
    expect(authState.authError).toBe('Session expired. Please log in again.');
    expect(localStorage.getItem('studylm_auth_token')).toBeNull();

    // Verify workspace state is purged
    expect(useWorkspaceStore.getState().activeNotebookId).toBeNull();
  });

  it('test_deactivated_user_displays_403_banner', async () => {
    server.use(
      http.post('/api/auth/google', async () => {
        return HttpResponse.json(
          { detail: 'Account pending deletion' },
          { status: 403 }
        );
      })
    );

    const success = await useAuthStore.getState().loginWithGoogle('deactivated-user-token');
    expect(success).toBe(false);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
    expect(state.isDeactivated).toBe(true);
    expect(state.deactivationMessage).toBe('Account pending deletion');
  });
});
