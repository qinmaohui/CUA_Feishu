import { useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Map,
  Plus,
  RefreshCcw,
  Trash2,
  Route,
  Sparkles,
  Square,
} from 'lucide-react';

import { Button } from '@renderer/components/ui/button';
import { Textarea } from '@renderer/components/ui/textarea';
import { DragArea } from '@renderer/components/Common/drag';
import { useUIMapStore } from '@renderer/store/uiMap';
import type { UIMapEdge, UIMapNode } from '@main/store/uiMap';

const formatTime = (ts?: number) =>
  ts
    ? new Date(ts).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-';

const formatPoint = (point?: [number, number], digits = 3) =>
  point ? `(${point[0].toFixed(digits)}, ${point[1].toFixed(digits)})` : '-';

const formatBox = (box?: [number, number, number, number]) =>
  box ? `[${box.map((item) => item.toFixed(3)).join(', ')}]` : '-';

function ExperienceList({
  node,
  edge,
}: {
  node?: UIMapNode;
  edge?: UIMapEdge;
}) {
  const { addExperience, deleteExperience } = useUIMapStore();
  const [text, setText] = useState('');
  const target = node
    ? ({ kind: 'node', nodeId: node.id } as const)
    : edge
      ? ({ kind: 'edge', edgeId: edge.id } as const)
      : null;
  const items = node?.experience ?? edge?.experience ?? [];

  if (!target) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-800">Experience</h3>
        <span className="text-xs text-neutral-400">{items.length} tips</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="group rounded-lg border border-neutral-200 bg-white px-3 py-2"
          >
            <div className="flex items-start gap-2">
              <p className="flex-1 text-sm leading-5 text-neutral-700">
                {item.text}
              </p>
              <button
                className="rounded p-1 text-neutral-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                onClick={() => deleteExperience(target, item.id)}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-neutral-400">
              <span>{item.source}</span>
              <span>hits {item.hitCount}</span>
              <span>{formatTime(item.createdAt)}</span>
            </div>
          </div>
        ))}
        {!items.length && (
          <div className="rounded-lg border border-dashed border-neutral-200 px-3 py-8 text-center text-sm text-neutral-400">
            No experience recorded yet.
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Add a short manual tip..."
          className="min-h-20 resize-none text-sm"
        />
        <Button
          className="self-start"
          size="icon"
          disabled={!text.trim()}
          onClick={async () => {
            await addExperience(target, text);
            setText('');
          }}
          title="Add"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function EdgeRow({
  edge,
  target,
  selected,
  onSelect,
}: {
  edge: UIMapEdge;
  target?: UIMapNode;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = [
    edge.action.tool,
    edge.action.params.elementName ? `"${edge.action.params.elementName}"` : '',
    edge.action.params.shortcut ?? '',
    edge.action.params.targetPoint
      ? formatPoint(edge.action.params.targetPoint, 2)
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={`w-full rounded-lg border px-3 py-2 text-left transition ${
        selected
          ? 'border-blue-400 bg-blue-50'
          : 'border-neutral-200 hover:bg-neutral-50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <Route className="h-3.5 w-3.5 text-neutral-400" />
        <span className="truncate text-sm font-medium text-neutral-700">
          {label || edge.action.tool}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-neutral-400">
        <span className="truncate">to {target?.name ?? edge.targetNodeId}</span>
        <span>
          {edge.successCount}/{edge.observedCount}
        </span>
      </div>
    </button>
  );
}

export default function UIMapPage() {
  const {
    uiMap,
    loading,
    exploring,
    fetchUIMap,
    deleteNode,
    startExploration,
    stopExploration,
  } = useUIMapStore();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  useEffect(() => {
    fetchUIMap();
  }, []);

  useEffect(() => {
    if (!selectedNodeId && uiMap?.nodes.length) {
      setSelectedNodeId(uiMap.nodes[0].id);
    }
  }, [uiMap?.nodes, selectedNodeId]);

  const selectedNode = useMemo(
    () => uiMap?.nodes.find((node) => node.id === selectedNodeId),
    [uiMap, selectedNodeId],
  );
  const outgoingEdges = useMemo(
    () =>
      uiMap?.edges.filter((edge) => edge.sourceNodeId === selectedNodeId) ?? [],
    [uiMap, selectedNodeId],
  );
  const selectedEdge = useMemo(
    () => outgoingEdges.find((edge) => edge.id === selectedEdgeId),
    [outgoingEdges, selectedEdgeId],
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <DragArea />
      <div className="flex shrink-0 items-center justify-between border-b px-8 py-5">
        <div className="flex items-center gap-3">
          <Map className="h-5 w-5 text-neutral-600" />
          <h1 className="text-xl font-semibold text-neutral-800">UI Map</h1>
          <span className="text-sm text-neutral-400">
            {uiMap?.nodes.length ?? 0} nodes · {uiMap?.edges.length ?? 0} edges
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchUIMap}>
            <RefreshCcw className="mr-1 h-4 w-4" />
            Refresh
          </Button>
          {exploring ? (
            <Button variant="outline" size="sm" onClick={stopExploration}>
              <Square className="mr-1 h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={startExploration}>
              <Sparkles className="mr-1 h-4 w-4" />
              Explore
            </Button>
          )}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_360px]">
        <aside className="overflow-y-auto border-r p-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          )}
          <div className="space-y-2">
            {uiMap?.nodes.map((node) => (
              <button
                key={node.id}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                  selectedNodeId === node.id
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-neutral-200 hover:bg-neutral-50'
                }`}
                onClick={() => {
                  setSelectedNodeId(node.id);
                  setSelectedEdgeId(null);
                }}
              >
                <div className="truncate text-sm font-medium text-neutral-800">
                  {node.name}
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-neutral-400">
                  <span>{node.type}</span>
                  <span>visits {node.visitCount}</span>
                </div>
              </button>
            ))}
          </div>
          {!uiMap?.nodes.length && !loading && (
            <div className="rounded-lg border border-dashed border-neutral-200 px-3 py-10 text-center text-sm text-neutral-400">
              Run an agent task to discover pages.
            </div>
          )}
        </aside>

        <main className="overflow-y-auto p-6">
          {selectedNode ? (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-neutral-400">
                    {selectedNode.id}
                  </div>
                  <h2 className="mt-1 text-2xl font-semibold text-neutral-900">
                    {selectedNode.name}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-3 text-sm text-neutral-500">
                    <span>{selectedNode.type}</span>
                    <span>
                      first {formatTime(selectedNode.firstDiscoveredAt)}
                    </span>
                    <span>last {formatTime(selectedNode.lastVisitedAt)}</span>
                    <span>{selectedNode.discoveredBy}</span>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deleteNode(selectedNode.id)}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Delete
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-400">Visual hash</div>
                  <div className="mt-1 break-all font-mono text-sm text-neutral-700">
                    {selectedNode.features.visualHash ?? '-'}
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-200 p-3">
                  <div className="text-xs text-neutral-400">Summary</div>
                  <div className="mt-1 text-sm text-neutral-700">
                    {selectedNode.features.summary ?? '-'}
                  </div>
                </div>
              </div>

              <ExperienceList node={selectedNode} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-neutral-400">
              Select a node.
            </div>
          )}
        </main>

        <aside className="overflow-y-auto border-l p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neutral-800">
              Outgoing Edges
            </h3>
            <span className="text-xs text-neutral-400">
              {outgoingEdges.length}
            </span>
          </div>
          <div className="space-y-2">
            {outgoingEdges.map((edge) => (
              <EdgeRow
                key={edge.id}
                edge={edge}
                target={uiMap?.nodes.find(
                  (node) => node.id === edge.targetNodeId,
                )}
                selected={selectedEdgeId === edge.id}
                onSelect={() => setSelectedEdgeId(edge.id)}
              />
            ))}
          </div>
          {!outgoingEdges.length && (
            <div className="rounded-lg border border-dashed border-neutral-200 px-3 py-8 text-center text-sm text-neutral-400">
              No outgoing edges yet.
            </div>
          )}

          {selectedEdge && (
            <div className="mt-6 space-y-4 border-t pt-4">
              <div>
                <div className="text-xs text-neutral-400">Selected edge</div>
                <div className="mt-1 font-mono text-xs text-neutral-600">
                  {selectedEdge.id}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-neutral-50 p-2">
                    <div className="font-semibold text-neutral-800">
                      {selectedEdge.observedCount}
                    </div>
                    <div className="text-neutral-400">seen</div>
                  </div>
                  <div className="rounded-lg bg-green-50 p-2">
                    <div className="font-semibold text-green-700">
                      {selectedEdge.successCount}
                    </div>
                    <div className="text-green-500">ok</div>
                  </div>
                  <div className="rounded-lg bg-red-50 p-2">
                    <div className="font-semibold text-red-700">
                      {selectedEdge.failureCount}
                    </div>
                    <div className="text-red-500">fail</div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-neutral-200 p-3">
                <div className="text-xs font-medium text-neutral-500">
                  Action target
                </div>
                <dl className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-400">Point</dt>
                    <dd className="font-mono text-neutral-700">
                      {formatPoint(selectedEdge.action.params.targetPoint)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-400">Box</dt>
                    <dd className="break-all font-mono text-neutral-700">
                      {formatBox(selectedEdge.action.params.targetBox)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-400">Screen</dt>
                    <dd className="font-mono text-neutral-700">
                      {formatPoint(selectedEdge.action.params.screenPoint, 0)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-400">Element</dt>
                    <dd className="truncate text-right text-neutral-700">
                      {selectedEdge.action.params.elementMeta?.controlType ??
                        selectedEdge.action.params.elementHint ??
                        '-'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-neutral-400">Source</dt>
                    <dd className="text-neutral-700">
                      {selectedEdge.action.params.elementMeta?.source ?? '-'}
                    </dd>
                  </div>
                </dl>
              </div>
              {selectedEdge.lastEffect && (
                <div className="rounded-lg border border-neutral-200 p-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-neutral-500">
                      Latest effect
                    </div>
                    <span
                      className={`text-xs ${
                        selectedEdge.lastEffect.judgedValid === false
                          ? 'text-red-500'
                          : 'text-green-600'
                      }`}
                    >
                      {selectedEdge.lastEffect.judgedValid === false
                        ? 'invalid'
                        : 'valid'}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-neutral-600">
                    {!!selectedEdge.lastEffect.experienceUsed?.length && (
                      <div className="rounded bg-emerald-50 px-2 py-1.5 text-emerald-700">
                        <div className="mb-1 font-medium">Used experience</div>
                        <div className="space-y-1">
                          {selectedEdge.lastEffect.experienceUsed.map((ref) => (
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
                    <p>
                      {selectedEdge.lastEffect.effectSummary ??
                        selectedEdge.lastEffect.reason ??
                        'No effect summary.'}
                    </p>
                    <div className="flex justify-between gap-3 text-neutral-400">
                      <span>
                        visual{' '}
                        {selectedEdge.lastEffect.visualChanged
                          ? 'changed'
                          : 'unchanged'}
                      </span>
                      <span>
                        {formatTime(selectedEdge.lastEffect.observedAt)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
              <ExperienceList edge={selectedEdge} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
