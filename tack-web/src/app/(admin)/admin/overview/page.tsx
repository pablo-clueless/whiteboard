"use client";

import { Activity, LayoutGrid, UserCheck, Users } from "lucide-react";
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
import Link from "next/link";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { ActivityList, EmptyNote, Panel } from "@/components/admin";
import { boardName, periodLabel, statItem } from "@/lib/admin";
import { ButtonGroup, Statistics } from "@/components/shared";
import { useValues } from "@/hooks/use-values";
import type { Overview } from "@/types/admin";
import { useApiQuery } from "@/lib/query";
import { PERIODS } from "@/config/params";
import { formatDate } from "@/lib/utils";
import {
  createBaseXAxisConfig,
  totalActiveUsersChartConfig,
  uniqueUsersByBrowserChartConfig,
  uniqueUsersByDeviceChartConfig,
  usersRetentionChartConfig,
} from "@/config/charts";

const Page = () => {
  const { onValueChange, values } = useValues({ period: PERIODS[0].value });
  const { data, isPending } = useApiQuery<Overview>({
    keys: ["admin", "overview"],
    url: "/api/admin/overview",
    params: { period: values.period },
  });

  const against = `the previous ${periodLabel(values.period)}`;
  const totalActiveUsers = (data?.activeUsers ?? []).map((p) => ({
    date: formatDate(p.date, "dd/MM"),
    visitors: p.visitors,
  }));
  const usersRetention = (data?.retention ?? []).map((p) => ({
    date: formatDate(p.date, "dd/MM"),
    visitors: p.visitors,
  }));
  const uniqueUsersByBrowserData = data?.usersByBrowser ?? [];
  const uniqueUsersByDeviceData = data?.usersByDevice ?? [];
  // A pie of zeros draws nothing at all; say so instead.
  const noVisitors = uniqueUsersByBrowserData.every((d) => d.visitors === 0);

  return (
    <div className="space-y-6">
      <Statistics
        items={
          data
            ? [
                statItem(Activity, "Sessions", data.stats.sessions, against),
                statItem(LayoutGrid, "Boards", data.stats.boards, against),
                statItem(UserCheck, "Active Users", data.stats.activeUsers, against),
                statItem(Users, "Total Users", data.stats.totalUsers, against),
              ]
            : []
        }
        isLoading={isPending}
      />
      <div className="flex w-full items-center justify-end">
        <ButtonGroup
          onValueChange={(value) => onValueChange("period", value)}
          options={PERIODS}
          value={values.period}
        />
      </div>
      <div className="grid grid-cols-3 gap-6">
        <Panel className="col-span-2" title="Total Active Users">
          <div className="w-full">
            <ChartContainer className="w-full" config={totalActiveUsersChartConfig}>
              <BarChart accessibilityLayer data={totalActiveUsers}>
                <CartesianGrid vertical={false} />
                <XAxis
                  {...createBaseXAxisConfig("date", {
                    tickFormatter: (value) => value,
                  })}
                />
                <YAxis
                  allowDecimals={false}
                  tickCount={6}
                  domain={[0, "auto"]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Bar
                  dataKey="visitors"
                  fill="var(--color-primary)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ChartContainer>
          </div>
        </Panel>
        <Panel title="Unique Users By Browser">
          {noVisitors && <EmptyNote>No visitors in this period.</EmptyNote>}
          <div className={noVisitors ? "hidden" : "w-full"}>
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
        </Panel>
      </div>
      <div className="grid grid-cols-3 gap-6">
        <Panel title="Unique Users By Device">
          {noVisitors && <EmptyNote>No visitors in this period.</EmptyNote>}
          <div className={noVisitors ? "hidden" : "w-full"}>
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
        </Panel>
        <Panel className="col-span-2" title="Users Retention">
          <div className="w-full">
            <ChartContainer className="w-full" config={usersRetentionChartConfig}>
              <LineChart accessibilityLayer data={usersRetention}>
                <CartesianGrid vertical={false} />
                <XAxis
                  {...createBaseXAxisConfig("date", {
                    tickFormatter: (value) => value,
                  })}
                />
                <YAxis
                  allowDecimals={false}
                  tickCount={6}
                  domain={[0, "auto"]}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 12 }}
                />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                <Line
                  dataKey="visitors"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={false}
                  type="monotone"
                />
              </LineChart>
            </ChartContainer>
          </div>
        </Panel>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <Panel title="Top Boards">
          {data?.topBoards.length ? (
            <ul className="divide-y">
              {data.topBoards.map((board) => (
                <li className="flex items-center justify-between gap-4 py-2 text-sm" key={board.id}>
                  <Link
                    className="truncate font-medium hover:underline"
                    href={`/admin/boards/${board.id}`}
                  >
                    {boardName(board.name, board.id)}
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {board.sessions.toLocaleString()} sessions · {board.visitors.toLocaleString()}{" "}
                    visitors
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No boards opened in this period.</EmptyNote>
          )}
        </Panel>
        <Panel title="Recent Activities">
          <ActivityList items={data?.recentActivity ?? []} />
        </Panel>
      </div>
    </div>
  );
};

export default Page;
