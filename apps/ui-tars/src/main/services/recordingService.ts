import { uIOhook, UiohookKey, type UiohookMouseEvent } from 'uiohook-napi';

import { logger } from '@main/logger';
import { AgentMemoryStore } from '@main/store/agentMemory';
import type { MemoryStep } from '@main/store/agentMemory';
import { embedInstruction } from './memoryEmbedding';
import {
  queryAccessibilityTree,
  getLatestTaskA11yContextSnapshot,
} from './getDom';
import { SettingStore } from '@main/store/setting';
import { store } from '@main/store/create';
import { getScreenSize } from '@main/utils/screen';
import { captureFeishuWindow } from './feishuAnnotation';

// Modifier key scancodes — filter these out to avoid recording bare Ctrl/Alt/Shift/Meta keydowns
const MODIFIER_KEYCODES = new Set<number>([
  UiohookKey.Ctrl,
  UiohookKey.CtrlRight,
  UiohookKey.Alt,
  UiohookKey.AltRight,
  UiohookKey.Shift,
  UiohookKey.ShiftRight,
  UiohookKey.Meta,
  UiohookKey.MetaRight,
]);

// Map uiohook keycode → printable character (unshifted)
const KEYCODE_TO_CHAR: Record<number, string> = {
  [UiohookKey.Space]: ' ',
  [UiohookKey[0]]: '0',
  [UiohookKey[1]]: '1',
  [UiohookKey[2]]: '2',
  [UiohookKey[3]]: '3',
  [UiohookKey[4]]: '4',
  [UiohookKey[5]]: '5',
  [UiohookKey[6]]: '6',
  [UiohookKey[7]]: '7',
  [UiohookKey[8]]: '8',
  [UiohookKey[9]]: '9',
  [UiohookKey.A]: 'a',
  [UiohookKey.B]: 'b',
  [UiohookKey.C]: 'c',
  [UiohookKey.D]: 'd',
  [UiohookKey.E]: 'e',
  [UiohookKey.F]: 'f',
  [UiohookKey.G]: 'g',
  [UiohookKey.H]: 'h',
  [UiohookKey.I]: 'i',
  [UiohookKey.J]: 'j',
  [UiohookKey.K]: 'k',
  [UiohookKey.L]: 'l',
  [UiohookKey.M]: 'm',
  [UiohookKey.N]: 'n',
  [UiohookKey.O]: 'o',
  [UiohookKey.P]: 'p',
  [UiohookKey.Q]: 'q',
  [UiohookKey.R]: 'r',
  [UiohookKey.S]: 's',
  [UiohookKey.T]: 't',
  [UiohookKey.U]: 'u',
  [UiohookKey.V]: 'v',
  [UiohookKey.W]: 'w',
  [UiohookKey.X]: 'x',
  [UiohookKey.Y]: 'y',
  [UiohookKey.Z]: 'z',
};

// Map uiohook keycode → key name for hotkey actions
const KEYCODE_TO_NAME: Record<number, string> = {
  [UiohookKey.Enter]: 'enter',
  [UiohookKey.Tab]: 'tab',
  [UiohookKey.Backspace]: 'backspace',
  [UiohookKey.Delete]: 'delete',
  [UiohookKey.Escape]: 'escape',
  [UiohookKey.Space]: 'space',
  [UiohookKey.ArrowUp]: 'up',
  [UiohookKey.ArrowDown]: 'down',
  [UiohookKey.ArrowLeft]: 'left',
  [UiohookKey.ArrowRight]: 'right',
  [UiohookKey.Home]: 'home',
  [UiohookKey.End]: 'end',
  [UiohookKey.PageUp]: 'pageup',
  [UiohookKey.PageDown]: 'pagedown',
  [UiohookKey.F1]: 'f1',
  [UiohookKey.F2]: 'f2',
  [UiohookKey.F3]: 'f3',
  [UiohookKey.F4]: 'f4',
  [UiohookKey.F5]: 'f5',
  [UiohookKey.F6]: 'f6',
  [UiohookKey.F7]: 'f7',
  [UiohookKey.F8]: 'f8',
  [UiohookKey.F9]: 'f9',
  [UiohookKey.F10]: 'f10',
  [UiohookKey.F11]: 'f11',
  [UiohookKey.F12]: 'f12',
  [UiohookKey.A]: 'a',
  [UiohookKey.B]: 'b',
  [UiohookKey.C]: 'c',
  [UiohookKey.D]: 'd',
  [UiohookKey.E]: 'e',
  [UiohookKey.F]: 'f',
  [UiohookKey.G]: 'g',
  [UiohookKey.H]: 'h',
  [UiohookKey.I]: 'i',
  [UiohookKey.J]: 'j',
  [UiohookKey.K]: 'k',
  [UiohookKey.L]: 'l',
  [UiohookKey.M]: 'm',
  [UiohookKey.N]: 'n',
  [UiohookKey.O]: 'o',
  [UiohookKey.P]: 'p',
  [UiohookKey.Q]: 'q',
  [UiohookKey.R]: 'r',
  [UiohookKey.S]: 's',
  [UiohookKey.T]: 't',
  [UiohookKey.U]: 'u',
  [UiohookKey.V]: 'v',
  [UiohookKey.W]: 'w',
  [UiohookKey.X]: 'x',
  [UiohookKey.Y]: 'y',
  [UiohookKey.Z]: 'z',
};

class RecordingService {
  private textBuffer = '';
  private lastClickTime = 0;
  private lastClickX = 0;
  private lastClickY = 0;
  private active = false;
  private isStopping = false;
  private actionQueue: Promise<void> = Promise.resolve();
  private startA11ySnapshot: string | undefined = undefined;

  private getState() {
    return store.getState();
  }

  private setState(patch: Partial<ReturnType<typeof store.getState>>) {
    store.setState({ ...this.getState(), ...patch });
  }

  private enqueueAction(task: () => Promise<void> | void) {
    if (!this.active || this.isStopping) return;
    this.actionQueue = this.actionQueue
      .then(async () => {
        if (!this.active || this.isStopping) return;
        await task();
      })
      .catch((e) => {
        logger.error('[RecordingService] queued action failed:', e);
      });
  }

  private async drainQueue() {
    await this.actionQueue.catch(() => undefined);
  }

  private normalizeBox(x: number, y: number): string {
    const { physicalSize } = getScreenSize();
    const nx = (x / physicalSize.width).toFixed(4);
    const ny = (y / physicalSize.height).toFixed(4);
    return `[${nx}, ${ny}, ${nx}, ${ny}]`;
  }

  private pushStep(step: MemoryStep) {
    this.setState({
      recordingSteps: [...this.getState().recordingSteps, step],
    });
  }

  private async getRuntimeStepEvidence() {
    const a11ySnapshot = getLatestTaskA11yContextSnapshot();

    try {
      const screenshot = await captureFeishuWindow();
      return {
        screenshotBase64: screenshot?.base64,
        a11ySnapshot,
      };
    } catch (e) {
      logger.warn(
        '[RecordingService] Failed to capture screenshot for step:',
        e,
      );
      return {
        screenshotBase64: undefined,
        a11ySnapshot,
      };
    }
  }

  private async pushStepWithEvidence(
    step: Omit<MemoryStep, 'screenshotBase64' | 'a11ySnapshot'>,
  ) {
    const evidence = await this.getRuntimeStepEvidence();
    this.pushStep({
      ...step,
      screenshotBase64: evidence.screenshotBase64,
      a11ySnapshot: evidence.a11ySnapshot,
    });
  }

  private async flushTextBuffer() {
    if (!this.textBuffer) return;
    await this.pushStepWithEvidence({
      action_type: 'type',
      action_inputs: { content: this.textBuffer },
      thought: '',
      reflection: null,
    });
    this.textBuffer = '';
  }

  start(instruction: string) {
    if (this.active) return;
    this.active = true;
    this.isStopping = false;
    this.actionQueue = Promise.resolve();
    this.textBuffer = '';
    this.startA11ySnapshot = undefined;
    this.setState({
      isRecording: true,
      recordingSteps: [],
      recordingInstruction: instruction,
    });

    // Capture start-state A11y snapshot before user begins operating
    queryAccessibilityTree({})
      .then((a11y) => {
        this.startA11ySnapshot =
          a11y?.extraction?.extractionText?.slice(0, 2000) ?? undefined;
      })
      .catch(() => {
        /* ignore */
      });

    uIOhook.on('mousedown', (e: UiohookMouseEvent) => {
      if (!this.active || this.isStopping) return;
      const now = Date.now();
      const btn = e.button as number;
      const isDoubleClick =
        Math.abs(e.x - this.lastClickX) < 5 &&
        Math.abs(e.y - this.lastClickY) < 5 &&
        now - this.lastClickTime < 500;

      const actionType = isDoubleClick
        ? 'double_click'
        : ({ 1: 'click', 2: 'right_click', 3: 'middle_click' }[btn] ?? 'click');

      this.lastClickTime = now;
      this.lastClickX = e.x;
      this.lastClickY = e.y;

      this.enqueueAction(async () => {
        await this.flushTextBuffer();
        await this.pushStepWithEvidence({
          action_type: actionType,
          action_inputs: { start_box: this.normalizeBox(e.x, e.y) },
          thought: '',
          reflection: null,
        });
      });
    });

    uIOhook.on('wheel', (e) => {
      if (!this.active || this.isStopping) return;
      this.enqueueAction(async () => {
        await this.flushTextBuffer();
        await this.pushStepWithEvidence({
          action_type: 'scroll',
          action_inputs: {
            start_box: this.normalizeBox(e.x, e.y),
            direction: e.rotation > 0 ? 'down' : 'up',
            coordinate: [e.x, e.y],
          },
          thought: '',
          reflection: null,
        });
      });
    });

    uIOhook.on('keydown', (e) => {
      if (!this.active) return;

      if (e.ctrlKey && e.keycode === UiohookKey.S) {
        this.save();
        return;
      }
      if (e.ctrlKey && e.keycode === UiohookKey.D) {
        this.discard();
        return;
      }

      if (this.isStopping) return;
      // Skip bare modifier key presses
      if (MODIFIER_KEYCODES.has(e.keycode)) return;

      const hasModifier = e.ctrlKey || e.altKey || e.metaKey;
      const char = KEYCODE_TO_CHAR[e.keycode];

      if (!hasModifier && char !== undefined) {
        const nextChar = e.shiftKey ? char.toUpperCase() : char;
        this.enqueueAction(() => {
          this.textBuffer += nextChar;
        });
        return;
      }

      const parts: string[] = [];
      if (e.ctrlKey) parts.push('ctrl');
      if (e.altKey) parts.push('alt');
      if (e.shiftKey) parts.push('shift');
      if (e.metaKey) parts.push('meta');
      const keyName = KEYCODE_TO_NAME[e.keycode] ?? `key${e.keycode}`;
      parts.push(keyName);

      this.enqueueAction(async () => {
        await this.flushTextBuffer();
        await this.pushStepWithEvidence({
          action_type: 'hotkey',
          action_inputs: { key: parts.join('+') },
          thought: '',
          reflection: null,
        });
      });
    });

    uIOhook.start();
    logger.info('[RecordingService] Started recording:', instruction);
  }

  async save() {
    if (!this.active || this.isStopping) return;
    this.isStopping = true;
    await this.drainQueue();
    await this.flushTextBuffer();
    this.stop();

    const { recordingSteps, recordingInstruction } = this.getState();
    const instruction = recordingInstruction ?? 'Recorded task';

    if (recordingSteps.length === 0) {
      logger.warn('[RecordingService] No steps recorded, skipping save');
      this.setState({
        isRecording: false,
        recordingSteps: [],
        recordingInstruction: null,
      });
      this.isStopping = false;
      return;
    }

    const settings = SettingStore.getStore();
    const instructionEmbedding = await embedInstruction(instruction);

    const now = Date.now();
    AgentMemoryStore.save({
      id: `memory_${now}_${Math.random().toString(36).slice(2, 9)}`,
      name: instruction.slice(0, 50).trim(),
      instruction,
      instructionEmbedding,
      operator: settings.operator,
      steps: recordingSteps,
      startA11ySnapshot: this.startA11ySnapshot,
      successMeta: {
        createdAt: now,
        updatedAt: now,
        successCount: 1,
        lastSuccessAt: now,
      },
    });

    logger.info(
      '[RecordingService] Saved',
      recordingSteps.length,
      'steps for:',
      instruction,
    );
    this.setState({
      isRecording: false,
      recordingSteps: [],
      recordingInstruction: null,
    });
    this.isStopping = false;
  }

  async discard() {
    if (!this.active || this.isStopping) return;
    this.isStopping = true;
    await this.drainQueue();
    this.stop();
    this.setState({
      isRecording: false,
      recordingSteps: [],
      recordingInstruction: null,
    });
    this.isStopping = false;
    logger.info('[RecordingService] Recording discarded');
  }

  private stop() {
    this.active = false;
    uIOhook.removeAllListeners();
    uIOhook.stop();
  }
}

export const recordingService = new RecordingService();
