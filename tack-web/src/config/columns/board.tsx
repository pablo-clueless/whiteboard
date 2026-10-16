import { Archive, ArchiveRestore, Eye, Trash2 } from "lucide-react";

import { createColumns, DateCell, RelativeTimeCell, StatusCell, TextCell } from "./core";
import type { Board } from "@/types/admin";
import { boardName, formatBytes } from "@/lib/admin";

interface BoardActions {
  onView: (board: Board) => void;
  onArchive: (board: Board, archived: boolean) => void;
  onDelete: (board: Board) => void;
}

export const createBoardColumns = (actions: BoardActions) =>
  createColumns<Board>({
    selectable: true,
    onRowClick: (row) => actions.onView(row.original),
    columns: [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{boardName(row.original.name, row.original.id)}</span>
            {row.original.connected > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700"
                title="Connected right now"
              >
                <span className="size-1.5 rounded-full bg-green-500" />
                {row.original.connected} live
              </span>
            )}
          </div>
        ),
      },
      {
        accessorKey: "owner",
        header: "Owner",
        cell: ({ row }) => <TextCell value={row.original.owner} />,
      },
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
        accessorKey: "sizeBytes",
        header: "Size",
        cell: ({ row }) => (
          <span
            title={`${row.original.assetCount} images, ${formatBytes(row.original.assetBytes)}`}
          >
            {formatBytes(row.original.sizeBytes + row.original.assetBytes)}
          </span>
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
        header: "Last Edited",
        cell: ({ row }) => <RelativeTimeCell date={row.original.updatedAt} />,
        enableSorting: true,
      },
    ],
    actions: (board) => [
      { label: "View", icon: Eye, onClick: actions.onView },
      board.status === "active"
        ? { label: "Archive", icon: Archive, onClick: (b) => actions.onArchive(b, true) }
        : { label: "Restore", icon: ArchiveRestore, onClick: (b) => actions.onArchive(b, false) },
      { label: "Delete", icon: Trash2, variant: "destructive", onClick: actions.onDelete },
    ],
  });
