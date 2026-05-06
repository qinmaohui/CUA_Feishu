import { initIpc } from '@ui-tars/electron-ipc/main';
import { recordingService } from '@main/services/recordingService';
import { AgentMemoryStore } from '@main/store/agentMemory';
import { replayByMemory } from '@main/services/replayExecutor';
import { NutJSElectronOperator } from '@main/agent/operator';
import { store } from '@main/store/create';
import { logger } from '@main/logger';

const t = initIpc.create();

export const recordingRoute = t.router({
  startRecording: t.procedure
    .input<{ instruction: string }>()
    .handle(async ({ input }) => {
      await recordingService.start(input.instruction);
    }),

  saveRecording: t.procedure.handle(async () => {
    await recordingService.save();
  }),

  discardRecording: t.procedure.handle(async () => {
    await recordingService.discard();
  }),

  replayMemory: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      const memory = AgentMemoryStore.getAll().find((m) => m.id === input.id);
      if (!memory) throw new Error(`Memory not found: ${input.id}`);

      const operator = new NutJSElectronOperator();
      const state = store.getState();
      store.setState({
        ...state,
        replayProgress: {
          current: 0,
          total: memory.steps.length,
          currentStep: null,
        },
      });

      try {
        const result = await replayByMemory({
          operator,
          memorySteps: memory.steps,
          onStepStart: (i, step) => {
            store.setState({
              ...store.getState(),
              replayProgress: {
                current: i + 1,
                total: memory.steps.length,
                currentStep: step,
              },
            });
          },
        });
        logger.info('[replayMemory IPC] result:', result);
        return result;
      } finally {
        store.setState({ ...store.getState(), replayProgress: null });
      }
    }),
});
