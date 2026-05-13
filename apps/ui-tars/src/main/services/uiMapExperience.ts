import type { PredictionParsed } from '@ui-tars/shared/types';

import {
  UIMapStore,
  type EdgeAction,
  type UIMapEdge,
  type UIMapExperienceRef,
  type UIMapNode,
} from '@main/store/uiMap';
import { actionFromPrediction } from './uiMapLocalize';

export interface UIMapRunTraceItem {
  sourceNodeId?: string;
  targetNodeId?: string;
  edgeId?: string;
  action?: EdgeAction;
  reflection?: string | null;
  valid?: boolean;
  reason?: string;
  experience?: string;
  effectSummary?: string;
  beforeShotHash?: string;
  afterShotHash?: string;
}

export interface PendingUIMapAction {
  sourceNodeId: string;
  sourceShotHash?: string;
  action: EdgeAction;
  prediction: PredictionParsed;
  experienceUsed?: UIMapExperienceRef[];
}

const NEGATIVE_REFLECTION_PATTERNS = [
  /未生效/,
  /失败/,
  /错误/,
  /未点中/,
  /没点中/,
  /没有点中/,
  /被遮挡/,
  /动画未结束/,
  /重试/,
  /不成功/,
  /无效/,
  /未完成/,
  /not work/i,
  /did not/i,
  /failed/i,
  /failure/i,
  /error/i,
  /incorrect/i,
  /blocked/i,
  /covered/i,
  /retry/i,
  /not clicked/i,
  /missed/i,
  /invalid/i,
];

const POSITIVE_REFLECTION_PATTERNS = [
  /成功/,
  /已完成/,
  /生效/,
  /正确/,
  /success/i,
  /completed/i,
  /worked/i,
];

export interface PreviousActionAssessment {
  raw: string;
  structured: boolean;
  valid: boolean;
  reason: string;
  experience?: string;
  effectSummary?: string;
}

export function hasNegativeReflection(reflection?: string | null): boolean {
  if (!reflection?.trim()) return false;
  if (
    POSITIVE_REFLECTION_PATTERNS.some((pattern) => pattern.test(reflection)) &&
    !NEGATIVE_REFLECTION_PATTERNS.some((pattern) => pattern.test(reflection))
  ) {
    return false;
  }
  return NEGATIVE_REFLECTION_PATTERNS.some((pattern) =>
    pattern.test(reflection),
  );
}

export function compactReflection(reflection: string): string {
  return reflection.trim().replace(/\s+/g, ' ').slice(0, 80);
}

export function parsePreviousActionAssessment(
  reflection?: string | null,
  nextThought?: string | null,
): PreviousActionAssessment {
  const raw = reflection?.trim() ?? '';
  const structuredText = [reflection, nextThought].filter(Boolean).join('\n');
  const validText = extractStructuredValue(raw, [
    'Previous_Action_Valid',
    'Previous Action Valid',
    'Action_Valid',
    'Valid',
  ]);
  const reason =
    extractStructuredValue(structuredText, [
      'Previous_Action_Reason',
      'Previous Action Reason',
      'Action_Reason',
      'Reason',
    ]) ?? '';
  const experience = extractStructuredValue(structuredText, [
    'Previous_Action_Experience',
    'Previous Action Experience',
    'Action_Experience',
    'Experience',
  ]);
  const effectSummary = extractStructuredValue(structuredText, [
    'Previous_Action_Effect',
    'Previous Action Effect',
    'Action_Effect',
    'Effect',
    'Effect_Summary',
  ]);

  if (validText) {
    const normalized = validText.trim().toLowerCase();
    const valid =
      /^(true|yes|y|valid|success|successful|worked|ok|有效|成功|是)/i.test(
        normalized,
      ) &&
      !/^(false|no|n|invalid|failed|failure|not|unknown|无效|失败|否|未知)/i.test(
        normalized,
      );
    const invalid =
      /^(false|no|n|invalid|failed|failure|not|无效|失败|否)/i.test(normalized);

    if (valid || invalid) {
      return {
        raw,
        structured: true,
        valid: valid && !invalid,
        reason: reason || raw,
        experience,
        effectSummary,
      };
    }
  }

  const negative = hasNegativeReflection(raw);
  return {
    raw,
    structured: false,
    valid: !negative,
    reason: raw,
    experience: negative && raw ? compactReflection(raw) : undefined,
    effectSummary: undefined,
  };
}

export function extractExperienceUsedRefs(
  text: string,
  catalog?: Map<string, string>,
): UIMapExperienceRef[] {
  const raw =
    extractStructuredValue(text, ['Experience_Used']) ??
    text.match(/Experience_Used\s*:\s*([^\n;]+)/i)?.[1]?.trim();
  if (!raw) return [];

  const refs: UIMapExperienceRef[] = [];
  const seen = new Set<string>();
  const idPattern =
    /\[?\b([PE]\d+(?:\.\d+)?)\b\]?(?:\s*(?:=|:|：|-)\s*([^,\n;]+))?/gi;
  let match: RegExpExecArray | null;

  while ((match = idPattern.exec(raw))) {
    const id = match[1].toUpperCase();
    if (seen.has(id)) continue;
    const refText = (match[2]?.trim() || catalog?.get(id) || '')
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
      .slice(0, 240);
    refs.push({ id, text: refText });
    seen.add(id);
  }

  return refs;
}

export function pendingActionFromPrediction(params: {
  sourceNodeId?: string;
  sourceShotHash?: string;
  prediction?: PredictionParsed;
  experienceCatalog?: Map<string, string>;
}): PendingUIMapAction | null {
  if (!params.sourceNodeId || !params.prediction) return null;
  const action = actionFromPrediction({
    action_type: params.prediction.action_type,
    action_inputs: params.prediction.action_inputs,
    thought: params.prediction.thought,
  });
  if (!action) return null;
  return {
    sourceNodeId: params.sourceNodeId,
    sourceShotHash: params.sourceShotHash,
    action,
    prediction: params.prediction,
    experienceUsed: extractExperienceUsedRefs(
      [params.prediction.thought, params.prediction.reflection]
        .filter(Boolean)
        .join('\n'),
      params.experienceCatalog,
    ),
  };
}

export function buildPreviousActionAssessmentPrompt(
  pending: PendingUIMapAction | null,
): string {
  if (!pending) return '';

  const params = pending.action.params;
  const actionParts = [
    pending.action.tool,
    params.elementName ? `"${params.elementName}"` : '',
    params.shortcut ? `shortcut=${params.shortcut}` : '',
    params.targetPoint
      ? `point=(${params.targetPoint[0].toFixed(3)},${params.targetPoint[1].toFixed(3)})`
      : '',
    params.targetBox
      ? `box=[${params.targetBox.map((item) => item.toFixed(3)).join(',')}]`
      : '',
    params.screenPoint
      ? `screen=(${Math.round(params.screenPoint[0])},${Math.round(params.screenPoint[1])})`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return `

## Previous Action Assessment
Before choosing the next action, judge whether the previous action worked by comparing the action below with the current screenshot.
Previous action: ${actionParts || pending.action.tool}
Previous thought: ${pending.prediction.thought || '(none)'}

If the previous action changed the UI as intended, mark it valid. If it missed the target, opened the wrong place, caused no useful change, was blocked, or needs correction, mark it invalid.

Start your next response with this exact Reflection block, then continue with Action_Summary and Action:
Reflection: Previous_Action_Valid: true|false
Previous_Action_Reason: <brief evidence from the current screenshot>
Previous_Action_Effect: <what visibly changed or did not change>
Previous_Action_Experience: <short reusable lesson only when useful; use "none" if there is no lesson>
Action_Summary: Experience_Used: <id=text pairs from Current Page Knowledge, or none>; <your next action summary>
Action: <one action>
`;
}

export function observePendingAction(params: {
  pending: PendingUIMapAction;
  targetNodeId: string;
  afterShotHash?: string;
  reflection?: string | null;
  nextThought?: string | null;
  instruction?: string;
  trace: UIMapRunTraceItem[];
}): UIMapEdge {
  const assessment = parsePreviousActionAssessment(
    params.reflection,
    params.nextThought,
  );
  const visualChanged =
    !!params.pending.sourceShotHash &&
    !!params.afterShotHash &&
    params.pending.sourceShotHash !== params.afterShotHash;
  const edge = UIMapStore.observeEdge({
    sourceNodeId: params.pending.sourceNodeId,
    targetNodeId: params.targetNodeId,
    action: params.pending.action,
    success: assessment.valid,
    effect: {
      beforeShotHash: params.pending.sourceShotHash,
      afterShotHash: params.afterShotHash,
      visualChanged,
      judgedValid: assessment.valid,
      experienceUsed: params.pending.experienceUsed,
      reason: assessment.reason || undefined,
      effectSummary: assessment.effectSummary,
    },
  });

  const traceItem: UIMapRunTraceItem = {
    sourceNodeId: params.pending.sourceNodeId,
    targetNodeId: params.targetNodeId,
    edgeId: edge.id,
    action: params.pending.action,
    reflection: params.reflection ?? null,
    valid: assessment.valid,
    reason: assessment.reason,
    experience: assessment.experience,
    effectSummary: assessment.effectSummary,
    beforeShotHash: params.pending.sourceShotHash,
    afterShotHash: params.afterShotHash,
  };
  params.trace.push(traceItem);

  const experienceText =
    assessment.experience ||
    (!assessment.valid && assessment.raw
      ? compactReflection(assessment.reason || assessment.raw)
      : '');
  if (experienceText) {
    UIMapStore.addExperience(
      { kind: 'edge', edgeId: edge.id },
      experienceText,
      'auto',
      {
        instruction: params.instruction,
        beforeShotHash: params.pending.sourceShotHash,
        afterShotHash: params.afterShotHash,
        actionValid: assessment.valid,
        effectSummary: assessment.effectSummary,
        vlmReflection: params.reflection ?? undefined,
      },
    );
  }

  return edge;
}

export function promoteNodeExperienceFromTrace(
  trace: UIMapRunTraceItem[],
): void {
  const grouped = new Map<string, Map<string, number>>();

  for (const item of trace) {
    if (!item.targetNodeId || item.valid) continue;
    const key = normalizeReflectionKey(
      item.experience || item.reason || item.reflection || '',
    );
    if (!key) continue;
    const nodeGroup =
      grouped.get(item.targetNodeId) ?? new Map<string, number>();
    nodeGroup.set(key, (nodeGroup.get(key) ?? 0) + 1);
    grouped.set(item.targetNodeId, nodeGroup);
  }

  for (const [nodeId, reflections] of grouped) {
    for (const [text, count] of reflections) {
      if (count >= 2) {
        UIMapStore.addExperience({ kind: 'node', nodeId }, text, 'auto');
      }
    }
  }
}

export function buildCurrentPageKnowledgePrompt(params: {
  node: UIMapNode | null;
  maxNodeTips?: number;
  maxEdges?: number;
  maxEdgeTips?: number;
}): {
  text: string;
  edgeIds: string[];
  nodeId?: string;
  experienceCatalog: Map<string, string>;
} {
  const { node } = params;
  if (!node) {
    return { text: '', edgeIds: [], experienceCatalog: new Map() };
  }

  const experienceCatalog = new Map<string, string>();
  const uiMap = UIMapStore.getMap();
  const maxNodeTips = params.maxNodeTips ?? 5;
  const maxEdges = params.maxEdges ?? 6;
  const maxEdgeTips = params.maxEdgeTips ?? 3;
  const outgoingEdges = uiMap.edges
    .filter((edge) => edge.sourceNodeId === node.id)
    .filter(
      (edge) => edge.experience.length > 0 || !!edge.lastEffect?.effectSummary,
    )
    .sort((a, b) => b.lastObservedAt - a.lastObservedAt)
    .slice(0, maxEdges);

  if (!node.experience.length && !outgoingEdges.length) {
    return { text: '', edgeIds: [], experienceCatalog };
  }

  const lines: string[] = [
    '## Current Page Knowledge',
    `You are likely on page: ${node.name} (${node.id})`,
  ];

  if (node.experience.length) {
    lines.push('Page tips:');
    node.experience.slice(0, maxNodeTips).forEach((experience, index) => {
      const id = `P${index + 1}`;
      experienceCatalog.set(id, experience.text);
      lines.push(`- [${id}] ${experience.text}`);
    });
  }

  if (outgoingEdges.length) {
    lines.push('Outgoing actions and tips:');
    outgoingEdges.forEach((edge, edgeIndex) => {
      const edgeRef = `E${edgeIndex + 1}`;
      lines.push(`- [${edgeRef}] ${formatEdgeAction(edge)}`);
      edge.experience.slice(0, maxEdgeTips).forEach((experience, tipIndex) => {
        const id = `${edgeRef}.${tipIndex + 1}`;
        const tipWithAction = formatEdgeExperienceTip(experience.text, edge);
        experienceCatalog.set(id, tipWithAction);
        lines.push(`  - [${id}] ${tipWithAction}`);
      });
    });
    lines.push(
      'When an edge tip [E*.*] influences your next action, use its parent [E*] action context. Prefer the listed recommended_action and point1000/box1000 unless the current screenshot clearly differs. Write both id and text in Thought or Action_Summary as: Experience_Used: P1=<tip text>, E2.1=<tip text>. If none influenced you, write Experience_Used: none.',
    );
  }

  return {
    text: `\n\n${lines.join('\n')}`,
    edgeIds: outgoingEdges.map((edge) => edge.id),
    nodeId: node.id,
    experienceCatalog,
  };
}

function normalizeReflectionKey(reflection: string): string {
  return compactReflection(reflection)
    .replace(/[，。,.!！?？]/g, '')
    .replace(/\d+/g, '#')
    .slice(0, 60);
}

function formatEdgeAction(edge: UIMapEdge): string {
  const target = UIMapStore.getMap().nodes.find(
    (node) => node.id === edge.targetNodeId,
  );
  const params = edge.action.params;
  const parts: string[] = [`action_type=${edge.action.tool}`];
  if (params.elementName) parts.push(`target="${params.elementName}"`);
  if (params.elementHint) parts.push(`hint="${params.elementHint}"`);
  if (params.shortcut) parts.push(`shortcut="${params.shortcut}"`);
  if (params.elementMeta?.controlType) {
    parts.push(`control=${params.elementMeta.controlType}`);
  }
  const recommendedAction = formatRecommendedAction(edge.action);
  if (recommendedAction) parts.push(`recommended_action=${recommendedAction}`);
  const point1000 = formatPoint1000(params.targetPoint);
  if (point1000) parts.push(`point1000=<point>${point1000}</point>`);
  const box1000 = formatBox1000(params.targetBox);
  if (box1000) parts.push(`box1000=[${box1000}]`);
  if (params.targetPoint) {
    parts.push(`norm_point=${formatPoint(params.targetPoint, 3)}`);
  }
  if (params.targetBox) {
    parts.push(
      `norm_box=[${params.targetBox.map((item) => item.toFixed(3)).join(',')}]`,
    );
  }
  if (params.screenPoint) {
    parts.push(
      `screen=(${Math.round(params.screenPoint[0])},${Math.round(params.screenPoint[1])})`,
    );
  }
  if (edge.lastEffect?.effectSummary) {
    parts.push(`effect=${edge.lastEffect.effectSummary}`);
  }
  parts.push(`to=${target?.name ?? edge.targetNodeId}`);
  return parts.join(' | ');
}

function formatEdgeExperienceTip(text: string, edge: UIMapEdge): string {
  const actionParts = [
    `tip="${text}"`,
    `action_type=${edge.action.tool}`,
    formatRecommendedAction(edge.action)
      ? `recommended_action=${formatRecommendedAction(edge.action)}`
      : '',
    formatPoint1000(edge.action.params.targetPoint)
      ? `point1000=<point>${formatPoint1000(edge.action.params.targetPoint)}</point>`
      : '',
    formatBox1000(edge.action.params.targetBox)
      ? `box1000=[${formatBox1000(edge.action.params.targetBox)}]`
      : '',
  ].filter(Boolean);
  return actionParts.join('; ');
}

function formatRecommendedAction(action: EdgeAction): string | undefined {
  const params = action.params;
  const point = formatPoint1000(params.targetPoint);
  const escapedShortcut = escapeActionString(params.shortcut);
  const escapedContent = escapeActionString(params.elementHint);

  switch (action.tool) {
    case 'click':
      return point ? `click(point='<point>${point}</point>')` : undefined;
    case 'double_click':
      return point ? `left_double(point='<point>${point}</point>')` : undefined;
    case 'right_click':
      return point
        ? `right_single(point='<point>${point}</point>')`
        : undefined;
    case 'scroll': {
      if (!point) return undefined;
      const direction = normalizeScrollDirection(params.elementName);
      const count = Number.parseInt(params.elementHint ?? '', 10);
      return `scroll(point='<point>${point}</point>', direction='${direction}', scroll_direction_count='${Number.isFinite(count) ? count : 3}')`;
    }
    case 'hotkey':
      return escapedShortcut ? `hotkey(key='${escapedShortcut}')` : undefined;
    case 'type':
      return escapedContent ? `type(content='${escapedContent}')` : undefined;
    default:
      return undefined;
  }
}

function formatPoint(point?: [number, number], digits = 3): string | undefined {
  return point
    ? `(${point[0].toFixed(digits)},${point[1].toFixed(digits)})`
    : undefined;
}

function formatPoint1000(point?: [number, number]): string | undefined {
  if (!point) return undefined;
  return `${to1000(point[0])} ${to1000(point[1])}`;
}

function formatBox1000(
  box?: [number, number, number, number],
): string | undefined {
  if (!box) return undefined;
  return box.map((item) => to1000(item)).join(',');
}

function to1000(value: number): number {
  return Math.max(1, Math.min(999, Math.round(value * 1000)));
}

function escapeActionString(value?: string): string {
  return (value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizeScrollDirection(value?: string): string {
  const direction = (value ?? '').toLowerCase();
  return ['up', 'down', 'left', 'right'].includes(direction)
    ? direction
    : 'down';
}

function extractStructuredValue(
  text: string,
  keys: string[],
): string | undefined {
  if (!text) return undefined;
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = text.match(
      new RegExp(
        `(?:^|\\n)\\s*${escaped}\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*[A-Za-z_ ]+\\s*:|$)`,
        'i',
      ),
    );
    const value = match?.[1]?.trim();
    if (value && !/^(none|null|n\/a|无|暂无)$/i.test(value)) {
      return value.slice(0, 160);
    }
  }
  return undefined;
}
