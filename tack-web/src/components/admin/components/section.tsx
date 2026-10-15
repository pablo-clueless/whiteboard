"use client";

import { formatDistanceToNow } from "date-fns";
import { History } from "lucide-react";
import React from "react";
import { cn } from "cn";

import { Button } from "@/components/ui/button";
import type { AuditLog } from "@/types/admin";
import type { Section } from "./use-settings";
import { useApiQuery } from "@/lib/query";

interface Props {
  title: string;
  description: string;
  children: React.ReactNode;
  dirty?: boolean;
  saving?: boolean;
  onSave?: () => void;
  onReset?: () => void;
}

/** A settings card with Save and Discard when something changed. */
export const SettingsSection = ({
  title,
  description,
  children,
  dirty,
  saving,
  onSave,
  onReset,
}: Props) => (
  <form
    className="space-y-4 rounded-md border bg-white p-4"
    onSubmit={(e) => {
      e.preventDefault();
      onSave?.();
    }}
  >
    <div>
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground text-sm">{description}</p>
    </div>
    <div className="divide-y">{children}</div>
    {onSave && (
      <div
        className={cn(
          "sticky bottom-0 -mx-4 -mb-4 flex items-center justify-end gap-2 rounded-b-md border-t px-4 py-3",
          dirty ? "bg-amber-50/95" : "bg-white",
        )}
      >
        {dirty && (
          <p className="mr-auto text-xs font-medium text-amber-700">You have unsaved changes</p>
        )}
        <Button disabled={!dirty || saving} onClick={onReset} type="button" variant="outline">
          Discard
        </Button>
        <Button disabled={!dirty || saving} type="submit">
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    )}
  </form>
);

/** A setting's label and description, with the server's complaint about it. */
export const RowLabel = ({
  label,
  description,
  error,
}: {
  label: string;
  description?: string;
  error?: string;
}) => (
  <span className="space-y-0.5">
    <span className="block text-sm font-medium">{label}</span>
    {description && <span className="text-muted-foreground block text-xs">{description}</span>}
    {error && (
      <span className="text-destructive block text-xs" role="alert">
        {error}
      </span>
    )}
  </span>
);

/** A labelled number input with a unit, laid out like a ToggleRow. */
export const NumberRow = ({
  label,
  description,
  unit,
  value,
  min,
  max,
  error,
  onChange,
}: {
  label: string;
  description?: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  error?: string;
  onChange: (value: number) => void;
}) => (
  <label className="flex items-start justify-between gap-6 py-3">
    <RowLabel description={description} error={error} label={label} />
    <span className="flex shrink-0 items-center gap-2">
      <input
        aria-invalid={Boolean(error)}
        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive h-8 w-24 rounded-lg border px-2 text-right text-sm outline-none focus-visible:ring-3"
        max={max}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        required
        type="number"
        value={Number.isFinite(value) ? value : ""}
      />
      <span className="text-muted-foreground w-14 text-xs">{unit}</span>
    </span>
  </label>
);

/** What settings are called on screen, by their key on the server. */
const LABELS: Record<string, string> = {
  allowedOrigins: "Allowed origins",
  idleTimeout: "Idle timeout",
  maintenanceMode: "Maintenance mode",
  sizeLimit: "Board size limit",
  allowNewUsers: "Allow sign-ups",
  maxLoginAttempts: "Failed sign-ins before lockout",
  passwordPolicy: "Password policy",
  retentionPolicy: "Retention",
  automaticDeletion: "Delete old records",
  retentionPeriod: "Retention period",
  sessionTimeout: "Session timeout",
  twoFactorAuthentication: "Two-factor authentication",
  newBoardCreation: "New boards",
  imageUploads: "Image uploads",
  diagramImport: "Diagram import",
  readOnlySwitch: "Read-only switch",
};

const show = (value: unknown): string => {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "none";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
};

type Change = { label: string; from?: string; to: string };

/** The settings one audit entry changed, nested ones (retention) flattened. */
function describeChanges(log: AuditLog): Change[] {
  const meta = (log.metadata ?? {}) as {
    changes?: Record<string, unknown>;
    previous?: Record<string, unknown>;
  };
  const changes: Change[] = [];
  for (const [key, to] of Object.entries(meta.changes ?? {})) {
    const from = meta.previous?.[key];
    if (to && typeof to === "object" && !Array.isArray(to)) {
      for (const [sub, value] of Object.entries(to)) {
        const before =
          from && typeof from === "object" ? (from as Record<string, unknown>)[sub] : undefined;
        changes.push({
          label: LABELS[sub] ?? sub,
          from: before === undefined ? undefined : show(before),
          to: show(value),
        });
      }
    } else {
      changes.push({
        label: LABELS[key] ?? key,
        from: from === undefined ? undefined : show(from),
        to: show(to),
      });
    }
  }
  return changes;
}

function describeFlag(log: AuditLog): string {
  const meta = (log.metadata ?? {}) as { name?: string; enabled?: boolean };
  const id = log.resource.replace(/^feature_flag:/, "");
  if (log.action === "feature_flag.created")
    return `added flag ${meta.name ?? id} (${show(meta.enabled)})`;
  if (log.action === "feature_flag.deleted") return `removed flag ${id}`;
  return `turned flag ${id} ${show(meta.enabled)}`;
}

/**
 * Who changed what in one settings section, newest first. `flags` shows feature flag changes
 * instead.
 */
export const SettingsHistory = ({ section }: { section: Section | "flags" }) => {
  const { data, isPending } = useApiQuery<AuditLog[]>({
    keys: ["admin", "settings-history"],
    url: "/api/admin/settings/history",
    params: { section: section === "flags" ? undefined : section },
  });
  const logs = (data ?? []).filter((l) =>
    section === "flags" ? l.resource.startsWith("feature_flag:") : true,
  );

  return (
    <div className="space-y-3 rounded-md border bg-white p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <History className="text-muted-foreground size-4" /> Recent changes
      </p>
      {logs.length ? (
        <ul className="divide-y">
          {logs.map((log) => (
            <li className="space-y-1 py-2 text-sm" key={log.id}>
              <p className="text-muted-foreground text-xs">
                <span className="text-foreground font-medium">{log.user}</span> ·{" "}
                <span title={new Date(log.createdAt).toLocaleString()}>
                  {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                </span>
              </p>
              {section === "flags" ? (
                <p>{describeFlag(log)}</p>
              ) : (
                <ul className="space-y-0.5">
                  {describeChanges(log).map((c, i) => (
                    <li key={i}>
                      {c.label}:{" "}
                      {c.from !== undefined && (
                        <>
                          <span className="text-muted-foreground line-through">{c.from}</span>{" "}
                          →{" "}
                        </>
                      )}
                      <span className="font-medium">{c.to}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground py-2 text-sm">
          {isPending ? "Loading…" : "No changes recorded yet."}
        </p>
      )}
    </div>
  );
};
