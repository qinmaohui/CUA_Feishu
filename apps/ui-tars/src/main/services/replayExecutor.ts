import { nativeImage } from 'electron';
import OpenAI from 'openai';

import { logger } from '@main/logger';
import { MemoryStep } from '@main/store/agentMemory';
import { StatusEnum, type PredictionParsed } from '@ui-tars/shared/types';
import type {
  Operator as BaseOperator,
  ExecuteOutput,
} from '@ui-tars/sdk/core';
import { queryAccessibilityTree } from './getDom';
import { captureFeishuWindow } from './feishuAnnotation';
import { SettingStore } from '@main/store/setting';

type ReplayResult = {
  ok: boolean;
  failStep?: number;
  reason?: string;
};

const toPrediction = (step: MemoryStep): PredictionParsed => ({
  action_type: step.action_type,
  action_inputs: step.action_inputs as PredictionParsed['action_inputs'],
  thought: step.thought,
  reflection: step.reflection,
});

const getScreenContext = async (operator: BaseOperator) => {
  const snapshot = await operator.screenshot();
  const image = nativeImage.createFromDataURL(
    `data:image/jpeg;base64,${snapshot.base64}`,
  );
  const size = image.getSize();
  if (!size.width || !size.height) {
    throw new Error('Failed to parse screenshot size for replay context');
  }

  return {
    width: size.width,
    height: size.height,
    scaleFactor: snapshot.scaleFactor || 1,
  };
};

const isExecuteFailed = (output: ExecuteOutput | void) => {
  if (!output || !('status' in output) || !output.status) {
    return false;
  }
  return output.status === StatusEnum.ERROR;
};

// Token overlap ratio between two text strings (Jaccard-like)
const textOverlapRatio = (a: string, b: string): number => {
  const tokenize = (s: string) =>
    new Set(
      s.toLowerCase().replace(/\s+/g, ' ').trim().split(' ').filter(Boolean),
    );
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  setA.forEach((t) => {
    if (setB.has(t)) intersection += 1;
  });
  return intersection / Math.max(setA.size, setB.size);
};

// Exported separately so callers can show a thinkingMsg while this runs
export const checkReplayScreenState = async (
  startA11ySnapshot: string,
  memorySteps: MemoryStep[],
  onProgress?: (stage: 'thinking' | 'result', text: string) => void,
): Promise<ReplayResult> => {
  try {
    const settings = SettingStore.getStore();

    onProgress?.('thinking', '正在截图并调用VLM判断起点状态...');

    // Gather current screen state: screenshot + A11y text
    const [screenshot, currentA11y] = await Promise.all([
      captureFeishuWindow(),
      queryAccessibilityTree({}).catch(() => null),
    ]);

    const currentA11yText = currentA11y?.extraction?.extractionText ?? '';

    // Fast text-overlap fallback when VLM is not configured
    if (!settings.vlmBaseUrl || !settings.vlmApiKey || !settings.vlmModelName) {
      logger.warn(
        '[checkReplayScreenState] VLM not configured, falling back to text overlap',
      );
      const similarity = textOverlapRatio(startA11ySnapshot, currentA11yText);
      logger.info(
        '[checkReplayScreenState] Text similarity (fallback):',
        similarity,
      );
      const ok = similarity >= 0.3;
      onProgress?.(
        'result',
        `（文本相似度回退）相似度 ${(similarity * 100).toFixed(0)}%，判断：${ok ? '起点匹配' : '起点不匹配'}`,
      );
      if (!ok) {
        return {
          ok: false,
          reason: `Screen state mismatch (text similarity=${similarity.toFixed(2)})`,
        };
      }
      return { ok: true };
    }

    const llmClient = new OpenAI({
      baseURL: settings.vlmBaseUrl,
      apiKey: settings.vlmApiKey,
    });

    const lang = settings.language ?? 'en';
    const isChinese = lang === 'zh';

    const stepsText = memorySteps
      .map((s, i) => `${i + 1}. [${s.action_type}] ${s.thought}`)
      .join('\n');

    const prompt = isChinese
      ? `你是一个GUI自动化Agent的界面状态验证器。

Agent已记录了一个任务，即将重放其操作步骤。在重放之前，你需要判断**当前界面**是否是这组操作序列的正确起点。

## 即将重放的操作序列（共 ${memorySteps.length} 步）
${stepsText}

## 记录时的起点无障碍树快照
\`\`\`
${startA11ySnapshot.slice(0, 2000)}
\`\`\`

## 当前无障碍树
\`\`\`
${currentA11yText.slice(0, 2000)}
\`\`\`

## 当前截图
（见附图）

## 任务
结合上述操作序列，判断当前界面是否适合作为重放的起点。仅返回JSON对象，不要有其他内容：
{
  "match": true | false,
  "reason": "一句话说明判断依据，需引用操作序列第一步"
}

若当前界面与记录起点足够接近，第一步操作可以正常执行（时间戳、未读数等动态内容的差异可以忽略），则 "match": true。
若页面类型、当前面板或主要UI结构与第一步所需明显不同，则 "match": false。`
      : `You are a screen-state verifier for a GUI automation agent.

The agent recorded a task and is about to replay its steps. Before replaying, you must decide whether the **current screen** is the correct starting point for this operation sequence.

## Operation sequence to be replayed (${memorySteps.length} steps)
${stepsText}

## Recorded starting state (accessibility tree snapshot)
\`\`\`
${startA11ySnapshot.slice(0, 2000)}
\`\`\`

## Current accessibility tree
\`\`\`
${currentA11yText.slice(0, 2000)}
\`\`\`

## Current screenshot
(attached as image)

## Task
Considering the operation sequence above, judge whether the current screen is a valid starting point for replaying these steps. Answer with a JSON object only — no markdown, no explanation:
{
  "match": true | false,
  "reason": "one sentence explaining your decision, referencing the first step of the operation sequence"
}

Set "match": true if the current screen matches the recorded starting state closely enough that step 1 of the sequence can be executed (minor differences like timestamps or unread counts are acceptable).
Set "match": false if the page type, active panel, or major UI structure is clearly different from what step 1 requires.`;

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: 'user',
        content: screenshot
          ? [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${screenshot.base64}`,
                },
              },
            ]
          : prompt,
      },
    ];

    const response = await llmClient.chat.completions.create({
      model: settings.vlmModelName,
      messages,
    });

    const raw = response.choices[0]?.message?.content ?? '';
    logger.info('[checkReplayScreenState] LLM raw response:', raw);

    // Extract JSON from the response (handle markdown code fences)
    let jsonStr = raw;
    const fenceMatch = raw.match(/```(?:json)?([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (braceMatch) jsonStr = braceMatch[0];

    const parsed = JSON.parse(jsonStr) as { match: boolean; reason: string };
    logger.info('[checkReplayScreenState] LLM judgment:', parsed);

    onProgress?.(
      'result',
      `**VLM起点判断**：${parsed.match ? '✓ 起点匹配' : '✗ 起点不匹配'}\n\n${parsed.reason}`,
    );

    if (!parsed.match) {
      return {
        ok: false,
        reason: parsed.reason ?? 'LLM judged screen state as mismatched',
      };
    }
    return { ok: true };
  } catch (e) {
    logger.warn('[checkReplayScreenState] Check failed, allowing replay:', e);
    onProgress?.(
      'result',
      `VLM判断失败（${e instanceof Error ? e.message : String(e)}），默认允许重放`,
    );
    return { ok: true };
  }
};

export const replayByMemory = async ({
  operator,
  memorySteps,
  onStepStart,
}: {
  operator: BaseOperator;
  memorySteps: MemoryStep[];
  onStepStart?: (stepIndex: number, step: MemoryStep) => void;
}): Promise<ReplayResult> => {
  if (!memorySteps.length) {
    return {
      ok: false,
      reason: 'No memory steps available',
    };
  }

  const { width, height, scaleFactor } = await getScreenContext(operator);

  for (let i = 0; i < memorySteps.length; i += 1) {
    const step = memorySteps[i];
    onStepStart?.(i, step);
    const parsedPrediction = toPrediction(step);

    try {
      const executeOutput = await operator.execute({
        prediction: JSON.stringify(step),
        parsedPrediction,
        screenWidth: width,
        screenHeight: height,
        scaleFactor,
        factors: [1, 1],
      });

      if (isExecuteFailed(executeOutput)) {
        return {
          ok: false,
          failStep: i,
          reason: `Step returned failed status: ${step.action_type}`,
        };
      }
    } catch (error) {
      logger.warn('[replayByMemory] Step failed:', i, step.action_type, error);
      return {
        ok: false,
        failStep: i,
        reason:
          error instanceof Error
            ? error.message
            : `Unknown replay error at step ${i}`,
      };
    }
  }

  return { ok: true };
};
