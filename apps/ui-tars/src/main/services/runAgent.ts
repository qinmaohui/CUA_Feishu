/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from 'assert';

import { logger } from '@main/logger';
import { StatusEnum } from '@ui-tars/shared/types';
import { type ConversationWithSoM } from '@main/shared/types';
import { GUIAgent, type GUIAgentConfig } from '@ui-tars/sdk';
import { markClickPosition } from '@main/utils/image';
import { UTIOService } from '@main/services/utio';
import { NutJSElectronOperator } from '../agent/operator';
import {
  createRemoteBrowserOperator,
  RemoteComputerOperator,
} from '../remote/operators';
import {
  DefaultBrowserOperator,
  RemoteBrowserOperator,
} from '@ui-tars/operator-browser';
import { showPredictionMarker } from '@main/window/ScreenMarker';
import { SettingStore } from '@main/store/setting';
import { AgentMemoryStore, MemoryStep } from '@main/store/agentMemory';
import { AppState, Operator, MemoryPhase } from '@main/store/types';
import { GUIAgentManager } from '../ipcRoutes/agent';
import { checkBrowserAvailability } from './browserCheck';
import {
  getModelVersion,
  getSpByModelVersion,
  beforeAgentRun,
  afterAgentRun,
  getLocalBrowserSearchEngine,
} from '../utils/agent';
import { FREE_MODEL_BASE_URL } from '../remote/shared';
import { getAuthHeader } from '../remote/auth';
import { ProxyClient } from '../remote/proxyClient';
import { UITarsModelConfig } from '@ui-tars/sdk/core';
import { runAutoAnnotation, ensureFeishuForeground } from './feishuAnnotation';
import { showWidgetWindow } from '../window/ScreenMarker';
import { hideMainWindow } from '../window';
import {
  resetTaskA11yContext,
  queryAccessibilityTree,
  getLatestTaskA11yContextSnapshot,
} from './getDom';
import { embedInstruction, findTopKSimilarMemories } from './memoryEmbedding';
import {
  replayByMemory,
  checkReplayScreenState,
  verifyReplayResult,
} from './replayExecutor';

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

export const runAgent = async (
  setState: (state: AppState) => void,
  getState: () => AppState,
) => {
  logger.info('runAgent');

  const settings = SettingStore.getStore();
  const { instructions, abortController } = getState();
  assert(instructions, 'instructions is required');

  // Show Widget and hide main window immediately so the user sees progress during memory retrieval
  if (
    settings.operator === Operator.LocalComputer ||
    settings.operator === Operator.LocalBrowser
  ) {
    showWidgetWindow();
    hideMainWindow();
  }

  // Set feishu-launch phase first so Widget renders before ensureFeishuForeground runs
  setState({
    ...getState(),
    messages: [],
    memoryPhases: [
      { id: 'feishu', label: '正在激活飞书...', status: 'active' },
    ],
    replayProgress: null,
    verifyProgress: null,
  });
  await ensureFeishuForeground((patch) =>
    setState({ ...getState(), ...patch }),
  );

  const language = settings.language ?? 'en';

  logger.info('settings.operator', settings.operator);

  const handleData: GUIAgentConfig<NutJSElectronOperator>['onData'] = async ({
    data,
  }) => {
    const lastConv = getState().messages[getState().messages.length - 1];
    const { status, conversations, ...restUserData } = data;
    logger.info('[onGUIAgentData] status', status, conversations.length);

    // 每次截图操作时获取无障碍树并打印
    // TODO: 无障碍树功能暂时搁置，后续恢复时取消注释
    /*
    if (
      conversations.length > 0 &&
      conversations[conversations.length - 1].screenshotBase64
    ) {
      try {
        logger.info('[getDom] 正在获取飞书无障碍树...');
        const axTree = await getAccessibilityTree('Feishu');
        const summary = getTreeSummary(axTree);
        logger.info('[getDom] 无障碍树获取成功:\n', summary);
        console.log('========================================');
        console.log('📊 飞书无障碍树摘要:');
        console.log(summary);
        console.log('========================================');
      } catch (e) {
        logger.error('[getDom] 获取无障碍树失败:', e);
        console.error('❌ 获取无障碍树失败:', e);
      }
    }
    */

    // 每次截图时执行飞书UI自动标注（异步执行，不阻塞主流程）
    if (
      settings.autoAnnotation &&
      conversations.length > 0 &&
      conversations[conversations.length - 1].screenshotBase64
    ) {
      // 异步执行标注，无需等待结果
      (async () => {
        try {
          logger.info('[FeishuAnnotation] 开始飞书UI自动标注...');
          const currentConv = conversations[conversations.length - 1];
          if (currentConv.screenshotBase64 && currentConv.screenshotContext) {
            // 使用Agent已有的截图，避免重复截取
            await runAutoAnnotation({
              base64: currentConv.screenshotBase64,
              width: currentConv.screenshotContext.size.width,
              height: currentConv.screenshotContext.size.height,
              scaleFactor: currentConv.screenshotContext.scaleFactor || 1,
            });
          } else {
            // 没有现有截图时自行截取
            await runAutoAnnotation();
          }
          logger.info('[FeishuAnnotation] 飞书UI自动标注完成');
        } catch (e) {
          logger.error('[FeishuAnnotation] 飞书UI自动标注失败:', e);
        }
      })();
    }

    // add SoM to conversations
    const latestA11ySnapshot = getLatestTaskA11yContextSnapshot();
    const conversationsWithSoM: ConversationWithSoM[] = await Promise.all(
      conversations.map(async (conv) => {
        const convWithSoM = conv as ConversationWithSoM;
        const { screenshotContext, predictionParsed } = convWithSoM;
        const a11ySnapshot =
          convWithSoM.a11ySnapshot ??
          (predictionParsed?.length ? latestA11ySnapshot : undefined);
        if (
          lastConv?.screenshotBase64 &&
          screenshotContext?.size &&
          predictionParsed
        ) {
          const screenshotBase64WithElementMarker = await markClickPosition({
            screenshotContext,
            base64: lastConv?.screenshotBase64,
            parsed: predictionParsed,
          }).catch((e) => {
            logger.error('[markClickPosition error]:', e);
            return '';
          });
          return {
            ...convWithSoM,
            a11ySnapshot,
            screenshotBase64WithElementMarker,
          };
        }
        return {
          ...convWithSoM,
          ...(a11ySnapshot ? { a11ySnapshot } : {}),
        };
      }),
    ).catch((e) => {
      logger.error('[conversationsWithSoM error]:', e);
      return conversations;
    });

    const {
      screenshotBase64,
      predictionParsed,
      screenshotContext,
      screenshotBase64WithElementMarker,
      ...rest
    } = conversationsWithSoM?.[conversationsWithSoM.length - 1] || {};
    logger.info(
      '[onGUIAgentData] ======data======\n',
      predictionParsed,
      screenshotContext,
      rest,
      status,
      '\n========',
    );

    if (
      settings.operator === Operator.LocalComputer &&
      predictionParsed?.length &&
      screenshotContext?.size &&
      !abortController?.signal?.aborted
    ) {
      showPredictionMarker(predictionParsed, screenshotContext);
    }

    setState({
      ...getState(),
      status,
      restUserData,
      // Append new conversations; skip the final SDK "end" callback which sends conversations: []
      ...(conversationsWithSoM.length > 0
        ? { messages: [...getState().messages, ...conversationsWithSoM] }
        : {}),
    });
  };

  let operatorType: 'computer' | 'browser' = 'computer';
  let operator:
    | NutJSElectronOperator
    | DefaultBrowserOperator
    | RemoteComputerOperator
    | RemoteBrowserOperator;

  switch (settings.operator) {
    case Operator.LocalComputer:
      operator = new NutJSElectronOperator();
      operatorType = 'computer';
      break;
    case Operator.LocalBrowser:
      await checkBrowserAvailability();
      const { browserAvailable } = getState();
      if (!browserAvailable) {
        setState({
          ...getState(),
          status: StatusEnum.ERROR,
          errorMsg:
            'Browser is not available. Please install Chrome and try again.',
        });
        return;
      }

      operator = await DefaultBrowserOperator.getInstance(
        false,
        false,
        false,
        getState().status === StatusEnum.CALL_USER,
        getLocalBrowserSearchEngine(settings.searchEngineForBrowser),
      );
      operatorType = 'browser';
      break;
    case Operator.RemoteComputer:
      operator = await RemoteComputerOperator.create();
      operatorType = 'computer';
      break;
    case Operator.RemoteBrowser:
      operator = await createRemoteBrowserOperator();
      operatorType = 'browser';
      break;
    default:
      break;
  }

  let modelVersion = getModelVersion(settings.vlmProvider);
  let modelConfig: UITarsModelConfig = {
    baseURL: settings.vlmBaseUrl,
    apiKey: settings.vlmApiKey,
    model: settings.vlmModelName,
    useResponsesApi: settings.useResponsesApi,
  };
  let modelAuthHdrs: Record<string, string> = {};

  if (
    settings.operator === Operator.RemoteComputer ||
    settings.operator === Operator.RemoteBrowser
  ) {
    const useResponsesApi = await ProxyClient.getRemoteVLMResponseApiSupport();
    modelConfig = {
      baseURL: FREE_MODEL_BASE_URL,
      apiKey: '',
      model: '',
      useResponsesApi,
    };
    modelAuthHdrs = await getAuthHeader();
    modelVersion = await ProxyClient.getRemoteVLMProvider();
  }

  const a11yGuidance = `
## Accessibility Tree Context
Before each response, a fresh [A11Y_CONTEXT] snapshot is injected listing visible, enabled UI controls.
Each entry includes precomputed click targets:
  - norm=(x,y)
  - point1000=<point>NNN NNN</point>

When deciding where to click or type:
1. If the target appears in [A11Y_CONTEXT], copy its point1000 value directly and use it in click(point='...').
2. Do not re-calculate or re-derive coordinates from rect/norm.
3. Only if the target is missing from [A11Y_CONTEXT], fall back to screenshot-based estimation.
`;

  // Memory: search for similar past successes before starting
  const MEMORY_SIMILARITY_THRESHOLD = 0.84;
  let memoryGuidance = '';
  let runInstruction = instructions;

  const makePhases = (
    activeId: string,
    doneIds: string[],
    failedIds: string[] = [],
    details: Record<string, string> = {},
  ): MemoryPhase[] => {
    const PHASES = [
      { id: 'retrieve', label: '检索中' },
      { id: 'found', label: '找到记忆' },
      { id: 'check', label: '判断起点' },
      { id: 'replay', label: '重放/参考模式' },
    ];
    return PHASES.map(({ id, label }) => ({
      id,
      label,
      status: failedIds.includes(id)
        ? 'failed'
        : doneIds.includes(id)
          ? 'done'
          : id === activeId
            ? 'active'
            : 'pending',
      detail: details[id],
    }));
  };

  // Helper: push a system-level message into chat history so it appears in session records
  const pushSystemMessage = (text: string) => {
    const msg: ConversationWithSoM = {
      from: 'system',
      value: text,
      timing: { start: Date.now(), end: Date.now(), cost: 0 },
    };
    setState({ ...getState(), messages: [...getState().messages, msg] });
  };

  if (operator!) {
    setState({
      ...getState(),
      thinkingMsg: '正在检索相似记忆...',
      memoryPhases: makePhases('retrieve', []),
    });
    const topMatches = await findTopKSimilarMemories(
      instructions,
      settings.operator,
      3,
    );
    const bestMatch = topMatches[0];

    if (bestMatch && bestMatch.score >= MEMORY_SIMILARITY_THRESHOLD) {
      logger.info(
        '[runAgent] Memory hit:',
        bestMatch.memory.id,
        'score:',
        bestMatch.score,
      );
      const scoreStr = `${(bestMatch.score * 100).toFixed(0)}%`;
      const memName =
        bestMatch.memory.name || bestMatch.memory.instruction.slice(0, 40);

      setState({
        ...getState(),
        thinkingMsg: '找到相似记忆，正在判断起点...',
        memoryPhases: makePhases('check', ['retrieve', 'found'], [], {
          found: `${memName}（相似度 ${scoreStr}，共 ${bestMatch.memory.steps.length} 步）`,
        }),
      });

      // Push "found memory" message first so it appears before the VLM judgment
      pushSystemMessage(
        `[记忆检索] 找到相似记忆「${memName}」（相似度 ${scoreStr}，共 ${bestMatch.memory.steps.length} 步），正在判断起点...`,
      );

      const screenCheck = bestMatch.memory.startA11ySnapshot
        ? await checkReplayScreenState(
            bestMatch.memory.startA11ySnapshot,
            bestMatch.memory.steps,
            (stage, text) => {
              if (stage === 'thinking') {
                setState({
                  ...getState(),
                  thinkingMsg: text,
                  memoryPhases: makePhases('check', ['retrieve', 'found'], [], {
                    found: `${memName}（${scoreStr}）`,
                    check: text,
                  }),
                });
              } else {
                pushSystemMessage(text);
                setState({
                  ...getState(),
                  memoryPhases: makePhases('check', ['retrieve', 'found'], [], {
                    found: `${memName}（${scoreStr}）`,
                    check: text,
                  }),
                });
              }
            },
          )
        : { ok: true };

      if (!screenCheck.ok) {
        logger.info(
          '[runAgent] Screen state mismatch:',
          screenCheck.reason,
          '- falling back to reference mode',
        );
        setState({
          ...getState(),
          thinkingMsg: '起点状态不匹配，切换到参考模式...',
          memoryPhases: makePhases(
            'replay',
            ['retrieve', 'found', 'check', 'replay'],
            [],
            {
              found: `${memName}（${scoreStr}）`,
              replay: '参考模式（起点不匹配）',
            },
          ),
        });
        pushSystemMessage(`[起点判断] 起点状态不匹配，切换到参考模式执行。`);
        memoryGuidance = `\n\n## Memory Reference\nA similar task was previously completed successfully. Key steps for reference:\n${bestMatch.memory.steps
          .map((s, i) => `${i + 1}. ${s.action_type}: ${s.thought}`)
          .join('\n')}\nAdapt these steps to the current UI state as needed.`;
      } else {
        setState({
          ...getState(),
          thinkingMsg: '正在重放操作...',
          memoryPhases: makePhases(
            'replay',
            ['retrieve', 'found', 'check'],
            [],
            {
              found: `${memName}（${scoreStr}）`,
            },
          ),
        });
        const replayResult = await replayByMemory({
          operator: operator!,
          memorySteps: bestMatch.memory.steps,
          onStepStart: (i, step) => {
            setState({
              ...getState(),
              replayProgress: {
                current: i + 1,
                total: bestMatch.memory.steps.length,
                currentStep: step,
              },
            });
          },
        });
        setState({ ...getState(), replayProgress: null });

        if (replayResult.ok) {
          logger.info('[runAgent] Replay succeeded, running VLM verification');
          setState({
            ...getState(),
            replayProgress: null,
            thinkingMsg: '重放完成，正在验证任务结果...',
            verifyProgress: {
              status: 'thinking',
              message: '正在截图，调用 VLM 验证任务结果...',
            },
            memoryPhases: makePhases(
              'replay',
              ['retrieve', 'found', 'check', 'replay'],
              [],
              {
                found: `${memName}（${scoreStr}）`,
                replay: `重放成功（${bestMatch.memory.steps.length} 步）`,
              },
            ),
          });

          await verifyReplayResult(instructions, (status, message) => {
            setState({
              ...getState(),
              verifyProgress: { status, message },
            });
          });

          setState({
            ...getState(),
            status: StatusEnum.END,
            thinkingMsg: '',
          });

          // 让用户有时间看到验证结果，3 秒后再隐藏 Widget
          await new Promise((resolve) => setTimeout(resolve, 3000));

          afterAgentRun(settings.operator);
          resetTaskA11yContext();
          return;
        } else {
          logger.info(
            '[runAgent] Replay failed at step',
            replayResult.failStep,
            ':',
            replayResult.reason,
            '- falling back to reference mode',
          );
          setState({
            ...getState(),
            thinkingMsg: '重放失败，切换到参考模式...',
            memoryPhases: makePhases(
              'replay',
              ['retrieve', 'found', 'check'],
              ['replay'],
              {
                found: `${memName}（${scoreStr}）`,
                replay: `第 ${(replayResult.failStep ?? 0) + 1} 步失败，切换参考模式`,
              },
            ),
          });
          pushSystemMessage(
            `[重放] 第 ${(replayResult.failStep ?? 0) + 1} 步执行失败，切换到参考模式继续执行。`,
          );
          memoryGuidance = `\n\n## Memory Reference\nA similar task was previously completed successfully. Key steps for reference:\n${bestMatch.memory.steps
            .map((s, i) => `${i + 1}. ${s.action_type}: ${s.thought}`)
            .join('\n')}\nAdapt these steps to the current UI state as needed.`;
        }
      }
    } else {
      setState({
        ...getState(),
        thinkingMsg: '未找到匹配记忆，正常执行...',
        memoryPhases: [
          { id: 'retrieve', label: '检索中', status: 'done' },
          {
            id: 'found',
            label: '未找到匹配',
            status: 'failed',
            detail: topMatches[0]
              ? `最高相似度 ${(topMatches[0].score * 100).toFixed(0)}%`
              : undefined,
          },
          { id: 'check', label: '判断起点', status: 'pending' },
          { id: 'replay', label: '重放/参考模式', status: 'pending' },
        ],
      });
    }
  }

  setState({ ...getState(), thinkingMsg: 'Thinking...' });

  // Capture start-state A11y snapshot before the agent runs
  let startA11ySnapshot: string | undefined;
  try {
    const a11yResult = await queryAccessibilityTree({});
    startA11ySnapshot =
      a11yResult?.extraction?.extractionText?.slice(0, 2000) ?? undefined;
  } catch (e) {
    logger.warn('[runAgent] Failed to capture start A11y snapshot:', e);
  }

  const systemPrompt =
    getSpByModelVersion(modelVersion, language, operatorType) +
    a11yGuidance +
    memoryGuidance;

  const guiAgent = new GUIAgent({
    model: modelConfig,
    systemPrompt: systemPrompt,
    logger,
    signal: abortController?.signal,
    operator: operator!,
    onData: handleData,
    onError: (params) => {
      const { error } = params;
      logger.error('[onGUIAgentError]', settings, error);
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: JSON.stringify({
          status: error?.status,
          message: error?.message,
          stack: error?.stack,
        }),
      });
    },
    retry: {
      model: {
        maxRetries: 5,
      },
      screenshot: {
        maxRetries: 5,
      },
      execute: {
        maxRetries: 1,
      },
    },
    maxLoopCount: settings.maxLoopCount,
    loopIntervalInMs: settings.loopIntervalInMs,
    uiTarsVersion: modelVersion,
  });

  GUIAgentManager.getInstance().setAgent(guiAgent);
  UTIOService.getInstance().sendInstruction(instructions);

  const { sessionHistoryMessages } = getState();

  beforeAgentRun(settings.operator);
  resetTaskA11yContext();

  const startTime = Date.now();

  await guiAgent
    .run(runInstruction, sessionHistoryMessages, modelAuthHdrs)
    .catch((e) => {
      logger.error('[runAgentLoop error]', e);
      setState({
        ...getState(),
        status: StatusEnum.ERROR,
        errorMsg: e.message,
      });
    });

  logger.info('[runAgent Totoal cost]: ', (Date.now() - startTime) / 1000, 's');

  // Memory: save successful run as reusable memory
  const finalState = getState();
  if (finalState.status === StatusEnum.END) {
    const steps: MemoryStep[] = [];
    for (let i = 0; i < finalState.messages.length; i += 1) {
      const conv = finalState.messages[i];
      const parsed = conv.predictionParsed ?? [];
      if (!parsed.length) continue;
      const recentA11y = getRecentA11yFromMessages(finalState.messages, i);

      for (const p of parsed) {
        if (
          !p.action_type ||
          ['screenshot', 'finished'].includes(p.action_type)
        ) {
          continue;
        }

        steps.push({
          action_type: p.action_type,
          action_inputs: (p.action_inputs ?? {}) as Record<string, unknown>,
          thought: p.thought ?? '',
          reflection: p.reflection ?? null,
          screenshotBase64: conv.screenshotBase64,
          screenshotWithMarker: conv.screenshotBase64WithElementMarker,
          a11ySnapshot: conv.a11ySnapshot ?? recentA11y,
        });
      }
    }

    if (steps.length > 0) {
      const instructionEmbedding = await embedInstruction(instructions);

      const now = Date.now();
      AgentMemoryStore.save({
        id: `memory_${now}_${Math.random().toString(36).slice(2, 9)}`,
        name: instructions.slice(0, 50).trim(),
        instruction: instructions,
        instructionEmbedding,
        operator: settings.operator,
        steps,
        startA11ySnapshot,
        successMeta: {
          createdAt: now,
          updatedAt: now,
          successCount: 1,
          lastSuccessAt: now,
        },
      });
      logger.info(
        '[runAgent] Memory saved for instruction:',
        instructions.slice(0, 50),
      );
    }
  }

  afterAgentRun(settings.operator);
  resetTaskA11yContext();
  setState({ ...getState(), verifyProgress: null });
};
