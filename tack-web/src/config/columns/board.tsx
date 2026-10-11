import { createColumns, DateCell, StatusCell } from "./core";
import { Checkbox } from "@/components/ui/checkbox";

export type Board = {
  id: string;
  name: string;
  owner: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export const boardColumns = createColumns<Board>({
  columns: [
    { id: "select", header: () => <Checkbox />, cell: () => <Checkbox /> },
    { accessorKey: "name", header: "Name" },
    { accessorKey: "owner", header: "Owner" },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusCell
          status={row.original.status}
          config={{ active: "success", archived: "neutral" }}
        />
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created At",
      cell: ({ row }) => <DateCell date={row.original.createdAt} />,
      enableSorting: true,
    },
    {
      accessorKey: "updatedAt",
      header: "Updated At",
      cell: ({ row }) => <DateCell date={row.original.updatedAt} />,
      enableSorting: true,
    },
  ],
  actions: () => [],
});
