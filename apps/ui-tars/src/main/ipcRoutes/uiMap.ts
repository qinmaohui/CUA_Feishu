import { initIpc } from '@ui-tars/electron-ipc/main';

import {
  UIMapStore,
  type UIMapExperienceTarget,
  type UIMapNode,
} from '@main/store/uiMap';
import { explorationService } from '@main/services/explorationService';

const t = initIpc.create();

export const uiMapRoute = t.router({
  getUIMap: t.procedure.handle(async () => {
    return UIMapStore.getMap();
  }),

  resetUIMap: t.procedure.handle(async () => {
    return UIMapStore.reset();
  }),

  updateUIMapNode: t.procedure
    .input<{ id: string; patch: Partial<Omit<UIMapNode, 'id'>> }>()
    .handle(async ({ input }) => {
      return UIMapStore.updateNode(input.id, input.patch);
    }),

  deleteUIMapNode: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return UIMapStore.deleteNode(input.id);
    }),

  addUIMapExperience: t.procedure
    .input<{
      target: UIMapExperienceTarget;
      text: string;
      source?: 'auto' | 'manual';
    }>()
    .handle(async ({ input }) => {
      return UIMapStore.addExperience(
        input.target,
        input.text,
        input.source ?? 'manual',
      );
    }),

  deleteUIMapExperience: t.procedure
    .input<{ target: UIMapExperienceTarget; experienceId: string }>()
    .handle(async ({ input }) => {
      return UIMapStore.deleteExperience(input.target, input.experienceId);
    }),

  startExploration: t.procedure
    .input<{ maxPages?: number; timeoutMs?: number } | undefined>()
    .handle(async ({ input }) => {
      return explorationService.start(input ?? {});
    }),

  stopExploration: t.procedure.handle(async () => {
    explorationService.stop();
    return UIMapStore.getMap();
  }),
});
