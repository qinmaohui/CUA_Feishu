import { create } from 'zustand';

import { api } from '@renderer/api';
import type { AgentMemoryItem } from '@main/store/agentMemory';

interface AgentMemoryState {
  memories: AgentMemoryItem[];
  loading: boolean;

  fetchMemories: () => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  renameMemory: (id: string, name: string) => Promise<void>;
}

export const useAgentMemoryStore = create<AgentMemoryState>((set, get) => ({
  memories: [],
  loading: false,

  fetchMemories: async () => {
    set({ loading: true });
    try {
      const memories = await api.listMemories();
      set({ memories: memories ?? [] });
    } finally {
      set({ loading: false });
    }
  },

  deleteMemory: async (id: string) => {
    await api.deleteMemory({ id });
    set({ memories: get().memories.filter((m) => m.id !== id) });
  },

  renameMemory: async (id: string, name: string) => {
    const updated = await api.renameMemory({ id, name });
    if (updated) {
      set({
        memories: get().memories.map((m) => (m.id === id ? { ...m, name } : m)),
      });
    }
  },
}));
