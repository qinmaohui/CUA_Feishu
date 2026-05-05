import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Play,
  Trash2,
  Pencil,
  Loader2,
  FlaskConical,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart3,
  ChevronDown,
  ChevronUp,
  GripVertical,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@renderer/components/ui/button';
import { DragArea } from '@renderer/components/Common/drag';
import { useBatchTestStore } from '@renderer/store/batchTest';
import type {
  TestCase,
  TestReport,
  TestResult,
  TestStepDetail,
} from '@main/store/batchTest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
};

const formatDateTime = (ts: number): string =>
  new Date(ts).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const formatActionInputs = (
  type: string,
  inputs: Record<string, unknown>,
): string => {
  if (!inputs || !Object.keys(inputs).length) return '';
  switch (type) {
    case 'click':
    case 'left_click':
    case 'right_click':
    case 'double_click': {
      const box = inputs.start_box ?? inputs.coordinate ?? inputs.point;
      return box ? `坐标 ${JSON.stringify(box)}` : '';
    }
    case 'type':
    case 'input':
      return inputs.content ? `"${String(inputs.content).slice(0, 60)}"` : '';
    case 'hotkey':
    case 'key':
      return inputs.key ? String(inputs.key) : '';
    case 'scroll': {
      const dir = inputs.direction ?? '';
      return dir ? `方向 ${dir}` : '';
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

// ── Case Dialog ───────────────────────────────────────────────────────────────

function CaseDialog({
  initial,
  onConfirm,
  onCancel,
}: {
  initial?: TestCase;
  onConfirm: (name: string, instruction: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [instruction, setInstruction] = useState(initial?.instruction ?? '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl p-6 w-[480px]">
        <h3 className="text-base font-semibold mb-4">
          {initial ? 'Edit Test Case' : 'Add Test Case'}
        </h3>
        <div className="mb-3">
          <label className="text-sm text-neutral-600 mb-1 block">
            Name{' '}
            <span className="text-neutral-400 font-normal">(optional)</span>
          </label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
            placeholder="Defaults to first 30 chars of instruction"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="mb-5">
          <label className="text-sm text-neutral-600 mb-1 block">
            Instruction <span className="text-red-400">*</span>
          </label>
          <textarea
            autoFocus
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none"
            rows={5}
            placeholder="Enter the task instruction..."
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel();
            }}
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!instruction.trim()}
            onClick={() => onConfirm(name.trim(), instruction.trim())}
          >
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Step Detail Modal ─────────────────────────────────────────────────────────

function StepDetailModal({
  result,
  onClose,
}: {
  result: TestResult;
  onClose: () => void;
}) {
  const [selectedStep, setSelectedStep] = useState<number>(0);
  const step: TestStepDetail | undefined = result.steps[selectedStep];
  const stepImage = toDataUrl(
    step?.screenshotWithMarker ?? step?.screenshotBase64,
  );
  const verifyImage = toDataUrl(result.verifyEvidence?.screenshotBase64);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[900px] max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0">
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-800 transition-colors"
              onClick={onClose}
            >
              <ChevronRight className="w-4 h-4 rotate-180" />
              返回
            </button>
            <span className="text-neutral-300">|</span>
            <div>
              <h3 className="text-sm font-semibold text-neutral-800">
                {result.caseName}
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5 line-clamp-1">
                {result.instruction}
              </p>
            </div>
          </div>
          <button
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded-lg hover:bg-neutral-100 transition-colors"
            onClick={onClose}
          >
            <XCircle className="w-4 h-4" />
          </button>
        </div>

        {result.steps.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">
            No step data recorded
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Step list */}
            <div className="w-52 border-r overflow-y-auto shrink-0">
              {result.steps.map((s, i) => (
                <button
                  key={i}
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
                      {s.action_type}
                    </span>
                  </div>
                  {s.timingCost !== undefined && (
                    <span className="text-xs text-neutral-400 mt-0.5 block">
                      {formatDuration(s.timingCost)}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Step detail */}
            {step && (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* Screenshot */}
                {stepImage && (
                  <div>
                    <p className="text-xs font-medium text-neutral-500 mb-2">
                      截图
                    </p>
                    <img
                      src={stepImage}
                      alt={`step-${step.index}`}
                      className="w-full rounded-lg border object-contain max-h-64"
                    />
                  </div>
                )}

                {/* Action */}
                <div className="bg-neutral-50 rounded-lg p-3">
                  <p className="text-xs font-medium text-neutral-500 mb-1">
                    操作
                  </p>
                  <span className="inline-block bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded mr-2">
                    {step.action_type}
                  </span>
                  <span className="text-xs text-neutral-600">
                    {formatActionInputs(step.action_type, step.action_inputs)}
                  </span>
                </div>

                {/* Thought */}
                {step.thought && (
                  <div>
                    <p className="text-xs font-medium text-neutral-500 mb-1">
                      思考过程
                    </p>
                    <p className="text-xs text-neutral-600 leading-relaxed bg-amber-50 border border-amber-100 rounded-lg p-3 whitespace-pre-wrap">
                      {step.thought}
                    </p>
                  </div>
                )}

                {/* Reflection */}
                {step.reflection && (
                  <div>
                    <p className="text-xs font-medium text-neutral-500 mb-1">
                      反思
                    </p>
                    <p className="text-xs text-neutral-600 leading-relaxed bg-purple-50 border border-purple-100 rounded-lg p-3 whitespace-pre-wrap">
                      {step.reflection}
                    </p>
                  </div>
                )}

                {/* Accessibility tree */}
                {step.a11ySnapshot && (
                  <div>
                    <p className="text-xs font-medium text-neutral-500 mb-1">
                      无障碍树
                    </p>
                    <pre className="text-xs text-neutral-600 leading-relaxed bg-neutral-50 border rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-auto">
                      {step.a11ySnapshot}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Verify conclusion */}
        {(result.verifyConclusion || result.verifyEvidence) && (
          <div className="px-5 py-3 border-t bg-neutral-50 shrink-0 max-h-[34vh] overflow-y-auto">
            <p className="text-xs font-medium text-neutral-500 mb-1">
              验证结论
            </p>
            <p
              className={`text-sm leading-relaxed whitespace-pre-wrap ${
                result.verifyConclusion?.startsWith('✓')
                  ? 'text-green-700'
                  : 'text-red-600'
              }`}
            >
              {result.verifyConclusion}
            </p>
            {verifyImage && (
              <div className="mt-3">
                <p className="text-xs font-medium text-neutral-500 mb-2">
                  用于判断任务是否完成的截图
                </p>
                <img
                  src={verifyImage}
                  alt={`${result.caseName}-verification`}
                  className="w-full rounded-lg border object-contain max-h-64 bg-white"
                />
              </div>
            )}
            {result.verifyEvidence?.a11ySnapshot && (
              <div className="mt-3">
                <p className="text-xs font-medium text-neutral-500 mb-1">
                  用于判断任务是否完成的无障碍树
                </p>
                <pre className="text-xs text-neutral-600 leading-relaxed bg-white border rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-auto">
                  {result.verifyEvidence.a11ySnapshot}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Report Panel ──────────────────────────────────────────────────────────────

function ReportPanel({
  report,
  onDelete,
}: {
  report: TestReport;
  onDelete: () => void;
}) {
  const { summary, results } = report;
  const [expanded, setExpanded] = useState(true);
  const [detailResult, setDetailResult] = useState<TestResult | null>(null);

  return (
    <>
      <div className="border rounded-xl overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-5 py-3 bg-neutral-50 hover:bg-neutral-100 transition-colors"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex items-center gap-3">
            <BarChart3 className="w-4 h-4 text-neutral-500" />
            <span className="text-sm font-medium text-neutral-700">
              {formatDateTime(report.startTime)}
            </span>
            <span className="text-xs text-neutral-400">
              · {formatDuration(report.totalDurationMs)}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-green-600">
              {summary.successRate}% success
            </span>
            <span className="text-xs text-neutral-400">
              {summary.success}/{summary.total}
            </span>
            <button
              className="p-1 rounded hover:bg-red-50 text-neutral-300 hover:text-red-400 transition-colors"
              title="删除报告"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-neutral-400" />
            ) : (
              <ChevronDown className="w-4 h-4 text-neutral-400" />
            )}
          </div>
        </button>

        {expanded && (
          <div className="p-5">
            <div className="grid grid-cols-6 gap-3 mb-5">
              {[
                {
                  label: 'Total',
                  value: summary.total,
                  color: 'text-neutral-700',
                },
                {
                  label: 'Success',
                  value: summary.success,
                  color: 'text-green-600',
                },
                {
                  label: 'Failed',
                  value: summary.failed,
                  color: 'text-red-500',
                },
                {
                  label: 'Success Rate',
                  value: `${summary.successRate}%`,
                  color: 'text-blue-600',
                },
                {
                  label: 'Avg Duration',
                  value: formatDuration(summary.avgDurationMs),
                  color: 'text-neutral-700',
                },
                {
                  label: 'Avg Steps',
                  value: summary.avgStepCount,
                  color: 'text-neutral-700',
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="bg-neutral-50 rounded-lg p-3 text-center"
                >
                  <div className={`text-lg font-semibold ${item.color}`}>
                    {item.value}
                  </div>
                  <div className="text-xs text-neutral-400 mt-0.5">
                    {item.label}
                  </div>
                </div>
              ))}
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-neutral-400 text-left">
                  <th className="pb-2 font-medium w-8">#</th>
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium w-20">Status</th>
                  <th className="pb-2 font-medium w-24">Duration</th>
                  <th className="pb-2 font-medium w-16">Steps</th>
                  <th className="pb-2 font-medium">Error</th>
                  <th className="pb-2 font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr
                    key={r.caseId}
                    className="border-b last:border-0 hover:bg-neutral-50 group"
                  >
                    <td className="py-2.5 text-neutral-400 text-xs">{i + 1}</td>
                    <td className="py-2.5 text-neutral-700 max-w-[160px]">
                      <div className="truncate" title={r.caseName}>
                        {r.caseName}
                      </div>
                    </td>
                    <td className="py-2.5">
                      {r.status === 'success' ? (
                        <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Pass
                        </span>
                      ) : r.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1 text-red-500 text-xs">
                          <XCircle className="w-3.5 h-3.5" /> Fail
                        </span>
                      ) : (
                        <span className="text-neutral-400 text-xs">Skip</span>
                      )}
                    </td>
                    <td className="py-2.5 text-neutral-500 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDuration(r.durationMs)}
                      </span>
                    </td>
                    <td className="py-2.5 text-neutral-500 text-xs">
                      {r.stepCount}
                    </td>
                    <td className="py-2.5 text-red-400 text-xs max-w-[240px]">
                      <div
                        className="whitespace-pre-wrap break-words line-clamp-3"
                        title={r.errorMsg}
                      >
                        {r.errorMsg ?? '—'}
                      </div>
                    </td>
                    <td className="py-2.5">
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50"
                        onClick={() => setDetailResult(r)}
                      >
                        <ChevronRight className="w-3 h-3" />
                        详情
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailResult && (
        <StepDetailModal
          result={detailResult}
          onClose={() => setDetailResult(null)}
        />
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BatchTestPage() {
  const {
    testCases,
    reports,
    isRunning,
    latestReport,
    fetchTestCases,
    addTestCase,
    updateTestCase,
    deleteTestCase,
    reorderTestCases,
    runBatchTest,
    fetchReports,
    deleteReport,
  } = useBatchTestStore();

  const [caseDialog, setCaseDialog] = useState<{
    mode: 'add' | 'edit';
    item?: TestCase;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<'cases' | 'reports'>('cases');

  // Drag state
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchTestCases();
    fetchReports();
  }, []);

  const allEnabled = testCases.length > 0 && testCases.every((c) => c.enabled);
  const someEnabled = testCases.some((c) => c.enabled);
  const enabledCount = testCases.filter((c) => c.enabled).length;

  const handleSelectAll = async () => {
    const next = !allEnabled;
    await Promise.all(
      testCases.map((c) => updateTestCase(c.id, { enabled: next })),
    );
  };

  const handleAddConfirm = async (name: string, instruction: string) => {
    await addTestCase(name, instruction);
    setCaseDialog(null);
  };

  const handleEditConfirm = async (name: string, instruction: string) => {
    if (caseDialog?.item)
      await updateTestCase(caseDialog.item.id, { name, instruction });
    setCaseDialog(null);
  };

  const handleRunAll = async () => {
    if (isRunning) return;
    setActiveTab('reports');
    await runBatchTest();
  };

  // Drag handlers
  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = dragIndexRef.current;
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragOverIndex(null);
      return;
    }
    const next = [...testCases];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(dropIndex, 0, moved);
    reorderTestCases(next.map((c) => c.id));
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  };

  const allReports = latestReport
    ? [latestReport, ...reports.filter((r) => r.id !== latestReport.id)]
    : reports;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      <DragArea />

      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b shrink-0">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5 text-neutral-600" strokeWidth={2} />
          <h1 className="text-xl font-semibold text-neutral-800">Batch Test</h1>
          <span className="text-sm text-neutral-400">
            {testCases.length} cases · {enabledCount} enabled
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCaseDialog({ mode: 'add' })}
            disabled={isRunning}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Case
          </Button>
          <Button
            size="sm"
            onClick={handleRunAll}
            disabled={isRunning || enabledCount === 0}
          >
            {isRunning ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-1" />
            )}
            {isRunning ? 'Running...' : `Run All (${enabledCount})`}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex px-8 border-b shrink-0">
        {(['cases', 'reports'] as const).map((tab) => (
          <button
            key={tab}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-neutral-500 hover:text-neutral-700'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'cases'
              ? 'Test Cases'
              : `Reports${allReports.length ? ` (${allReports.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {activeTab === 'cases' && (
          <div className="max-w-3xl">
            {/* Select-all toolbar */}
            {testCases.length > 0 && (
              <div className="flex items-center gap-3 mb-3 px-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={allEnabled}
                    ref={(el) => {
                      if (el) el.indeterminate = !allEnabled && someEnabled;
                    }}
                    onChange={handleSelectAll}
                    className="w-4 h-4 accent-blue-500 cursor-pointer"
                  />
                  <span className="text-sm text-neutral-600">
                    {allEnabled ? 'Deselect All' : 'Select All'}
                  </span>
                </label>
                <span className="text-xs text-neutral-400">
                  {enabledCount} / {testCases.length} selected
                </span>
              </div>
            )}

            {testCases.length === 0 && (
              <div className="text-center py-16 text-neutral-400">
                <FlaskConical className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">
                  No test cases yet. Click "Add Case" to get started.
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              {testCases.map((item, i) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={(e) => handleDrop(e, i)}
                  onDragEnd={handleDragEnd}
                  className={`flex items-start gap-3 p-4 border rounded-xl group transition-all cursor-default ${
                    dragOverIndex === i
                      ? 'border-blue-400 bg-blue-50 shadow-sm'
                      : 'hover:bg-neutral-50 border-neutral-200'
                  }`}
                >
                  {/* Drag handle */}
                  <div className="mt-0.5 cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500 shrink-0">
                    <GripVertical className="w-4 h-4" />
                  </div>

                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={() =>
                      updateTestCase(item.id, { enabled: !item.enabled })
                    }
                    className="mt-0.5 w-4 h-4 accent-blue-500 shrink-0 cursor-pointer"
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-neutral-400 shrink-0">
                        #{i + 1}
                      </span>
                      <span
                        className={`text-sm font-medium truncate ${item.enabled ? 'text-neutral-800' : 'text-neutral-400'}`}
                      >
                        {item.name}
                      </span>
                    </div>
                    <p
                      className={`text-xs leading-relaxed line-clamp-2 ${item.enabled ? 'text-neutral-500' : 'text-neutral-300'}`}
                    >
                      {item.instruction}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      className="p-1.5 rounded-lg hover:bg-neutral-200 text-neutral-500 hover:text-neutral-700"
                      onClick={() => setCaseDialog({ mode: 'edit', item })}
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className="p-1.5 rounded-lg hover:bg-red-50 text-neutral-400 hover:text-red-500"
                      onClick={() => deleteTestCase(item.id)}
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-3 max-w-4xl">
            {isRunning && (
              <div className="flex items-center gap-3 p-4 border rounded-xl bg-blue-50 border-blue-200">
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />
                <span className="text-sm text-blue-700">
                  Running batch test, please wait...
                </span>
              </div>
            )}
            {allReports.length === 0 && !isRunning && (
              <div className="text-center py-16 text-neutral-400">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">
                  No reports yet. Run a batch test to generate one.
                </p>
              </div>
            )}
            {allReports.map((report) => (
              <ReportPanel
                key={report.id}
                report={report}
                onDelete={() => deleteReport(report.id)}
              />
            ))}
          </div>
        )}
      </div>

      {caseDialog && (
        <CaseDialog
          initial={caseDialog.mode === 'edit' ? caseDialog.item : undefined}
          onConfirm={
            caseDialog.mode === 'add' ? handleAddConfirm : handleEditConfirm
          }
          onCancel={() => setCaseDialog(null)}
        />
      )}
    </div>
  );
}
