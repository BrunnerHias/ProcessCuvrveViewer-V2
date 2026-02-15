// ============================================================
// Settings Store - Plot settings and visibility
// ============================================================

import { create } from 'zustand';
import type { PlotSettings, VisibilitySettings, ChannelVisibility, CursorState, ZoomLevel, SyncMode, SnapYStrategy } from '../types';

export type AppTheme = 'dark' | 'light';

const CURSOR_COLORS = ['#ff6b6b', '#51cf66', '#ffd43b', '#339af0', '#cc5de8', '#ff922b'];

interface SettingsStoreState {
  theme: AppTheme;
  plotSettings: PlotSettings;
  activeTab: 'portal' | 'plot' | 'tables';

  // Theme
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;

  // Global visibility
  setActiveXAxis: (xAxis: string) => void;
  setVisibility: (update: Partial<VisibilitySettings>) => void;
  toggleAllElements: () => void;
  toggleLines: () => void;
  toggleWindows: () => void;
  toggleCircles: () => void;
  toggleShowPoints: () => void;
  setActiveTab: (tab: 'portal' | 'plot' | 'tables') => void;

  // Per-instance channel visibility
  setChannelVisible: (groupId: string, fileId: string, channelId: string, visible: boolean) => void;
  setMultipleChannelsVisible: (entries: { groupId: string; fileId: string; channelId: string }[], visible: boolean) => void;
  setChannelElementVisible: (groupId: string, fileId: string, channelId: string, element: 'lines' | 'windows' | 'circles', visible: boolean) => void;
  setElementGroupVisible: (groupId: string, fileId: string, channelId: string, elementGroupKey: string, visible: boolean) => void;
  toggleDescriptionVisibility: (description: string) => void;
  initChannelVisibility: (entries: Omit<ChannelVisibility, 'visible' | 'visibleElements'>[]) => void;
  isChannelVisible: (groupId: string, fileId: string, channelId: string) => boolean;
  getChannelVisibility: (groupId: string, fileId: string, channelId: string) => ChannelVisibility | undefined;

  // Cursor management
  addCursor: (snapFileId?: string, snapChannelId?: string) => void;
  removeCursor: (id: string) => void;
  updateCursorPosition: (id: string, xPosition: number, yPosition?: number, freeYAxisIndex?: number) => void;
  setCursorMode: (id: string, mode: 'free' | 'snap', snapFileId?: string, snapChannelId?: string) => void;
  setCursorSnapYStrategy: (id: string, strategy: SnapYStrategy) => void;
  setCursorShowAllFiles: (id: string, showAll: boolean) => void;
  clearCursors: () => void;

  // Color overrides
  setChannelColorOverride: (channelId: string, color: string) => void;
  setGroupColorOverride: (groupId: string, color: string, channelIds?: string[]) => void;
  removeColorOverride: (channelId: string) => void;
  recentColors: string[];
  addRecentColor: (color: string) => void;

  // Zoom history
  pushZoom: (level: ZoomLevel) => void;
  undoZoom: () => ZoomLevel | null;
  redoZoom: () => ZoomLevel | null;
  resetZoom: () => void;

  // X-Sync
  syncMode: SyncMode;
  syncMasterYAxis: string;
  syncThreshold: number;
  syncOffsets: Record<string, number>; // fileId → X-offset
  syncIsCalculating: boolean;
  syncErrors: string[];
  setSyncMode: (mode: SyncMode) => void;
  setSyncMasterYAxis: (yAxis: string) => void;
  setSyncThreshold: (value: number) => void;
  applySyncOffsets: (offsets: Record<string, number>, errors: string[]) => void;
  resetSync: () => void;
  setSyncCalculating: (v: boolean) => void;

  // Tree-view checkbox selection (shared with CurvePlot & ValueTables)
  treeSelection: Set<string>;            // "fileId::channelId" keys
  setTreeSelection: (sel: Set<string>) => void;
}

// Detect initial theme from localStorage or system preference
const getInitialTheme = (): AppTheme => {
  try {
    const stored = localStorage.getItem('pt-curveviewer-theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
};

const applyTheme = (theme: AppTheme) => {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('pt-curveviewer-theme', theme); } catch { /* ignore */ }
};

// Apply initial theme immediately
const initialTheme = getInitialTheme();
applyTheme(initialTheme);

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  theme: initialTheme,
  plotSettings: {
    activeXAxis: '',
    visibility: {
      allElements: true,
      lines: true,
      windows: true,
      circles: true,
      showPoints: false,
    },
    channelVisibility: [],
    colorOverrides: {},
    cursors: [],
    zoomHistory: [],
    zoomIndex: -1,
  },
  activeTab: 'portal',
  recentColors: [],
  syncMode: 'off' as SyncMode,
  syncMasterYAxis: '',
  syncThreshold: 0,
  syncOffsets: {} as Record<string, number>,
  syncIsCalculating: false,
  syncErrors: [] as string[],
  treeSelection: new Set<string>(),

  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },

  toggleTheme: () => {
    const newTheme = get().theme === 'dark' ? 'light' : 'dark';
    applyTheme(newTheme);
    set({ theme: newTheme });
  },

  setActiveXAxis: (xAxis) =>
    set((state) => ({
      plotSettings: { ...state.plotSettings, activeXAxis: xAxis },
    })),

  setVisibility: (update) =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        visibility: { ...state.plotSettings.visibility, ...update },
      },
    })),

  toggleAllElements: () =>
    set((state) => {
      const newVal = !state.plotSettings.visibility.allElements;
      return {
        plotSettings: {
          ...state.plotSettings,
          visibility: {
            ...state.plotSettings.visibility,
            allElements: newVal,
            lines: newVal,
            windows: newVal,
            circles: newVal,
          },
        },
      };
    }),

  toggleLines: () =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        visibility: {
          ...state.plotSettings.visibility,
          lines: !state.plotSettings.visibility.lines,
        },
      },
    })),

  toggleWindows: () =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        visibility: {
          ...state.plotSettings.visibility,
          windows: !state.plotSettings.visibility.windows,
        },
      },
    })),

  toggleCircles: () =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        visibility: {
          ...state.plotSettings.visibility,
          circles: !state.plotSettings.visibility.circles,
        },
      },
    })),

  toggleShowPoints: () =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        visibility: {
          ...state.plotSettings.visibility,
          showPoints: !state.plotSettings.visibility.showPoints,
        },
      },
    })),

  setActiveTab: (tab) => set({ activeTab: tab }),

  // --- Per-Instance Channel Visibility ---
  setChannelVisible: (groupId, fileId, channelId, visible) =>
    set((state) => {
      const cv = state.plotSettings.channelVisibility;
      const idx = cv.findIndex((c) => c.groupId === groupId && c.fileId === fileId && c.channelId === channelId);
      if (idx >= 0) {
        const updated = [...cv];
        updated[idx] = { ...updated[idx], visible };
        return { plotSettings: { ...state.plotSettings, channelVisibility: updated } };
      }
      // Auto-create entry
      return {
        plotSettings: {
          ...state.plotSettings,
          channelVisibility: [...cv, { groupId, fileId, channelId, visible, visibleElements: { lines: true, windows: true, circles: true } }],
        },
      };
    }),

  setMultipleChannelsVisible: (entries, visible) =>
    set((state) => {
      let cv = [...state.plotSettings.channelVisibility];
      for (const { groupId, fileId, channelId } of entries) {
        const idx = cv.findIndex((c) => c.groupId === groupId && c.fileId === fileId && c.channelId === channelId);
        if (idx >= 0) {
          cv[idx] = { ...cv[idx], visible };
        } else {
          cv.push({ groupId, fileId, channelId, visible, visibleElements: { lines: true, windows: true, circles: true } });
        }
      }
      return { plotSettings: { ...state.plotSettings, channelVisibility: cv } };
    }),

  setChannelElementVisible: (groupId, fileId, channelId, element, visible) =>
    set((state) => {
      const cv = state.plotSettings.channelVisibility;
      const idx = cv.findIndex((c) => c.groupId === groupId && c.fileId === fileId && c.channelId === channelId);
      if (idx >= 0) {
        const updated = [...cv];
        updated[idx] = { ...updated[idx], visibleElements: { ...updated[idx].visibleElements, [element]: visible } };
        return { plotSettings: { ...state.plotSettings, channelVisibility: updated } };
      }
      const newEntry: ChannelVisibility = {
        groupId, fileId, channelId, visible: true,
        visibleElements: { lines: true, windows: true, circles: true, [element]: visible },
      };
      return { plotSettings: { ...state.plotSettings, channelVisibility: [...cv, newEntry] } };
    }),

  setElementGroupVisible: (groupId, fileId, channelId, elementGroupKey, visible) =>
    set((state) => {
      const cv = state.plotSettings.channelVisibility;
      const idx = cv.findIndex((c) => c.groupId === groupId && c.fileId === fileId && c.channelId === channelId);
      if (idx >= 0) {
        const updated = [...cv];
        const hidden = new Set(updated[idx].hiddenElementGroups || []);
        if (visible) hidden.delete(elementGroupKey); else hidden.add(elementGroupKey);
        updated[idx] = { ...updated[idx], hiddenElementGroups: Array.from(hidden) };
        return { plotSettings: { ...state.plotSettings, channelVisibility: updated } };
      }
      const newEntry: ChannelVisibility = {
        groupId, fileId, channelId, visible: true,
        visibleElements: { lines: true, windows: true, circles: true },
        hiddenElementGroups: visible ? [] : [elementGroupKey],
      };
      return { plotSettings: { ...state.plotSettings, channelVisibility: [...cv, newEntry] } };
    }),

  toggleDescriptionVisibility: (_description: string) =>
    set((state) => {
      // Description toggling is handled in the component via setChannelVisible
      // This is a placeholder for potential future centralized logic
      return state;
    }),

  initChannelVisibility: (entries) =>
    set((state) => {
      const existing = state.plotSettings.channelVisibility;
      const existingKeys = new Set(existing.map((c) => `${c.groupId}-${c.fileId}-${c.channelId}`));
      const newEntries: ChannelVisibility[] = entries
        .filter((e) => !existingKeys.has(`${e.groupId}-${e.fileId}-${e.channelId}`))
        .map((e) => ({ ...e, visible: true, visibleElements: { lines: true, windows: true, circles: true } }));
      if (newEntries.length === 0) return state;
      return {
        plotSettings: {
          ...state.plotSettings,
          channelVisibility: [...existing, ...newEntries],
        },
      };
    }),

  isChannelVisible: (groupId, fileId, channelId) => {
    const entry = get().plotSettings.channelVisibility.find(
      (c) => c.groupId === groupId && c.fileId === fileId && c.channelId === channelId
    );
    return entry ? entry.visible : true; // Default visible
  },

  getChannelVisibility: (groupId, fileId, channelId) => {
    return get().plotSettings.channelVisibility.find(
      (c) => c.groupId === groupId && c.fileId === fileId && c.channelId === channelId
    );
  },

  // --- Cursor Management ---
  addCursor: (snapFileId, snapChannelId) =>
    set((state) => {
      const idx = state.plotSettings.cursors.length;
      const cursor: CursorState = {
        id: crypto.randomUUID(),
        xPosition: 0,
        mode: snapChannelId ? 'snap' : 'free',
        snapFileId,
        snapChannelId,
        snapYStrategy: 'ymax',
        showAllFiles: true,
        color: CURSOR_COLORS[idx % CURSOR_COLORS.length],
      };
      return {
        plotSettings: { ...state.plotSettings, cursors: [...state.plotSettings.cursors, cursor] },
      };
    }),

  removeCursor: (id) =>
    set((state) => ({
      plotSettings: { ...state.plotSettings, cursors: state.plotSettings.cursors.filter((c) => c.id !== id) },
    })),

  updateCursorPosition: (id, xPosition, yPosition?, freeYAxisIndex?) =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        cursors: state.plotSettings.cursors.map((c) => {
          if (c.id !== id) return c;
          const upd: typeof c = { ...c, xPosition };
          if (yPosition !== undefined) upd.yPosition = yPosition;
          if (freeYAxisIndex !== undefined) upd.freeYAxisIndex = freeYAxisIndex;
          return upd;
        }),
      },
    })),

  setCursorMode: (id, mode, snapFileId, snapChannelId) =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        cursors: state.plotSettings.cursors.map((c) => (c.id === id ? { ...c, mode, snapFileId, snapChannelId } : c)),
      },
    })),

  setCursorSnapYStrategy: (id, strategy) =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        cursors: state.plotSettings.cursors.map((c) => (c.id === id ? { ...c, snapYStrategy: strategy } : c)),
      },
    })),

  setCursorShowAllFiles: (id, showAll) =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        cursors: state.plotSettings.cursors.map((c) => (c.id === id ? { ...c, showAllFiles: showAll } : c)),
      },
    })),

  clearCursors: () =>
    set((state) => ({
      plotSettings: { ...state.plotSettings, cursors: [] },
    })),

  // --- Color Overrides ---
  setChannelColorOverride: (channelId, color) =>
    set((state) => ({
      plotSettings: {
        ...state.plotSettings,
        colorOverrides: { ...state.plotSettings.colorOverrides, [channelId]: color },
      },
    })),

  setGroupColorOverride: (_groupId, color, channelIds) => {
    if (!channelIds || channelIds.length === 0) return;
    set((state) => {
      const overrides = { ...state.plotSettings.colorOverrides };
      for (const cid of channelIds) {
        overrides[cid] = color;
      }
      return { plotSettings: { ...state.plotSettings, colorOverrides: overrides } };
    });
  },

  removeColorOverride: (channelId) =>
    set((state) => {
      const overrides = { ...state.plotSettings.colorOverrides };
      delete overrides[channelId];
      return { plotSettings: { ...state.plotSettings, colorOverrides: overrides } };
    }),

  addRecentColor: (color) =>
    set((state) => {
      const existing = state.recentColors.filter((c) => c !== color);
      return { recentColors: [color, ...existing].slice(0, 12) };
    }),

  // --- Zoom History ---
  pushZoom: (level) =>
    set((state) => {
      const { zoomHistory, zoomIndex } = state.plotSettings;
      // Trim forward history when new zoom happens
      const trimmed = zoomHistory.slice(0, zoomIndex + 1);
      return {
        plotSettings: {
          ...state.plotSettings,
          zoomHistory: [...trimmed, level],
          zoomIndex: trimmed.length,
        },
      };
    }),

  undoZoom: () => {
    const state = get();
    const { zoomHistory, zoomIndex } = state.plotSettings;
    if (zoomIndex <= 0) return null;
    const newIndex = zoomIndex - 1;
    set({
      plotSettings: { ...state.plotSettings, zoomIndex: newIndex },
    });
    return zoomHistory[newIndex];
  },

  redoZoom: () => {
    const state = get();
    const { zoomHistory, zoomIndex } = state.plotSettings;
    if (zoomIndex >= zoomHistory.length - 1) return null;
    const newIndex = zoomIndex + 1;
    set({
      plotSettings: { ...state.plotSettings, zoomIndex: newIndex },
    });
    return zoomHistory[newIndex];
  },

  resetZoom: () =>
    set((state) => ({
      plotSettings: { ...state.plotSettings, zoomHistory: [], zoomIndex: -1 },
    })),

  // --- X-Sync ---
  setSyncMode: (mode) => set({ syncMode: mode }),
  setSyncMasterYAxis: (yAxis) => set({ syncMasterYAxis: yAxis }),
  setSyncThreshold: (value) => set({ syncThreshold: value }),
  applySyncOffsets: (offsets, errors) => set({ syncOffsets: offsets, syncErrors: errors, syncIsCalculating: false }),
  resetSync: () => set({ syncMode: 'off', syncOffsets: {}, syncErrors: [], syncIsCalculating: false }),
  setSyncCalculating: (v) => set({ syncIsCalculating: v }),

  // --- Tree selection ---
  setTreeSelection: (sel) => set({ treeSelection: sel }),
}));
