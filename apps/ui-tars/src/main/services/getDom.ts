/**
 * Get the Accessibility Tree from Feishu via IAccessible (MSAA).
 *
 * Feishu uses a custom Electron fork (frame.dll) that does NOT expose a UIA provider.
 * WM_GETOBJECT(UIA_OBJID) returns 0, but WM_GETOBJECT(OBJID_CLIENT) returns a valid
 * IAccessible object. We compile a small C# helper at runtime to walk the IAccessible
 * tree, which avoids PowerShell's cross-process COM marshaling issues.
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
// C# source for the IAccessible walker helper
// Compiled at runtime via csc.exe, cached by hash so it's only built once.
// ---------------------------------------------------------------------------

const CSHARP_SOURCE = `
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
using System.Windows.Automation;

class FeishuAccWalker {
    [DllImport("oleacc.dll")]
    static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint dwId,
        ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object ppvObject);

    static readonly Guid IID_IAccessible = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    const uint OBJID_CLIENT = 0xFFFFFFFC;
    const int MAX_NODES = 10000;

    static int total = 0;
    static List<string> jsonLines = new List<string>();

    static void Main(string[] args) {
        Console.OutputEncoding = Encoding.UTF8;
        string procName = args.Length > 0 ? args[0] : "Feishu";

        var procs = Process.GetProcessesByName(procName);
        if (procs.Length == 0) procs = Process.GetProcessesByName("Lark");
        if (procs.Length == 0) { Console.Error.WriteLine("ERR:Process not found"); return; }

        Process mainProc = null;
        foreach (var p in procs) if (p.MainWindowHandle != IntPtr.Zero) { mainProc = p; break; }
        if (mainProc == null) { Console.Error.WriteLine("ERR:No main window"); return; }

        string windowTitle = mainProc.MainWindowTitle;
        var win = AutomationElement.FromHandle(mainProc.MainWindowHandle);
        var walker = TreeWalker.RawViewWalker;

        // Walk all Chrome_RenderWidgetHostHWND children
        var cur = walker.GetFirstChild(win);
        while (cur != null) {
            if (cur.Current.ClassName == "Chrome_RenderWidgetHostHWND") {
                var hwnd = (IntPtr)cur.Current.NativeWindowHandle;
                var iid = IID_IAccessible;
                object accObj;
                if (AccessibleObjectFromWindow(hwnd, OBJID_CLIENT, ref iid, out accObj) == 0 && accObj != null) {
                    Walk(accObj, 0, -1);
                }
            }
            cur = walker.GetNextSibling(cur);
        }

        Console.WriteLine("WINDOW_TITLE:" + windowTitle);
        Console.WriteLine("NODES_JSON:[" + string.Join(",", jsonLines) + "]");
        Console.WriteLine("TOTAL_NODES:" + total);
    }

    static void Walk(dynamic acc, int childId, int parentIdx) {
        if (total >= MAX_NODES) return;
        int myIdx = total++;
        try {
            string name = "";
            int role = 0;
            int childCount = 0;
            int x = 0, y = 0, w = 0, h = 0;
            bool enabled = true;

            try { name = (acc.accName(childId) ?? "").ToString().Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"").Replace("\\n", " ").Replace("\\r", ""); } catch {}
            try { role = Convert.ToInt32(acc.accRole(childId)); } catch {}
            try { acc.accLocation(out x, out y, out w, out h, childId); } catch {}
            if (childId == 0) { try { childCount = acc.accChildCount; } catch {} }
            try {
                object state = acc.accState(childId);
                int stateInt = Convert.ToInt32(state);
                enabled = (stateInt & 0x00000001) == 0; // STATE_SYSTEM_UNAVAILABLE = 1
            } catch {}

            bool offscreen = (x < -9999 || y < -9999 || w <= 0 || h <= 0);
            string rectJson = (w > 0 && h > 0 && !offscreen)
                ? "{\\"left\\":" + x + ",\\"top\\":" + y + ",\\"width\\":" + w + ",\\"height\\":" + h + "}"
                : "null";

            string controlType = RoleToControlType(role);
            jsonLines.Add(
                "{\\"index\\":" + myIdx +
                ",\\"parentIndex\\":" + parentIdx +
                ",\\"controlType\\":\\"" + controlType + "\\"" +
                ",\\"name\\":\\"" + name + "\\"" +
                ",\\"boundingRectangle\\":" + rectJson +
                ",\\"isEnabled\\":" + (enabled ? "true" : "false") +
                ",\\"isOffscreen\\":" + (offscreen ? "true" : "false") +
                ",\\"value\\":\\"\\"" +
                ",\\"helpText\\":\\"\\"" +
                ",\\"automationId\\":\\"\\"" +
                ",\\"className\\":\\"\\"" +
                ",\\"frameworkId\\":\\"Chrome\\"" +
                ",\\"childCount\\":" + childCount +
                ",\\"localizedControlType\\":\\"" + controlType.ToLower() + "\\"" +
                ",\\"isKeyboardFocusable\\":false}"
            );

            for (int i = 1; i <= childCount && total < MAX_NODES; i++) {
                try {
                    dynamic child = acc.accChild(i);
                    if (child != null) Walk(child, 0, myIdx);
                    else Walk(acc, i, myIdx);
                } catch {}
            }
        } catch {}
    }

    static string RoleToControlType(int role) {
        switch (role) {
            case 9:  return "Button";
            case 10: return "CheckBox";
            case 11: return "RadioButton";
            case 42: return "ComboBox";
            case 15: return "Pane";
            case 20: return "Group";
            case 21: return "Edit";
            case 25: return "ListItem";
            case 33: return "MenuItem";
            case 35: return "MenuBar";
            case 36: return "ScrollBar";
            case 40: return "TabItem";
            case 41: return "Text";
            case 43: return "Image";
            case 44: return "Hyperlink";
            case 45: return "Spinner";
            case 46: return "ScrollBar";
            case 47: return "ToolBar";
            case 48: return "StatusBar";
            case 49: return "Table";
            case 50: return "ColumnHeader";
            case 51: return "RowHeader";
            case 52: return "DataItem";
            case 53: return "DataGrid";
            case 54: return "Document";
            case 56: return "Window";
            default: return "Custom";
        }
    }
}
`;

// ---------------------------------------------------------------------------
// PowerShell bootstrap: compile C# once, then run it
// ---------------------------------------------------------------------------

const POWERSHELL_SCRIPT = `param(
  [string]$ProcessName = "Feishu",
  [switch]$EnableDebug
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-DebugLog {
    param([string]$Message)
    if ($EnableDebug) { [Console]::Error.WriteLine("DEBUG:$Message") }
}

try {
    # 1. Locate csc.exe
    $csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe"
    if (-not (Test-Path $csc)) {
        $csc = Get-ChildItem "C:\\Windows\\Microsoft.NET\\Framework64" -Filter "csc.exe" -Recurse -ErrorAction SilentlyContinue |
               Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $csc) { Write-Error "csc.exe not found"; exit 1 }
    Write-DebugLog "csc: $csc"

    # 2. Locate UIA assemblies
    $gac = "C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL"
    $r1 = (Get-ChildItem "$gac\\UIAutomationClient" -Filter "*.dll" -Recurse | Select-Object -First 1).FullName
    $r2 = (Get-ChildItem "$gac\\UIAutomationTypes"  -Filter "*.dll" -Recurse | Select-Object -First 1).FullName
    $r3 = (Get-ChildItem "$gac\\WindowsBase"        -Filter "*.dll" -Recurse | Select-Object -First 1).FullName
    Write-DebugLog "refs: $r1 | $r2 | $r3"

    # 3. Write C# source and compile (cache exe by source hash)
    $tmpDir = [System.IO.Path]::GetTempPath()
    $csPath  = [System.IO.Path]::Combine($tmpDir, "FeishuAccWalker.cs")
    $exePath = [System.IO.Path]::Combine($tmpDir, "FeishuAccWalker.exe")

    $csSource = @'
CSHARP_SOURCE_PLACEHOLDER
'@

    # Only recompile if source changed
    $needCompile = $true
    if (Test-Path $exePath) {
        $hashFile = $exePath + ".hash"
        $newHash = [System.Security.Cryptography.MD5]::Create().ComputeHash(
            [System.Text.Encoding]::UTF8.GetBytes($csSource)) | ForEach-Object { $_.ToString("x2") }
        $newHash = $newHash -join ""
        if ((Test-Path $hashFile) -and (Get-Content $hashFile) -eq $newHash) {
            $needCompile = $false
            Write-DebugLog "Using cached exe (hash match)"
        } else {
            $newHash | Out-File $hashFile -Encoding ASCII -NoNewline
        }
    }

    if ($needCompile) {
        Write-DebugLog "Compiling C# walker..."
        [System.IO.File]::WriteAllText($csPath, $csSource, [System.Text.Encoding]::UTF8)
        $compileOut = & $csc /nologo /out:$exePath /reference:$r1 /reference:$r2 /reference:$r3 $csPath 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Compile failed: $compileOut"
            exit 1
        }
        Write-DebugLog "Compiled OK"
    }

    # 4. Run the walker
    Write-DebugLog "Running walker for: $ProcessName"
    $output = & $exePath $ProcessName 2>&1
    $stdout = ($output | Where-Object { $_ -notmatch "^ERR:" }) -join [char]10
    $stderr = ($output | Where-Object { $_ -match "^ERR:" }) -join [char]10

    if ($stderr) { Write-DebugLog "Walker stderr: $stderr" }

    # 5. Pass through the walker output
    Write-Output $stdout

} catch {
    Write-Error "Fatal: $_"
    exit 1
}
`;

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

export async function getAccessibilityTree(
  processName: string = 'Feishu',
  options?: {
    enableDebug?: boolean;
  },
): Promise<AccessibilityTreeResult> {
  const enableDebug = options?.enableDebug ?? true;

  logger.info(`[getDom] Running IAccessible fetch for: ${processName}`);

  const { writeFile, unlink } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  // Embed the C# source into the PowerShell script
  const script = POWERSHELL_SCRIPT.replace(
    'CSHARP_SOURCE_PLACEHOLDER',
    CSHARP_SOURCE.trim(),
  );

  const scriptPath = join(tmpdir(), `feishu-acc-${Date.now()}.ps1`);
  await writeFile(scriptPath, '﻿' + script, 'utf-8');

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
        ...(enableDebug ? ['-EnableDebug'] : []),
      ],
      { timeout: 90000, maxBuffer: 100 * 1024 * 1024, windowsHide: true },
    );

    if (stderr && enableDebug) {
      const debugLines = stderr.split('\n').filter((l) => l.includes('DEBUG:'));
      if (debugLines.length)
        logger.debug('[getDom] Debug:', debugLines.slice(0, 20).join('\n'));
    }

    return parsePowerShellOutput(stdout, processName, enableDebug);
  } catch (error: any) {
    if (error.code === 'ETIMEDOUT') logger.error('[getDom] Script timed out');
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
      `No NODES_JSON found. Output:\n${output.split('\n').slice(0, 20).join('\n')}`,
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
  logger.info('[getDom] Starting IAccessible fetch test...');
  let result: AccessibilityTreeResult;
  try {
    result = await getAccessibilityTree('Feishu', { enableDebug: true });
  } catch (err) {
    logger.error('[getDom] Failed:', err);
    return;
  }
  console.log(getTreeSummary(result));
  if (result.totalNodes < 50) {
    console.warn('\n⚠️ Few nodes. Ensure Feishu is running and not minimized.');
  }
  logger.info('[getDom] Done!');
}
