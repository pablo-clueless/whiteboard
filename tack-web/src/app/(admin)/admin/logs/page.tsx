"use client";

import { ClipboardList } from "lucide-react";

import type { AuditLog, LogStats, Page as ListPage } from "@/types/admin";
import { DataTable, Statistics } from "@/components/shared";
import { useTableParams } from "@/hooks/use-table-params";
import { actionLabel } from "@/components/admin";
import { logColumns } from "@/config/columns/log";
import type { Option } from "@/types/app";
import { useApiQuery } from "@/lib/query";
import { statItem } from "@/lib/admin";

const Page = () => {
  const { params, tableProps } = useTableParams(20);

  const stats = useApiQuery<LogStats>({ keys: ["admin", "logs", "stats"], url: "/api/admin/logs/stats" });
  const actions = useApiQuery<Option[]>({ keys: ["admin", "logs", "actions"], url: "/api/admin/logs/actions" });
  const list = useApiQuery<ListPage<AuditLog>>({
    keys: ["admin", "logs", "list"],
    url: "/api/admin/logs",
    params,
  });

  const s = stats.data;

  return (
    <div className="space-y-6 overflow-y-auto">
      <Statistics
        items={
          s
            ? [
                statItem(ClipboardList, "Total Logs", s.total, "30 days ago"),
                statItem(ClipboardList, "Today's Logs", s.today, "yesterday"),
                statItem(ClipboardList, "This Week", s.thisWeek, "the week before"),
                statItem(ClipboardList, "This Month", s.thisMonth, "the month before"),
              ]
            : []
        }
        isLoading={stats.isPending}
      />
      <DataTable
        {...tableProps}
        columns={logColumns}
        data={list.data?.data ?? []}
        total={list.data?.total ?? 0}
        filters={[
          {
            key: "action",
            label: "Action",
            options: (actions.data ?? []).map((a) => ({ ...a, label: actionLabel(a.value) })),
            type: "checkbox",
          },
        ]}
        empty={{ title: "No logs", description: "Nothing matches the current search or filters." }}
        showPageSizeChange
      />
    </div>
  );
};

export default Page;
