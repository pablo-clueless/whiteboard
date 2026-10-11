import { createColumns, DateCell, StatusCell } from "./core";
import { Checkbox } from "@/components/ui/checkbox";
import { User } from "@/types/user";

export const userColumns = createColumns<User>({
  columns: [
    { id: "select", header: () => <Checkbox />, cell: ({}) => <Checkbox /> },
    { accessorKey: "name", header: "Name" },
    { accessorKey: "email", header: "Email" },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <StatusCell
          status={row.original.status}
          config={{
            active: "success",
            deleted: "danger",
            inactive: "neutral",
            pending: "warning",
            suspended: "amber",
          }}
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
