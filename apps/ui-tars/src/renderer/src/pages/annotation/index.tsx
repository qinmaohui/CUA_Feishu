import { useEffect, useState, useRef } from 'react';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import { Save, Trash2, Sparkles, Loader2 } from 'lucide-react';
import { Element, BoundingBox, FeishuData } from './types';
import { buildTree } from './treeUtils';
import { TreeList } from './TreeList';
import { EditDialog } from './EditDialog';

const AnnotationPage = () => {
  const [data, setData] = useState<FeishuData | null>(null);
  const [allImages, setAllImages] = useState<string[]>([]);
  const [currentScreenshot, setCurrentScreenshot] = useState('');
  const [selectedElement, setSelectedElement] = useState<Element | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editedElement, setEditedElement] = useState<Partial<Element>>({});
  const [scale, setScale] = useState(0.3);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);

  const [isDrawing, setIsDrawing] = useState(false);
  const [newBox, setNewBox] = useState<BoundingBox | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(
    null,
  );

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [longPressTimer, setLongPressTimer] = useState<ReturnType<
    typeof setTimeout
  > | null>(null);
  const [isDotDragging, setIsDotDragging] = useState(false);
  const dragStartPos = useRef<{
    mouseX: number;
    mouseY: number;
    cx: number;
    cy: number;
  } | null>(null);

  const [isAnnotating, setIsAnnotating] = useState(false);
  const [isMergeDialogOpen, setIsMergeDialogOpen] = useState(false);
  const [pendingElements, setPendingElements] = useState<Element[]>([]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const result =
          await window.electron.ipcRenderer.invoke('annotation:read');
        if (result && result.length > 0) {
          setData(result[0]);
          setCurrentScreenshot(result[0].screenshotPath);
        }
        const images = await window.electron.ipcRenderer.invoke(
          'annotation:listImages',
        );
        setAllImages(images || []);
      } catch (error) {
        console.error('加载数据失败:', error);
      }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (!currentScreenshot) return;
    window.electron.ipcRenderer
      .invoke('annotation:getImage', currentScreenshot)
      .then((dataUrl: string | null) => {
        if (dataUrl) setScreenshotDataUrl(dataUrl);
      });
  }, [currentScreenshot]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setScale((prev) => Math.max(0.1, Math.min(3, prev + delta)));
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [data]);

  const saveData = async () => {
    if (!data) return;
    try {
      await window.electron.ipcRenderer.invoke('annotation:write', [data]);
      alert('数据保存成功！');
    } catch {
      alert('保存失败，请检查权限！');
    }
  };

  const clearElements = () => {
    if (!data) return;
    if (!confirm('确认清空所有元素？')) return;
    setData({ ...data, elements: [] });
  };

  const runAiAnnotate = async () => {
    if (!data) return;
    setIsAnnotating(true);
    try {
      const result = await window.electron.ipcRenderer.invoke(
        'annotation:annotate',
        currentScreenshot,
        data.screenshotInfo,
      );
      if (
        !result ||
        result.pageType === 'not_feishu' ||
        result.elements.length === 0
      ) {
        alert('AI未识别到有效元素');
        return;
      }
      const newEls: Element[] = result.elements.map((el: any) => ({
        ...el,
        id: el.id || crypto.randomUUID(),
        isCorrected: false,
        createdBy: 'llm',
        children: [],
      }));
      setPendingElements(newEls);
      setIsMergeDialogOpen(true);
    } catch (e: any) {
      alert('AI标注失败：' + (e?.message || e));
    } finally {
      setIsAnnotating(false);
    }
  };

  const applyMerge = (strategy: 'overwrite' | 'merge') => {
    if (!data) return;
    if (strategy === 'overwrite') {
      setData({ ...data, elements: pendingElements });
    } else {
      // merge: keep existing elements whose center overlaps with a new element, add truly new ones
      const IOU_THRESHOLD = 0.3;
      const overlap = (a: Element, b: Element) => {
        const ix1 = Math.max(a.boundingBox[0], b.boundingBox[0]);
        const iy1 = Math.max(a.boundingBox[1], b.boundingBox[1]);
        const ix2 = Math.min(a.boundingBox[2], b.boundingBox[2]);
        const iy2 = Math.min(a.boundingBox[3], b.boundingBox[3]);
        const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
        if (inter === 0) return 0;
        const aArea =
          (a.boundingBox[2] - a.boundingBox[0]) *
          (a.boundingBox[3] - a.boundingBox[1]);
        const bArea =
          (b.boundingBox[2] - b.boundingBox[0]) *
          (b.boundingBox[3] - b.boundingBox[1]);
        return inter / (aArea + bArea - inter);
      };
      const matched = new Set<string>();
      for (const existing of data.elements) {
        for (const newEl of pendingElements) {
          if (overlap(existing, newEl) > IOU_THRESHOLD) {
            matched.add(newEl.id);
            break;
          }
        }
      }
      const toAdd = pendingElements.filter((el) => !matched.has(el.id));
      setData({ ...data, elements: [...data.elements, ...toAdd] });
    }
    setIsMergeDialogOpen(false);
    setPendingElements([]);
  };

  const handleElementClick = (element: Element) => {
    setSelectedElement(element);
    setEditedElement({ ...element });
    setIsEditDialogOpen(true);
  };

  const saveEditedElement = () => {
    if (!data || !selectedElement) return;
    setData({
      ...data,
      elements: data.elements.map((el) =>
        el.id === selectedElement.id
          ? { ...el, ...editedElement, isCorrected: true }
          : el,
      ),
    });
    setIsEditDialogOpen(false);
    setSelectedElement(null);
    setEditedElement({});
  };

  const deleteElement = () => {
    if (!data || !selectedElement) return;
    setData({
      ...data,
      elements: data.elements.filter((el) => el.id !== selectedElement.id),
    });
    setIsEditDialogOpen(false);
    setSelectedElement(null);
    setEditedElement({});
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (isDotDragging) return;
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    setDrawStart({ x, y });
    setIsDrawing(true);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (
      isDotDragging &&
      draggingId &&
      dragStartPos.current &&
      canvasRef.current &&
      data
    ) {
      const rect = canvasRef.current.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const dx = (mouseX - dragStartPos.current.mouseX) / scale;
      const dy = (mouseY - dragStartPos.current.mouseY) / scale;
      const newCx = dragStartPos.current.cx + dx;
      const newCy = dragStartPos.current.cy + dy;
      setData({
        ...data,
        elements: data.elements.map((el) => {
          if (el.id !== draggingId) return el;
          const hw = (el.boundingBox[2] - el.boundingBox[0]) / 2;
          const hh = (el.boundingBox[3] - el.boundingBox[1]) / 2;
          return {
            ...el,
            boundingBox: [newCx - hw, newCy - hh, newCx + hw, newCy + hh] as [
              number,
              number,
              number,
              number,
            ],
            isCorrected: true,
          };
        }),
      });
      return;
    }

    if (!isDrawing || !drawStart || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / scale;
    const cy = (e.clientY - rect.top) / scale;
    setNewBox({
      x: Math.min(drawStart.x, cx),
      y: Math.min(drawStart.y, cy),
      width: Math.abs(cx - drawStart.x),
      height: Math.abs(cy - drawStart.y),
    });
  };

  const handleCanvasMouseUp = () => {
    if (isDotDragging) {
      setIsDotDragging(false);
      setDraggingId(null);
      dragStartPos.current = null;
      return;
    }

    if (!isDrawing || !newBox || newBox.width < 5 || newBox.height < 5) {
      setIsDrawing(false);
      setNewBox(null);
      setDrawStart(null);
      return;
    }
    const newElement: Element = {
      id: crypto.randomUUID(),
      type: 'container',
      name: '新元素',
      boundingBox: [
        newBox.x,
        newBox.y,
        newBox.x + newBox.width,
        newBox.y + newBox.height,
      ],
      isInteractive: true,
      confidence: 1,
      isCorrected: true,
      createdBy: 'human',
      description: '',
      children: [],
    };
    setEditedElement(newElement);
    setSelectedElement(newElement);
    setIsEditDialogOpen(true);
    setIsDrawing(false);
    setNewBox(null);
    setDrawStart(null);
  };

  const handleDotMouseDown = (e: React.MouseEvent, el: Element) => {
    e.stopPropagation();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const cx = (el.boundingBox[0] + el.boundingBox[2]) / 2;
    const cy = (el.boundingBox[1] + el.boundingBox[3]) / 2;
    const timer = setTimeout(() => {
      setDraggingId(el.id);
      setIsDotDragging(true);
      dragStartPos.current = { mouseX, mouseY, cx, cy };
    }, 300);
    setLongPressTimer(timer);
  };

  const handleDotMouseUp = (e: React.MouseEvent, el: Element) => {
    e.stopPropagation();
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      setLongPressTimer(null);
    }
    if (isDotDragging) {
      setIsDotDragging(false);
      setDraggingId(null);
      dragStartPos.current = null;
      return;
    }
    handleElementClick(el);
  };

  const addNewElement = () => {
    if (!data || !editedElement) return;
    setData({
      ...data,
      elements: [...data.elements, editedElement as Element],
    });
    setIsEditDialogOpen(false);
    setSelectedElement(null);
    setEditedElement({});
  };

  if (!data)
    return (
      <div className="flex items-center justify-center h-screen">加载中...</div>
    );

  const isNewElement =
    selectedElement?.createdBy === 'human' && selectedElement.name === '新元素';
  // screenshotInfo.width/height 已经是逻辑像素，直接使用
  const logicalWidth = data.screenshotInfo.width;
  const logicalHeight = data.screenshotInfo.height;

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Left: Canvas area */}
      <div className="flex-1 p-4 flex flex-col gap-3 min-w-0 overflow-hidden">
        <div className="flex items-center gap-4 flex-shrink-0">
          <h1 className="text-xl font-bold">飞书标注检查工具</h1>
          <Button
            onClick={saveData}
            size="sm"
            className="flex items-center gap-1"
          >
            <Save size={14} />
            保存数据
          </Button>
          <Button
            onClick={clearElements}
            size="sm"
            variant="outline"
            className="flex items-center gap-1 text-red-600 border-red-300 hover:bg-red-50"
          >
            <Trash2 size={14} />
            清空元素
          </Button>
          <Button
            onClick={runAiAnnotate}
            size="sm"
            variant="outline"
            disabled={isAnnotating}
            className="flex items-center gap-1 text-purple-600 border-purple-300 hover:bg-purple-50"
          >
            {isAnnotating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
            AI标注
          </Button>
          <span className="text-sm text-gray-500">
            缩放: {Math.round(scale * 100)}%（滚轮缩放）
          </span>
        </div>

        {/* Canvas with rulers */}
        <div className="flex-1 overflow-auto border border-gray-300 rounded bg-gray-200 relative">
          <div
            className="sticky top-0 left-0 z-30 bg-gray-300 border-b border-r border-gray-400"
            style={{ width: 32, height: 24, position: 'sticky', float: 'left' }}
          />

          <div
            className="sticky top-0 z-20 bg-gray-300 border-b border-gray-400 overflow-hidden"
            style={{ height: 24, marginLeft: 32 }}
          >
            <svg
              width={logicalWidth * scale}
              height={24}
              style={{ display: 'block' }}
            >
              {Array.from(
                { length: Math.ceil(logicalWidth / 100) + 1 },
                (_, i) => i * 100,
              ).map((v) => (
                <g key={v}>
                  <line
                    x1={v * scale}
                    y1={14}
                    x2={v * scale}
                    y2={24}
                    stroke="#888"
                    strokeWidth={1}
                  />
                  <text x={v * scale + 2} y={12} fontSize={9} fill="#555">
                    {v}
                  </text>
                </g>
              ))}
              {Array.from(
                { length: Math.ceil(logicalWidth / 50) + 1 },
                (_, i) => i * 50,
              )
                .filter((v) => v % 100 !== 0)
                .map((v) => (
                  <line
                    key={v}
                    x1={v * scale}
                    y1={18}
                    x2={v * scale}
                    y2={24}
                    stroke="#aaa"
                    strokeWidth={1}
                  />
                ))}
            </svg>
          </div>

          <div className="flex" style={{ marginTop: -24 }}>
            <div
              className="sticky left-0 z-20 bg-gray-300 border-r border-gray-400 flex-shrink-0 overflow-hidden"
              style={{ width: 32, marginTop: 24 }}
            >
              <svg
                width={32}
                height={logicalHeight * scale}
                style={{ display: 'block' }}
              >
                {Array.from(
                  { length: Math.ceil(logicalHeight / 100) + 1 },
                  (_, i) => i * 100,
                ).map((v) => (
                  <g key={v}>
                    <line
                      x1={18}
                      y1={v * scale}
                      x2={32}
                      y2={v * scale}
                      stroke="#888"
                      strokeWidth={1}
                    />
                    <text
                      x={16}
                      y={v * scale + 3}
                      fontSize={9}
                      fill="#555"
                      textAnchor="end"
                      transform={`rotate(-90, 16, ${v * scale})`}
                    >
                      {v}
                    </text>
                  </g>
                ))}
                {Array.from(
                  { length: Math.ceil(logicalHeight / 50) + 1 },
                  (_, i) => i * 50,
                )
                  .filter((v) => v % 100 !== 0)
                  .map((v) => (
                    <line
                      key={v}
                      x1={24}
                      y1={v * scale}
                      x2={32}
                      y2={v * scale}
                      stroke="#aaa"
                      strokeWidth={1}
                    />
                  ))}
              </svg>
            </div>

            <div style={{ marginTop: 24 }}>
              <div
                ref={canvasRef}
                className="relative cursor-crosshair"
                style={{
                  width: logicalWidth * scale,
                  height: logicalHeight * scale,
                  backgroundImage: screenshotDataUrl
                    ? `url(${screenshotDataUrl})`
                    : 'none',
                  backgroundSize: '100% 100%',
                  backgroundRepeat: 'no-repeat',
                }}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
              >
                {data.elements
                  .filter((el) => el.isInteractive)
                  .map((el) => {
                    const [x1, y1, x2, y2] = el.boundingBox;
                    const isSelected = selectedElement?.id === el.id;
                    const isDragging = draggingId === el.id;

                    if (el.type === 'container') {
                      return (
                        <div
                          key={el.id}
                          className={`absolute border-2 rounded-sm pointer-events-none ${
                            isSelected
                              ? 'border-red-500 bg-red-500/10'
                              : 'border-indigo-500 bg-indigo-500/10'
                          }`}
                          style={{
                            left: x1 * scale,
                            top: y1 * scale,
                            width: (x2 - x1) * scale,
                            height: (y2 - y1) * scale,
                            zIndex: 5,
                          }}
                          title={`${el.name}\n区域`}
                        />
                      );
                    }

                    const cx = ((x1 + x2) / 2) * scale;
                    const cy = ((y1 + y2) / 2) * scale;
                    const size = isSelected || isDragging ? 14 : 8;

                    return (
                      <div
                        key={el.id}
                        className={`absolute rounded-full border-2 border-white shadow-md select-none ${
                          isDragging
                            ? 'cursor-grabbing bg-orange-500'
                            : isSelected
                              ? 'cursor-pointer bg-red-500'
                              : el.isCorrected
                                ? 'cursor-pointer bg-green-500'
                                : 'cursor-pointer bg-blue-500'
                        }`}
                        style={{
                          left: cx - size / 2,
                          top: cy - size / 2,
                          width: size,
                          height: size,
                          zIndex: isDragging ? 20 : 10,
                        }}
                        onMouseDown={(e) => handleDotMouseDown(e, el)}
                        onMouseUp={(e) => handleDotMouseUp(e, el)}
                        title={`${el.name}\n类型: ${el.type}\n置信度: ${(el.confidence * 100).toFixed(0)}%\n长按拖拽移动`}
                      />
                    );
                  })}

                {newBox && isDrawing && (
                  <div
                    className="absolute border-2 border-dashed border-yellow-500 bg-yellow-500/10 pointer-events-none"
                    style={{
                      left: newBox.x * scale,
                      top: newBox.y * scale,
                      width: newBox.width * scale,
                      height: newBox.height * scale,
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Screenshot switcher */}
        <div className="flex-shrink-0 flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500 whitespace-nowrap">
            切换截图:
          </span>
          {allImages.map((img) => (
            <button
              key={img}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                currentScreenshot === img
                  ? 'bg-blue-500 text-white border-blue-500'
                  : 'bg-white border-gray-300 hover:border-blue-400'
              }`}
              onClick={() => setCurrentScreenshot(img)}
              title={img}
            >
              {new Date(parseInt(img.split('_')[0])).toLocaleTimeString()}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Tree element list */}
      <div className="w-72 bg-white border-l border-gray-200 p-4 flex flex-col">
        <div className="mb-3 flex items-center justify-between flex-shrink-0">
          <h2 className="text-lg font-semibold">元素列表</h2>
          <div className="text-sm text-gray-500">{data.elements.length} 个</div>
        </div>
        <ScrollArea className="flex-1">
          <TreeList
            nodes={buildTree(data.elements)}
            selectedId={selectedElement?.id ?? null}
            onSelect={handleElementClick}
          />
        </ScrollArea>
      </div>

      <EditDialog
        isOpen={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        isNewElement={isNewElement}
        editedElement={editedElement}
        setEditedElement={setEditedElement}
        onSave={saveEditedElement}
        onAdd={addNewElement}
        onDelete={deleteElement}
      />

      <Dialog open={isMergeDialogOpen} onOpenChange={setIsMergeDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>AI标注完成</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-600 py-2">
            识别到{' '}
            <span className="font-semibold">{pendingElements.length}</span>{' '}
            个元素，请选择合并策略：
          </p>
          <DialogFooter className="flex gap-2 sm:justify-start">
            <Button
              onClick={() => applyMerge('overwrite')}
              variant="destructive"
              size="sm"
            >
              覆盖（替换全部）
            </Button>
            <Button onClick={() => applyMerge('merge')} size="sm">
              合并（保留原有，新增不重叠的）
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AnnotationPage;
