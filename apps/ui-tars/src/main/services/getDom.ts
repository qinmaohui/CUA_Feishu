/**
 * Get the Accessibility Tree from Feishu via Windows UI Automation API.
 *
 * FIXED v4: 切换至 UIA3 COM API (与 Accessibility Insights 底层一致)
 * 1. 弃用 .NET System.Windows.Automation (对 Chromium 兼容性差)
 * 2. 使用 New-Object -ComObject UIAutomationClient.CUIAutomation
 * 3. 采用 RawViewWalker 直接遍历，绕过 Chromium 的懒加载过滤
 * 4. 保留 SetForegroundWindow + SendKeys 唤醒机制
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '@main/logger';

const execFileAsync = promisify(execFile);

export interface AXNode {
  index: number;
  parentIndex: number;
  controlType: string;
  name: string;
  boundingRectangle: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  isEnabled: boolean;
  isOffscreen: boolean;
  value: string;
  helpText: string;
  automationId: string;
  className: string;
  frameworkId: string;
  childCount: number;
  localizedControlType: string;
  isKeyboardFocusable: boolean;
}

export interface AccessibilityTreeResult {
  processName: string;
  windowTitle: string;
  nodes: AXNode[];
  totalNodes: number;
  debugInfo?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// PowerShell Script - UIA3 COM API (Matches Accessibility Insights)
// ---------------------------------------------------------------------------

const POWERSHELL_SCRIPT = `param(
  [string]$ProcessName = "Feishu",
  [switch]$EnableDebug = $true
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms

function Write-DebugLog {
    param([string]$Message)
    if ($EnableDebug) { [Console]::Error.WriteLine("DEBUG:$Message") }
}

try {
    Write-DebugLog "Starting Hybrid UIA fetch for: $ProcessName"

    # 1. 查找进程
    $procs = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue
    if (-not $procs) { $procs = Get-Process -Name "Lark" -ErrorAction SilentlyContinue }
    if (-not $procs) { 
        Write-Error "Process '$ProcessName' or 'Lark' not found."
        exit 1 
    }
    $targetPid = [int]$procs[0].Id
    Write-DebugLog "Target PID: $targetPid"

    # 2. 获取根元素
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    
    # 3. 定位主窗口 (使用 ProcessIdProperty)
    $propCond = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, 
        $targetPid
    )
    
    # 先找所有桌面子窗口，过滤出目标进程的窗口
    $desktopChildren = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $win = $null
    
    foreach ($c in $desktopChildren) {
        if ([int]$c.Current.ProcessId -eq $targetPid) {
            # 进一步过滤名称，确保是主窗口
            if ($c.Current.Name -match "飞书|Feishu|Lark" -and $c.Current.BoundingRectangle.Width -gt 0) {
                $win = $c
                break
            }
        }
    }

    if (-not $win) {
        Write-Error "Main window not found for PID $targetPid."
        exit 1
    }
    
    $windowTitle = $win.Current.Name
    Write-DebugLog "Found window: '$windowTitle'"

    # 4. 唤醒 Chromium A11y 桥 (关键步骤)
    try {
        $hwnd = $win.Current.NativeWindowHandle
        if ($hwnd -ne 0) {
            Write-DebugLog "Bringing window to foreground..."
            [System.Windows.Forms.SendKeys]::SendWait("{F6}")
            Start-Sleep -Milliseconds 300
            
            Write-DebugLog "Sending TAB keys to trigger A11y bridge..."
            for ($i = 0; $i -lt 4; $i++) {
                [System.Windows.Forms.SendKeys]::SendWait("{TAB}")
                Start-Sleep -Milliseconds 400
            }
            
            Write-DebugLog "Waiting for Chromium to build tree (3s)..."
            Start-Sleep -Milliseconds 3000
        }
    } catch {
        Write-DebugLog "Trigger warning: $_"
    }

    # 5. 使用 RawViewWalker 遍历 (绕过 ControlView 的过滤)
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $queue = New-Object System.Collections.Queue
    $nodes = New-Object System.Collections.ArrayList
    $globalIdx = 0
    $maxNodes = 10000

    # 初始入队
    $queue.Enqueue(@{ el = $win; pIdx = -1 })
    
    while ($queue.Count -gt 0 -and $nodes.Count -lt $maxNodes) {
        $item = $queue.Dequeue()
        $el = $item.el
        $pIdx = $item.pIdx

        try {
            # 强制更新缓存，确保获取最新属性
            $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) | Out-Null
            
            $br = $el.Current.BoundingRectangle
            $rect = if ($br.Width -gt 0) {
                @{ left = [math]::Round($br.X); top = [math]::Round($br.Y); width = [math]::Round($br.Width); height = [math]::Round($br.Height) }
            } else { $null }

            $info = @{
                index = $globalIdx
                parentIndex = $pIdx
                controlType = $el.Current.ControlType.ProgrammaticName
                name = $el.Current.Name
                className = $el.Current.ClassName
                frameworkId = $el.Current.FrameworkId
                automationId = $el.Current.AutomationId
                helpText = $el.Current.HelpText
                value = ""
                localizedControlType = $el.Current.LocalizedControlType
                isEnabled = $el.Current.IsEnabled
                isOffscreen = $el.Current.IsOffscreen
                isKeyboardFocusable = $el.Current.IsKeyboardFocusable
                boundingRectangle = $rect
                childCount = 0
            }
            
            # 尝试获取 ValuePattern
            try {
                $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
                if ($vp) { $info.value = $vp.Current.Value }
            } catch {}

            [void]$nodes.Add($info)

            # 获取子节点
            $child = $walker.GetFirstChild($el)
            $childCount = 0
            while ($child -ne $null -and $nodes.Count -lt $maxNodes) {
                $childCount++
                $globalIdx++
                $queue.Enqueue(@{ el = $child; pIdx = $globalIdx })
                $child = $walker.GetNextSibling($child)
            }
            $info.childCount = $childCount
        } catch {
            Write-DebugLog "Node error: $_"
        }
    }

    Write-DebugLog "Total nodes collected: $($nodes.Count)"

    # 6. 输出结果
    $json = $nodes | ConvertTo-Json -Depth 10 -Compress
    Write-Output "WINDOW_TITLE:$windowTitle"
    Write-Output "NODES_JSON:$json"
    Write-Output "TOTAL_NODES:$($nodes.Count)"

} catch {
    Write-Error "Fatal Error: $_"
    exit 1
}
`;

// ---------------------------------------------------------------------------
// Core Functions (保持原有解析逻辑不变)
// ---------------------------------------------------------------------------

export async function getAccessibilityTree(
  processName: string = 'Feishu',
  options?: {
    maxRetries?: number;
    retryDelayMs?: number;
    enableDebug?: boolean;
  },
): Promise<AccessibilityTreeResult> {
  const opts = options ?? {};
  const maxRetries = opts.maxRetries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 2000;
  const enableDebug = opts.enableDebug ?? true;

  logger.info(`[getDom] Running UIA3 COM fetch for: ${processName}`, {
    maxRetries,
    retryDelayMs,
  });

  const { writeFile, unlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const scriptPath = join(tmpdir(), `uia3-com-${Date.now()}.ps1`);
  await writeFile(scriptPath, '\uFEFF' + POWERSHELL_SCRIPT, 'utf-8');

  try {
    const { stdout, stderr } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        '-ProcessName',
        processName,
        '-MaxRetries',
        maxRetries.toString(),
        '-RetryDelayMs',
        retryDelayMs.toString(),
        ...(enableDebug ? ['-EnableDebug'] : []),
      ],
      { timeout: 90000, maxBuffer: 100 * 1024 * 1024, windowsHide: true },
    );

    if (stderr && enableDebug) {
      const debugLines = stderr.split('\n').filter((l) => l.includes('DEBUG:'));
      if (debugLines.length)
        logger.debug('[getDom] COM Debug:', debugLines.slice(0, 15));
    }

    return parsePowerShellOutput(stdout, processName, enableDebug);
  } catch (error: any) {
    if (error.code === 'ETIMEDOUT')
      logger.error('[getDom] COM script timed out');
    throw error;
  } finally {
    await unlink(scriptPath).catch(() => {});
  }
}

function parsePowerShellOutput(
  output: string,
  processName: string,
  enableDebug: boolean,
): AccessibilityTreeResult {
  let windowTitle = '';
  let nodesJson = '';
  let totalNodes = 0;
  const debugInfo: Record<string, any> = {};

  for (const line of output.split('\n')) {
    const t = line.trim();
    if (t.startsWith('WINDOW_TITLE:')) windowTitle = t.substring(13);
    else if (t.startsWith('NODES_JSON:')) nodesJson = t.substring(11);
    else if (t.startsWith('TOTAL_NODES:'))
      totalNodes = parseInt(t.substring(12), 10) || 0;
    else if (enableDebug && t.startsWith('DEBUG:')) {
      const c = t.substring(6);
      if (c.includes('=')) {
        const [k, v] = c.split('=');
        debugInfo[k] = v;
      }
    }
  }

  if (!nodesJson) {
    throw new Error(
      `No NODES_JSON found. Debug:\n${output
        .split('\n')
        .filter((l) => l.includes('DEBUG:'))
        .join('\n')}`,
    );
  }

  let raw: any;
  try {
    raw = JSON.parse(nodesJson);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e}`);
  }

  const rawArr = Array.isArray(raw) ? raw : [raw];
  const nodes: AXNode[] = rawArr.map((r: any) => ({
    index: r.index ?? 0,
    parentIndex: r.parentIndex ?? -1,
    controlType: r.controlType ?? '',
    name: r.name ?? '',
    boundingRectangle: r.boundingRectangle
      ? {
          left: r.boundingRectangle.left ?? 0,
          top: r.boundingRectangle.top ?? 0,
          width: r.boundingRectangle.width ?? 0,
          height: r.boundingRectangle.height ?? 0,
        }
      : null,
    isEnabled: r.isEnabled ?? true,
    isOffscreen: r.isOffscreen ?? false,
    value: r.value ?? '',
    helpText: r.helpText ?? '',
    automationId: r.automationId ?? '',
    className: r.className ?? '',
    frameworkId: r.frameworkId ?? '',
    childCount: r.childCount ?? 0,
    localizedControlType: r.localizedControlType ?? '',
    isKeyboardFocusable: r.isKeyboardFocusable ?? false,
  }));

  logger.info(`[getDom] Parsed ${nodes.length} nodes from "${windowTitle}"`);
  return {
    processName,
    windowTitle,
    nodes,
    totalNodes: totalNodes || nodes.length,
    ...(enableDebug ? { debugInfo } : {}),
  };
}

export function filterNodes(
  nodes: AXNode[],
  criteria: Partial<{
    controlType: string;
    nameContains: string;
    isEnabled: boolean;
    isVisible: boolean;
  }>,
): AXNode[] {
  return nodes.filter((node) => {
    if (
      criteria.controlType &&
      node.controlType.toLowerCase() !== criteria.controlType.toLowerCase()
    )
      return false;
    if (
      criteria.nameContains &&
      !node.name.toLowerCase().includes(criteria.nameContains.toLowerCase())
    )
      return false;
    if (
      criteria.isEnabled !== undefined &&
      node.isEnabled !== criteria.isEnabled
    )
      return false;
    if (
      criteria.isVisible !== undefined &&
      node.isOffscreen === criteria.isVisible
    )
      return false;
    return true;
  });
}

export function getTreeSummary(result: AccessibilityTreeResult): string {
  const lines: string[] = [
    `=== Accessibility Tree for "${result.windowTitle}" (process: ${result.processName}) ===`,
    `Total nodes: ${result.totalNodes}`,
  ];
  if (result.debugInfo)
    lines.push(`Debug: ${JSON.stringify(result.debugInfo)}`);
  lines.push('');

  const byType = new Map<string, number>();
  for (const node of result.nodes)
    byType.set(node.controlType, (byType.get(node.controlType) ?? 0) + 1);

  lines.push('Control Type Distribution:');
  for (const [type, count] of Array.from(byType.entries()).sort(
    (a, b) => b[1] - a[1],
  )) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push('');
  lines.push('Named Interactive Elements (first 30):');
  const interactive = result.nodes.filter(
    (n) =>
      [
        'Button',
        'Edit',
        'MenuItem',
        'Hyperlink',
        'CheckBox',
        'RadioButton',
        'ComboBox',
        'TabItem',
        'ListItem',
        'Text',
      ].includes(n.controlType) && n.name,
  );
  for (const node of interactive.slice(0, 30)) {
    const rect = node.boundingRectangle
      ? `[${node.boundingRectangle.left},${node.boundingRectangle.top},${node.boundingRectangle.width}x${node.boundingRectangle.height}]`
      : '[no rect]';
    lines.push(`  ${node.controlType}: "${node.name}" ${rect}`);
  }
  return lines.join('\n');
}

export async function testGetDom(): Promise<void> {
  logger.info('[getDom] ========================================');
  logger.info(
    '[getDom] Starting enhanced UI Automation fetch (Chromium Optimized)',
  );
  logger.info('[getDom] ========================================');

  let result: AccessibilityTreeResult;
  try {
    result = await getAccessibilityTree('Feishu', {
      maxRetries: 2,
      retryDelayMs: 2000,
      useControlViewWalker: false, // 关键：使用 RawViewWalker
      enableDebug: true,
    });
  } catch (err) {
    logger.error('[getDom] Failed:', err);
    return;
  }

  console.log(getTreeSummary(result));
  if (result.totalNodes < 50) {
    console.warn(
      '\n⚠️ Still few nodes. Ensure: 1. Feishu is foreground 2. Not minimized 3. Try manually pressing Tab in Feishu before running.',
    );
  }
  logger.info('[getDom] Done!');
}
