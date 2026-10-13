import { Eye, KeyRound, Trash2, UserCheck, UserX } from "lucide-react";

import { createColumns, DateCell, RelativeTimeCell, StatusCell } from "./core";
import type { User } from "@/types/user";

interface UserActions {
  onView: (user: User) => void;
  onSetStatus: (user: User, status: "active" | "suspended") => void;
  onSendReset: (user: User) => void;
  onDelete: (user: User) => void;
}

export const createUserColumns = (actions: UserActions) =>
  createColumns<User>({
    selectable: true,
    onRowClick: (row) => actions.onView(row.original),
    columns: [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <p className="text-muted-foreground text-xs">{row.original.email}</p>
          </div>
        ),
      },
      {
        accessorKey: "role",
        header: "Role",
        cell: ({ row }) => (
          <span className="capitalize">
            {row.original.type === "superadmin" ? "Superadmin" : row.original.role}
          </span>
        ),
      },
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
        accessorKey: "lastSeenAt",
        header: "Last Seen",
        cell: ({ row }) => <RelativeTimeCell date={row.original.lastSeenAt} />,
      },
      {
        accessorKey: "createdAt",
        header: "Created At",
        cell: ({ row }) => <DateCell date={row.original.createdAt} />,
        enableSorting: true,
      },
    ],
    actions: (user) => [
      { label: "View", icon: Eye, onClick: actions.onView },
      {
        label: "Activate",
        icon: UserCheck,
        variant: "success",
        hidden: user.status === "active",
        onClick: (u) => actions.onSetStatus(u, "active"),
      },
      {
        label: "Suspend",
        icon: UserX,
        variant: "amber",
        hidden: user.status !== "active",
        onClick: (u) => actions.onSetStatus(u, "suspended"),
      },
      { label: "Send reset link", icon: KeyRound, onClick: actions.onSendReset },
      {
        label: "Delete",
        icon: Trash2,
        variant: "destructive",
        hidden: user.status === "deleted",
        onClick: actions.onDelete,
      },
    ],
  });
