/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useState } from 'react';
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
}

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
  <div className="mt-3 mb-2 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2">
    <div className="mb-1.5 text-xs font-semibold text-gray-500">记忆检索</div>
    <div className="flex flex-col gap-1">
      {phases.map((phase) => (
        <div key={phase.id} className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-xs">
            {PHASE_ICON[phase.status]}
            <span className={PHASE_TEXT[phase.status]}>{phase.label}</span>
          </div>
          {phase.detail && (
            <div className="ml-5 truncate text-xs text-gray-400">
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
    <div className="mt-3 mb-2 rounded-lg border border-red-200 bg-red-50/80 px-3 py-2">
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
  <div className="mt-2 mb-2 rounded-lg border border-blue-200 bg-blue-50/80 px-3 py-2">
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
      <div className="truncate text-xs text-gray-600">
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
    <div
      className={`mt-2 mb-2 rounded-lg border ${borderColor} ${bgColor} px-3 py-2`}
    >
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
      <div className="text-xs leading-relaxed text-gray-500">
        {verify.message}
      </div>
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

        return {
          action: 'Action',
          type: item.action_type,
          cost: lastMessage.timing?.cost,
          input: input || undefined,
          reflection: item.reflection || '',
          thought: item.thought,
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
      className="h-100 w-100 overflow-hidden rounded-[10px] border-gray-300 bg-white/90 p-4 dark:bg-gray-800/90"
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

      {!!errorMsg && <div>{errorMsg}</div>}

      {!!isRecording && (
        <RecordingBlock
          instruction={recordingInstruction}
          steps={recordingSteps ?? []}
        />
      )}
      {!!memoryPhases && <MemoryPhasesBlock phases={memoryPhases} />}
      {!!replayProgress && <ReplayProgressBlock progress={replayProgress} />}
      {!!verifyProgress && <VerifyBlock verify={verifyProgress} />}

      {!!actions.length && !errorMsg && (
        <div className="mt-4 max-h-70 overflow-scroll hide_scroll_bar">
          {actions.map((action, idx) => {
            const ActionIcon = ActionIconMap[action.type] || MousePointerClick;
            return (
              <div key={idx}>
                {!!action.type && (
                  <>
                    <div className="flex items-baseline">
                      <div className="text-lg font-medium">{action.action}</div>
                    </div>
                    <div className="flex items-center text-sm text-gray-500">
                      {!!ActionIcon && (
                        <ActionIcon
                          className="mr-1.5 h-4 w-4"
                          strokeWidth={2}
                        />
                      )}
                      <span className="text-gray-600">{action.type}</span>
                      {action.input && (
                        <span className="truncate break-all text-gray-600">
                          {action.input}
                        </span>
                      )}
                    </div>
                  </>
                )}
                {!!action.reflection && (
                  <>
                    <div className="mt-2 text-lg font-medium">Reflection</div>
                    <div className="break-all text-sm text-gray-500">
                      {action.reflection}
                    </div>
                  </>
                )}
                {!!action.thought && (
                  <>
                    <div className="mt-2 text-lg font-medium">Thought</div>
                    <div className="mb-4 break-all text-sm text-gray-500">
                      {action.thought}
                    </div>
                  </>
                )}
                {!!action.query && (
                  <>
                    <div className="text-lg font-medium">Human Query</div>
                    <div className="break-all text-sm text-gray-500">
                      {action.query}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="shortcut-panel absolute right-4 bottom-4">
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
