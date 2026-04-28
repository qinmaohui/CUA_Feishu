import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Switch } from '../../components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Trash2 } from 'lucide-react';
import { Element } from './types';

interface EditDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isNewElement: boolean;
  editedElement: Partial<Element>;
  setEditedElement: (el: Partial<Element>) => void;
  onSave: () => void;
  onAdd: () => void;
  onDelete: () => void;
}

export function EditDialog({
  isOpen,
  onOpenChange,
  isNewElement,
  editedElement,
  setEditedElement,
  onSave,
  onAdd,
  onDelete,
}: EditDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isNewElement ? '添加新元素' : '编辑元素'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              元素名称
            </Label>
            <Input
              id="name"
              value={editedElement.name || ''}
              onChange={(e) =>
                setEditedElement({ ...editedElement, name: e.target.value })
              }
              className="col-span-3"
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="type" className="text-right">
              元素类型
            </Label>
            <Select
              value={editedElement.type || 'container'}
              onValueChange={(value) =>
                setEditedElement({ ...editedElement, type: value })
              }
            >
              <SelectTrigger className="col-span-3">
                <SelectValue placeholder="选择元素类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="container">容器</SelectItem>
                <SelectItem value="button">按钮</SelectItem>
                <SelectItem value="input">输入框</SelectItem>
                <SelectItem value="indicator">指示器</SelectItem>
                <SelectItem value="text">文本</SelectItem>
                <SelectItem value="image">图片</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="description" className="text-right">
              描述
            </Label>
            <Textarea
              id="description"
              value={editedElement.description || ''}
              onChange={(e) =>
                setEditedElement({
                  ...editedElement,
                  description: e.target.value,
                })
              }
              className="col-span-3"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="isInteractive" className="text-right">
              是否可交互
            </Label>
            <div className="flex items-center space-x-2 col-span-3">
              <Switch
                id="isInteractive"
                checked={editedElement.isInteractive ?? true}
                onCheckedChange={(checked) =>
                  setEditedElement({ ...editedElement, isInteractive: checked })
                }
              />
              <Label htmlFor="isInteractive">
                {editedElement.isInteractive ? '是' : '否'}
              </Label>
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">坐标信息</Label>
            <div className="col-span-3 space-y-2">
              {editedElement.boundingBox &&
                (() => {
                  const [bx1, by1, bx2, by2] = editedElement.boundingBox;
                  const isContainer = editedElement.type === 'container';
                  const cx = (bx1 + bx2) / 2;
                  const cy = (by1 + by2) / 2;
                  const update = (
                    patch: Partial<{
                      x: number;
                      y: number;
                      w: number;
                      h: number;
                    }>,
                  ) => {
                    if (isContainer) {
                      const x = patch.x ?? bx1;
                      const y = patch.y ?? by1;
                      const w = patch.w ?? bx2 - bx1;
                      const h = patch.h ?? by2 - by1;
                      setEditedElement({
                        ...editedElement,
                        boundingBox: [x, y, x + w, y + h],
                      });
                    } else {
                      const ncx = patch.x ?? cx;
                      const ncy = patch.y ?? cy;
                      const hw = (bx2 - bx1) / 2;
                      const hh = (by2 - by1) / 2;
                      setEditedElement({
                        ...editedElement,
                        boundingBox: [ncx - hw, ncy - hh, ncx + hw, ncy + hh],
                      });
                    }
                  };
                  return (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <Label className="text-xs text-gray-500">
                          {isContainer ? 'X' : '中心X'}
                        </Label>
                        <Input
                          type="number"
                          value={Math.round(isContainer ? bx1 : cx)}
                          onChange={(e) =>
                            update({ x: Number(e.target.value) })
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="flex-1">
                        <Label className="text-xs text-gray-500">
                          {isContainer ? 'Y' : '中心Y'}
                        </Label>
                        <Input
                          type="number"
                          value={Math.round(isContainer ? by1 : cy)}
                          onChange={(e) =>
                            update({ y: Number(e.target.value) })
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      {isContainer && (
                        <>
                          <div className="flex-1">
                            <Label className="text-xs text-gray-500">宽</Label>
                            <Input
                              type="number"
                              value={Math.round(bx2 - bx1)}
                              onChange={(e) =>
                                update({ w: Number(e.target.value) })
                              }
                              className="h-7 text-xs"
                            />
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs text-gray-500">高</Label>
                            <Input
                              type="number"
                              value={Math.round(by2 - by1)}
                              onChange={(e) =>
                                update({ h: Number(e.target.value) })
                              }
                              className="h-7 text-xs"
                            />
                          </div>
                        </>
                      )}
                    </div>
                  );
                })()}
            </div>
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">置信度</Label>
            <div className="col-span-3 text-sm text-gray-600">
              {(editedElement.confidence
                ? editedElement.confidence * 100
                : 100
              ).toFixed(0)}
              %
            </div>
          </div>
        </div>
        <DialogFooter className="flex justify-between">
          <Button
            type="button"
            variant="destructive"
            onClick={onDelete}
            className="mr-auto"
          >
            <Trash2 size={16} className="mr-2" />
            删除元素
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="button" onClick={isNewElement ? onAdd : onSave}>
              {isNewElement ? '添加' : '保存'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
