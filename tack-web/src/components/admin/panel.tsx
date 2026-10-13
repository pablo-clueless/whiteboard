import React from "react";
import { cn } from "cn";

interface Props {
  title: string;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/** A titled white card, the building block of the admin pages. */
export const Panel = ({ title, action, className, children }: Props) => (
  <div className={cn("space-y-4 rounded-md border bg-white p-4", className)}>
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-medium">{title}</p>
      {action}
    </div>
    {children}
  </div>
);

/** A label and value row, for detail sheets. */
export const DetailRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
    <span className="text-muted-foreground shrink-0">{label}</span>
    <span className="min-w-0 text-right break-all">{children}</span>
  </div>
);

export const EmptyNote = ({ children }: { children: React.ReactNode }) => (
  <p className="text-muted-foreground py-6 text-center text-sm">{children}</p>
);
