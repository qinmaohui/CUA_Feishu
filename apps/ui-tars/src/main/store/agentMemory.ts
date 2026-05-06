import ElectronStore from 'electron-store';

import { logger } from '@main/logger';
import { Operator } from './types';

export interface MemoryStep {
  action_type: string;
  action_inputs: Record<string, unknown>;
  thought: string;
  reflection: string | null;
  screenshotBase64?: string;
  screenshotWithMarker?: string;
  a11ySnapshot?: string;
}

export interface AgentMemoryItem {
  id: string;
  name: string;
  instruction: string;
  instructionEmbedding: number[];
  operator: Operator;
  source?: 'agent' | 'manual';
  steps: MemoryStep[];
  startA11ySnapshot?: string;
  successMeta: {
    createdAt: number;
    updatedAt: number;
    successCount: number;
    lastSuccessAt: number;
  };
}

type AgentMemoryStoreSchema = {
  memories: AgentMemoryItem[];
};

const MAX_MEMORIES = 100;

export class AgentMemoryStore {
  private static instance: ElectronStore<AgentMemoryStoreSchema>;

  public static getInstance(): ElectronStore<AgentMemoryStoreSchema> {
    if (!AgentMemoryStore.instance) {
      AgentMemoryStore.instance = new ElectronStore<AgentMemoryStoreSchema>({
        name: 'ui_tars.agent_memory',
        defaults: {
          memories: [],
        },
      });
    }

    return AgentMemoryStore.instance;
  }

  public static getAll(): AgentMemoryItem[] {
    return AgentMemoryStore.getInstance().get('memories') || [];
  }

  public static setAll(memories: AgentMemoryItem[]): void {
    const sorted = [...memories]
      .sort((a, b) => b.successMeta.lastSuccessAt - a.successMeta.lastSuccessAt)
      .slice(0, MAX_MEMORIES);
    AgentMemoryStore.getInstance().set('memories', sorted);
  }

  public static save(item: AgentMemoryItem): AgentMemoryItem {
    const existing = AgentMemoryStore.getAll();
    const dedupIdx = existing.findIndex(
      (memory) =>
        memory.operator === item.operator &&
        memory.instruction === item.instruction &&
        (memory.source ?? 'agent') === (item.source ?? 'agent'),
    );

    if (dedupIdx >= 0) {
      const now = Date.now();
      const current = existing[dedupIdx];
      const merged: AgentMemoryItem = {
        ...current,
        name: item.name || current.name,
        instructionEmbedding:
          item.instructionEmbedding.length > 0
            ? item.instructionEmbedding
            : current.instructionEmbedding,
        source: item.source ?? current.source,
        steps: item.steps.length > 0 ? item.steps : current.steps,
        startA11ySnapshot: item.startA11ySnapshot ?? current.startA11ySnapshot,
        successMeta: {
          ...current.successMeta,
          updatedAt: now,
          lastSuccessAt: now,
          successCount: current.successMeta.successCount + 1,
        },
      };
      existing[dedupIdx] = merged;
      AgentMemoryStore.setAll(existing);
      logger.info('[AgentMemoryStore] Updated memory:', merged.id);
      return merged;
    }

    const next = [item, ...existing];
    AgentMemoryStore.setAll(next);
    logger.info('[AgentMemoryStore] Saved memory:', item.id);
    return item;
  }

  public static delete(id: string): boolean {
    const existing = AgentMemoryStore.getAll();
    const next = existing.filter((item) => item.id !== id);
    AgentMemoryStore.setAll(next);
    return next.length !== existing.length;
  }

  public static rename(id: string, name: string): AgentMemoryItem | null {
    const existing = AgentMemoryStore.getAll();
    const index = existing.findIndex((item) => item.id === id);
    if (index < 0) {
      return null;
    }

    const now = Date.now();
    const updated: AgentMemoryItem = {
      ...existing[index],
      name,
      successMeta: {
        ...existing[index].successMeta,
        updatedAt: now,
      },
    };

    existing[index] = updated;
    AgentMemoryStore.setAll(existing);
    return updated;
  }
}
