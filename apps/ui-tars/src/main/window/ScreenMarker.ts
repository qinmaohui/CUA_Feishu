/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Portions Copyright 2024-present Bytedance, Inc. All rights reserved.
 * Use of this source code is governed by a MIT license that can be
 * found in https://github.com/web-infra-dev/midscene/blob/main/LICENSE
 *
 */
import { BrowserWindow, screen, app, globalShortcut } from 'electron';

import { PredictionParsed, Conversation } from '@ui-tars/shared/types';

import * as env from '@main/env';
import { logger } from '@main/logger';

import { AppUpdater } from '@main/utils/updateApp';
import { setOfMarksOverlays } from '@main/shared/setOfMarks';
import path from 'path';
import MenuBuilder from '../menu';
import { windowManager } from '../services/windowManager';
import { SettingStore } from '@main/store/setting';
import { triggerTogglePauseRun, triggerStopRun } from '@main/ipcRoutes/agent';

let appUpdater;

class ScreenMarker {
  private static instance: ScreenMarker;
  private currentOverlay: BrowserWindow | null = null;
  private widgetWindow: BrowserWindow | null = null;
  private screenWaterFlow: BrowserWindow | null = null;
  private lastPauseShortcut = '';
  private lastStopShortcut = '';
  private lastShowPredictionMarkerPos: { xPos: number; yPos: number } | null =
    null;

  static getInstance(): ScreenMarker {
    if (!ScreenMarker.instance) {
      ScreenMarker.instance = new ScreenMarker();
    }
    return ScreenMarker.instance;
  }

  private registerWidgetShortcuts() {
    const setting = SettingStore.getStore();
    const pauseShortcut = setting.pauseShortcut || 'CommandOrControl+P';
    const stopShortcut = setting.stopShortcut || 'CommandOrControl+Escape';

    const normalize = (shortcut: string) =>
      shortcut
        .trim()
        .split('+')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean)
        .join('+');

    if (normalize(pauseShortcut) === normalize(stopShortcut)) {
      logger.warn(
        '[widget shortcut] Pause and stop shortcut are same, skip register',
      );
      return;
    }

    if (
      this.lastPauseShortcut &&
      globalShortcut.isRegistered(this.lastPauseShortcut)
    ) {
      globalShortcut.unregister(this.lastPauseShortcut);
    }

    if (
      this.lastStopShortcut &&
      globalShortcut.isRegistered(this.lastStopShortcut)
    ) {
      globalShortcut.unregister(this.lastStopShortcut);
    }

    const pauseRegistered = globalShortcut.register(pauseShortcut, () => {
      triggerTogglePauseRun();
    });

    const stopRegistered = globalShortcut.register(stopShortcut, () => {
      triggerStopRun();
    });

    if (!pauseRegistered || !stopRegistered) {
      logger.warn(
        `[widget shortcut] register failed, pause=${pauseShortcut}, stop=${stopShortcut}`,
      );
      if (pauseRegistered) {
        globalShortcut.unregister(pauseShortcut);
      }
      if (stopRegistered) {
        globalShortcut.unregister(stopShortcut);
      }
      return;
    }

    this.lastPauseShortcut = pauseShortcut;
    this.lastStopShortcut = stopShortcut;
  }

  private unregisterWidgetShortcuts() {
    if (
      this.lastPauseShortcut &&
      globalShortcut.isRegistered(this.lastPauseShortcut)
    ) {
      globalShortcut.unregister(this.lastPauseShortcut);
    }
    if (
      this.lastStopShortcut &&
      globalShortcut.isRegistered(this.lastStopShortcut)
    ) {
      globalShortcut.unregister(this.lastStopShortcut);
    }
    this.lastPauseShortcut = '';
    this.lastStopShortcut = '';
  }

  refreshWidgetShortcuts() {
    if (!this.widgetWindow || this.widgetWindow.isDestroyed()) {
      return;
    }
    this.registerWidgetShortcuts();
  }

  refreshWidgetCaptureMode() {
    if (!this.widgetWindow || this.widgetWindow.isDestroyed()) {
      return;
    }
    this.showWidgetWindow();
  }

  showScreenWaterFlow() {
    if (this.screenWaterFlow) {
      return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.size;

    this.screenWaterFlow = new BrowserWindow({
      width: screenWidth,
      height: screenHeight,
      x: 0,
      y: 0,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      thickFrame: false,
      paintWhenInitiallyHidden: true,
      type: 'panel',
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });

    this.screenWaterFlow.setFocusable(false);
    this.screenWaterFlow.setContentProtection(false);
    this.screenWaterFlow.setIgnoreMouseEvents(true);

    this.screenWaterFlow.loadURL(`data:text/html;charset=UTF-8,
      <html>
        <head>
          <style id="water-flow-animation">
            html::before {
              content: "";
              position: fixed;
              top: 0; right: 0; bottom: 0; left: 0;
              pointer-events: none;
              z-index: 9999;
              background:
                linear-gradient(to right, rgba(30, 144, 255, 0.4), transparent 50%) left,
                linear-gradient(to left, rgba(30, 144, 255, 0.4), transparent 50%) right,
                linear-gradient(to bottom, rgba(30, 144, 255, 0.4), transparent 50%) top,
                linear-gradient(to top, rgba(30, 144, 255, 0.4), transparent 50%) bottom;
              background-repeat: no-repeat;
              background-size: 10% 100%, 10% 100%, 100% 10%, 100% 10%;
              animation: waterflow 5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
              filter: blur(8px);
            }

            @keyframes waterflow {
              0%, 100% {
                background-image:
                  linear-gradient(to right, rgba(30, 144, 255, 0.4), transparent 50%),
                  linear-gradient(to left, rgba(30, 144, 255, 0.4), transparent 50%),
                  linear-gradient(to bottom, rgba(30, 144, 255, 0.4), transparent 50%),
                  linear-gradient(to top, rgba(30, 144, 255, 0.4), transparent 50%);
                transform: scale(1);
              }
              25% {
                background-image:
                  linear-gradient(to right, rgba(30, 144, 255, 0.39), transparent 52%),
                  linear-gradient(to left, rgba(30, 144, 255, 0.39), transparent 52%),
                  linear-gradient(to bottom, rgba(30, 144, 255, 0.39), transparent 52%),
                  linear-gradient(to top, rgba(30, 144, 255, 0.39), transparent 52%);
                transform: scale(1.03);
              }
              50% {
                background-image:
                  linear-gradient(to right, rgba(30, 144, 255, 0.38), transparent 55%),
                  linear-gradient(to left, rgba(30, 144, 255, 0.38), transparent 55%),
                  linear-gradient(to bottom, rgba(30, 144, 255, 0.38), transparent 55%),
                  linear-gradient(to top, rgba(30, 144, 255, 0.38), transparent 55%);
                transform: scale(1.05);
              }
              75% {
                background-image:
                  linear-gradient(to right, rgba(30, 144, 255, 0.39), transparent 52%),
                  linear-gradient(to left, rgba(30, 144, 255, 0.39), transparent 52%),
                  linear-gradient(to bottom, rgba(30, 144, 255, 0.39), transparent 52%),
                  linear-gradient(to top, rgba(30, 144, 255, 0.39), transparent 52%);
                transform: scale(1.03);
              }
            }
          </style>
        </head>
        <body></body>
      </html>
    `);
  }

  hideScreenWaterFlow() {
    this.screenWaterFlow?.close();
    this.screenWaterFlow = null;
  }

  hideWidgetForScreenshot(): boolean {
    const settings = SettingStore.getStore();
    if (!settings.recordingFriendlyWidget) {
      return false;
    }

    if (
      this.widgetWindow &&
      !this.widgetWindow.isDestroyed() &&
      this.widgetWindow.isVisible()
    ) {
      this.widgetWindow.hide();
      return true;
    }
    return false;
  }

  showWidgetAfterScreenshot(wasHidden = true) {
    if (wasHidden && this.widgetWindow && !this.widgetWindow.isDestroyed()) {
      this.widgetWindow.show();
    }
  }

  hideWidgetWindow() {
    this.unregisterWidgetShortcuts();
    this.widgetWindow?.close();
    this.widgetWindow = null;
  }

  resizeWidgetWindow(size: { width?: number; height?: number }) {
    if (!this.widgetWindow || this.widgetWindow.isDestroyed()) {
      return;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const {
      x,
      y,
      width: screenWidth,
      height: screenHeight,
    } = primaryDisplay.workArea;
    const rightOffset = 32;
    const bottomOffset = 96;
    const width = Math.max(320, Math.ceil(size.width ?? 400));
    const height = Math.max(120, Math.ceil(size.height ?? 220));

    this.widgetWindow.setBounds({
      width,
      height,
      x: Math.floor(x + screenWidth - width - rightOffset),
      y: Math.max(y, Math.floor(y + screenHeight - height - bottomOffset)),
    });
  }

  showWidgetWindow() {
    if (this.widgetWindow) {
      this.widgetWindow.close();
      this.widgetWindow = null;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const {
      x,
      y,
      width: screenWidth,
      height: screenHeight,
    } = primaryDisplay.workArea;
    const initialWidth = 400;
    const initialHeight = 220;
    const settings = SettingStore.getStore();
    const recordingFriendly = !!settings.recordingFriendlyWidget;

    this.widgetWindow = new BrowserWindow({
      width: initialWidth,
      height: initialHeight,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: !recordingFriendly,
      focusable: recordingFriendly,
      resizable: true,
      ...(recordingFriendly ? {} : { type: 'toolbar' as const }),
      visualEffectState: 'active', // macOS only
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        sandbox: false,
        webSecurity: !!env.isDev,
      },
    });

    this.widgetWindow.setFocusable(recordingFriendly);
    this.widgetWindow.setContentProtection(!recordingFriendly);
    // Enable mouse passthrough — most of the window area lets clicks through,
    // but interactive elements (buttons) with pointer-events: auto still capture.
    this.widgetWindow.setIgnoreMouseEvents(true, { forward: true });
    this.widgetWindow.setPosition(
      Math.floor(x + screenWidth - initialWidth - 32),
      Math.floor(y + screenHeight - initialHeight - 96),
    );

    if (!app.isPackaged && env.rendererUrl) {
      this.widgetWindow.loadURL(env.rendererUrl + '#widget');
    } else {
      this.widgetWindow.loadFile(
        path.join(__dirname, '../renderer/index.html'),
        {
          hash: '#widget',
        },
      );
    }

    if (!appUpdater) {
      appUpdater = new AppUpdater(this.widgetWindow);
    }

    const menuBuilder = new MenuBuilder(this.widgetWindow, appUpdater);
    menuBuilder.buildMenu();

    this.registerWidgetShortcuts();

    windowManager.registerWindow(this.widgetWindow);
  }

  // show Screen Marker in screen for prediction
  showPredictionMarker(
    predictions: PredictionParsed[],
    screenshotContext: NonNullable<Conversation['screenshotContext']>,
  ) {
    const { overlays } = setOfMarksOverlays({
      predictions,
      screenshotContext,
      xPos: this.lastShowPredictionMarkerPos?.xPos,
      yPos: this.lastShowPredictionMarkerPos?.yPos,
    });

    const { scaleFactor = 1 } = screenshotContext;

    // loop predictions
    for (let i = 0; i < overlays.length; i++) {
      const overlay = overlays[i];

      try {
        this.closeOverlay();
        this.currentOverlay = new BrowserWindow({
          width: overlay.boxWidth || 300,
          height: overlay.boxHeight || 100,
          transparent: true,
          frame: false,
          alwaysOnTop: true,
          skipTaskbar: true,
          focusable: false,
          hasShadow: false,
          thickFrame: false,
          paintWhenInitiallyHidden: true,
          type: 'panel',
          webPreferences: { nodeIntegration: true, contextIsolation: false },
          ...(overlay.xPos &&
            overlay.yPos && {
              // logical pixels
              x: (overlay.xPos + overlay.offsetX) * scaleFactor,
              y: (overlay.yPos + overlay.offsetY) * scaleFactor,
            }),
        });

        this.currentOverlay.blur();
        this.currentOverlay.setFocusable(false);
        this.currentOverlay.setContentProtection(true); // not show for vlm model
        this.currentOverlay.setIgnoreMouseEvents(true, { forward: true });

        if (env.isWindows) {
          this.currentOverlay.setAlwaysOnTop(true, 'screen-saver');
        }

        if (overlay.xPos && overlay.yPos) {
          this.lastShowPredictionMarkerPos = {
            xPos: overlay.xPos,
            yPos: overlay.yPos,
          };
        }

        if (overlay.svg) {
          this.currentOverlay.loadURL(`data:text/html;charset=UTF-8,
    <html>
      <body style="background: transparent; margin: 0;">
        ${overlay.svg}
      </body>
    </html>
    `);

          // max 5s close overlay
          setTimeout(() => {
            this.closeOverlay();
          }, 5000);
        }
      } catch (error) {
        logger.error('[showPredictionMarker] 显示预测标记失败:', error);
      }
    }
  }

  close() {
    this.unregisterWidgetShortcuts();
    if (this.currentOverlay) {
      this.currentOverlay.close();
      this.currentOverlay = null;
    }
    if (this.widgetWindow) {
      this.widgetWindow.close();
      this.widgetWindow = null;
    }
    if (this.screenWaterFlow) {
      this.screenWaterFlow.close();
      this.screenWaterFlow = null;
    }
  }

  closeOverlay() {
    if (this.currentOverlay) {
      this.currentOverlay.close();
      this.currentOverlay = null;
    }
  }

  /**
   * Temporarily hide the overlay window before executing an action.
   */
  hideOverlay() {
    if (this.currentOverlay && !this.currentOverlay.isDestroyed()) {
      this.currentOverlay.hide();
    }
  }

  /**
   * Restore a previously hidden overlay window.
   */
  showOverlay() {
    if (this.currentOverlay && !this.currentOverlay.isDestroyed()) {
      this.currentOverlay.show();
    }
  }
}

export const closeScreenMarker = () => {
  ScreenMarker.getInstance().close();
};

export const showPredictionMarker = (
  predictions: PredictionParsed[],
  screenshotContext: NonNullable<Conversation['screenshotContext']>,
) => {
  ScreenMarker.getInstance().showPredictionMarker(
    predictions,
    screenshotContext,
  );
};

export const showWidgetWindow = () => {
  ScreenMarker.getInstance().showWidgetWindow();
};

export const hideWidgetWindow = () => {
  ScreenMarker.getInstance().hideWidgetWindow();
};

export const hideWidgetForScreenshot = () => {
  return ScreenMarker.getInstance().hideWidgetForScreenshot();
};

export const showWidgetAfterScreenshot = (wasHidden = true) => {
  ScreenMarker.getInstance().showWidgetAfterScreenshot(wasHidden);
};

export const showScreenWaterFlow = () => {
  ScreenMarker.getInstance().showScreenWaterFlow();
};

export const hideScreenWaterFlow = () => {
  ScreenMarker.getInstance().hideScreenWaterFlow();
};

export const refreshWidgetShortcuts = () => {
  ScreenMarker.getInstance().refreshWidgetShortcuts();
};

export const refreshWidgetCaptureMode = () => {
  ScreenMarker.getInstance().refreshWidgetCaptureMode();
};

export const resizeWidgetWindow = (size: {
  width?: number;
  height?: number;
}) => {
  ScreenMarker.getInstance().resizeWidgetWindow(size);
};

export const closeOverlay = () => {
  ScreenMarker.getInstance().closeOverlay();
};

export const hideOverlay = () => {
  ScreenMarker.getInstance().hideOverlay();
};

export const showOverlay = () => {
  ScreenMarker.getInstance().showOverlay();
};
