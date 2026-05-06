import { initIpc } from '@ui-tars/electron-ipc/main';
import { StatusEnum } from '@ui-tars/shared/types';
import { store } from '@main/store/create';
import { runAgent } from '@main/services/runAgent';
import {
  BatchTestStore,
  TestResult,
  TestReport,
  TestStepDetail,
} from '@main/store/batchTest';
import { logger } from '@main/logger';
import { getGlobalStopEpoch, hasGlobalStopSince } from '@main/services/runStop';
import type { ConversationWithSoM } from '@main/shared/types';

const t = initIpc.create();
const A11Y_CONTEXT_PREFIX = '[A11Y_CONTEXT]';

const getRecentA11yFromMessages = (
  messages: ConversationWithSoM[],
  beforeIndex: number,
): string | undefined =>
  [...messages.slice(0, beforeIndex)]
    .reverse()
    .find(
      (m) =>
        typeof m.value === 'string' && m.value.startsWith(A11Y_CONTEXT_PREFIX),
    )?.value;

export const batchTestRoute = t.router({
  listTestCases: t.procedure.handle(async () => {
    return BatchTestStore.getAllCases();
  }),

  addTestCase: t.procedure
    .input<{ name: string; instruction: string }>()
    .handle(async ({ input }) => {
      return BatchTestStore.addCase(input.name, input.instruction);
    }),

  updateTestCase: t.procedure
    .input<{
      id: string;
      patch: Partial<{ name: string; instruction: string; enabled: boolean }>;
    }>()
    .handle(async ({ input }) => {
      return BatchTestStore.updateCase(input.id, input.patch);
    }),

  deleteTestCase: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return BatchTestStore.deleteCase(input.id);
    }),

  reorderTestCases: t.procedure
    .input<{ ids: string[] }>()
    .handle(async ({ input }) => {
      return BatchTestStore.reorderCases(input.ids);
    }),

  runBatchTest: t.procedure.handle(async () => {
    const cases = BatchTestStore.getAllCases().filter((c) => c.enabled);
    const results: TestResult[] = [];
    const batchStartTime = Date.now();
    const batchStopEpoch = getGlobalStopEpoch();

    logger.info(`[BatchTest] Starting batch run with ${cases.length} cases`);

    for (const testCase of cases) {
      if (hasGlobalStopSince(batchStopEpoch)) {
        logger.info(
          '[BatchTest] Stop signal detected, aborting remaining cases',
        );
        break;
      }

      const caseStartTime = Date.now();
      let shouldStopBatch = false;
      logger.info(`[BatchTest] Running case: ${testCase.name}`);

      try {
        store.setState({
          ...store.getState(),
          instructions: testCase.instruction,
          messages: [],
          status: StatusEnum.INIT,
          errorMsg: null,
          abortController: new AbortController(),
          thinking: true,
          memoryPhases: null,
          replayProgress: null,
          verifyProgress: null,
        });

        await runAgent(store.setState, store.getState);

        store.setState({
          ...store.getState(),
          thinking: false,
          thinkingMsg: null,
        });

        const finalState = store.getState();
        const caseEndTime = Date.now();
        const isSuccess = finalState.status === StatusEnum.END;
        const isStopped = finalState.status === StatusEnum.USER_STOPPED;
        const verifyMessage = [...finalState.messages]
          .reverse()
          .find((m) => m.from === 'system' && m.value?.includes('[验证结论]'));

        // Collect full step details including screenshots
        const steps: TestStepDetail[] = [];
        let stepIndex = 0;
        for (let i = 0; i < finalState.messages.length; i += 1) {
          const conv = finalState.messages[i];
          const recentA11y = getRecentA11yFromMessages(finalState.messages, i);
          const parsed = conv.predictionParsed ?? [];
          for (const p of parsed) {
            if (
              !p.action_type ||
              ['screenshot', 'finished'].includes(p.action_type)
            ) {
              continue;
            }
            steps.push({
              index: stepIndex++,
              thought: p.thought ?? '',
              action_type: p.action_type,
              action_inputs: (p.action_inputs ?? {}) as Record<string, unknown>,
              reflection: p.reflection ?? null,
              screenshotBase64: conv.screenshotBase64,
              screenshotWithMarker: (
                conv as { screenshotBase64WithElementMarker?: string }
              ).screenshotBase64WithElementMarker,
              a11ySnapshot: conv.a11ySnapshot ?? recentA11y,
              timingCost: conv.timing?.cost,
            });
          }
        }

        const verifyMessageIndex = finalState.messages.findIndex(
          (m) => m.from === 'system' && m.value?.includes('[验证结论]'),
        );
        const verifyRecentA11y =
          verifyMessageIndex >= 0
            ? getRecentA11yFromMessages(finalState.messages, verifyMessageIndex)
            : undefined;

        results.push({
          caseId: testCase.id,
          caseName: testCase.name,
          instruction: testCase.instruction,
          status: isStopped ? 'skipped' : isSuccess ? 'success' : 'failed',
          startTime: caseStartTime,
          endTime: caseEndTime,
          durationMs: caseEndTime - caseStartTime,
          stepCount: steps.length,
          errorMsg:
            isSuccess || isStopped
              ? undefined
              : (finalState.errorMsg ?? 'Unknown error'),
          steps,
          // 从 messages 提取验证结论文本（from='system' 且包含 '[验证结论]'）
          verifyConclusion: verifyMessage?.value?.replace('[验证结论] ', ''),
          verifyEvidence:
            verifyMessage?.screenshotBase64 ||
            verifyMessage?.a11ySnapshot ||
            verifyRecentA11y
              ? {
                  screenshotBase64: verifyMessage?.screenshotBase64,
                  a11ySnapshot: verifyMessage?.a11ySnapshot ?? verifyRecentA11y,
                }
              : undefined,
        });

        logger.info(
          `[BatchTest] Case ${testCase.name} finished: ${isStopped ? 'stopped' : isSuccess ? 'success' : 'failed'}, steps: ${steps.length}`,
        );

        if (isStopped || hasGlobalStopSince(batchStopEpoch)) {
          logger.info('[BatchTest] Stop signal detected, ending batch run now');
          shouldStopBatch = true;
        }
      } catch (e: unknown) {
        const caseEndTime = Date.now();
        const errMsg = e instanceof Error ? e.message : String(e);
        logger.error(`[BatchTest] Case ${testCase.name} threw:`, errMsg);
        results.push({
          caseId: testCase.id,
          caseName: testCase.name,
          instruction: testCase.instruction,
          status: 'failed',
          startTime: caseStartTime,
          endTime: caseEndTime,
          durationMs: caseEndTime - caseStartTime,
          stepCount: 0,
          errorMsg: errMsg,
          steps: [],
        });
      }

      store.setState({
        ...store.getState(),
        status: StatusEnum.END,
        messages: [],
        thinking: false,
        errorMsg: null,
        instructions: '',
        memoryPhases: null,
        replayProgress: null,
        verifyProgress: null,
      });

      if (shouldStopBatch) {
        break;
      }
    }

    const batchEndTime = Date.now();
    const successCount = results.filter((r) => r.status === 'success').length;
    const failedCount = results.filter((r) => r.status === 'failed').length;
    const skippedCount = results.filter((r) => r.status === 'skipped').length;
    const totalDurationMs = batchEndTime - batchStartTime;
    const avgDurationMs =
      results.length > 0
        ? Math.round(
            results.reduce((s, r) => s + r.durationMs, 0) / results.length,
          )
        : 0;
    const avgStepCount =
      results.length > 0
        ? Math.round(
            results.reduce((s, r) => s + r.stepCount, 0) / results.length,
          )
        : 0;

    const report: TestReport = {
      id: `report_${batchStartTime}_${Math.random().toString(36).slice(2, 9)}`,
      startTime: batchStartTime,
      endTime: batchEndTime,
      totalDurationMs,
      results,
      summary: {
        total: results.length,
        success: successCount,
        failed: failedCount,
        skipped: skippedCount,
        successRate:
          results.length > 0
            ? Math.round((successCount / results.length) * 100)
            : 0,
        avgDurationMs,
        avgStepCount,
      },
    };

    BatchTestStore.saveReport(report);
    logger.info(
      `[BatchTest] Batch complete. Success: ${successCount}/${results.length}`,
    );
    return report;
  }),

  listTestReports: t.procedure.handle(async () => {
    return BatchTestStore.getAllReports();
  }),

  getTestReport: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return BatchTestStore.getReport(input.id);
    }),

  deleteTestReport: t.procedure
    .input<{ id: string }>()
    .handle(async ({ input }) => {
      return BatchTestStore.deleteReport(input.id);
    }),
});
