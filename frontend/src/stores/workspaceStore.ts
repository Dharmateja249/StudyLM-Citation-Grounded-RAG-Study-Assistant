import { create } from 'zustand';
import { ViewerFocusTarget, RateLimitStatus, ResolvedCitation } from '@/types/api';

export interface WorkspaceState {
  // Active Entities
  activeNotebookId: string | null;
  activeSourceId: string | null;
  activeFocusTarget: ViewerFocusTarget | null;

  // Rate Limiting (60 q/hr)
  rateLimit: RateLimitStatus;

  // Responsive Layout Panes
  leftPanelCollapsed: boolean;
  rightPanelCollapsed: boolean;
  leftPanelSize: number; // Default: 20%
  rightPanelSize: number; // Default: 35%

  // Phase 3 Modal State
  isSignInModalOpen: boolean;
  isOnboardingOpen: boolean;

  // View Navigation
  currentView: 'workspace' | 'landing' | null;

  // Phase 4 Source Scope & Citations
  selectedSourceIds: string[];
  isScopeCleared: boolean;
  totalSourceCount: number;
  activeCitations: ResolvedCitation[];

  // Actions
  setActiveNotebookId: (id: string | null) => void;
  setActiveSourceId: (id: string | null) => void;
  dispatchFocusTarget: (target: (Omit<ViewerFocusTarget, 'timestamp'> & { timestamp?: number }) | null) => void;
  clearFocusTarget: () => void;
  setRateLimitStatus: (status: Partial<RateLimitStatus>) => void;
  setLeftPanelCollapsed: (collapsed: boolean) => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setPanelSizes: (left: number, right: number) => void;

  // Phase 3 Actions
  setSignInModalOpen: (open: boolean) => void;
  setOnboardingOpen: (open: boolean) => void;

  // View Navigation Actions
  setCurrentView: (view: 'workspace' | 'landing' | null) => void;

  // Phase 4 Actions
  setSelectedSourceIds: (ids: string[]) => void;
  toggleSourceScope: (sourceId: string) => void;
  selectAllSources: (sourceIds: string[]) => void;
  clearSourceScope: () => void;
  setTotalSourceCount: (count: number) => void;
  setActiveCitations: (citations: ResolvedCitation[]) => void;

  reset: () => void;
}

const NOTEBOOK_KEY = 'studylm_active_notebook_id';
const PANEL_SIZES_KEY = 'studylm_panel_sizes';
const SOURCE_KEY = 'studylm_active_source_id';

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

function getInitialPanelSizes(): { left: number; right: number } {
  const raw = safeStorage.getItem(PANEL_SIZES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.left === 'number' && typeof parsed.right === 'number') {
        return {
          left: Math.min(35, Math.max(15, parsed.left)),
          right: Math.min(50, Math.max(25, parsed.right)),
        };
      }
    } catch {}
  }
  return { left: 20, right: 35 };
}

const defaultRateLimit: RateLimitStatus = {
  queryCount: 0,
  maxQueries: 60,
  windowStart: new Date().toISOString(),
  isRateLimited: false,
  isLocked: false,
  retryAfterSeconds: 0,
};

let lastMonotonicTs = 0;
function getMonotonicTimestamp(): number {
  const now = Date.now();
  lastMonotonicTs = now > lastMonotonicTs ? now : lastMonotonicTs + 1;
  return lastMonotonicTs;
}

const initialPanelSizes = getInitialPanelSizes();

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeNotebookId: safeStorage.getItem(NOTEBOOK_KEY),
  activeSourceId: null,
  activeFocusTarget: null,
  rateLimit: defaultRateLimit,
  leftPanelCollapsed: false,
  rightPanelCollapsed: false,
  leftPanelSize: initialPanelSizes.left,
  rightPanelSize: initialPanelSizes.right,
  isSignInModalOpen: false,
  isOnboardingOpen: false,
  currentView: null,
  selectedSourceIds: [],
  isScopeCleared: false,
  totalSourceCount: 0,
  activeCitations: [],

  setActiveNotebookId: (id) => {
    if (id) {
      safeStorage.setItem(NOTEBOOK_KEY, id);
    } else {
      safeStorage.removeItem(NOTEBOOK_KEY);
      safeStorage.removeItem(SOURCE_KEY);
    }
    // Switching notebooks clears active source and citations from prior notebook
    set({
      activeNotebookId: id,
      activeSourceId: null,
      activeFocusTarget: null,
      activeCitations: [],
    });
  },

  setActiveSourceId: (id) => {
    if (id) {
      safeStorage.setItem(SOURCE_KEY, id);
    } else {
      safeStorage.removeItem(SOURCE_KEY);
    }
    set({ activeSourceId: id });
  },

  dispatchFocusTarget: (target) => {
    if (!target) {
      set({ activeFocusTarget: null });
      return;
    }
    const focusTarget: ViewerFocusTarget = {
      ...target,
      timestamp: target.timestamp ?? getMonotonicTimestamp(),
    };
    // Auto-select source if targeted
    set({
      activeFocusTarget: focusTarget,
      activeSourceId: target.sourceId,
    });
  },

  clearFocusTarget: () => {
    set({ activeFocusTarget: null });
  },

  setRateLimitStatus: (status) => {
    set((state) => ({
      rateLimit: { ...state.rateLimit, ...status },
    }));
  },

  setLeftPanelCollapsed: (collapsed) => set({ leftPanelCollapsed: collapsed }),
  setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),

  toggleLeftPanel: () => set((state) => ({ leftPanelCollapsed: !state.leftPanelCollapsed })),
  toggleRightPanel: () => set((state) => ({ rightPanelCollapsed: !state.rightPanelCollapsed })),

  setPanelSizes: (left, right) => {
    const clampedLeft = Math.min(35, Math.max(15, left));
    const clampedRight = Math.min(50, Math.max(25, right));
    safeStorage.setItem(
      PANEL_SIZES_KEY,
      JSON.stringify({ left: clampedLeft, right: clampedRight })
    );
    set({
      leftPanelSize: clampedLeft,
      rightPanelSize: clampedRight,
    });
  },

  setSignInModalOpen: (open) => set({ isSignInModalOpen: open }),
  setOnboardingOpen: (open) => set({ isOnboardingOpen: open }),

  setCurrentView: (view) => set({ currentView: view }),

  setSelectedSourceIds: (ids) => set({ selectedSourceIds: ids, isScopeCleared: ids.length === 0 }),
  toggleSourceScope: (sourceId) =>
    set((state) => {
      const next = state.selectedSourceIds.includes(sourceId)
        ? state.selectedSourceIds.filter((id) => id !== sourceId)
        : [...state.selectedSourceIds, sourceId];
      return {
        selectedSourceIds: next,
        isScopeCleared: next.length === 0,
      };
    }),
  selectAllSources: (sourceIds) => set({ selectedSourceIds: [...sourceIds], isScopeCleared: false }),
  clearSourceScope: () => set({ selectedSourceIds: [], isScopeCleared: true }),
  setTotalSourceCount: (count) => set({ totalSourceCount: count }),
  setActiveCitations: (citations) => set({ activeCitations: citations }),

  reset: () => {
    safeStorage.removeItem(NOTEBOOK_KEY);
    safeStorage.removeItem(SOURCE_KEY);
    set({
      activeNotebookId: null,
      activeSourceId: null,
      activeFocusTarget: null,
      rateLimit: defaultRateLimit,
      leftPanelCollapsed: false,
      rightPanelCollapsed: false,
      isSignInModalOpen: false,
      isOnboardingOpen: false,
      currentView: null,
      selectedSourceIds: [],
      isScopeCleared: false,
      totalSourceCount: 0,
      activeCitations: [],
    });
  },
}));
