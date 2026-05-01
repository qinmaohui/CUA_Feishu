/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { z } from 'zod';

import { SearchEngineForSettings, VLMProviderV2, Operator } from './types';

const PresetSourceSchema = z.object({
  type: z.enum(['local', 'remote']),
  url: z.string().url().optional(),
  autoUpdate: z.boolean().optional(),
  lastUpdated: z.number().optional(),
});

const normalizeShortcut = (value: string) =>
  value
    .trim()
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join('+');

const ShortcutSchema = z.string().min(1);

export const PresetSchema = z
  .object({
    // Local VLM Settings
    vlmProvider: z.nativeEnum(VLMProviderV2).optional(),
    vlmBaseUrl: z.string().url(),
    vlmApiKey: z.string().min(1),
    vlmModelName: z.string().min(1),
    useResponsesApi: z.boolean().optional(),

    // Chat Settings
    operator: z.nativeEnum(Operator),
    language: z.enum(['zh', 'en']).optional(),
    screenshotScale: z.number().min(0.1).max(1).optional(),
    maxLoopCount: z.number().min(25).max(200).optional(),
    loopIntervalInMs: z.number().min(0).max(3000).optional(),
    searchEngineForBrowser: z.nativeEnum(SearchEngineForSettings).optional(),
    pauseShortcut: ShortcutSchema.optional(),
    stopShortcut: ShortcutSchema.optional(),

    // Feishu Annotation
    autoAnnotation: z.boolean().optional(),

    // Report Settings
    reportStorageBaseUrl: z.string().url().optional(),
    utioBaseUrl: z.string().url().optional(),
    presetSource: PresetSourceSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.pauseShortcut || !value.stopShortcut) {
      return;
    }

    if (
      normalizeShortcut(value.pauseShortcut) ===
      normalizeShortcut(value.stopShortcut)
    ) {
      ctx.addIssue({
        path: ['stopShortcut'],
        code: z.ZodIssueCode.custom,
        message: 'Stop shortcut must be different from pause shortcut',
      });
    }
  });

export type PresetSource = z.infer<typeof PresetSourceSchema>;
export type LocalStore = z.infer<typeof PresetSchema>;

export const validatePreset = (data: unknown): LocalStore => {
  return PresetSchema.parse(data);
};
