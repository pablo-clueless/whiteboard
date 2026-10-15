import type { ColumnFiltersState } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";

import type { Stat } from "@/types/admin";
import { PERIODS } from "@/config/params";

/** "7 days", "1 month", … for a period in days. */
export function periodLabel(period: string | number) {
  return PERIODS.find((p) => p.value === String(period))?.label ?? `${period} days`;
}

/** A Statistics card from an API stat: the value, and its change against `against`. */
export function statItem(icon: LucideIcon, label: string, stat: Stat | undefined, against: string) {
  if (!stat) return { icon, label, value: "—", description: "" };
  const delta =
    stat.delta === null ? "new" : `${stat.delta > 0 ? "+" : ""}${stat.delta.toLocaleString()}%`;
  return {
    icon,
    label,
    value: stat.value.toLocaleString(),
    // No arrow for "no change", so a quiet period doesn't read as growth.
    delta: stat.delta === 0 || stat.delta === null ? undefined : delta,
    description: stat.delta === null ? `Up from 0 vs ${against}` : `${delta} vs ${against}`,
  };
}

/** Untitled boards show the start of their id. */
export function boardName(name: string | null | undefined, id: string) {
  return name?.trim() || `Untitled · ${id.slice(0, 8)}`;
}

export function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Table filters as the API's comma-separated query params: `{ status: "active,archived" }`. */
export function filterParams(filters: ColumnFiltersState) {
  return Object.fromEntries(
    filters.map((f) => [f.id, ((f.value as string[]) ?? []).join(",")]),
  ) as Record<string, string>;
}

/** Turns `{ a: true, b: false }` (a table's row selection) into `["a"]`. */
export function selectedIds(selection: Record<string, boolean>) {
  return Object.entries(selection)
    .filter(([, selected]) => selected)
    .map(([id]) => id);
}
