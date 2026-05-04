import { useEffect, useState } from 'react';
import {
  MoreHorizontal,
  Trash2,
  Brain,
  ChevronRight,
  Pencil,
  Play,
  Circle,
  RefreshCw,
} from 'lucide-react';

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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@renderer/components/ui/sheet';
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
  const { isRecording } = useStore();
  const { setOpen, state } = useSidebar();

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
                        onClick={() => setDetailMemory(item)}
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

      <Sheet
        open={!!detailMemory}
        onOpenChange={(open) => !open && setDetailMemory(null)}
      >
        <SheetContent side="left" className="w-80 overflow-y-auto">
          {detailMemory && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base leading-snug break-words">
                  {detailMemory.name}
                </SheetTitle>
              </SheetHeader>

              <p className="mt-2 text-xs text-neutral-500 break-words">
                {detailMemory.instruction}
              </p>

              <p className="mt-3 text-xs text-neutral-400">
                成功 {detailMemory.successMeta.successCount} 次 · 最近:{' '}
                {formatDate(detailMemory.successMeta.lastSuccessAt)}
              </p>

              <div className="mt-4">
                <p className="text-xs font-medium text-neutral-600 mb-2">
                  操作步骤
                </p>
                <ol className="space-y-3">
                  {detailMemory.steps.map((step, i) => {
                    const detail = formatActionInputs(
                      step.action_type,
                      step.action_inputs as Record<string, unknown>,
                    );
                    return (
                      <li key={i} className="text-xs text-neutral-500">
                        <div className="font-medium text-neutral-700">
                          {i + 1}. [{step.action_type}]
                          {detail && (
                            <span className="ml-1 text-neutral-500 font-normal">
                              {detail}
                            </span>
                          )}
                        </div>
                        {step.thought && (
                          <div className="mt-0.5 pl-3 text-neutral-400 leading-relaxed">
                            {step.thought}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

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
