import { useState } from 'react';
import { ChevronRight, ChevronDown, Layers, MousePointer } from 'lucide-react';
import { Element, TreeNode } from './types';

function TreeNodeRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (el: Element) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const el = node.element;
  const isContainer = el.type === 'container';
  const isSelected = selectedId === el.id;
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-sm transition-colors ${
          isSelected ? 'bg-red-100 text-red-700' : 'hover:bg-gray-100'
        }`}
        style={{ paddingLeft: depth * 12 + 8 }}
        onClick={() => onSelect(el)}
      >
        {isContainer && hasChildren ? (
          <button
            className="flex-shrink-0 text-gray-400 hover:text-gray-600"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}
        {isContainer ? (
          <Layers size={12} className="flex-shrink-0 text-indigo-400" />
        ) : (
          <MousePointer size={12} className="flex-shrink-0 text-blue-400" />
        )}
        <span
          className={`truncate flex-1 ${isContainer ? 'font-medium text-indigo-700' : 'text-gray-700'}`}
        >
          {el.name}
        </span>
        {el.isCorrected && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"
            title="已人工修正"
          />
        )}
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${el.isInteractive ? 'bg-green-400' : 'bg-gray-300'}`}
          title={el.isInteractive ? '可交互' : '不可交互'}
        />
      </div>
      {isContainer &&
        expanded &&
        node.children.map((child) => (
          <TreeNodeRow
            key={child.element.id}
            node={child}
            depth={depth + 1}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function TreeList({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: TreeNode[];
  selectedId: string | null;
  onSelect: (el: Element) => void;
}) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <TreeNodeRow
          key={node.element.id}
          node={node}
          depth={0}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
