/**
 * 飞书UI自动标注服务
 * LLM粗标注 + 人工矫正流程
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@main/logger';
import { desktopCapturer, screen } from 'electron';
import { SettingStore } from '@main/store/setting';
import OpenAI from 'openai';

const execFileAsync = promisify(execFile);

export interface UIElement {
  id: string;
  type:
    | 'button'
    | 'input'
    | 'link'
    | 'checkbox'
    | 'radio'
    | 'dropdown'
    | 'tab'
    | 'menu'
    | 'icon'
    | 'container'
    | 'panel';
  name: string;
  description?: string;
  boundingBox: [number, number, number, number]; // [x1, y1, x2, y2]
  isInteractive: boolean;
  confidence: number;
  isCorrected: boolean;
  createdBy: 'llm' | 'human';
  parentId?: string; // 父元素ID，根元素为root
  children?: UIElement[]; // 子元素列表，实现嵌套树结构
}

export interface FeishuUIData {
  id: string;
  timestamp: number;
  screenshotPath: string; // 截图文件相对路径
  screenshotInfo: {
    width: number;
    height: number;
    scaleFactor: number;
  };
  pageType: string;
  elements: UIElement[];
  tags: string[];
}

const DATA_FILE_PATH = path.join(app.getPath('userData'), 'feishuData.json');
const IMAGES_DIR_PATH = path.join(app.getPath('userData'), 'feishuImages');
// 开发环境使用项目内的data目录
const DEV_DATA_FILE_PATH = path.join(__dirname, '../../data/feishuData.json');
const DEV_IMAGES_DIR_PATH = path.join(__dirname, '../../data/feishuImages');

/**
 * 获取数据文件路径
 */
function getDataFilePath(): string {
  return process.env.NODE_ENV === 'development'
    ? DEV_DATA_FILE_PATH
    : DATA_FILE_PATH;
}

/**
 * 获取图片存储目录路径
 */
function getImagesDirPath(): string {
  return process.env.NODE_ENV === 'development'
    ? DEV_IMAGES_DIR_PATH
    : IMAGES_DIR_PATH;
}

/**
 * 保存截图到文件
 */
async function saveScreenshot(base64: string, id: string): Promise<string> {
  const imagesDir = getImagesDirPath();
  // 确保目录存在
  await fs.mkdir(imagesDir, { recursive: true });

  const timestamp = Date.now();
  const fileName = `${timestamp}_${id}.jpg`;
  const filePath = path.join(imagesDir, fileName);

  // 保存图片
  const buffer = Buffer.from(base64, 'base64');
  await fs.writeFile(filePath, buffer);

  // 返回相对路径用于存储
  return fileName;
}

/**
 * 列出所有截图文件名
 */
export async function listAnnotationImages(): Promise<string[]> {
  try {
    const imagesDir = getImagesDirPath();
    const files = await fs.readdir(imagesDir);
    return files.filter((f) => f.endsWith('.jpg') || f.endsWith('.png')).sort();
  } catch {
    return [];
  }
}

/**
 * 读取截图文件并返回 base64 data URL
 */
export async function readAnnotationImage(
  filename: string,
): Promise<string | null> {
  try {
    const filePath = path.join(getImagesDirPath(), filename);
    const buffer = await fs.readFile(filePath);
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * 读取所有标注数据
 */
export async function readAnnotationData(): Promise<FeishuUIData[]> {
  try {
    const filePath = getDataFilePath();
    // 确保文件存在，不存在则创建
    try {
      await fs.access(filePath);
    } catch {
      // 文件不存在，初始化空数组
      await fs.writeFile(filePath, '[]', 'utf-8');
      return [];
    }
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as FeishuUIData[];
  } catch (error) {
    logger.error('读取标注数据失败:', error);
    return [];
  }
}

/**
 * 写入标注数据
 */
export async function writeAnnotationData(data: FeishuUIData[]): Promise<void> {
  try {
    const filePath = getDataFilePath();
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    logger.error('写入标注数据失败:', error);
    throw error;
  }
}

/**
 * 计算两个boundingBox的IOU（交并比）
 */
function calculateIOU(
  box1: [number, number, number, number],
  box2: [number, number, number, number],
): number {
  const x1 = Math.max(box1[0], box2[0]);
  const y1 = Math.max(box1[1], box2[1]);
  const x2 = Math.min(box1[2], box2[2]);
  const y2 = Math.min(box1[3], box2[3]);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const area1 = (box1[2] - box1[0]) * (box1[3] - box1[1]);
  const area2 = (box2[2] - box2[0]) * (box2[3] - box2[1]);
  const union = area1 + area2 - intersection;

  return union === 0 ? 0 : intersection / union;
}

/**
 * 扁平化嵌套的元素树为数组
 */
function flattenElements(
  elements: UIElement[],
  result: UIElement[] = [],
): UIElement[] {
  for (const el of elements) {
    result.push(el);
    if (el.children && el.children.length > 0) {
      flattenElements(el.children, result);
    }
  }
  return result;
}

/**
 * 合并新旧标注数据，相同元素保留置信度高的版本
 */
function mergeAnnotations(
  existingElements: UIElement[],
  newElements: Omit<UIElement, 'id' | 'isCorrected' | 'createdBy'>[],
): UIElement[] {
  const existingFlattened = flattenElements(existingElements);
  const mergedElements = new Map<string, UIElement>();

  // 先把现有元素加入map，人工矫正的元素优先级最高
  existingFlattened.forEach((el) => {
    mergedElements.set(el.id, el);
  });

  // 处理新元素
  for (const newEl of newElements) {
    let matched = false;

    // 查找匹配的现有元素
    for (const [id, existingEl] of mergedElements) {
      // 人工矫正的元素不替换
      if (existingEl.isCorrected) continue;

      // 匹配条件：类型相同、名称相似、IOU>0.7
      if (
        existingEl.type === newEl.type &&
        existingEl.name === newEl.name &&
        calculateIOU(existingEl.boundingBox, newEl.boundingBox) > 0.7
      ) {
        // 新元素置信度更高，替换
        if (newEl.confidence > existingEl.confidence) {
          mergedElements.set(id, {
            ...existingEl,
            ...newEl,
            id: existingEl.id, // 保留原有id
            isCorrected: existingEl.isCorrected,
            createdBy: existingEl.createdBy,
          });
        }
        matched = true;
        break;
      }
    }

    // 没有匹配到，作为新增元素
    if (!matched) {
      const newId = uuidv4();
      mergedElements.set(newId, {
        ...newEl,
        id: newId,
        isCorrected: false,
        createdBy: 'llm',
      });
    }
  }

  // 重新构建树结构
  const elementArray = Array.from(mergedElements.values());
  const elementMap = new Map<string, UIElement>();
  const rootElements: UIElement[] = [];

  elementArray.forEach((el) => {
    elementMap.set(el.id, { ...el, children: [] });
  });

  elementArray.forEach((el) => {
    const element = elementMap.get(el.id)!;
    if (el.parentId === 'root' || !elementMap.has(el.parentId!)) {
      rootElements.push(element);
    } else {
      const parent = elementMap.get(el.parentId!);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(element);
      }
    }
  });

  return rootElements;
}

/**
 * 保存合并后的标注数据（维护单一最新结果）
 */
export async function saveMergedAnnotationData(
  item: FeishuUIData,
): Promise<void> {
  const existingData = await readAnnotationData();

  if (existingData.length === 0) {
    // 没有数据，直接保存
    await writeAnnotationData([item]);
  } else {
    // 合并到最新的现有数据
    const latest = existingData[existingData.length - 1];
    const mergedElements = mergeAnnotations(latest.elements, item.elements);

    const mergedData: FeishuUIData = {
      ...latest,
      id: uuidv4(),
      timestamp: Date.now(),
      screenshotPath: item.screenshotPath, // 保留最新截图路径
      pageType: item.pageType || latest.pageType,
      elements: mergedElements,
    };

    // 只保留最新的合并结果
    await writeAnnotationData([mergedData]);
  }
}

/**
 * 查找飞书窗口位置和尺寸
 */
async function getFeishuWindowBounds(): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null> {
  try {
    // 使用PowerShell查找飞书窗口位置
    const script = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        [DllImport("user32.dll")]
        public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
        public struct RECT {
          public int Left;
          public int Top;
          public int Right;
          public int Bottom;
        }
      }
"@
      $hWnd = [Win32]::FindWindow("Chrome_WidgetWin_1", $null)
      if ($hWnd -eq [IntPtr]::Zero) {
        $hWnd = [Win32]::FindWindow("Lark", $null)
      }
      if ($hWnd -eq [IntPtr]::Zero) {
        Write-Output "NOT_FOUND"
        exit
      }
      $rect = New-Object Win32+RECT
      [Win32]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
      Write-Output "$($rect.Left),$($rect.Top),$($rect.Right - $rect.Left),$($rect.Bottom - $rect.Top)"
    `;

    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-NoLogo',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$Env:DISABLE_PSREADLINE=1; ${script}`,
      ],
      {
        timeout: 5000,
        env: {
          ...process.env,
          DISABLE_PSREADLINE: '1',
          __PSDisableModuleAnalysisCache: '1',
        },
      },
    );

    const output = stdout.trim();
    if (output === 'NOT_FOUND') {
      return null;
    }

    const [x, y, width, height] = output.split(',').map(Number);
    return { x, y, width, height };
  } catch (error) {
    logger.error('获取飞书窗口位置失败:', error);
    return null;
  }
}

/**
 * Bring an existing Feishu window to the foreground.
 * Returns true if the window was found and activated.
 * Uses process-name lookup (same approach as getDom.ts) to avoid matching other Chromium windows.
 */
export async function activateFeishuWindow(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  // Guard Add-Type so re-running in the same PS session doesn't throw "type already exists"
  const script = `
    if (-not ([System.Management.Automation.PSTypeName]'Win32FgHelper').Type) {
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32FgHelper {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
      }
"@
    }
    $procs = @(Get-Process -Name 'Feishu' -ErrorAction SilentlyContinue) + @(Get-Process -Name 'Lark' -ErrorAction SilentlyContinue)
    $mainProc = $procs | Where-Object { $_.MainWindowHandle -ne [System.IntPtr]::Zero } | Select-Object -First 1
    if (-not $mainProc) { Write-Output "NOT_FOUND"; exit }
    $hWnd = $mainProc.MainWindowHandle
    [Win32FgHelper]::ShowWindow($hWnd, 9) | Out-Null
    [Win32FgHelper]::ShowWindow($hWnd, 3) | Out-Null
    [Win32FgHelper]::SetForegroundWindow($hWnd) | Out-Null
    Write-Output "OK"
  `;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-NoLogo',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `$Env:DISABLE_PSREADLINE=1; ${script}`,
      ],
      {
        timeout: 8000,
        env: {
          ...process.env,
          DISABLE_PSREADLINE: '1',
          __PSDisableModuleAnalysisCache: '1',
        },
      },
    );
    return stdout.trim() === 'OK';
  } catch (e) {
    logger.warn('[activateFeishuWindow] Failed:', e);
    return false;
  }
}

/**
 * Ensure Feishu is running and in the foreground before the agent starts.
 * If already running, activates the window. If not, launches it and polls up to 10s.
 * Accepts optional setState/getState to surface launch progress in the Widget.
 */
export async function ensureFeishuForeground(
  setState?: (patch: Record<string, unknown>) => void,
): Promise<void> {
  if (process.platform !== 'win32') return;

  const setPhase = (label: string) => {
    setState?.({ memoryPhases: [{ id: 'feishu', label, status: 'active' }] });
  };

  setPhase('正在激活飞书...');
  const activated = await activateFeishuWindow();
  if (activated) {
    logger.info('[ensureFeishuForeground] Feishu window activated');
    setState?.({
      memoryPhases: [{ id: 'feishu', label: '飞书已就绪', status: 'done' }],
    });
    return;
  }

  const FEISHU_PATHS = [
    path.join(process.env.LOCALAPPDATA ?? '', 'Feishu', 'Feishu.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'Lark', 'Lark.exe'),
  ];

  let launchPath: string | null = null;
  for (const p of FEISHU_PATHS) {
    try {
      await fs.access(p);
      launchPath = p;
      break;
    } catch {
      /* not at this path */
    }
  }

  if (!launchPath) {
    logger.warn(
      '[ensureFeishuForeground] Feishu executable not found, skipping',
    );
    setState?.({
      memoryPhases: [
        { id: 'feishu', label: '未找到飞书，跳过', status: 'failed' },
      ],
    });
    return;
  }

  setPhase('正在启动飞书...');
  logger.info('[ensureFeishuForeground] Launching Feishu:', launchPath);
  const child = spawn(launchPath, [], { detached: true, stdio: 'ignore' });
  child.unref();

  const POLL_INTERVAL_MS = 500;
  const MAX_ATTEMPTS = 20;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const ok = await activateFeishuWindow();
    if (ok) {
      logger.info(
        '[ensureFeishuForeground] Feishu window appeared after',
        (i + 1) * POLL_INTERVAL_MS,
        'ms',
      );
      setState?.({
        memoryPhases: [{ id: 'feishu', label: '飞书已就绪', status: 'done' }],
      });
      return;
    }
  }

  logger.warn(
    '[ensureFeishuForeground] Feishu window did not appear within 10s',
  );
  setState?.({
    memoryPhases: [{ id: 'feishu', label: '飞书启动超时', status: 'failed' }],
  });
}

/**
 * 截取飞书窗口截图
 */
export async function captureFeishuWindow(): Promise<{
  base64: string;
  width: number;
  height: number;
  scaleFactor: number;
} | null> {
  try {
    const feishuBounds = await getFeishuWindowBounds();
    if (!feishuBounds) {
      logger.error('未找到飞书窗口');
      return null;
    }

    const primaryDisplay = screen.getPrimaryDisplay();
    const scaleFactor = primaryDisplay.scaleFactor;

    // 截取全屏后裁剪飞书窗口区域
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(primaryDisplay.size.width * scaleFactor),
        height: Math.round(primaryDisplay.size.height * scaleFactor),
      },
    });

    const primarySource = sources[0];
    if (!primarySource) {
      return null;
    }

    // 裁剪飞书窗口区域（crop 坐标需要物理像素）
    const feishuImage = primarySource.thumbnail.crop({
      x: Math.round(feishuBounds.x * scaleFactor),
      y: Math.round(feishuBounds.y * scaleFactor),
      width: Math.round(feishuBounds.width * scaleFactor),
      height: Math.round(feishuBounds.height * scaleFactor),
    });

    // 缩放回逻辑尺寸：确保图片实际像素与坐标范围一致，LLM 和前端统一使用逻辑坐标
    const logicalImage = feishuImage.resize({
      width: feishuBounds.width,
      height: feishuBounds.height,
    });

    return {
      base64: logicalImage.toJPEG(85).toString('base64'),
      width: feishuBounds.width, // 逻辑像素
      height: feishuBounds.height, // 逻辑像素
      scaleFactor,
    };
  } catch (error) {
    logger.error('截取飞书窗口失败:', error);
    return null;
  }
}

/**
 * LLM自动标注UI元素
 * 使用项目现有VLM配置进行实际标注
 */
export async function llmAnnotateUI(
  screenshotBase64: string,
  width: number,
  height: number,
): Promise<{
  pageType: string;
  elements: Omit<UIElement, 'id' | 'isCorrected' | 'createdBy'>[];
}> {
  const settings = SettingStore.getStore();

  if (!settings.vlmBaseUrl || !settings.vlmApiKey || !settings.vlmModelName) {
    throw new Error('VLM配置不完整，请先在设置中配置VLM模型参数');
  }

  const llmClient = new OpenAI({
    baseURL: settings.vlmBaseUrl,
    apiKey: settings.vlmApiKey,
  });

  const prompt = `
你是一个飞书UI元素标注专家，请先判断当前截图是否是飞书客户端界面，如果不是，请返回pageType: "not_feishu"，elements为空数组。

如果是飞书界面，请识别所有UI元素（包括容器类元素和可交互元素），并构建层级嵌套结构：

要求：
1. 首先确认是否为飞书界面，如果不是直接返回：{"pageType": "not_feishu", "elements": []}
2. 元素类型支持：button/input/link/checkbox/radio/dropdown/tab/menu/icon/container/panel
3. 每个元素返回：
   - type: 元素类型
   - name: 元素显示的文本或功能名称
   - description: 可选，元素功能描述
   - boundingBox: [x1, y1, x2, y2] 坐标，左上角和右下角的相对坐标，范围为0到图片宽高（图片宽${width}，高${height}）
   - isInteractive: 是否可交互
   - confidence: 置信度，0到1之间，标注越准确值越高
   - parentId: 父元素ID，根元素的parentId为"root"
4. 识别层级关系：容器包含子元素，子元素的boundingBox应该完全在父元素的boundingBox内部
5. 飞书页面类型可选：消息页/文档页/日历页/通讯录页/设置页/搜索页/其他
6. 严格返回JSON格式，不要有其他内容

返回格式示例：
{
  "pageType": "消息页",
  "elements": [
    {
      "type": "container",
      "name": "顶部导航栏",
      "parentId": "root",
      "boundingBox": [0, 0, 900, 60],
      "isInteractive": false,
      "confidence": 0.98
    },
    {
      "type": "button",
      "name": "发送",
      "parentId": "底部输入栏ID",
      "boundingBox": [800, 600, 850, 630],
      "isInteractive": true,
      "confidence": 0.95
    }
  ]
}
  `;

  try {
    const response = await llmClient.chat.completions.create({
      model: settings.vlmModelName,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${screenshotBase64}`,
              },
            },
          ],
        },
      ],
      // 移除response_format，部分模型不支持，通过prompt强制要求返回JSON
    });

    // 解析返回内容，支持从markdown代码块中提取JSON
    let content = response.choices[0].message.content || '';
    // 提取```json和```之间的内容
    const jsonMatch = content.match(/```json([\s\S]*?)```/);
    if (jsonMatch) {
      content = jsonMatch[1].trim();
    }
    // 也支持直接提取{}包裹的JSON
    const bracketMatch = content.match(/\{[\s\S]*\}/);
    if (bracketMatch) {
      content = bracketMatch[0].trim();
    }

    const result = JSON.parse(content);
    logger.info('LLM标注结果:', result);

    // 校验返回结果格式
    if (!result.elements || !Array.isArray(result.elements)) {
      throw new Error('LLM返回格式不正确，缺少elements数组');
    }

    // 如果不是飞书界面，直接返回空
    if (result.pageType === 'not_feishu') {
      logger.info('检测到非飞书界面，跳过标注');
      return {
        pageType: 'not_feishu',
        elements: [],
      };
    }

    // 给每个元素生成临时id
    const flatElements = result.elements.map((el: any) => ({
      id: uuidv4(),
      type: el.type || 'button',
      name: el.name || '未知元素',
      description: el.description,
      boundingBox:
        Array.isArray(el.boundingBox) && el.boundingBox.length === 4
          ? (el.boundingBox as [number, number, number, number])
          : [0, 0, 100, 100],
      isInteractive: el.isInteractive !== false,
      confidence:
        typeof el.confidence === 'number'
          ? Math.max(0, Math.min(1, el.confidence))
          : 0.5,
      parentId: 'root',
      children: [],
    }));

    // 自动通过boundingBox包含关系构建层级树
    // 判断元素A是否包含元素B
    const contains = (a: UIElement, b: UIElement): boolean => {
      return (
        a.boundingBox[0] <= b.boundingBox[0] &&
        a.boundingBox[1] <= b.boundingBox[1] &&
        a.boundingBox[2] >= b.boundingBox[2] &&
        a.boundingBox[3] >= b.boundingBox[3]
      );
    };

    // 计算每个元素的父元素
    for (let i = 0; i < flatElements.length; i++) {
      const child = flatElements[i];
      let parent: UIElement | null = null;

      // 找到包含当前元素的最小容器作为父元素
      for (let j = 0; j < flatElements.length; j++) {
        if (i === j) continue;
        const candidate = flatElements[j];
        if (contains(candidate, child)) {
          // 如果当前没有父元素，或者候选父元素更小（包含范围更小）
          if (
            !parent ||
            (contains(parent, candidate) && parent !== candidate)
          ) {
            parent = candidate;
          }
        }
      }

      if (parent) {
        child.parentId = parent.id;
        if (!parent.children) parent.children = [];
        parent.children.push(child);
      }
    }

    // 根元素是没有父元素的元素
    const rootElements = flatElements.filter((el) => el.parentId === 'root');

    return {
      pageType: result.pageType || '未知',
      elements: rootElements,
    };
  } catch (error) {
    logger.error('LLM标注失败:', error);
    throw error;
  }
}

/**
 * LLM对比新截图和历史数据，增量更新标注
 */
async function incrementalUpdateAnnotation(
  newScreenshotBase64: string,
  newAnnotation: {
    pageType: string;
    elements: Omit<UIElement, 'id' | 'isCorrected' | 'createdBy'>[];
  },
  screenshotPath: string,
  screenshotInfo: { width: number; height: number; scaleFactor: number },
): Promise<FeishuUIData> {
  const historyData = await readAnnotationData();

  // 如果没有历史数据，直接返回新标注
  if (historyData.length === 0) {
    return {
      id: uuidv4(),
      timestamp: Date.now(),
      screenshotPath,
      screenshotInfo,
      pageType: newAnnotation.pageType || '未知',
      elements: newAnnotation.elements.map((el) => ({
        ...el,
        id: uuidv4(),
        isCorrected: false,
        createdBy: 'llm',
      })),
      tags: [],
    };
  }

  // 获取最新的历史标注数据
  const latestHistory = historyData[historyData.length - 1];

  const settings = SettingStore.getStore();
  if (!settings.vlmBaseUrl || !settings.vlmApiKey || !settings.vlmModelName) {
    // 如果没有VLM配置，直接返回全新标注
    return {
      id: uuidv4(),
      timestamp: Date.now(),
      screenshotPath,
      screenshotInfo,
      pageType: newAnnotation.pageType || '未知',
      elements: newAnnotation.elements.map((el) => ({
        ...el,
        id: uuidv4(),
        isCorrected: false,
        createdBy: 'llm',
      })),
      tags: [],
    };
  }

  try {
    const llmClient = new OpenAI({
      baseURL: settings.vlmBaseUrl,
      apiKey: settings.vlmApiKey,
    });

    // 构造对比prompt，让LLM判断哪些元素需要更新
    const prompt = `
你是UI元素对比专家，请对比新截图和历史标注数据，输出增量更新结果。

历史标注数据：
${JSON.stringify(
  {
    pageType: latestHistory.pageType,
    elements: latestHistory.elements.map((el) => ({
      id: el.id,
      type: el.type,
      name: el.name,
      boundingBox: el.boundingBox,
      description: el.description,
    })),
  },
  null,
  2,
)}

要求：
1. 对比新截图和历史数据，识别：
   - 新增元素：历史数据中没有的元素
   - 修改元素：位置/文本/功能变化的元素
   - 删除元素：新截图中不存在的元素
   - 保持不变的元素：完全没有变化的元素
2. 返回完整的最新元素列表，包含所有保持不变、新增、修改的元素（删除的元素不要包含）
3. 对于保持不变和修改的元素，请保留原有id
4. 对于新增元素，id设为"new"，我会后续生成
5. 严格返回JSON格式，不要有其他内容

返回格式示例：
{
  "pageType": "当前页面类型",
  "elements": [
    {
      "id": "原有id或new",
      "type": "button",
      "name": "发送",
      "description": "发送消息",
      "boundingBox": [800, 600, 850, 630],
      "isInteractive": true,
      "confidence": 0.95
    }
  ]
}
    `;

    const response = await llmClient.chat.completions.create({
      model: settings.vlmModelName,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${newScreenshotBase64}`,
              },
            },
          ],
        },
      ],
      // 移除response_format，部分模型不支持，通过prompt强制要求返回JSON
    });

    // 解析返回内容，支持从markdown代码块中提取JSON
    let content = response.choices[0].message.content || '';
    // 提取```json和```之间的内容
    const jsonMatch = content.match(/```json([\s\S]*?)```/);
    if (jsonMatch) {
      content = jsonMatch[1].trim();
    }
    // 也支持直接提取{}包裹的JSON
    const bracketMatch = content.match(/\{[\s\S]*\}/);
    if (bracketMatch) {
      content = bracketMatch[0].trim();
    }

    const result = JSON.parse(content);

    // 处理返回的元素，生成正确的id
    const finalElements = (result.elements || []).map((el: any) => {
      if (el.id === 'new') {
        return {
          ...el,
          id: uuidv4(),
          isCorrected: false,
          createdBy: 'llm',
        };
      }
      // 保留原有元素的isCorrected和createdBy状态
      const existingEl = latestHistory.elements.find((e) => e.id === el.id);
      return {
        ...el,
        isCorrected: existingEl?.isCorrected || false,
        createdBy: existingEl?.createdBy || 'llm',
      };
    });

    return {
      id: uuidv4(),
      timestamp: Date.now(),
      screenshotPath,
      screenshotInfo,
      pageType: result.pageType || newAnnotation.pageType || '未知',
      elements: finalElements,
      tags: [],
    };
  } catch (error) {
    logger.error('增量更新失败，使用全新标注:', error);
    // 增量更新失败时回退到全新标注
    return {
      id: uuidv4(),
      timestamp: Date.now(),
      screenshotPath,
      screenshotInfo,
      pageType: newAnnotation.pageType || '未知',
      elements: newAnnotation.elements.map((el) => ({
        ...el,
        id: uuidv4(),
        isCorrected: false,
        createdBy: 'llm',
      })),
      tags: [],
    };
  }
}

/**
 * 执行完整的自动标注流程
 * @param existingScreenshot 可选，传入已有的截图base64和信息，避免重复截图
 */
export async function runAutoAnnotation(existingScreenshot?: {
  base64: string;
  width: number;
  height: number;
  scaleFactor: number;
}): Promise<FeishuUIData | null> {
  try {
    logger.info('开始飞书UI自动标注流程');

    // 使用传入的截图或自行截取飞书窗口
    let screenshot = existingScreenshot;
    if (!screenshot) {
      const capturedScreenshot = await captureFeishuWindow();
      if (!capturedScreenshot) {
        throw new Error('截取飞书窗口失败');
      }
      screenshot = capturedScreenshot;
    }

    // 2. 保存截图到文件
    const tempId = uuidv4();
    const screenshotPath = await saveScreenshot(screenshot.base64, tempId);
    logger.info('截图已保存到:', screenshotPath);

    // 3. LLM标注
    const annotationResult = await llmAnnotateUI(
      screenshot.base64,
      screenshot.width,
      screenshot.height,
    );

    // 如果是非飞书界面，直接返回null，不保存数据
    if (
      annotationResult.pageType === 'not_feishu' ||
      annotationResult.elements.length === 0
    ) {
      logger.info('非飞书界面或无有效元素，跳过保存');
      return null;
    }

    // 4. 增量更新标注数据
    const annotationData = await incrementalUpdateAnnotation(
      screenshot.base64,
      annotationResult,
      screenshotPath,
      {
        width: screenshot.width,
        height: screenshot.height,
        scaleFactor: screenshot.scaleFactor,
      },
    );

    // 5. 合并并保存数据（维护单一最新结果，置信度高的保留）
    await saveMergedAnnotationData(annotationData);
    logger.info('自动标注完成，数据已合并保存');

    return annotationData;
  } catch (error) {
    logger.error('自动标注流程失败:', error);
    // 标注失败不抛出错误，不影响主流程
    return null;
  }
}
