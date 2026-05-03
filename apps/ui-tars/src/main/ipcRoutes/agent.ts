/*
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { initIpc } from '@ui-tars/electron-ipc/main';
import { StatusEnum, Conversation, Message } from '@ui-tars/shared/types';
import { store } from '@main/store/create';
import { runAgent } from '@main/services/runAgent';
import { queryAccessibilityTree } from '@main/services/getDom';
import { showWindow } from '@main/window/index';

import { closeScreenMarker } from '@main/window/ScreenMarker';
import { GUIAgent } from '@ui-tars/sdk';
import { Operator } from '@ui-tars/sdk/core';

const t = initIpc.create();

export class GUIAgentManager {
  private static instance: GUIAgentManager;
  private currentAgent: GUIAgent<Operator> | null = null;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  private constructor() {}

  public static getInstance(): GUIAgentManager {
    if (!GUIAgentManager.instance) {
      GUIAgentManager.instance = new GUIAgentManager();
    }
    return GUIAgentManager.instance;
  }

  public setAgent(agent: GUIAgent<Operator>) {
    this.currentAgent = agent;
  }

  public getAgent(): GUIAgent<Operator> | null {
    return this.currentAgent;
  }

  public clearAgent() {
    this.currentAgent = null;
  }
}

export const triggerPauseRun = () => {
  const guiAgent = GUIAgentManager.getInstance().getAgent();
  if (guiAgent instanceof GUIAgent) {
    guiAgent.pause();
    store.setState({ status: StatusEnum.PAUSE, thinking: false });
  }
};

export const triggerResumeRun = () => {
  const guiAgent = GUIAgentManager.getInstance().getAgent();
  if (guiAgent instanceof GUIAgent) {
    guiAgent.resume();
    store.setState({ status: StatusEnum.RUNNING, thinking: false });
  }
};

export const triggerTogglePauseRun = () => {
  const { status } = store.getState();
  if (status === StatusEnum.PAUSE) {
    triggerResumeRun();
    return;
  }
  triggerPauseRun();
};

export const triggerStopRun = () => {
  const { abortController } = store.getState();
  store.setState({ status: StatusEnum.END, thinking: false });

  showWindow();

  abortController?.abort();
  const guiAgent = GUIAgentManager.getInstance().getAgent();
  if (guiAgent instanceof GUIAgent) {
    guiAgent.resume();
    guiAgent.stop();
  }

  closeScreenMarker();
};

export const agentRoute = t.router({
  runAgent: t.procedure.input<void>().handle(async () => {
    const { thinking } = store.getState();
    if (thinking) {
      return;
    }

    store.setState({
      abortController: new AbortController(),
      thinking: true,
      errorMsg: null,
    });

    await runAgent(store.setState, store.getState);

    store.setState({ thinking: false, thinkingMsg: null });
  }),
  pauseRun: t.procedure.input<void>().handle(async () => {
    triggerPauseRun();
  }),
  resumeRun: t.procedure.input<void>().handle(async () => {
    triggerResumeRun();
  }),
  stopRun: t.procedure.input<void>().handle(async () => {
    triggerStopRun();
  }),
  setInstructions: t.procedure
    .input<{ instructions: string }>()
    .handle(async ({ input }) => {
      store.setState({ instructions: input.instructions });
    }),
  setMessages: t.procedure
    .input<{ messages: Conversation[] }>()
    .handle(async ({ input }) => {
      store.setState({ messages: input.messages });
    }),
  setSessionHistoryMessages: t.procedure
    .input<{ messages: Message[] }>()
    .handle(async ({ input }) => {
      store.setState({ sessionHistoryMessages: input.messages });
    }),
  queryA11yTree: t.procedure
    .input<{
      query?: string;
      controlType?: string;
      isVisible?: boolean;
      isEnabled?: boolean;
      limit?: number;
    }>()
    .handle(async ({ input }) => {
      return await queryAccessibilityTree(input);
    }),
  clearHistory: t.procedure.input<void>().handle(async () => {
    store.setState({
      status: StatusEnum.END,
      messages: [],
      thinking: false,
      errorMsg: null,
      instructions: '',
    });
  }),
});
