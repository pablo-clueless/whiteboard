"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";

import type { SystemConfiguration } from "@/types/system";
import { useApiMutation, useApiQuery } from "@/lib/query";

export const SETTINGS_KEY = ["admin", "settings"];

export type Section = "platform" | "security" | "board";

export function useSettings() {
  return useApiQuery<SystemConfiguration>({ keys: SETTINGS_KEY, url: "/api/admin/settings" });
}

/** Which settings forms have unsaved changes, so the page can warn before they're lost. */
export const useSettingsDirty = create<{
  dirty: Record<string, boolean>;
  setDirty: (form: string, dirty: boolean) => void;
}>()((set) => ({
  dirty: {},
  setDirty: (form, dirty) => set((s) => ({ dirty: { ...s.dirty, [form]: dirty } })),
}));

/** Reports whether `form` has unsaved changes, while it's on screen. */
export function useReportDirty(form: string, dirty: boolean) {
  const setDirty = useSettingsDirty((s) => s.setDirty);
  useEffect(() => {
    setDirty(form, dirty);
  }, [form, dirty, setDirty]);
  useEffect(() => () => setDirty(form, false), [form, setDirty]);
}

/**
 * A local copy of one settings section to edit, and a save that sends only what changed (the
 * server merges partial updates). A setting the server refuses gets its message in `errors`,
 * keyed like the server names it (`sessionTimeout`, `retentionPolicy.retentionPeriod`).
 */
export function useSectionDraft<T extends object>(section: Section, saved: T) {
  const [draft, setDraft] = useState<T>(saved);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation<Partial<T>>({
    keys: [SETTINGS_KEY, ["admin", "settings-history"]],
    method: "patch",
    url: `/api/admin/settings/${section}`,
    successMessage: "Settings saved",
    onFieldError: (field, message) => setErrors({ [field]: message }),
  });

  const changes = Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(saved[key as keyof T]),
    ),
  ) as Partial<T>;
  const dirty = Object.keys(changes).length > 0;
  useReportDirty(section, dirty);

  return {
    draft,
    errors,
    set: <K extends keyof T>(key: K, value: T[K]) => {
      setDraft((d) => ({ ...d, [key]: value }));
      // Editing a setting clears its error, nested ones included.
      setErrors((e) =>
        Object.fromEntries(
          Object.entries(e).filter(([field]) => field !== key && !field.startsWith(`${String(key)}.`)),
        ),
      );
    },
    reset: () => {
      setDraft(saved);
      setErrors({});
    },
    dirty,
    saving: save.isPending,
    save: () => dirty && save.mutate(changes),
  };
}
