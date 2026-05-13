import { StatusEnum } from '@ui-tars/shared/types';
import type { Operator as BaseOperator } from '@ui-tars/sdk/core';
import { sleep } from '@ui-tars/shared/utils';

import { logger } from '@main/logger';
import {
  UIMapStore,
  type EdgeAction,
  type UIMap,
  type UIMapNode,
} from '@main/store/uiMap';
import { NutJSElectronOperator } from '@main/agent/operator';
import { getScreenSize } from '@main/utils/screen';
import { queryAccessibilityTree, type AXNode } from './getDom';
import { localizeUIMapNode } from './uiMapLocalize';

let exploring = false;

export interface ExplorationOptions {
  maxPages?: number;
  timeoutMs?: number;
  operator?: BaseOperator;
}

const INTERACTIVE_TYPES = new Set([
  'TabItem',
  'MenuItem',
  'Button',
  'Hyperlink',
  'ListItem',
  'Edit',
  'ComboBox',
]);

const DANGEROUS_NAME_PATTERNS = [
  /delete/i,
  /remove/i,
  /logout/i,
  /log out/i,
  /sign out/i,
  /exit/i,
  /quit/i,
  /format/i,
  /删除/,
  /移除/,
  /退出/,
  /退出登录/,
  /注销/,
  /格式化/,
];

export const explorationService = {
  isRunning() {
    return exploring;
  },

  stop() {
    exploring = false;
  },

  async start(options: ExplorationOptions = {}): Promise<UIMap> {
    if (exploring) {
      return UIMapStore.getMap();
    }

    exploring = true;
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;
    const maxPages = options.maxPages ?? 15;
    const operator = options.operator ?? new NutJSElectronOperator();
    const visitedNodeIds = new Set<string>();
    let unchangedCount = 0;

    try {
      while (
        exploring &&
        Date.now() - startedAt < timeoutMs &&
        visitedNodeIds.size < maxPages
      ) {
        const before = await captureAndLocalize(operator);
        if (!before.node) break;

        visitedNodeIds.add(before.node.id);
        const candidates = await getExplorationCandidates(before.node);
        const candidate = candidates[0];
        if (!candidate) {
          await sleep(1200);
          unchangedCount += 1;
          if (unchangedCount >= 3) break;
          continue;
        }

        const { physicalSize, scaleFactor } = getScreenSize();
        const action = actionFromCandidate(candidate);
        const point = action.params.targetPoint ?? [0.5, 0.5];
        const output = await operator.execute({
          prediction: `explore:${candidate.name}`,
          parsedPrediction: {
            action_type: 'click',
            action_inputs: {
              start_box: `[${point[0]},${point[1]},${point[0]},${point[1]}]`,
            },
            thought: `Explore ${candidate.controlType} "${candidate.name}"`,
            reflection: null,
          },
          screenWidth: physicalSize.width,
          screenHeight: physicalSize.height,
          scaleFactor,
          factors: [1, 1],
        });

        if (
          output &&
          'status' in output &&
          output.status === StatusEnum.ERROR
        ) {
          break;
        }

        await sleep(1500);

        const after = await captureAndLocalize(operator);
        if (!after.node) break;

        UIMapStore.observeEdge({
          sourceNodeId: before.node.id,
          targetNodeId: after.node.id,
          action,
          success: after.node.id !== before.node.id,
          effect: {
            beforeShotHash: before.visualHash,
            afterShotHash: after.visualHash,
            visualChanged: after.visualHash !== before.visualHash,
            judgedValid: after.node.id !== before.node.id,
            reason:
              after.node.id === before.node.id
                ? 'Exploration click did not change the localized page.'
                : 'Exploration click changed the localized page.',
            effectSummary:
              after.node.id === before.node.id
                ? 'No page transition observed.'
                : `Navigated to ${after.node.name}.`,
          },
        });

        if (after.node.id === before.node.id) {
          unchangedCount += 1;
        } else {
          unchangedCount = 0;
        }

        if (unchangedCount >= 3) break;
      }
    } catch (error) {
      logger.warn('[Exploration] stopped with error:', error);
    } finally {
      exploring = false;
    }

    return UIMapStore.getMap();
  },
};

async function captureAndLocalize(operator: BaseOperator): Promise<{
  node: UIMapNode | null;
  visualHash?: string;
}> {
  const snapshot = await operator.screenshot();
  const a11y = await queryAccessibilityTree({}).catch((error) => {
    logger.warn('[Exploration] A11y candidate fetch failed:', error);
    return null;
  });
  const localized = await localizeUIMapNode({
    screenshotBase64: snapshot.base64,
    a11yText: a11y?.extraction.extractionText,
    allowVlmFallback: true,
  });
  return {
    node: localized.node,
    visualHash: localized.visualHash,
  };
}

async function getExplorationCandidates(
  currentNode: UIMapNode,
): Promise<AXNode[]> {
  const { physicalSize, scaleFactor } = getScreenSize();
  const a11y = await queryAccessibilityTree(
    {},
    {
      width: physicalSize.width,
      height: physicalSize.height,
      scaleFactor,
    },
  );
  const knownActionNames = new Set(
    UIMapStore.getMap()
      .edges.filter((edge) => edge.sourceNodeId === currentNode.id)
      .filter((edge) => edge.observedCount >= 2)
      .map((edge) => normalize(edge.action.params.elementName)),
  );

  return a11y.allNodes
    .filter(
      (node) =>
        INTERACTIVE_TYPES.has(node.controlType) &&
        node.name.trim() &&
        node.isEnabled &&
        !node.isOffscreen &&
        node.boundingRectangle &&
        !knownActionNames.has(normalize(node.name)) &&
        !DANGEROUS_NAME_PATTERNS.some((pattern) => pattern.test(node.name)),
    )
    .sort((a, b) => priority(a) - priority(b))
    .slice(0, 20);
}

function actionFromCandidate(node: AXNode): EdgeAction {
  const { physicalSize } = getScreenSize();
  const rect = node.boundingRectangle;
  const x = rect ? (rect.left + rect.width / 2) / physicalSize.width : 0.5;
  const y = rect ? (rect.top + rect.height / 2) / physicalSize.height : 0.5;
  const targetBox = rect
    ? ([
        rect.left / physicalSize.width,
        rect.top / physicalSize.height,
        (rect.left + rect.width) / physicalSize.width,
        (rect.top + rect.height) / physicalSize.height,
      ].map((item) => Math.max(0, Math.min(1, item))) as [
        number,
        number,
        number,
        number,
      ])
    : undefined;
  return {
    tool: 'click',
    params: {
      elementName: node.name,
      elementHint: node.controlType,
      targetPoint: [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))],
      targetBox,
      screenPoint: rect
        ? [rect.left + rect.width / 2, rect.top + rect.height / 2]
        : undefined,
      elementMeta: {
        name: node.name,
        controlType: node.controlType,
        source: 'exploration',
      },
    },
  };
}

function priority(node: AXNode): number {
  const order = ['TabItem', 'MenuItem', 'Button', 'Hyperlink', 'ListItem'];
  const index = order.indexOf(node.controlType);
  return index >= 0 ? index : order.length;
}

function normalize(value?: string): string {
  return (value ?? '').replace(/\s+/g, '').toLowerCase();
}
