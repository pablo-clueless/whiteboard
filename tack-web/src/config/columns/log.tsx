import { actionLabel } from "@/components/admin/activity-list";
import { createColumns, DateTimeCell, TextCell } from "./core";
import type { AuditLog } from "@/types/admin";

export const logColumns = createColumns<AuditLog>({
  columns: [
    { accessorKey: "user", header: "User" },
    {
      accessorKey: "action",
      header: "Action",
      cell: ({ row }) => (
        <span title={row.original.action}>{actionLabel(row.original.action)}</span>
      ),
    },
    {
      accessorKey: "resource",
      header: "Resource",
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.resource}</span>,
    },
    {
      accessorKey: "metadata",
      header: "Details",
      cell: ({ row }) => {
        const entries = Object.entries(row.original.metadata ?? {}).filter(
          ([, v]) => v !== null && v !== undefined,
        );
        const text = entries
          .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
          .join(", ");
        return <TextCell className="max-w-72 truncate text-xs" value={text} />;
      },
    },
    { accessorKey: "ip", header: "IP", cell: ({ row }) => <TextCell value={row.original.ip} /> },
    {
      accessorKey: "createdAt",
      header: "Date",
      cell: ({ row }) => <DateTimeCell date={row.original.createdAt} />,
      enableSorting: true,
    },
  ],
  actions: () => [],
});
