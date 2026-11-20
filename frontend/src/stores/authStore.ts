import { create } from 'zustand';
import { UserProfileResponse } from '@/types/api';
import { useWorkspaceStore } from './workspaceStore';

export interface DevLoginOptions {
  id?: string;
  email?: string;
  name?: string;
  token?: string;
  picture?: string;
  avatar_url?: string;
}

export interface AuthState {
  // Session State
  token: string | null;
  user: UserProfileResponse | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;

  // SEC-08 Deactivation State
  isDeactivated: boolean;
  deactivationMessage: string | null;

  // Actions
  setToken: (token: string | null) => void;
  setUser: (user: UserProfileResponse | null) => void;
  setSession: (token: string | null, user: UserProfileResponse | null) => void;
  login: (credentials?: DevLoginOptions) => void;
  loginWithGoogle: (idToken: string) => Promise<boolean>;
  logout: () => void;
  handleExpiredSession: () => void;
  triggerDeactivatedState: (message?: string) => void;
  dismissDeactivatedModal: () => void;
  reset: () => void;
}

const STORAGE_KEY = 'studylm_auth_token';
const USER_STORAGE_KEY = 'studylm_user_profile';

const safeStorage = {
  getItem: (key: string): string | null => {
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    return null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(key, value);
      } catch {}
    }
  },
  removeItem: (key: string): void => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(key);
      } catch {}
    }
  },
};

const getStoredUser = (): UserProfileResponse | null => {
  const raw = safeStorage.getItem(USER_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserProfileResponse;
  } catch {
    return null;
  }
};

export const useAuthStore = create<AuthState>((set, get) => ({
  token: safeStorage.getItem(STORAGE_KEY),
  user: getStoredUser(),
  isAuthenticated: Boolean(safeStorage.getItem(STORAGE_KEY)),
  isLoading: false,
  authError: null,
  isDeactivated: false,
  deactivationMessage: null,

  setToken: (token) => {
    if (token) {
      safeStorage.setItem(STORAGE_KEY, token);
      set({ token, isAuthenticated: true, authError: null });
    } else {
      safeStorage.removeItem(STORAGE_KEY);
      safeStorage.removeItem(USER_STORAGE_KEY);
      useWorkspaceStore.getState().reset();
      set({ token: null, isAuthenticated: false, user: null });
    }
  },

  setUser: (user) => {
    const prevUser = get().user;
    if (user) {
      safeStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      safeStorage.removeItem(USER_STORAGE_KEY);
    }
    // Cross-tenant protection: if switching user ID or clearing user, purge workspace
    if (prevUser && user && prevUser.id !== user.id) {
      useWorkspaceStore.getState().reset();
    } else if (prevUser && !user) {
      useWorkspaceStore.getState().reset();
    }
    set({ user });
  },

  setSession: (token, user) => {
    get().setToken(token);
    get().setUser(user);
  },

  login: (credentials?: DevLoginOptions) => {
    const token = credentials?.token || 'mock-jwt-token-alex-dev';
    const user: UserProfileResponse = {
      id: credentials?.id || 'usr-default-001',
      email: credentials?.email || 'student@university.edu',
      name: credentials?.name || 'Alex Student',
      avatar_url:
        credentials?.picture ||
        credentials?.avatar_url ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb',
      is_active: true,
      last_active_notebook_id: 'nb-physics-101',
      created_at: new Date().toISOString(),
    };
    get().setSession(token, user);
  },

  loginWithGoogle: async (idToken: string): Promise<boolean> => {
    set({ isLoading: true, authError: null, isDeactivated: false, deactivationMessage: null });
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken }),
      });

      if (response.status === 403) {
        // SEC-08 Deactivated user guard
        const errorData = (await response.json().catch(() => ({}))) as { detail?: string };
        const message = errorData.detail || 'Account pending deletion';
        get().triggerDeactivatedState(message);
        set({ isLoading: false });
        return false;
      }

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { detail?: string };
        const message = errorData.detail || `Authentication failed (HTTP ${response.status})`;
        set({ authError: message, isLoading: false, isAuthenticated: false, token: null });
        safeStorage.removeItem(STORAGE_KEY);
        return false;
      }

      const data = await response.json();
      safeStorage.setItem(STORAGE_KEY, data.access_token);
      if (data.user) {
        safeStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));
      }

      // Mandatory cross-tenant state purge before loading new user workspace
      useWorkspaceStore.getState().reset();

      set({
        token: data.access_token,
        user: data.user,
        isAuthenticated: true,
        isLoading: false,
        authError: null,
        isDeactivated: false,
      });

      // Restore last active notebook if available
      if (data.user?.last_active_notebook_id) {
        useWorkspaceStore.getState().setActiveNotebookId(data.user.last_active_notebook_id);
      }

      return true;
    } catch (err: unknown) {
      const error = err as Error;
      set({
        authError: error.message || 'Network error during authentication',
        isLoading: false,
        isAuthenticated: false,
        token: null,
      });
      safeStorage.removeItem(STORAGE_KEY);
      safeStorage.removeItem(USER_STORAGE_KEY);
      return false;
    }
  },

  logout: () => {
    safeStorage.removeItem(STORAGE_KEY);
    safeStorage.removeItem(USER_STORAGE_KEY);
    // Mandatory cross-tenant state purge
    useWorkspaceStore.getState().reset();
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      authError: null,
      isDeactivated: false,
      deactivationMessage: null,
    });
  },

  handleExpiredSession: () => {
    safeStorage.removeItem(STORAGE_KEY);
    // Mandatory cross-tenant state purge
    useWorkspaceStore.getState().reset();
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      authError: 'Session expired. Please log in again.',
    });
  },

  triggerDeactivatedState: (message = 'Account pending deletion') => {
    safeStorage.removeItem(STORAGE_KEY);
    useWorkspaceStore.getState().reset();
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      isDeactivated: true,
      deactivationMessage: message,
    });
  },

  dismissDeactivatedModal: () => {
    set({ isDeactivated: false, deactivationMessage: null });
  },

  reset: () => {
    safeStorage.removeItem(STORAGE_KEY);
    useWorkspaceStore.getState().reset();
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      isLoading: false,
      authError: null,
      isDeactivated: false,
      deactivationMessage: null,
    });
  },
}));

useAuthStore.subscribe((state, prevState) => {
  if (prevState.user && state.user && prevState.user.id !== state.user.id) {
    useWorkspaceStore.getState().reset();
  } else if (prevState.user && !state.user) {
    useWorkspaceStore.getState().reset();
  }
});

