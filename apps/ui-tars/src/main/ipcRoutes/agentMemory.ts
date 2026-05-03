import { initIpc } from '@ui-tars/electron-ipc/main';

import { AgentMemoryStore } from '@main/store/agentMemory';
import { Operator } from '@main/store/types';
import { findTopKSimilarMemories } from '@main/services/memoryEmbedding';

const t = initIpc.create();

export const agentMemoryRoute = t.router({
  listMemories: t.procedure.handle(async () => {
    return AgentMemoryStore.getAll();
  }),

  searchMemories: t.procedure
    .input<{ instruction: string; operator: Operator; k?: number }>()
    .handle(async ({ input }) => {
      return findTopKSimilarMemories(
        input.instruction,
        input.operator,
        input.k ?? 3,
      );
    }),

  deleteMemory: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return AgentMemoryStore.delete(input.id);
    }),

  renameMemory: t.procedure
    .input<{ id: string; name: string }>()
    .handle(async ({ input }) => {
      return AgentMemoryStore.rename(input.id, input.name);
    }),
});
