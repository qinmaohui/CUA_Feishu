/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '@renderer/hooks/useStore';
import {
  Monitor,
  Globe,
  MousePointerClick,
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
} from 'lucide-react';
import { ActionIconMap } from '@renderer/const/actions';
import { useSetting } from '@renderer/hooks/useSetting';
import { StatusEnum } from '@ui-tars/sdk';
import type {
  MemoryPhase,
  MemoryPhaseStatus,
  VerifyProgress,
} from '@main/store/types';
import type { MemoryStep } from '@main/store/agentMemory';

import logo from '@resources/logo-full.png?url';

import './widget.css';

// https://developer.mozilla.org/en-US/docs/Web/API/Navigator/platform
// chrome 93 support
// @ts-ignore
const isWin = navigator.userAgentData.platform === 'Windows';

interface Action {
  action: string;
  type: string;
  cost?: number;
  input?: string;
  reflection?: string;
  thought?: string;
  query?: string;
  experienceUsed?: ExperienceUsedRef[];
}

interface ExperienceUsedRef {
  id: string;
  text: string;
}

type PredictionWithExperience = {
  experienceUsed?: ExperienceUsedRef[];
};

const normalizeExperienceRef = (ref: ExperienceUsedRef): ExperienceUsedRef => ({
  id: ref.id
    .trim()
    .replace(/^\[|\]$/g, '')
    .toUpperCase(),
  text: ref.text.trim(),
});

const extractExperienceUsed = (...values: Array<string | undefined>) => {
  const text = values.filter(Boolean).join('\n');
  const match = text.match(/Experience_Used\s*:\s*([^\n;]+)/i);
  const value = match?.[1]?.trim();
  if (!value || /^(none|null|n\/a)$/i.test(value)) return [];

  const refs: ExperienceUsedRef[] = [];
  const seen = new Set<string>();
  const pattern =
    /\[?\b([PE]\d+(?:\.\d+)?)\b\]?(?:\s*(?:=|:|：|-)\s*([^,\n;]+))?/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = pattern.exec(value))) {
    const id = refMatch[1].toUpperCase();
    if (seen.has(id)) continue;
    refs.push({
      id,
      text: (refMatch[2] ?? '').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, ''),
    });
    seen.add(id);
  }

  return refs;
};

const getExperienceUsedRefs = (
  item: PredictionWithExperience,
  ...values: Array<string | undefined>
) => {
  if (item.experienceUsed?.length) {
    return item.experienceUsed.map(normalizeExperienceRef);
  }
  return extractExperienceUsed(...values);
};

const stripExperienceUsed = (value?: string) =>
  (value ?? '')
    .replace(/^\s*Experience_Used\s*:\s*[^\n;]+;?\s*/i, '')
    .replace(/\n\s*Experience_Used\s*:\s*[^\n;]+;?/gi, '')
    .trim();

const getOperatorIcon = (type: string) => {
  switch (type) {
    case 'browser':
      return <Globe className="h-3 w-3 mr-1.5" />;
    case 'nutjs':
    default:
      return <Monitor className="h-3 w-3 mr-1.5" />;
  }
};

const getOperatorLabel = (type: string) => {
  switch (type) {
    case 'browser':
      return 'Browser';
    case 'nutjs':
    default:
      return 'Computer';
  }
};

const PHASE_ICON: Record<MemoryPhaseStatus, React.ReactNode> = {
  pending: <Circle className="h-3 w-3 text-gray-300" />,
  active: <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />,
  done: <CheckCircle2 className="h-3 w-3 text-emerald-500" />,
  failed: <XCircle className="h-3 w-3 text-red-400" />,
};

const PHASE_TEXT: Record<MemoryPhaseStatus, string> = {
  pending: 'text-gray-400',
  active: 'text-blue-600',
  done: 'text-gray-700',
  failed: 'text-red-500',
};

const MemoryPhasesBlock = ({ phases }: { phases: MemoryPhase[] }) => (
  <div className="rounded-md border border-gray-200 bg-gray-50/80 px-2.5 py-2">
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
      Memory
    </div>
    <div className="flex flex-col gap-1">
      {phases.map((phase) => (
        <div key={phase.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-xs">
            {PHASE_ICON[phase.status]}
            <span className={PHASE_TEXT[phase.status]}>{phase.label}</span>
          </div>
          {phase.detail && (
            <div className="ml-5 break-words text-[11px] text-gray-400">
              {phase.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  </div>
);

const formatRecordingStep = (step: MemoryStep) => {
  const inputs = step.action_inputs ?? {};

  switch (step.action_type) {
    case 'type':
    case 'input':
      return inputs.content ? `输入 ${String(inputs.content)}` : '输入文本';
    case 'hotkey':
    case 'key':
      return inputs.key ? `快捷键 ${String(inputs.key)}` : '快捷键';
    case 'scroll':
      return inputs.direction ? `滚动 ${String(inputs.direction)}` : '滚动';
    case 'click':
    case 'double_click':
    case 'right_click':
    case 'middle_click':
      return inputs.start_box
        ? `坐标 ${String(inputs.start_box)}`
        : step.action_type;
    default:
      return step.action_type;
  }
};

const RecordingBlock = ({
  instruction,
  steps,
}: {
  instruction: string | null;
  steps: MemoryStep[];
}) => {
  const latestSteps = steps.slice(-3).reverse();

  return (
    <div className="rounded-md border border-red-200 bg-red-50/80 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
          <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
          正在录制
        </span>
        <span className="text-xs text-red-500">{steps.length} 步</span>
      </div>
      {!!instruction && (
        <div className="mb-2 max-h-10 overflow-hidden break-words text-xs leading-relaxed text-gray-600">
          {instruction}
        </div>
      )}
      {!!latestSteps.length && (
        <div className="mb-2 rounded-md bg-white/70 px-2 py-1.5">
          <div className="mb-1 text-[11px] font-medium text-gray-500">
            当前录入步骤
          </div>
          <div className="flex flex-col gap-1">
            {latestSteps.map((step, index) => (
              <div
                key={`${step.action_type}-${steps.length - index}`}
                className="truncate text-xs text-gray-600"
              >
                {steps.length - index}. {formatRecordingStep(step)}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="text-xs text-gray-400">Ctrl+S 保存 · Ctrl+D 中断</div>
    </div>
  );
};

const ReplayProgressBlock = ({
  progress,
}: {
  progress: { current: number; total: number; currentStep: MemoryStep | null };
}) => (
  <div className="rounded-md border border-blue-200 bg-blue-50/80 px-2.5 py-2">
    <div className="mb-1 flex items-center justify-between">
      <span className="text-xs font-semibold text-blue-600">正在重放操作</span>
      <span className="text-xs text-blue-500">
        {progress.current}/{progress.total}
      </span>
    </div>
    <div className="mb-1.5 h-1 w-full rounded-full bg-blue-100">
      <div
        className="h-1 rounded-full bg-blue-400 transition-all duration-300"
        style={{ width: `${(progress.current / progress.total) * 100}%` }}
      />
    </div>
    {progress.currentStep && (
      <div className="break-words text-xs text-gray-600">
        <span className="font-medium text-gray-700">
          {progress.currentStep.action_type}
        </span>
        {progress.currentStep.thought && (
          <span className="text-gray-500"> {progress.currentStep.thought}</span>
        )}
      </div>
    )}
  </div>
);

const VerifyBlock = ({ verify }: { verify: VerifyProgress }) => {
  const isThinking = verify.status === 'thinking';
  const isDone = verify.status === 'done';
  const borderColor = isThinking
    ? 'border-amber-200'
    : isDone
      ? 'border-emerald-200'
      : 'border-red-200';
  const bgColor = isThinking
    ? 'bg-amber-50/80'
    : isDone
      ? 'bg-emerald-50/80'
      : 'bg-red-50/80';
  const titleColor = isThinking
    ? 'text-amber-600'
    : isDone
      ? 'text-emerald-600'
      : 'text-red-600';

  return (
    <div className={`rounded-md border ${borderColor} ${bgColor} px-2.5 py-2`}>
      <div className="mb-1 flex items-center gap-1.5">
        {isThinking ? (
          <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
        ) : isDone ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
        ) : (
          <XCircle className="h-3 w-3 text-red-400" />
        )}
        <span className={`text-xs font-semibold ${titleColor}`}>
          {isThinking ? '验证中...' : isDone ? '验证通过' : '验证未通过'}
        </span>
      </div>
      <div className="break-words text-xs leading-relaxed text-gray-500">
        {verify.message}
      </div>
    </div>
  );
};

const CompactText = ({
  label,
  value,
  tone = 'gray',
}: {
  label: string;
  value?: string;
  tone?: 'gray' | 'blue';
}) => {
  if (!value) return null;
  return (
    <div
      className={`rounded-md px-2 py-1.5 ${
        tone === 'blue' ? 'bg-blue-50/80' : 'bg-gray-50/80'
      }`}
    >
      <div
        className={`mb-0.5 text-[10px] font-semibold uppercase tracking-wide ${
          tone === 'blue' ? 'text-blue-500' : 'text-gray-400'
        }`}
      >
        {label}
      </div>
      <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600">
        {value}
      </div>
    </div>
  );
};

const ActionTimeline = ({ actions }: { actions: Action[] }) => {
  if (!actions.length) return null;

  return (
    <div className="space-y-2">
      {actions.map((action, idx) => {
        const ActionIcon = ActionIconMap[action.type] || MousePointerClick;
        return (
          <div
            key={idx}
            className="rounded-md border border-gray-200 bg-white/80 px-2.5 py-2"
          >
            {!!action.type && (
              <div className="flex min-w-0 items-center gap-2">
                {!!ActionIcon && (
                  <ActionIcon
                    className="h-3.5 w-3.5 shrink-0 text-gray-500"
                    strokeWidth={2}
                  />
                )}
                <span className="shrink-0 text-xs font-semibold text-gray-800">
                  {action.type}
                </span>
                {action.input && (
                  <span className="truncate text-xs text-gray-500">
                    {action.input}
                  </span>
                )}
              </div>
            )}
            {!!action.experienceUsed?.length && (
              <div className="mt-1 rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700">
                <div className="mb-0.5 font-semibold">Used experience</div>
                <div className="space-y-0.5">
                  {action.experienceUsed.map((ref) => (
                    <div
                      key={ref.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)] gap-1.5"
                    >
                      <span className="font-mono font-semibold">
                        [{ref.id}]
                      </span>
                      <span className="break-words">
                        {ref.text || 'No content captured'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-2 space-y-1.5">
              <CompactText label="Reflection" value={action.reflection} />
              <CompactText label="Thought" value={action.thought} />
              <CompactText
                label="Human query"
                value={action.query}
                tone="blue"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

const Widget = () => {
  const {
    messages = [],
    errorMsg,
    status,
    memoryPhases,
    replayProgress,
    isRecording,
    recordingSteps,
    recordingInstruction,
    verifyProgress,
  } = useStore();
  const { settings } = useSetting();
  const widgetRef = useRef<HTMLDivElement>(null);

  const currentOperator = settings.operator || 'nutjs';
  const [actions, setActions] = useState<Action[]>([]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      return;
    }

    if (lastMessage.from === 'human') {
      if (!lastMessage.screenshotBase64) {
        setActions([
          {
            action: '',
            type: '',
            query: lastMessage.value,
          },
        ]);
      }
      return;
    }

    const nextActions =
      lastMessage.predictionParsed?.map((item) => {
        const input = [
          item.action_inputs?.start_box &&
            `(start_box: ${item.action_inputs.start_box})`,
          item.action_inputs?.content && `(${item.action_inputs.content})`,
          item.action_inputs?.key && `(${item.action_inputs.key})`,
        ]
          .filter(Boolean)
          .join(' ');

        const itemWithExperience = item as typeof item &
          PredictionWithExperience;

        return {
          action: 'Action',
          type: item.action_type,
          cost: lastMessage.timing?.cost,
          input: input || undefined,
          reflection: stripExperienceUsed(item.reflection || ''),
          thought: stripExperienceUsed(item.thought),
          experienceUsed: getExperienceUsedRefs(
            itemWithExperience,
            item.thought,
            item.reflection || undefined,
          ),
        };
      }) || [];

    setActions(nextActions);
  }, [messages]);

  const toDisplayShortcut = (shortcut?: string) => {
    if (!shortcut) return '';

    return shortcut
      .split('+')
      .map((part) => {
        const key = part.trim();
        if (key === 'CommandOrControl') {
          return isWin ? 'Ctrl' : 'Cmd';
        }
        if (key === 'Control') {
          return 'Ctrl';
        }
        if (key === 'Escape') {
          return 'Esc';
        }
        return key;
      })
      .join('+');
  };

  const pauseShortcut =
    toDisplayShortcut(settings.pauseShortcut) || (isWin ? 'Ctrl+P' : 'Cmd+P');
  const stopShortcut =
    toDisplayShortcut(settings.stopShortcut) ||
    (isWin ? 'Ctrl+Esc' : 'Cmd+Esc');

  useEffect(() => {
    const element = widgetRef.current;
    if (!element) return;

    let frame = 0;
    const reportSize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        window.electron.ipcRenderer.send('widget:resize', {
          width: Math.ceil(rect.width),
          height: Math.ceil(element.scrollHeight),
        });
      });
    };

    reportSize();
    const observer = new ResizeObserver(reportSize);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const statusMeta = (() => {
    switch (status) {
      case StatusEnum.RUNNING:
        return { label: 'Running', dotClass: 'bg-emerald-500 animate-pulse' };
      case StatusEnum.PAUSE:
        return { label: 'Paused', dotClass: 'bg-amber-400' };
      case StatusEnum.CALL_USER:
        return {
          label: 'Waiting for input',
          dotClass: 'bg-sky-400 animate-pulse',
        };
      case StatusEnum.ERROR:
        return { label: 'Error', dotClass: 'bg-red-500' };
      case StatusEnum.END:
      case StatusEnum.USER_STOPPED:
        return { label: 'Stopped', dotClass: 'bg-gray-400' };
      case StatusEnum.INIT:
      default:
        return { label: 'Ready', dotClass: 'bg-gray-400' };
    }
  })();

  return (
    <div
      ref={widgetRef}
      className="w-100 rounded-[10px] border-gray-300 bg-white/90 p-3 dark:bg-gray-800/90"
      style={{ borderWidth: isWin ? '1px' : '0' }}
    >
      <div className="draggable-area flex">
        <img src={logo} alt="logo" className="-ml-2 mr-auto h-6" />
        <div className="flex items-center justify-center rounded-full border px-2 text-xs text-gray-500">
          {getOperatorIcon(currentOperator)}
          {getOperatorLabel(currentOperator)}
        </div>
      </div>

      <div className="mt-2 mb-1 flex items-center gap-2 text-xs text-gray-600">
        <span
          className={['h-2 w-2 rounded-full', statusMeta.dotClass].join(' ')}
        />
        <span>Agent status: {statusMeta.label}</span>
      </div>

      <div className="widget-content mt-2 space-y-2">
        {!!errorMsg && (
          <div className="rounded-md border border-red-200 bg-red-50/80 px-2.5 py-2 text-xs text-red-600">
            {errorMsg}
          </div>
        )}
        {!!isRecording && (
          <RecordingBlock
            instruction={recordingInstruction}
            steps={recordingSteps ?? []}
          />
        )}
        {!!memoryPhases && <MemoryPhasesBlock phases={memoryPhases} />}
        {!!replayProgress && <ReplayProgressBlock progress={replayProgress} />}
        {!!verifyProgress && <VerifyBlock verify={verifyProgress} />}
        {!errorMsg && <ActionTimeline actions={actions} />}
      </div>

      <div className="shortcut-panel mt-2 shrink-0">
        <div className="shortcut-row">
          <span className="shortcut-label">Pause</span>
          <span className="shortcut-key">{pauseShortcut}</span>
        </div>
        <div className="shortcut-row">
          <span className="shortcut-label">Stop</span>
          <span className="shortcut-key">{stopShortcut}</span>
        </div>
      </div>
    </div>
  );
};

export default Widget;
