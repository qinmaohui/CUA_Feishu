import ElectronStore from 'electron-store';

export interface NodeFeatures {
  windowTitle?: string;
  visualHash?: string;
  visualEmbedding?: number[];
  paneNamesHint?: string[];
  uniqueTexts?: string[];
  summary?: string;
}

export interface NodeExperience {
  id: string;
  text: string;
  source: 'auto' | 'manual';
  createdAt: number;
  hitCount: number;
}

export interface UIMapNode {
  id: string;
  name: string;
  type: 'page' | 'modal' | 'panel';
  features: NodeFeatures;
  experience: NodeExperience[];
  visitCount: number;
  lastVisitedAt: number;
  firstDiscoveredAt: number;
  discoveredBy: 'exploration' | 'agent_run' | 'manual';
}

export interface EdgeAction {
  tool: 'click' | 'hotkey' | 'type' | 'scroll' | 'double_click' | 'right_click';
  params: {
    elementName?: string;
    elementHint?: string;
    shortcut?: string;
    rawTarget?: string;
    targetPoint?: [number, number];
    targetBox?: [number, number, number, number];
    screenPoint?: [number, number];
    elementMeta?: {
      name?: string;
      controlType?: string;
      source?: 'model' | 'a11y' | 'exploration' | 'manual';
    };
  };
}

export interface UIMapExperienceRef {
  id: string;
  text: string;
}

export interface EdgeEffect {
  beforeShotHash?: string;
  afterShotHash?: string;
  visualChanged?: boolean;
  judgedValid?: boolean;
  experienceUsed?: UIMapExperienceRef[];
  reason?: string;
  effectSummary?: string;
  observedAt: number;
}

export interface EdgeExperience {
  id: string;
  text: string;
  source: 'auto' | 'manual';
  evidence?: {
    instruction?: string;
    beforeShotHash?: string;
    afterShotHash?: string;
    actionValid?: boolean;
    effectSummary?: string;
    vlmReflection?: string;
  };
  createdAt: number;
  hitCount: number;
}

export interface UIMapEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  action: EdgeAction;
  experience: EdgeExperience[];
  lastEffect?: EdgeEffect;
  effectHistory?: EdgeEffect[];
  weight: number;
  successCount: number;
  failureCount: number;
  observedCount: number;
  lastObservedAt: number;
}

export interface UIMap {
  nodes: UIMapNode[];
  edges: UIMapEdge[];
  version: number;
  lastUpdatedAt: number;
}

type UIMapStoreSchema = {
  uiMap: UIMap;
};

export type UIMapExperienceTarget =
  | { kind: 'node'; nodeId: string }
  | { kind: 'edge'; edgeId: string };

const MAX_NODES = 100;
const MAX_EDGES = 500;
const MAX_EFFECT_HISTORY_PER_EDGE = 5;

const createEmptyMap = (): UIMap => ({
  nodes: [],
  edges: [],
  version: 1,
  lastUpdatedAt: Date.now(),
});

const createId = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const normalizeActionText = (value?: string) =>
  (value ?? '').replace(/\s+/g, '').toLowerCase();

const distance = (a: [number, number], b: [number, number]) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
};

export const createExperienceId = () => createId('exp');

export const createNodeId = (name?: string) => {
  const slug = (name ?? 'page')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `page_${slug || createId('node')}`;
};

export const areActionsEquivalent = (
  first: EdgeAction,
  second: EdgeAction,
): boolean => {
  if (first.tool !== second.tool) return false;

  const firstShortcut = first.params.shortcut;
  const secondShortcut = second.params.shortcut;
  if (firstShortcut && secondShortcut) {
    return (
      normalizeActionText(firstShortcut) === normalizeActionText(secondShortcut)
    );
  }

  const firstName = first.params.elementName;
  const secondName = second.params.elementName;
  if (firstName && secondName) {
    return normalizeActionText(firstName) === normalizeActionText(secondName);
  }

  const firstPoint = first.params.targetPoint;
  const secondPoint = second.params.targetPoint;
  if (firstPoint && secondPoint) {
    return distance(firstPoint, secondPoint) < 0.05;
  }

  return false;
};

export class UIMapStore {
  private static instance: ElectronStore<UIMapStoreSchema>;

  public static getInstance(): ElectronStore<UIMapStoreSchema> {
    if (!UIMapStore.instance) {
      UIMapStore.instance = new ElectronStore<UIMapStoreSchema>({
        name: 'ui_tars.ui_map',
        defaults: {
          uiMap: createEmptyMap(),
        },
      });
    }

    return UIMapStore.instance;
  }

  public static getMap(): UIMap {
    return UIMapStore.getInstance().get('uiMap') || createEmptyMap();
  }

  public static setMap(uiMap: UIMap): UIMap {
    const next = UIMapStore.prune({
      ...uiMap,
      version: uiMap.version || 1,
      lastUpdatedAt: Date.now(),
    });
    UIMapStore.getInstance().set('uiMap', next);
    return next;
  }

  public static reset(): UIMap {
    const next = createEmptyMap();
    UIMapStore.getInstance().set('uiMap', next);
    return next;
  }

  public static upsertNode(
    node: Omit<
      UIMapNode,
      'experience' | 'visitCount' | 'lastVisitedAt' | 'firstDiscoveredAt'
    > &
      Partial<
        Pick<
          UIMapNode,
          'experience' | 'visitCount' | 'lastVisitedAt' | 'firstDiscoveredAt'
        >
      >,
  ): UIMapNode {
    const uiMap = UIMapStore.getMap();
    const now = Date.now();
    const existingIndex = uiMap.nodes.findIndex((item) => item.id === node.id);
    const nextNode: UIMapNode =
      existingIndex >= 0
        ? {
            ...uiMap.nodes[existingIndex],
            ...node,
            features: {
              ...uiMap.nodes[existingIndex].features,
              ...node.features,
            },
            experience:
              node.experience ?? uiMap.nodes[existingIndex].experience ?? [],
            visitCount:
              node.visitCount ?? uiMap.nodes[existingIndex].visitCount ?? 0,
            lastVisitedAt: node.lastVisitedAt ?? now,
            firstDiscoveredAt:
              node.firstDiscoveredAt ??
              uiMap.nodes[existingIndex].firstDiscoveredAt ??
              now,
          }
        : {
            ...node,
            experience: node.experience ?? [],
            visitCount: node.visitCount ?? 0,
            lastVisitedAt: node.lastVisitedAt ?? now,
            firstDiscoveredAt: node.firstDiscoveredAt ?? now,
          };

    if (existingIndex >= 0) {
      uiMap.nodes[existingIndex] = nextNode;
    } else {
      uiMap.nodes.push(nextNode);
    }
    UIMapStore.setMap(uiMap);
    return nextNode;
  }

  public static touchNode(
    id: string,
    patch?: Partial<Pick<UIMapNode, 'features' | 'name' | 'type'>>,
  ): UIMapNode | null {
    const uiMap = UIMapStore.getMap();
    const index = uiMap.nodes.findIndex((item) => item.id === id);
    if (index < 0) return null;

    const now = Date.now();
    const current = uiMap.nodes[index];
    const updated: UIMapNode = {
      ...current,
      ...patch,
      features: {
        ...current.features,
        ...(patch?.features ?? {}),
      },
      visitCount: current.visitCount + 1,
      lastVisitedAt: now,
    };
    uiMap.nodes[index] = updated;
    UIMapStore.setMap(uiMap);
    return updated;
  }

  public static updateNode(
    id: string,
    patch: Partial<Omit<UIMapNode, 'id'>>,
  ): UIMapNode | null {
    const uiMap = UIMapStore.getMap();
    const index = uiMap.nodes.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = uiMap.nodes[index];
    const updated: UIMapNode = {
      ...current,
      ...patch,
      features: {
        ...current.features,
        ...(patch.features ?? {}),
      },
      experience: patch.experience ?? current.experience,
    };
    uiMap.nodes[index] = updated;
    UIMapStore.setMap(uiMap);
    return updated;
  }

  public static deleteNode(id: string): boolean {
    const uiMap = UIMapStore.getMap();
    const nextNodes = uiMap.nodes.filter((item) => item.id !== id);
    if (nextNodes.length === uiMap.nodes.length) return false;
    UIMapStore.setMap({
      ...uiMap,
      nodes: nextNodes,
      edges: uiMap.edges.filter(
        (edge) => edge.sourceNodeId !== id && edge.targetNodeId !== id,
      ),
    });
    return true;
  }

  public static observeEdge(params: {
    sourceNodeId: string;
    targetNodeId: string;
    action: EdgeAction;
    success?: boolean;
    effect?: Omit<EdgeEffect, 'observedAt'>;
  }): UIMapEdge {
    const uiMap = UIMapStore.getMap();
    const now = Date.now();
    const effect = params.effect
      ? {
          ...params.effect,
          observedAt: now,
        }
      : undefined;
    const existingIndex = uiMap.edges.findIndex(
      (edge) =>
        edge.sourceNodeId === params.sourceNodeId &&
        edge.targetNodeId === params.targetNodeId &&
        areActionsEquivalent(edge.action, params.action),
    );

    if (existingIndex >= 0) {
      const current = uiMap.edges[existingIndex];
      const updated: UIMapEdge = {
        ...current,
        action: {
          ...current.action,
          params: {
            ...current.action.params,
            ...params.action.params,
          },
        },
        lastEffect: effect ?? current.lastEffect,
        effectHistory: effect
          ? [effect, ...(current.effectHistory ?? [])].slice(
              0,
              MAX_EFFECT_HISTORY_PER_EDGE,
            )
          : current.effectHistory,
        successCount:
          params.success === false
            ? current.successCount
            : current.successCount + 1,
        failureCount:
          params.success === false
            ? current.failureCount + 1
            : current.failureCount,
        observedCount: current.observedCount + 1,
        weight:
          params.success === false ? current.weight + 0.5 : current.weight,
        lastObservedAt: now,
      };
      uiMap.edges[existingIndex] = updated;
      UIMapStore.setMap(uiMap);
      return updated;
    }

    const edge: UIMapEdge = {
      id: createId('edge'),
      sourceNodeId: params.sourceNodeId,
      targetNodeId: params.targetNodeId,
      action: params.action,
      experience: [],
      lastEffect: effect,
      effectHistory: effect ? [effect] : [],
      weight: params.success === false ? 1.5 : 1,
      successCount: params.success === false ? 0 : 1,
      failureCount: params.success === false ? 1 : 0,
      observedCount: 1,
      lastObservedAt: now,
    };
    uiMap.edges.push(edge);
    UIMapStore.setMap(uiMap);
    return edge;
  }

  public static addExperience(
    target: UIMapExperienceTarget,
    text: string,
    source: 'auto' | 'manual',
    evidence?: EdgeExperience['evidence'],
  ): NodeExperience | EdgeExperience | null {
    const trimmed = text.trim().replace(/\s+/g, ' ').slice(0, 80);
    if (!trimmed) return null;

    const uiMap = UIMapStore.getMap();
    const createdAt = Date.now();

    if (target.kind === 'node') {
      const nodeIndex = uiMap.nodes.findIndex(
        (item) => item.id === target.nodeId,
      );
      if (nodeIndex < 0) return null;
      const existing = uiMap.nodes[nodeIndex].experience.find(
        (item) => item.text === trimmed,
      );
      if (existing) return existing;

      const experience: NodeExperience = {
        id: createExperienceId(),
        text: trimmed,
        source,
        createdAt,
        hitCount: 0,
      };
      uiMap.nodes[nodeIndex].experience.push(experience);
      UIMapStore.setMap(uiMap);
      return experience;
    }

    const edgeIndex = uiMap.edges.findIndex(
      (item) => item.id === target.edgeId,
    );
    if (edgeIndex < 0) return null;
    const existing = uiMap.edges[edgeIndex].experience.find(
      (item) => item.text === trimmed,
    );
    if (existing) return existing;

    const experience: EdgeExperience = {
      id: createExperienceId(),
      text: trimmed,
      source,
      evidence,
      createdAt,
      hitCount: 0,
    };
    uiMap.edges[edgeIndex].experience.push(experience);
    UIMapStore.setMap(uiMap);
    return experience;
  }

  public static deleteExperience(
    target: UIMapExperienceTarget,
    experienceId: string,
  ): boolean {
    const uiMap = UIMapStore.getMap();

    if (target.kind === 'node') {
      const nodeIndex = uiMap.nodes.findIndex(
        (item) => item.id === target.nodeId,
      );
      if (nodeIndex < 0) return false;
      const current = uiMap.nodes[nodeIndex].experience;
      const next = current.filter((item) => item.id !== experienceId);
      if (next.length === current.length) return false;
      uiMap.nodes[nodeIndex].experience = next;
      UIMapStore.setMap(uiMap);
      return true;
    }

    const edgeIndex = uiMap.edges.findIndex(
      (item) => item.id === target.edgeId,
    );
    if (edgeIndex < 0) return false;
    const current = uiMap.edges[edgeIndex].experience;
    const next = current.filter((item) => item.id !== experienceId);
    if (next.length === current.length) return false;
    uiMap.edges[edgeIndex].experience = next;
    UIMapStore.setMap(uiMap);
    return true;
  }

  public static incrementExperienceHits(params: {
    nodeIds?: string[];
    edgeIds?: string[];
  }): void {
    const uiMap = UIMapStore.getMap();
    const nodeIds = new Set(params.nodeIds ?? []);
    const edgeIds = new Set(params.edgeIds ?? []);
    let changed = false;

    for (const node of uiMap.nodes) {
      if (!nodeIds.has(node.id)) continue;
      for (const exp of node.experience) {
        exp.hitCount += 1;
        changed = true;
      }
    }

    for (const edge of uiMap.edges) {
      if (!edgeIds.has(edge.id)) continue;
      for (const exp of edge.experience) {
        exp.hitCount += 1;
        changed = true;
      }
    }

    if (changed) {
      UIMapStore.setMap(uiMap);
    }
  }

  private static prune(uiMap: UIMap): UIMap {
    let nodes = [...uiMap.nodes];
    if (nodes.length > MAX_NODES) {
      const keepIds = new Set(
        nodes
          .sort(
            (a, b) =>
              a.visitCount - b.visitCount || a.lastVisitedAt - b.lastVisitedAt,
          )
          .slice(nodes.length - MAX_NODES)
          .map((item) => item.id),
      );
      nodes = uiMap.nodes.filter((node) => keepIds.has(node.id));
    }

    const nodeIds = new Set(nodes.map((node) => node.id));
    let edges = uiMap.edges.filter(
      (edge) =>
        nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
    );
    if (edges.length > MAX_EDGES) {
      const keepIds = new Set(
        [...edges]
          .sort((a, b) => a.observedCount - b.observedCount)
          .slice(edges.length - MAX_EDGES)
          .map((item) => item.id),
      );
      edges = edges.filter((edge) => keepIds.has(edge.id));
    }

    return {
      ...uiMap,
      nodes,
      edges,
    };
  }
}
