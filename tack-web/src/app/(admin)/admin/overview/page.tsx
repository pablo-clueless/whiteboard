"use client";

import { Users } from "lucide-react";
import { subDays } from "date-fns";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ButtonGroup, Statistics } from "@/components/shared";
import { useValues } from "@/hooks/use-values";
import { PERIODS } from "@/config/params";
import { formatDate } from "@/lib/utils";
import {
  createBaseXAxisConfig,
  totalActiveUsersChartConfig,
  uniqueUsersByBrowserChartConfig,
  uniqueUsersByDeviceChartConfig,
  usersRetentionChartConfig,
} from "@/config/charts";

const uniqueUsersByBrowserData = [
  { browser: "chrome", visitors: 1 },
  { browser: "firefox", visitors: 1 },
  { browser: "safari", visitors: 1 },
  { browser: "edge", visitors: 1 },
  { browser: "others", visitors: 1 },
];

const uniqueUsersByDeviceData = [
  { device: "desktop", visitors: 1 },
  { device: "tablet", visitors: 1 },
  { device: "mobile", visitors: 1 },
];

const Page = () => {
  const { onValueChange, values } = useValues({ period: PERIODS[0].value });

  const totalActiveUsers = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    return { date: formatDate(date), visitors: 0 };
  });

  const usersRetention = Array.from({ length: 7 }, (_, i) => {
    const date = subDays(new Date(), 6 - i);
    return { date: formatDate(date), visitors: 0 };
  });

  return (
    <div className="space-y-6">
      <Statistics
        items={[
          {
            icon: Users,
            label: "Sessions",
            value: "0",
            description: "+0% from last month",
            delta: "+0%",
          },
          {
            icon: Users,
            label: "Boards",
            value: "0",
            description: "+0% from last month",
            delta: "+0%",
          },
          {
            icon: Users,
            label: "Active Users",
            value: "0",
            description: "+0% from last month",
            delta: "+0%",
          },
          {
            icon: Users,
            label: "Total Users",
            value: "0",
            description: "+0% from last month",
            delta: "+0%",
          },
        ]}
        isLoading={true}
      />
      <div className="flex w-full items-center justify-end">
        <ButtonGroup
          onValueChange={(value) => onValueChange("period", value)}
          options={PERIODS}
          value={values.period}
        />
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium">Total Active Users</p>
          <div className="w-full">
            <ChartContainer className="w-full" config={totalActiveUsersChartConfig}>
              <BarChart accessibilityLayer data={totalActiveUsers}>
                <CartesianGrid vertical={false} />
                <XAxis
                  {...createBaseXAxisConfig("date", {
                    tickFormatter: (value) => formatDate(value),
                  })}
                />
                <YAxis
                  tickCount={6}
                  domain={[0, 50]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="visitors" fill="var(--color-primary)" radius={8} />
              </BarChart>
            </ChartContainer>
          </div>
        </div>
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium">Unique Users By Browser</p>
          <div className="w-full">
            <ChartContainer
              config={uniqueUsersByBrowserChartConfig}
              className="mx-auto aspect-square max-h-62.5"
            >
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie
                  data={uniqueUsersByBrowserData}
                  dataKey="visitors"
                  nameKey="browser"
                  innerRadius={75}
                >
                  {uniqueUsersByBrowserData.map((entry) => (
                    <Cell
                      key={entry.browser}
                      fill={uniqueUsersByBrowserChartConfig[entry.browser]?.color}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium">Unique Users By Device</p>
          <div className="w-full">
            <ChartContainer
              config={uniqueUsersByDeviceChartConfig}
              className="mx-auto aspect-square max-h-62.5"
            >
              <PieChart>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Pie
                  data={uniqueUsersByDeviceData}
                  dataKey="visitors"
                  nameKey="device"
                  innerRadius={75}
                >
                  {uniqueUsersByDeviceData.map((entry) => (
                    <Cell
                      key={entry.device}
                      fill={uniqueUsersByDeviceChartConfig[entry.device]?.color}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
          </div>
        </div>
        <div className="col-span-2 space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium">Users Retention</p>
          <div className="w-full">
            <ChartContainer className="w-full" config={usersRetentionChartConfig}>
              <LineChart accessibilityLayer data={usersRetention}>
                <CartesianGrid vertical={false} />
                <XAxis
                  {...createBaseXAxisConfig("date", {
                    tickFormatter: (value) => formatDate(value),
                  })}
                />
                <YAxis
                  tickCount={6}
                  domain={[0, 50]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Line dataKey="visitors" fill="var(--color-primary)" radius={8} />
              </LineChart>
            </ChartContainer>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium"></p>
          <div className="w-full"></div>
        </div>
        <div className="space-y-4 rounded-md border bg-white p-4">
          <p className="text-sm font-medium">Recent Activities</p>
          <div className="w-full"></div>
        </div>
      </div>
    </div>
  );
};

export default Page;
