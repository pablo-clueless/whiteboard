"use client";

import { ReactNode } from "react";
import Image from "next/image";
import { cn } from "cn";

export type EmptyStateProps = {
  title: string;
  action?: ReactNode;
  className?: string;
  description?: string;
};

const IMAGE = "/assets/empty-folder.svg";

export const EmptyState = ({ title, action, className, description }: EmptyStateProps) => {
  return (
    <div className={cn("grid h-100 w-full place-items-center", className)}>
      <div className="flex flex-col items-center gap-y-4">
        <div className="relative aspect-square size-50">
          <Image alt="empty-folder" fill src={IMAGE} />
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
