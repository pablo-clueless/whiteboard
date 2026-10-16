"use client";

import React, { useId } from "react";
import { cn } from "cn";

import { Switch } from "@/components/ui/switch";
import type { Option } from "@/types/app";

/** A labelled form control. */
export const FormField = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: (id: string) => React.ReactNode;
}) => {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
};

export const NativeSelect = ({
  options,
  className,
  ...props
}: React.ComponentProps<"select"> & { options: Option[] }) => (
  <select
    className={cn(
      "border-input focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-lg border bg-transparent px-2 text-sm outline-none focus-visible:ring-3 disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {options.map((o) => (
      <option key={o.value} value={o.value}>
        {o.label}
      </option>
    ))}
  </select>
);

/** A setting that's on or off, with what it does. */
export const ToggleRow = ({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <label className="space-y-0.5" htmlFor={id}>
        <span className="block text-sm font-medium">{label}</span>
        {description && <span className="text-muted-foreground block text-xs">{description}</span>}
      </label>
      <Switch
        checked={checked}
        disabled={disabled}
        id={id}
        onCheckedChange={(value: boolean) => onCheckedChange(value)}
      />
    </div>
  );
};

export const ROLE_OPTIONS: Option[] = [
  { label: "Viewer", value: "viewer" },
  { label: "Owner", value: "owner" },
  { label: "Admin", value: "admin" },
];

export const STATUS_OPTIONS: Option[] = [
  { label: "Active", value: "active" },
  { label: "Pending", value: "pending" },
  { label: "Inactive", value: "inactive" },
  { label: "Suspended", value: "suspended" },
  { label: "Deleted", value: "deleted" },
];
