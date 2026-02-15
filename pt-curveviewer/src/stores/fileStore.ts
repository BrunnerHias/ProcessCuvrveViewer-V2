// ============================================================
// File Store - Zustand store for imported files
// ============================================================

import { create } from 'zustand';
import type { ImportedFile, CurveChannel } from '../types';

interface FileStoreState {
  files: ImportedFile[];
  isLoading: boolean;
  loadingProgress: string;
  progressCurrent: number;
  progressTotal: number;

  // Actions
  addFiles: (files: ImportedFile[]) => void;
  removeFile: (fileId: string) => void;
  clearFiles: () => void;
  setLoading: (loading: boolean, progress?: string) => void;
  setProgress: (current: number, total: number, text?: string) => void;

  // Getters
  getFile: (fileId: string) => ImportedFile | undefined;
  getChannel: (fileId: string, channelId: string) => CurveChannel | undefined;
  getAllChannels: () => CurveChannel[];
}

export const useFileStore = create<FileStoreState>((set, get) => ({
  files: [],
  isLoading: false,
  loadingProgress: '',
  progressCurrent: 0,
  progressTotal: 0,

  addFiles: (newFiles) =>
    set((state) => {
      const existingIds = new Set(state.files.map((f) => f.id));
      const unique = newFiles.filter((nf) => !existingIds.has(nf.id));
      if (unique.length === 0) return state;
      return { files: [...state.files, ...unique] };
    }),

  removeFile: (fileId) =>
    set((state) => ({
      files: state.files.filter((f) => f.id !== fileId),
    })),

  clearFiles: () => set({ files: [] }),

  setLoading: (loading, progress) =>
    set({ isLoading: loading, loadingProgress: progress || '', ...(loading ? {} : { progressCurrent: 0, progressTotal: 0 }) }),

  setProgress: (current, total, text) =>
    set({ progressCurrent: current, progressTotal: total, ...(text ? { loadingProgress: text } : {}) }),

  getFile: (fileId) => get().files.find((f) => f.id === fileId),

  getChannel: (fileId, channelId) => {
    const file = get().files.find((f) => f.id === fileId);
    return file?.curves.find((c) => c.id === channelId);
  },

  getAllChannels: () => get().files.flatMap((f) => f.curves),
}));
