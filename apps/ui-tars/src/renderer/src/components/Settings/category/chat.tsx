/**
 * Copyright (c) 2025 Bytedance, Inc. and its affiliates.
 * SPDX-License-Identifier: Apache-2.0
 */
import { useEffect, useRef, useState } from 'react';
import * as z from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { useSetting } from '@renderer/hooks/useSetting';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@renderer/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/components/ui/select';
import { Input } from '@renderer/components/ui/input';
import { Switch } from '@renderer/components/ui/switch';

// @ts-ignore
const isWin = navigator.userAgentData?.platform === 'Windows';

function toDisplayShortcut(shortcut: string): string {
  if (!shortcut) return '';
  return shortcut
    .split('+')
    .map((part) => {
      const k = part.trim();
      if (k === 'CommandOrControl') return isWin ? 'Ctrl' : '⌘';
      if (k === 'Control') return 'Ctrl';
      if (k === 'Escape') return 'Esc';
      return k;
    })
    .join('+');
}

interface ShortcutRecorderProps {
  value: string;
  onChange: (value: string) => void;
}

function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      setRecording(false);
      return;
    }

    if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
      return;
    }

    const parts: string[] = [];

    if (e.ctrlKey || e.metaKey) {
      parts.push('CommandOrControl');
    }
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    if (parts.length === 0) return;

    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    parts.push(key);

    onChange(parts.join('+'));
    setRecording(false);
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onBlur={() => setRecording(false)}
      onClick={() => setRecording(true)}
      className={[
        'flex h-9 w-full rounded-md border px-3 py-1 text-sm cursor-pointer select-none items-center outline-none',
        recording
          ? 'border-primary ring-2 ring-ring/50 bg-accent text-accent-foreground'
          : 'border-input bg-background hover:bg-accent/30',
      ].join(' ')}
    >
      {recording ? (
        <span className="text-muted-foreground">Press shortcut...</span>
      ) : value ? (
        <span>{toDisplayShortcut(value)}</span>
      ) : (
        <span className="text-muted-foreground">Click to set</span>
      )}
    </div>
  );
}

const formSchema = z.object({
  language: z.enum(['en', 'zh']),
  maxLoopCount: z.number().min(25).max(200),
  loopIntervalInMs: z.number().min(0).max(3000),
  pauseShortcut: z.string().min(1),
  stopShortcut: z.string().min(1),
});

export function ChatSettings() {
  const { settings, updateSetting } = useSetting();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      language: undefined,
      maxLoopCount: 0,
      loopIntervalInMs: 1000,
      pauseShortcut: 'CommandOrControl+P',
      stopShortcut: 'CommandOrControl+Escape',
    },
  });

  const [
    newLanguage,
    newCount,
    newInterval,
    newPauseShortcut,
    newStopShortcut,
  ] = form.watch([
    'language',
    'maxLoopCount',
    'loopIntervalInMs',
    'pauseShortcut',
    'stopShortcut',
  ]);

  useEffect(() => {
    if (Object.keys(settings).length) {
      form.reset({
        language: settings.language,
        maxLoopCount: settings.maxLoopCount,
        loopIntervalInMs: settings.loopIntervalInMs,
        pauseShortcut: settings.pauseShortcut,
        stopShortcut: settings.stopShortcut,
      });
    }
  }, [settings, form]);

  useEffect(() => {
    if (!Object.keys(settings).length) {
      return;
    }
    if (
      newLanguage === undefined &&
      newCount === 0 &&
      newInterval === 1000 &&
      newPauseShortcut === 'CommandOrControl+P' &&
      newStopShortcut === 'CommandOrControl+Escape'
    ) {
      return;
    }

    const validAndSave = async () => {
      if (newLanguage !== settings.language) {
        updateSetting({ ...settings, language: newLanguage });
      }

      const isLoopValid = await form.trigger('maxLoopCount');
      if (isLoopValid && newCount !== settings.maxLoopCount) {
        updateSetting({ ...settings, maxLoopCount: newCount });
      }

      const isIntervalValid = await form.trigger('loopIntervalInMs');
      if (isIntervalValid && newInterval !== settings.loopIntervalInMs) {
        updateSetting({ ...settings, loopIntervalInMs: newInterval });
      }
      const isPauseShortcutValid = await form.trigger('pauseShortcut');
      if (isPauseShortcutValid && newPauseShortcut !== settings.pauseShortcut) {
        updateSetting({ ...settings, pauseShortcut: newPauseShortcut });
      }

      const isStopShortcutValid = await form.trigger('stopShortcut');
      if (isStopShortcutValid && newStopShortcut !== settings.stopShortcut) {
        updateSetting({ ...settings, stopShortcut: newStopShortcut });
      }
    };

    validAndSave();
  }, [
    newLanguage,
    newCount,
    newInterval,
    newPauseShortcut,
    newStopShortcut,
    settings,
    updateSetting,
    form,
  ]);

  return (
    <>
      <Form {...form}>
        <form className="space-y-8">
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => {
              return (
                <FormItem>
                  <FormLabel>Language</FormLabel>
                  <FormDescription>
                    Control the language used in LLM conversations
                  </FormDescription>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select language" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="zh">中文</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              );
            }}
          />
          <FormField
            control={form.control}
            name="maxLoopCount"
            render={({ field }) => {
              // console.log('field', field);
              return (
                <FormItem>
                  <FormLabel>Max Loop</FormLabel>
                  <FormDescription>
                    Enter a number between 25-200
                  </FormDescription>
                  <FormControl>
                    <Input
                      type="number"
                      {...field}
                      value={field.value === 0 ? '' : field.value}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
          <FormField
            control={form.control}
            name="loopIntervalInMs"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Loop Wait Time (ms)</FormLabel>
                <FormDescription>Enter a number between 0-3000</FormDescription>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="Enter a number between 0-3000"
                    {...field}
                    value={field.value === 0 ? '' : field.value}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="pauseShortcut"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Pause Shortcut</FormLabel>
                <FormDescription>Default: CommandOrControl+P</FormDescription>
                <FormControl>
                  <ShortcutRecorder
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="stopShortcut"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Stop Shortcut</FormLabel>
                <FormDescription>
                  Default: CommandOrControl+Escape
                </FormDescription>
                <FormControl>
                  <ShortcutRecorder
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormItem className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <FormLabel>Auto Annotation</FormLabel>
              <FormDescription>
                Automatically annotate the Feishu UI after each screenshot
              </FormDescription>
            </div>
            <Switch
              checked={!!settings.autoAnnotation}
              onCheckedChange={(checked) =>
                updateSetting({ ...settings, autoAnnotation: checked } as any)
              }
            />
          </FormItem>
        </form>
      </Form>
    </>
  );
}
