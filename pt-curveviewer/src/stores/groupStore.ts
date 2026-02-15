// ============================================================
// Group Store - Zustand store for channel grouping
// ============================================================

import { create } from 'zustand';
import type { ChannelGroup, ChannelRef } from '../types';

interface GroupStoreState {
  groups: ChannelGroup[];

  // Actions
  createGroup: (name: string, channels?: ChannelRef[]) => string;
  removeGroup: (groupId: string) => void;
  clearGroups: () => void;
  renameGroup: (groupId: string, newName: string) => void;
  addChannelToGroup: (groupId: string, channel: ChannelRef) => void;
  addChannelsToGroup: (groupId: string, channels: ChannelRef[]) => void;
  removeChannelFromGroup: (groupId: string, fileId: string, channelId: string) => void;
  removeFileFromGroup: (groupId: string, fileId: string) => void;
  moveChannel: (fromGroupId: string, toGroupId: string, channel: ChannelRef) => void;
  reorderGroups: (groupIds: string[]) => void;
  toggleGroupActive: (groupId: string) => void;
  setGroupActive: (groupId: string, active: boolean) => void;
}

export const useGroupStore = create<GroupStoreState>((set) => ({
  groups: [],

  createGroup: (name, channels = []) => {
    const id = crypto.randomUUID();
    set((state) => ({
      groups: [...state.groups, { id, name, channels, isActive: true }],
    }));
    return id;
  },

  removeGroup: (groupId) =>
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== groupId),
    })),

  clearGroups: () => set({ groups: [] }),

  renameGroup: (groupId, newName) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, name: newName } : g
      ),
    })),

  addChannelToGroup: (groupId, channel) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId
          ? { ...g, channels: [...g.channels, channel] }
          : g
      ),
    })),

  addChannelsToGroup: (groupId, channels) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              channels: [
                ...g.channels,
                ...channels.filter(
                  (nc) => !g.channels.some(
                    (ec) => ec.fileId === nc.fileId && ec.channelId === nc.channelId
                  )
                ),
              ],
            }
          : g
      ),
    })),

  removeChannelFromGroup: (groupId, fileId, channelId) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId
          ? {
              ...g,
              channels: g.channels.filter(
                (c) => !(c.fileId === fileId && c.channelId === channelId)
              ),
            }
          : g
      ),
    })),

  removeFileFromGroup: (groupId, fileId) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId
          ? { ...g, channels: g.channels.filter((c) => c.fileId !== fileId) }
          : g
      ),
    })),

  moveChannel: (fromGroupId, toGroupId, channel) =>
    set((state) => ({
      groups: state.groups.map((g) => {
        if (g.id === fromGroupId) {
          return {
            ...g,
            channels: g.channels.filter(
              (c) => !(c.fileId === channel.fileId && c.channelId === channel.channelId)
            ),
          };
        }
        if (g.id === toGroupId) {
          return { ...g, channels: [...g.channels, channel] };
        }
        return g;
      }),
    })),

  reorderGroups: (groupIds) =>
    set((state) => {
      const groupMap = new Map(state.groups.map((g) => [g.id, g]));
      return {
        groups: groupIds
          .map((id) => groupMap.get(id))
          .filter(Boolean) as ChannelGroup[],
      };
    }),

  toggleGroupActive: (groupId) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, isActive: !g.isActive } : g
      ),
    })),

  setGroupActive: (groupId, active) =>
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === groupId ? { ...g, isActive: active } : g
      ),
    })),
}));
