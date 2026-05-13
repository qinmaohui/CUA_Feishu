import OpenAI from 'openai';
import { intToRGBA, Jimp } from 'jimp';

import { logger } from '@main/logger';
import { SettingStore } from '@main/store/setting';
import {
  createNodeId,
  UIMapNode,
  UIMapStore,
  type EdgeAction,
} from '@main/store/uiMap';

export interface LocalizeResult {
  node: UIMapNode | null;
  visualHash: string;
  tier: 'hash' | 'embedding' | 'a11y' | 'vlm' | 'new' | 'unknown';
  confidence: number;
}

interface LocalizeOptions {
  screenshotBase64: string;
  a11yText?: string;
  allowVlmFallback?: boolean;
}

type VlmLocalizationResponse = {
  match?: string | null;
  newNode?: {
    name?: string;
    type?: UIMapNode['type'];
    summary?: string;
  };
};

const HASH_DISTANCE_THRESHOLD = 5;

const stripBase64Prefix = (base64: string) =>
  base64.replace(/^data:image\/\w+;base64,/, '');

export async function computeDHash(screenshotBase64: string): Promise<string> {
  const image = await Jimp.read(
    Buffer.from(stripBase64Prefix(screenshotBase64), 'base64'),
  );
  image.resize({ w: 9, h: 8 }).greyscale();

  let bits = '';
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = intToRGBA(image.getPixelColor(x, y));
      const right = intToRGBA(image.getPixelColor(x + 1, y));
      bits += left.r > right.r ? '1' : '0';
    }
  }

  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex.padStart(16, '0');
}

export function hammingDistance(first?: string, second?: string): number {
  if (!first || !second || first.length !== second.length) {
    return Number.POSITIVE_INFINITY;
  }

  let distance = 0;
  for (let i = 0; i < first.length; i += 1) {
    const value = parseInt(first[i], 16) ^ parseInt(second[i], 16);
    distance += value.toString(2).replace(/0/g, '').length;
  }
  return distance;
}

export function actionFromPrediction(input: {
  action_type?: string;
  action_inputs?: Record<string, unknown>;
  thought?: string;
}): EdgeAction | null {
  const rawType = (input.action_type ?? '').toLowerCase();
  if (
    !rawType ||
    ['screenshot', 'finished', 'wait', 'call_user'].includes(rawType)
  ) {
    return null;
  }

  const inputs = input.action_inputs ?? {};
  const key = String(inputs.key ?? inputs.hotkey ?? '').trim();
  const rawTarget = firstString(
    inputs.start_box,
    inputs.coordinate,
    inputs.point,
  );
  const targetBox = parseNormalizedBox(rawTarget);
  const targetPoint = targetBox ? centerOfBox(targetBox) : undefined;
  const screenPoint = parseScreenPoint(
    inputs.start_coords ?? inputs.coordinate,
  );
  const baseParams = {
    rawTarget,
    targetPoint,
    targetBox,
    screenPoint,
  };

  if (rawType.includes('double')) {
    return {
      tool: 'double_click',
      params: {
        ...baseParams,
        elementName: extractElementName(input.thought),
        elementMeta: {
          name: extractElementName(input.thought),
          source: 'model',
        },
      },
    };
  }

  if (rawType.includes('right')) {
    return {
      tool: 'right_click',
      params: {
        ...baseParams,
        elementName: extractElementName(input.thought),
        elementMeta: {
          name: extractElementName(input.thought),
          source: 'model',
        },
      },
    };
  }

  if (rawType === 'hotkey' || rawType === 'key') {
    return {
      tool: 'hotkey',
      params: {
        shortcut: key,
        elementName: key,
      },
    };
  }

  if (rawType === 'type' || rawType === 'input') {
    return {
      tool: 'type',
      params: {
        ...baseParams,
        elementName: extractElementName(input.thought),
        elementHint: String(inputs.content ?? '').slice(0, 40),
        elementMeta: {
          name: extractElementName(input.thought),
          source: 'model',
        },
      },
    };
  }

  if (rawType === 'scroll') {
    return {
      tool: 'scroll',
      params: {
        ...baseParams,
        elementName: String(inputs.direction ?? 'scroll'),
        elementHint: String(inputs.scroll_direction_count ?? ''),
        elementMeta: {
          name: String(inputs.direction ?? 'scroll'),
          source: 'model',
        },
      },
    };
  }

  if (rawType === 'click' || rawType === 'left_click') {
    return {
      tool: 'click',
      params: {
        ...baseParams,
        elementName: extractElementName(input.thought),
        elementMeta: {
          name: extractElementName(input.thought),
          source: 'model',
        },
      },
    };
  }

  return null;
}

export async function localizeUIMapNode({
  screenshotBase64,
  a11yText,
  allowVlmFallback = true,
}: LocalizeOptions): Promise<LocalizeResult> {
  const visualHash = await computeDHash(screenshotBase64);
  const uiMap = UIMapStore.getMap();

  const hashMatches = uiMap.nodes
    .map((node) => ({
      node,
      distance: hammingDistance(visualHash, node.features.visualHash),
    }))
    .sort((a, b) => a.distance - b.distance);

  const bestHash = hashMatches[0];
  if (bestHash && bestHash.distance <= HASH_DISTANCE_THRESHOLD) {
    const node =
      UIMapStore.touchNode(bestHash.node.id, {
        features: {
          visualHash,
        },
      }) ?? bestHash.node;
    return {
      node,
      visualHash,
      tier: 'hash',
      confidence: 1 - bestHash.distance / 64,
    };
  }

  const a11yCandidate = findA11yCandidate(a11yText, uiMap.nodes);
  if (a11yCandidate) {
    const node =
      UIMapStore.touchNode(a11yCandidate.id, {
        features: {
          visualHash,
        },
      }) ?? a11yCandidate;
    return {
      node,
      visualHash,
      tier: 'a11y',
      confidence: 0.75,
    };
  }

  if (!allowVlmFallback) {
    return {
      node: null,
      visualHash,
      tier: 'unknown',
      confidence: 0,
    };
  }

  const vlmNode = await vlmFallbackLocalize({
    screenshotBase64,
    visualHash,
    knownNodes: uiMap.nodes,
  });
  if (vlmNode) {
    return {
      node: vlmNode,
      visualHash,
      tier: uiMap.nodes.some((node) => node.id === vlmNode.id) ? 'vlm' : 'new',
      confidence: 0.7,
    };
  }

  return {
    node: null,
    visualHash,
    tier: 'unknown',
    confidence: 0,
  };
}

function findA11yCandidate(
  a11yText: string | undefined,
  nodes: UIMapNode[],
): UIMapNode | null {
  if (!a11yText) return null;
  const lowerText = a11yText.toLowerCase();

  const candidates = nodes
    .map((node) => {
      const uniqueTexts = node.features.uniqueTexts ?? [];
      const hitCount = uniqueTexts.filter(
        (text) => text && lowerText.includes(text.toLowerCase()),
      ).length;
      return { node, hitCount };
    })
    .filter((item) => item.hitCount >= 2)
    .sort((a, b) => b.hitCount - a.hitCount);

  return candidates[0]?.node ?? null;
}

async function vlmFallbackLocalize(params: {
  screenshotBase64: string;
  visualHash: string;
  knownNodes: UIMapNode[];
}): Promise<UIMapNode | null> {
  const settings = SettingStore.getStore();
  if (!settings.vlmBaseUrl || !settings.vlmApiKey || !settings.vlmModelName) {
    return createFallbackNode(params.visualHash);
  }

  try {
    const client = new OpenAI({
      baseURL: settings.vlmBaseUrl,
      apiKey: settings.vlmApiKey,
    });

    const knownNodeText = params.knownNodes.length
      ? params.knownNodes
          .slice(0, 80)
          .map(
            (node) =>
              `- ${node.id}: ${node.name} (${node.type}) ${node.features.summary ?? ''}`,
          )
          .join('\n')
      : '(none)';

    const prompt = `You are localizing the current GUI screen into a UI map.

Known nodes:
${knownNodeText}

Return JSON only:
{
  "match": "existing_node_id" | null,
  "newNode": { "name": "short page name", "type": "page" | "modal" | "panel", "summary": "one sentence visual summary" } | null
}

Prefer "match" only when the screenshot clearly depicts the same page or modal. Otherwise create a new node.`;

    const response = await client.chat.completions.create({
      model: settings.vlmModelName,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${stripBase64Prefix(params.screenshotBase64)}`,
              },
            },
          ],
        },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '';
    const parsed = parseJsonResponse(raw);
    if (parsed.match) {
      const matched = params.knownNodes.find(
        (node) => node.id === parsed.match,
      );
      if (matched) {
        return (
          UIMapStore.touchNode(matched.id, {
            features: {
              visualHash: params.visualHash,
            },
          }) ?? matched
        );
      }
    }

    if (parsed.newNode?.name) {
      return createFallbackNode(
        params.visualHash,
        parsed.newNode.name,
        parsed.newNode.type,
        parsed.newNode.summary,
      );
    }
  } catch (error) {
    logger.warn('[UIMapLocalize] VLM fallback failed:', error);
  }

  return createFallbackNode(params.visualHash);
}

function createFallbackNode(
  visualHash: string,
  name = 'Unknown Page',
  type: UIMapNode['type'] = 'page',
  summary?: string,
): UIMapNode {
  const now = Date.now();
  const baseId = createNodeId(name);
  const existing = UIMapStore.getMap().nodes.find((node) => node.id === baseId);
  const id = existing
    ? `${baseId}_${Math.random().toString(36).slice(2, 6)}`
    : baseId;
  return UIMapStore.upsertNode({
    id,
    name,
    type,
    features: {
      visualHash,
      summary,
    },
    visitCount: 1,
    lastVisitedAt: now,
    firstDiscoveredAt: now,
    discoveredBy: 'agent_run',
  });
}

function parseJsonResponse(raw: string): VlmLocalizationResponse {
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (braceMatch) jsonStr = braceMatch[0];
  return JSON.parse(jsonStr) as VlmLocalizationResponse;
}

function parseNormalizedBox(
  value: unknown,
): [number, number, number, number] | undefined {
  const numbers = String(value)
    .match(/-?\d+(?:\.\d+)?/g)
    ?.map((item) => Number(item))
    .filter((item) => Number.isFinite(item));

  if (!numbers?.length) return undefined;
  const [x1, y1, x2 = x1, y2 = y1] = numbers;
  const box: [number, number, number, number] = [x1, y1, x2, y2];
  const shouldScale = box.some((item) => Math.abs(item) > 1);
  return box.map((item) => {
    const normalized = shouldScale ? item / 1000 : item;
    return Math.max(0, Math.min(1, normalized));
  }) as [number, number, number, number];
}

function centerOfBox(box: [number, number, number, number]): [number, number] {
  return [
    Math.max(0, Math.min(1, (box[0] + box[2]) / 2)),
    Math.max(0, Math.min(1, (box[1] + box[3]) / 2)),
  ];
}

function parseScreenPoint(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return [x, y];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return undefined;
}

function extractElementName(thought?: string): string | undefined {
  if (!thought) return undefined;
  const quoted = thought.match(/["“']([^"”']{1,40})["”']/)?.[1];
  if (quoted) return quoted;
  return thought.trim().replace(/\s+/g, ' ').slice(0, 40);
}
