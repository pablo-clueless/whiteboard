"use client";

import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "cn";

import { getDelta } from "@/lib/utils";

type Variant = "negative" | "neutral" | "positive";

interface StatisticsItem {
  icon: LucideIcon;
  label: string;
  value: number | string;
  delta?: string;
  description?: string;
  variant?: Variant;
}

interface Props {
  items: StatisticsItem[];
  isLoading?: boolean;
}

const STATISTICS_VARIANT_CLASS: Record<Variant, string> = {
  negative: "bg-red-50 text-red-500 border-red-500",
  neutral: "bg-white text-ink border-border",
  positive: "bg-green-50 text-green-500 border-green-500",
};

const STATISTICS_VARIANT_ICONS: Record<Variant, LucideIcon> = {
  negative: TrendingDown,
  neutral: Minus,
  positive: TrendingUp,
};

const getGridCols = (items: number) => {
  if (items <= 2) return "grid-cols-1";
  if (items <= 4) return "grid-cols-2";
  return "grid-cols-4";
};

export const Statistics = ({ items, isLoading = false }: Props) => {
  const grids = getGridCols(items.length);

  if (isLoading && items.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, index) => (
          <div
            className="bg-primary/5 border-primary space-y-4 rounded border px-4 py-6"
            key={index}
          >
            <div className="flex items-center justify-between">
              <div className="bg-primary/50 h-4 w-30 animate-pulse rounded-md"></div>
              <div className="bg-primary/50 size-4 animate-pulse rounded-md"></div>
            </div>
            <div className="bg-primary/50 h-10 w-20 animate-pulse rounded-md"></div>
            <div className="flex items-center justify-between">
              <div className="bg-primary/50 h-2 w-40 animate-pulse rounded-md"></div>
              <div className="bg-primary/50 size-2 animate-pulse rounded-md"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4", grids)}>
      {items.map((item, index) => {
        const variant = STATISTICS_VARIANT_CLASS[item.variant || "neutral"];
        const delta = getDelta(item.delta);
        const Icon = STATISTICS_VARIANT_ICONS[delta];
        const deltaVariant = STATISTICS_VARIANT_CLASS[delta];

        return (
          <div className={cn("space-y-4 rounded border px-4 py-6", variant)} key={index}>
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">{item.label}</p>
              <item.icon className="size-4" />
            </div>
            <p className="text-4xl font-semibold">{item.value}</p>
            <div className="flex w-full items-center justify-between">
              <p className="text-xs">{item.description}</p>
              <Icon className={cn("size-4", deltaVariant)} />
            </div>
          </div>
        );
      })}
    </div>
  );
};
