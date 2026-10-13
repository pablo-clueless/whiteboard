import type { XAxisProps } from "recharts";

import type { ChartConfig } from "@/components/ui/chart";

export function createBaseXAxisConfig(dataKey: string, options?: XAxisProps): XAxisProps {
  return {
    dataKey,
    tickLine: false,
    tickMargin: 10,
    axisLine: false,
    ...options,
  };
}

export const totalActiveUsersChartConfig: ChartConfig = {
  visitors: { label: "Visitors", color: "var(--color-primary)" },
};

export const usersRetentionChartConfig: ChartConfig = {
  visitors: { label: "Visitors", color: "var(--color-primary)" },
};

export const uniqueUsersByBrowserChartConfig: ChartConfig = {
  chrome: { label: "Chrome", color: "var(--color-red-500)" },
  firefox: { label: "Firefox", color: "var(--color-blue-500)" },
  safari: { label: "Safari", color: "var(--color-yellow-500)" },
  edge: { label: "Edge", color: "var(--color-green-500)" },
  others: { label: "Others", color: "var(--color-gray-500)" },
};

export const uniqueUsersByDeviceChartConfig: ChartConfig = {
  desktop: { label: "Desktop", color: "var(--color-red-500)" },
  tablet: { label: "Tablet", color: "var(--color-yellow-500)" },
  mobile: { label: "Mobile", color: "var(--color-blue-500)" },
};
