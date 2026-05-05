import ElectronStore from 'electron-store';
import { logger } from '@main/logger';

export interface TestCase {
  id: string;
  name: string;
  instruction: string;
  enabled: boolean;
  createdAt: number;
}

export interface TestStepDetail {
  index: number;
  thought: string;
  action_type: string;
  action_inputs: Record<string, unknown>;
  reflection: string | null;
  screenshotBase64?: string;
  screenshotWithMarker?: string;
  a11ySnapshot?: string;
  timingCost?: number;
}

export interface TestVerificationEvidence {
  screenshotBase64?: string;
  a11ySnapshot?: string;
}

export interface TestResult {
  caseId: string;
  caseName: string;
  instruction: string;
  status: 'success' | 'failed' | 'skipped';
  startTime: number;
  endTime: number;
  durationMs: number;
  stepCount: number;
  errorMsg?: string;
  steps: TestStepDetail[];
  verifyConclusion?: string;
  verifyEvidence?: TestVerificationEvidence;
}

export interface TestReport {
  id: string;
  startTime: number;
  endTime: number;
  totalDurationMs: number;
  results: TestResult[];
  summary: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
    successRate: number;
    avgDurationMs: number;
    avgStepCount: number;
  };
}

type BatchTestStoreSchema = {
  testCases: TestCase[];
  testReports: TestReport[];
};

const MAX_REPORTS = 20;

// Default test cases parsed from test-example.md
const DEFAULT_TEST_CASES: TestCase[] = [
  {
    id: 'default_docs_1',
    name: '云文档-1',
    instruction: "在飞书云文档中创建一个新文档，并输入标题'2026年Q2项目进展'。",
    enabled: true,
    createdAt: 0,
  },
  {
    id: 'default_docs_2',
    name: '云文档-2',
    instruction:
      "在飞书云文档中打开'2026年Q2项目进展',添加内容：“本周已完成所有任务！！”。",
    enabled: true,
    createdAt: 0,
  },
  {
    id: 'default_docs_3',
    name: '云文档-3',
    instruction: "在飞书云文档中打开'2026年Q2项目进展'，分享给'覃茂辉5309'",
    enabled: true,
    createdAt: 0,
  },
  {
    id: 'default_im_1',
    name: 'IM-1',
    instruction:
      '打开飞书，给覃茂辉Test发一条消息，"你的工作做完了吗？？"，附带一个"送你小红花"的表情。',
    enabled: true,
    createdAt: 0,
  },
  {
    id: 'default_im_2',
    name: 'IM-2',
    instruction:
      '打开飞书，创建群组，包括覃茂辉Test以及覃茂辉5309，群名为飞书大赛讨论群。',
    enabled: true,
    createdAt: 0,
  },
  {
    id: 'default_im_3',
    name: 'IM-3',
    instruction:
      '在飞书大赛讨论群中@覃茂辉5309并问他什么时候提交作品，附带表情送心',
    enabled: true,
    createdAt: 0,
  },
  {
    id: 'default_cal_1',
    name: '日历-1',
    instruction:
      '打开日历，创建一个明天下午2点的会议，邀请覃茂辉5309参加，主题为CUA研讨会。',
    enabled: true,
    createdAt: 0,
  },
  {
    id: 'default_cal_2',
    name: '日历-2',
    instruction: '打开日历，修改CUA研讨会的时间到上午10点。',
    enabled: true,
    createdAt: 0,
  },
];

export class BatchTestStore {
  private static instance: ElectronStore<BatchTestStoreSchema>;

  public static getInstance(): ElectronStore<BatchTestStoreSchema> {
    if (!BatchTestStore.instance) {
      BatchTestStore.instance = new ElectronStore<BatchTestStoreSchema>({
        name: 'ui_tars.batch_test',
        defaults: {
          testCases: DEFAULT_TEST_CASES,
          testReports: [],
        },
      });
    }
    return BatchTestStore.instance;
  }

  public static getAllCases(): TestCase[] {
    return BatchTestStore.getInstance().get('testCases') || [];
  }

  public static setCases(cases: TestCase[]): void {
    BatchTestStore.getInstance().set('testCases', cases);
  }

  public static addCase(name: string, instruction: string): TestCase {
    const cases = BatchTestStore.getAllCases();
    const now = Date.now();
    const newCase: TestCase = {
      id: `case_${now}_${Math.random().toString(36).slice(2, 9)}`,
      name: name || instruction.slice(0, 30).trim(),
      instruction,
      enabled: true,
      createdAt: now,
    };
    BatchTestStore.setCases([...cases, newCase]);
    logger.info('[BatchTestStore] Added case:', newCase.id);
    return newCase;
  }

  public static updateCase(
    id: string,
    patch: Partial<Pick<TestCase, 'name' | 'instruction' | 'enabled'>>,
  ): TestCase | null {
    const cases = BatchTestStore.getAllCases();
    const idx = cases.findIndex((c) => c.id === id);
    if (idx < 0) return null;
    const updated = { ...cases[idx], ...patch };
    cases[idx] = updated;
    BatchTestStore.setCases(cases);
    return updated;
  }

  public static deleteCase(id: string): boolean {
    const cases = BatchTestStore.getAllCases();
    const next = cases.filter((c) => c.id !== id);
    BatchTestStore.setCases(next);
    return next.length !== cases.length;
  }

  public static reorderCases(ids: string[]): TestCase[] {
    const cases = BatchTestStore.getAllCases();
    const map = new Map(cases.map((c) => [c.id, c]));
    const reordered = ids
      .map((id) => map.get(id))
      .filter(Boolean) as TestCase[];
    // append any cases not in ids (safety)
    const idSet = new Set(ids);
    cases.filter((c) => !idSet.has(c.id)).forEach((c) => reordered.push(c));
    BatchTestStore.setCases(reordered);
    return reordered;
  }

  public static getAllReports(): TestReport[] {
    return BatchTestStore.getInstance().get('testReports') || [];
  }

  public static saveReport(report: TestReport): void {
    const reports = BatchTestStore.getAllReports();
    const next = [report, ...reports].slice(0, MAX_REPORTS);
    BatchTestStore.getInstance().set('testReports', next);
    logger.info('[BatchTestStore] Saved report:', report.id);
  }

  public static getReport(id: string): TestReport | null {
    return BatchTestStore.getAllReports().find((r) => r.id === id) ?? null;
  }

  public static deleteReport(id: string): boolean {
    const reports = BatchTestStore.getAllReports();
    const next = reports.filter((r) => r.id !== id);
    BatchTestStore.getInstance().set('testReports', next);
    return next.length !== reports.length;
  }
}
