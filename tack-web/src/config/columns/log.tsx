import { createColumns, DateTimeCell } from "./core";

export type AuditLog = {
  id: string;
  user: string;
  action: string;
  resource: string;
  createdAt: string;
};

export const logColumns = createColumns<AuditLog>({
  columns: [
    { accessorKey: "user", header: "User" },
    { accessorKey: "action", header: "Action" },
    { accessorKey: "resource", header: "Resource" },
    {
      accessorKey: "createdAt",
      header: "Date",
      cell: ({ row }) => <DateTimeCell date={row.original.createdAt} />,
      enableSorting: true,
    },
  ],
  actions: () => [],
});
