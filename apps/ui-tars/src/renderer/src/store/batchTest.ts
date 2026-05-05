import { create } from 'zustand';
import { api } from '@renderer/api';
import type { TestCase, TestReport } from '@main/store/batchTest';

interface BatchTestState {
  testCases: TestCase[];
  reports: TestReport[];
  isRunning: boolean;
  currentCaseIndex: number | null;
  latestReport: TestReport | null;

  fetchTestCases: () => Promise<void>;
  addTestCase: (name: string, instruction: string) => Promise<void>;
  updateTestCase: (
    id: string,
    patch: Partial<{ name: string; instruction: string; enabled: boolean }>,
  ) => Promise<void>;
  deleteTestCase: (id: string) => Promise<void>;
  reorderTestCases: (ids: string[]) => Promise<void>;
  runBatchTest: () => Promise<TestReport | null>;
  fetchReports: () => Promise<void>;
  deleteReport: (id: string) => Promise<void>;
}

export const useBatchTestStore = create<BatchTestState>((set, get) => ({
  testCases: [],
  reports: [],
  isRunning: false,
  currentCaseIndex: null,
  latestReport: null,

  fetchTestCases: async () => {
    const cases = await api.listTestCases();
    set({ testCases: cases ?? [] });
  },

  addTestCase: async (name: string, instruction: string) => {
    const newCase = await api.addTestCase({ name, instruction });
    if (newCase) {
      set({ testCases: [...get().testCases, newCase] });
    }
  },

  updateTestCase: async (id, patch) => {
    const updated = await api.updateTestCase({ id, patch });
    if (updated) {
      set({
        testCases: get().testCases.map((c) => (c.id === id ? updated : c)),
      });
    }
  },

  deleteTestCase: async (id) => {
    await api.deleteTestCase({ id });
    set({ testCases: get().testCases.filter((c) => c.id !== id) });
  },

  reorderTestCases: async (ids: string[]) => {
    // Optimistic update
    const current = get().testCases;
    const map = new Map(current.map((c) => [c.id, c]));
    const reordered = ids
      .map((id) => map.get(id))
      .filter(Boolean) as TestCase[];
    set({ testCases: reordered });
    await api.reorderTestCases({ ids });
  },

  runBatchTest: async () => {
    set({ isRunning: true, currentCaseIndex: 0 });
    try {
      const report = await api.runBatchTest();
      set({
        latestReport: report ?? null,
        isRunning: false,
        currentCaseIndex: null,
      });
      if (report) {
        set({ reports: [report, ...get().reports].slice(0, 20) });
      }
      return report ?? null;
    } catch {
      set({ isRunning: false, currentCaseIndex: null });
      return null;
    }
  },

  fetchReports: async () => {
    const reports = await api.listTestReports();
    set({ reports: reports ?? [] });
  },

  deleteReport: async (id: string) => {
    await api.deleteTestReport({ id });
    set({
      reports: get().reports.filter((r) => r.id !== id),
      latestReport: get().latestReport?.id === id ? null : get().latestReport,
    });
  },
}));
