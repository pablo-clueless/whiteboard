"use client";

import { LucideIcon, SearchX } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "cn";

export type EmptyStateProps = {
  title: string;
  action?: ReactNode;
  className?: string;
  description?: string;
  icon?: LucideIcon;
};

export const EmptyState = ({
  title,
  action,
  className,
  description,
  icon: Icon = SearchX,
}: EmptyStateProps) => {
  return (
    <div className={cn("grid h-100 w-full place-items-center", className)}>
      <div className="flex w-2/3 flex-col items-center gap-y-4">
        <div>
          <Icon className="size-20" />
        </div>
        <div className="text-center">
          <p className="text-xl font-medium">{title}</p>
          <p className="text-muted-foreground text-sm">{description}</p>
          {action}
        </div>
      </div>
    </div>
  );
};
