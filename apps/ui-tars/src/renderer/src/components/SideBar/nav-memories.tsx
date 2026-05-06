import { useEffect, useRef, useState } from 'react';
import {
  MoreHorizontal,
  Trash2,
  Brain,
  ChevronRight,
  Pencil,
  Play,
  Circle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import mediumZoom, { type Zoom } from 'medium-zoom';
import { useResize } from '@renderer/hooks/useResize';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@renderer/components/ui/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@renderer/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { useAgentMemoryStore } from '@renderer/store/agentMemory';
import type { AgentMemoryItem } from '@main/store/agentMemory';
import { useStore } from '@renderer/hooks/useStore';
import { api } from '@renderer/api';

const formatDate = (ts: number) =>
  new Date(ts).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

const formatActionInputs = (
  actionType: string,
  inputs: Record<string, unknown>,
): string => {
  if (!inputs || !Object.keys(inputs).length) return '';
  switch (actionType) {
    case 'click':
    case 'left_click':
    case 'right_click':
    case 'double_click':
    case 'middle_click': {
      const box = inputs.start_box ?? inputs.coordinate ?? inputs.point;
      return box ? `坐标 ${JSON.stringify(box)}` : '';
    }
    case 'drag': {
      const from = inputs.startBox ?? inputs.start_box;
      const to = inputs.endBox ?? inputs.end_box;
      return from && to
        ? `从 ${JSON.stringify(from)} 到 ${JSON.stringify(to)}`
        : '';
    }
    case 'type':
    case 'input':
      return inputs.content ? `"${inputs.content}"` : '';
    case 'hotkey':
    case 'key':
      return inputs.key ? String(inputs.key) : '';
    case 'scroll': {
      const dir = inputs.direction ?? '';
      const coord = inputs.coordinate ?? inputs.start_box;
      return [
        coord ? `坐标 ${JSON.stringify(coord)}` : '',
        dir ? `方向 ${dir}` : '',
      ]
        .filter(Boolean)
        .join(' ');
    }
    default: {
      const parts = Object.entries(inputs)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
      return parts.slice(0, 2).join(', ');
    }
  }
};

const toDataUrl = (base64?: string): string | null => {
  if (!base64 || !base64.trim()) {
    return null;
  }
  return base64.startsWith('data:image')
    ? base64
    : `data:image/png;base64,${base64}`;
};

export function NavMemories({
  onReplay,
}: {
  onReplay: (memory: AgentMemoryItem) => void;
}) {
  const { memories, fetchMemories, deleteMemory, renameMemory } =
    useAgentMemoryStore();
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [detailMemory, setDetailMemory] = useState<AgentMemoryItem | null>(
    null,
  );
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [recordInstruction, setRecordInstruction] = useState('');
  const [selectedStep, setSelectedStep] = useState(0);
  const { isRecording } = useStore();
  const { setOpen, state } = useSidebar();
  const { size, getResizeHandleProps } = useResize({
    initialWidth: 1440,
    initialHeight: 860,
    minWidth: 760,
    minHeight: 400,
  });
  const detailImgRef = useRef<HTMLImageElement>(null);
  const zoomRef = useRef<Zoom | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchMemories();
    }
  }, [isOpen]);

  const handleToggle = () => {
    if (state === 'collapsed') {
      setOpen(true);
      setTimeout(() => setIsOpen(true), 10);
    }
  };

  const startRename = (memory: AgentMemoryItem) => {
    setEditingId(memory.id);
    setEditingName(memory.name);
  };

  const commitRename = async () => {
    if (editingId && editingName.trim()) {
      await renameMemory(editingId, editingName.trim());
    }
    setEditingId(null);
    setEditingName('');
  };

  const handleStartRecording = async () => {
    if (!recordInstruction.trim()) return;
    setRecordDialogOpen(false);
    await api.startRecording({ instruction: recordInstruction.trim() });
    setRecordInstruction('');
  };

  const handleReRecord = (memory: AgentMemoryItem) => {
    setRecordInstruction(memory.instruction);
    setRecordDialogOpen(true);
  };

  const detailStep =
    detailMemory && detailMemory.steps.length > 0
      ? detailMemory.steps[
          Math.min(selectedStep, detailMemory.steps.length - 1)
        ]
      : null;
  const detailStepImage = detailStep
    ? toDataUrl(detailStep.screenshotWithMarker ?? detailStep.screenshotBase64)
    : null;
  const isManualMemory = detailMemory?.source === 'manual';
  const showA11ySnapshot = !!detailStep?.a11ySnapshot && !isManualMemory;

  useEffect(() => {
    if (!detailImgRef.current || !detailStepImage) return;
    zoomRef.current?.detach();
    zoomRef.current?.close();
    const zoom = mediumZoom(detailImgRef.current, {
      background: 'rgba(0,0,0,.7)',
      margin: 50,
    });
    zoomRef.current = zoom;
    return () => {
      zoom.detach();
      zoom.close();
    };
  }, [detailStepImage]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <SidebarGroup>
        <SidebarMenu className="items-center">
          <Collapsible
            asChild
            open={isOpen}
            onOpenChange={setIsOpen}
            className="group/collapsible"
          >
            <SidebarMenuItem className="w-full flex flex-col items-center">
              <CollapsibleTrigger asChild>
                <SidebarMenuButton
                  className="!pr-2 font-medium"
                  onClick={handleToggle}
                >
                  <Brain strokeWidth={2} />
                  <span>Memories</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent className="w-full">
                <SidebarMenuSub className="!mr-0 !pr-1">
                  <SidebarMenuSubItem>
                    <button
                      className="w-full flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-700 px-2 py-1.5 rounded hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => setRecordDialogOpen(true)}
                      disabled={isRecording}
                    >
                      <Circle className="w-3 h-3 text-red-400 fill-red-400" />
                      {isRecording ? '录制中...' : '录制操作'}
                    </button>
                  </SidebarMenuSubItem>
                  {memories.length === 0 && (
                    <SidebarMenuSubItem>
                      <span className="text-xs text-neutral-400 px-2 py-1">
                        No memories yet
                      </span>
                    </SidebarMenuSubItem>
                  )}
                  {memories.map((item) => (
                    <SidebarMenuSubItem key={item.id} className="group/item">
                      <SidebarMenuSubButton
                        className="hover:bg-neutral-100 hover:text-neutral-600 py-5 cursor-pointer text-neutral-500"
                        onClick={() => {
                          setDetailMemory(item);
                          setSelectedStep(0);
                        }}
                      >
                        <Brain className="w-4 h-4 shrink-0" />
                        {editingId === item.id ? (
                          <input
                            autoFocus
                            className="flex-1 bg-transparent border-b border-neutral-400 outline-none text-sm"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename();
                              if (e.key === 'Escape') {
                                setEditingId(null);
                                setEditingName('');
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="max-w-38 truncate">{item.name}</span>
                        )}
                      </SidebarMenuSubButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuAction className="invisible group-hover/item:visible [&[data-state=open]]:visible mt-1">
                            <MoreHorizontal />
                            <span className="sr-only">More</span>
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          className="rounded-lg"
                          side="right"
                          align="start"
                        >
                          <DropdownMenuItem onClick={() => onReplay(item)}>
                            <Play className="w-4 h-4" />
                            <span>Replay</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleReRecord(item)}
                          >
                            <RefreshCw className="w-4 h-4" />
                            <span>Re-record</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => startRename(item)}>
                            <Pencil className="w-4 h-4" />
                            <span>Rename</span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-400 focus:bg-red-50 focus:text-red-500"
                            onClick={() => deleteMemory(item.id)}
                          >
                            <Trash2 className="text-red-400" />
                            <span>Delete</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        </SidebarMenu>
      </SidebarGroup>

      <Dialog
        open={!!detailMemory}
        onOpenChange={(open) => !open && setDetailMemory(null)}
      >
        <DialogContent
          className="p-0 overflow-hidden gap-0 max-w-[96vw] flex flex-col"
          style={{
            width: `min(${size.width}px, 96vw)`,
            maxWidth: '96vw',
            height: `min(${size.height}px, 90vh)`,
          }}
        >
          {detailMemory && (
            <>
              <div className="flex h-full flex-col bg-white">
                <div className="flex items-center justify-between border-b px-5 py-4 shrink-0">
                  <div>
                    <DialogHeader className="p-0 text-left">
                      <DialogTitle className="text-base leading-snug break-words">
                        {detailMemory.name}
                      </DialogTitle>
                    </DialogHeader>
                    <p className="mt-1 text-xs text-neutral-500 break-words">
                      {detailMemory.instruction}
                    </p>
                    <p className="mt-2 text-xs text-neutral-400">
                      成功 {detailMemory.successMeta.successCount} 次 · 最近:{' '}
                      {formatDate(detailMemory.successMeta.lastSuccessAt)}
                    </p>
                  </div>
                  <button
                    className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100 transition-colors"
                    onClick={() => setDetailMemory(null)}
                  >
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>

                {detailMemory.steps.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
                    No step data recorded
                  </div>
                ) : (
                  <div className="flex flex-1 overflow-hidden">
                    <div className="w-56 border-r overflow-y-auto shrink-0">
                      {detailMemory.steps.map((step, i) => (
                        <button
                          key={`${detailMemory.id}_step_${i}`}
                          onClick={() => setSelectedStep(i)}
                          className={`w-full text-left px-3 py-2.5 border-b last:border-0 transition-colors ${
                            selectedStep === i
                              ? 'bg-blue-50 border-l-2 border-l-blue-500'
                              : 'hover:bg-neutral-50 border-l-2 border-l-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-neutral-400 shrink-0">
                              #{i + 1}
                            </span>
                            <span className="text-xs font-medium text-neutral-700 truncate">
                              {step.action_type}
                            </span>
                          </div>
                          <span className="text-xs text-neutral-400 mt-0.5 block truncate">
                            {formatActionInputs(
                              step.action_type,
                              step.action_inputs as Record<string, unknown>,
                            ) || '—'}
                          </span>
                        </button>
                      ))}
                    </div>

                    {detailStep && (
                      <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-neutral-50/50">
                        {detailStepImage && (
                          <div>
                            <p className="text-xs font-medium text-neutral-500 mb-2">
                              截图
                            </p>
                            <div className="max-h-[min(520px,calc(90vh-280px))] overflow-auto rounded-lg border bg-white">
                              <img
                                ref={detailImgRef}
                                src={detailStepImage}
                                alt={`${detailMemory.name}-step-${selectedStep + 1}`}
                                className="block w-full min-w-[720px] cursor-zoom-in object-contain"
                              />
                            </div>
                          </div>
                        )}

                        <div className="bg-neutral-50 rounded-lg p-3 max-h-48 overflow-auto">
                          <p className="text-xs font-medium text-neutral-500 mb-1">
                            操作
                          </p>
                          <span className="inline-block bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded mr-2">
                            {detailStep.action_type}
                          </span>
                          <span className="text-xs text-neutral-600 break-words">
                            {formatActionInputs(
                              detailStep.action_type,
                              detailStep.action_inputs as Record<
                                string,
                                unknown
                              >,
                            ) || '—'}
                          </span>
                        </div>

                        {detailStep.thought && (
                          <div>
                            <p className="text-xs font-medium text-neutral-500 mb-1">
                              思考过程
                            </p>
                            <p className="text-xs text-neutral-600 leading-relaxed bg-amber-50 border border-amber-100 rounded-lg p-3 whitespace-pre-wrap">
                              {detailStep.thought}
                            </p>
                          </div>
                        )}

                        {detailStep.reflection && (
                          <div>
                            <p className="text-xs font-medium text-neutral-500 mb-1">
                              反思
                            </p>
                            <p className="text-xs text-neutral-600 leading-relaxed bg-purple-50 border border-purple-100 rounded-lg p-3 whitespace-pre-wrap">
                              {detailStep.reflection}
                            </p>
                          </div>
                        )}

                        {showA11ySnapshot && (
                          <div>
                            <p className="text-xs font-medium text-neutral-500 mb-1">
                              无障碍树（当时提供给 VLM 的 A11Y_CONTEXT）
                            </p>
                            <pre className="text-xs text-neutral-600 leading-relaxed bg-white border rounded-lg p-3 whitespace-pre-wrap max-h-72 overflow-auto">
                              {detailStep.a11ySnapshot}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          {/* Width resize handle on the right edge. */}
          <div
            {...getResizeHandleProps('e')}
            className="group/resize absolute inset-y-0 right-0 w-3 cursor-ew-resize"
          >
            <div className="absolute right-0 top-1/2 h-16 w-1 -translate-y-1/2 rounded-l bg-neutral-200 opacity-0 transition-opacity group-hover/resize:opacity-100" />
          </div>
        </DialogContent>
      </Dialog>

      {recordDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-lg shadow-lg p-4 w-72">
            <div className="text-sm font-medium mb-2">录制操作</div>
            <div className="text-xs text-neutral-500 mb-3">
              输入任务描述，然后手动完成操作。按 Ctrl+S 保存，Ctrl+D 中断。
            </div>
            <input
              autoFocus
              className="w-full border rounded px-2 py-1.5 text-sm mb-3 outline-none focus:border-blue-400"
              placeholder="任务描述，例如：发送飞书消息给张三"
              value={recordInstruction}
              onChange={(e) => setRecordInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && recordInstruction.trim())
                  handleStartRecording();
                if (e.key === 'Escape') setRecordDialogOpen(false);
              }}
            />
            <div className="flex gap-2 justify-end">
              <button
                className="text-xs px-3 py-1.5 rounded border hover:bg-neutral-50"
                onClick={() => setRecordDialogOpen(false)}
              >
                取消
              </button>
              <button
                className="text-xs px-3 py-1.5 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                disabled={!recordInstruction.trim()}
                onClick={handleStartRecording}
              >
                开始录制
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
