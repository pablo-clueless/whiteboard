"use client";

import { Archive, ImageIcon, LayoutGrid, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { AssetBrowser, BoardSheet, useConfirm } from "@/components/admin";
import { ButtonGroup, DataTable, Statistics, TabList } from "@/components/shared";
import type { Board, BoardStats, BulkResult, Page as ListPage } from "@/types/admin";
import { periodLabel, selectedIds, statItem } from "@/lib/admin";
import { createBoardColumns } from "@/config/columns/board";
import { useTableParams } from "@/hooks/use-table-params";
import { useApiMutation, useApiQuery } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { useValues } from "@/hooks/use-values";
import { PERIODS } from "@/config/params";

const KEYS = [["admin", "boards"], ["admin", "board"]];

const TABS = [
  { label: "Boards", value: "boards", icon: LayoutGrid },
  { label: "Images", value: "images", icon: ImageIcon },
];

const STATUS_OPTIONS = [
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
];

/** `?board=<id>` (from the overview's top boards) opens that board's sheet. */
const BoardFromUrl = ({ onOpen }: { onOpen: (id: string) => void }) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = searchParams.get("board");
  useEffect(() => {
    if (!id) return;
    onOpen(id);
    // Consume it, so closing the sheet doesn't reopen it.
    router.replace("/admin/boards");
  }, [id, onOpen, router]);
  return null;
};

const Page = () => {
  const [tab, setTab] = useState(TABS[0].value);
  const [viewing, setViewing] = useState<string | null>(null);
  const { onValueChange, values } = useValues({ period: PERIODS[0].value });
  const { params, tableProps, rowSelection, clearSelection } = useTableParams();
  const { dialog, confirm } = useConfirm();

  const stats = useApiQuery<BoardStats>({
    keys: ["admin", "boards", "stats"],
    url: "/api/admin/boards/stats",
    params: { period: values.period },
  });
  const list = useApiQuery<ListPage<Board>>({
    keys: ["admin", "boards", "list"],
    url: "/api/admin/boards",
    params,
  });

  const archive = useApiMutation<{ id: string; archived: boolean }>({
    keys: KEYS,
    method: "post",
    url: ({ id, archived }) => `/api/admin/boards/${id}/${archived ? "archive" : "unarchive"}`,
    successMessage: "Board updated",
  });
  const remove = useApiMutation<{ id: string }>({
    keys: KEYS,
    method: "delete",
    url: ({ id }) => `/api/admin/boards/${id}`,
    successMessage: "Board deleted",
  });
  const bulk = useApiMutation<{ ids: string[]; action: string }, BulkResult>({
    keys: KEYS,
    method: "post",
    url: "/api/admin/boards/bulk",
    successMessage: "Boards updated",
  });

  const runBulk = (action: "archive" | "unarchive" | "delete") =>
    bulk.mutate({ ids: selectedIds(rowSelection), action }, { onSuccess: clearSelection });

  const columns = useMemo(
    () =>
      createBoardColumns({
        onView: (board) => setViewing(board.id),
        onArchive: (board, archived) => archive.mutate({ id: board.id, archived }),
        onDelete: (board) =>
          confirm({
            title: `Delete ${board.name || "this board"}?`,
            description:
              "Its history, share links and images are deleted for good. Anyone connected is disconnected.",
            confirmLabel: "Delete board",
            destructive: true,
            onConfirm: () => remove.mutate({ id: board.id }),
          }),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const against = `the previous ${periodLabel(values.period)}`;
  const s = stats.data;

  return (
    <div className="space-y-6 overflow-y-auto">
      <Suspense fallback={null}>
        <BoardFromUrl onOpen={setViewing} />
      </Suspense>
      <Statistics
        items={
          s
            ? [
                statItem(LayoutGrid, "Total Boards", s.totalBoards, against),
                statItem(LayoutGrid, "Active Boards", s.activeBoards, against),
                statItem(Users, "Collaborators", s.collaborators, against),
                statItem(Archive, "Archived Boards", s.archivedBoards, against),
              ]
            : []
        }
        isLoading={stats.isPending}
      />
      <div className="flex w-full items-center justify-between gap-4">
        <TabList className="w-64" onValueChange={setTab} options={TABS} value={tab} />
        {tab === "boards" && (
          <ButtonGroup
            onValueChange={(value) => onValueChange("period", value)}
            options={PERIODS}
            value={values.period}
          />
        )}
      </div>
      {tab === "boards" ? (
        <DataTable
          {...tableProps}
          columns={columns}
          data={list.data?.data ?? []}
          total={list.data?.total ?? 0}
          getRowId={(board) => board.id}
          filters={[{ key: "status", label: "Status", options: STATUS_OPTIONS, type: "checkbox" }]}
          selectionActions={
            <>
              <Button onClick={() => runBulk("archive")} size="sm" variant="outline">
                Archive
              </Button>
              <Button onClick={() => runBulk("unarchive")} size="sm" variant="outline">
                Restore
              </Button>
              <Button
                onClick={() =>
                  confirm({
                    title: `Delete ${selectedIds(rowSelection).length} boards?`,
                    description: "Their history, share links and images are deleted for good.",
                    confirmLabel: "Delete",
                    destructive: true,
                    onConfirm: () => runBulk("delete"),
                  })
                }
                size="sm"
                variant="destructive"
              >
                Delete
              </Button>
            </>
          }
          showPageSizeChange
        />
      ) : (
        <AssetBrowser />
      )}
      <BoardSheet boardId={viewing} onClose={() => setViewing(null)} />
      {dialog}
    </div>
  );
};

export default Page;
