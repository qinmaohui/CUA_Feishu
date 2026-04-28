export interface TreeNode {
  element: Element;
  children: TreeNode[];
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Element {
  id: string;
  type: string;
  name: string;
  boundingBox: [number, number, number, number];
  isInteractive: boolean;
  confidence: number;
  isCorrected: boolean;
  createdBy: string;
  description: string;
  children: any[];
}

export interface FeishuData {
  id: string;
  timestamp: number;
  screenshotPath: string;
  screenshotInfo: { width: number; height: number; scaleFactor: number };
  pageType: string;
  elements: Element[];
  tags: string[];
}
