import { create } from 'zustand';

import { api } from '@renderer/api';
import type {
  UIMap,
  UIMapExperienceTarget,
  UIMapNode,
} from '@main/store/uiMap';

interface UIMapState {
  uiMap: UIMap | null;
  loading: boolean;
  exploring: boolean;
  fetchUIMap: () => Promise<void>;
  updateNode: (
    id: string,
    patch: Partial<Omit<UIMapNode, 'id'>>,
  ) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  addExperience: (target: UIMapExperienceTarget, text: string) => Promise<void>;
  deleteExperience: (
    target: UIMapExperienceTarget,
    experienceId: string,
  ) => Promise<void>;
  startExploration: () => Promise<void>;
  stopExploration: () => Promise<void>;
}

export const useUIMapStore = create<UIMapState>((set, get) => ({
  uiMap: null,
  loading: false,
  exploring: false,

  fetchUIMap: async () => {
    set({ loading: true });
    try {
      const uiMap = await api.getUIMap();
      set({ uiMap });
    } finally {
      set({ loading: false });
    }
  },

  updateNode: async (id, patch) => {
    await api.updateUIMapNode({ id, patch });
    await get().fetchUIMap();
  },

  deleteNode: async (id) => {
    await api.deleteUIMapNode({ id });
    await get().fetchUIMap();
  },

  addExperience: async (target, text) => {
    await api.addUIMapExperience({ target, text, source: 'manual' });
    await get().fetchUIMap();
  },

  deleteExperience: async (target, experienceId) => {
    await api.deleteUIMapExperience({ target, experienceId });
    await get().fetchUIMap();
  },

  startExploration: async () => {
    set({ exploring: true });
    try {
      const uiMap = await api.startExploration({ maxPages: 15 });
      set({ uiMap });
    } finally {
      set({ exploring: false });
    }
  },

  stopExploration: async () => {
    const uiMap = await api.stopExploration();
    set({ uiMap, exploring: false });
  },
}));
