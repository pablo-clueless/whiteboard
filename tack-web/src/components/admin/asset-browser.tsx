"use client";

import { useQuery } from "@tanstack/react-query";
import { ScanSearch, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { createColumns, DateCell } from "@/config/columns/core";
import type { Asset, Page } from "@/types/admin";
import { useTableParams } from "@/hooks/use-table-params";
import { useApiMutation, useApiQuery } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared";
import { boardName, formatBytes } from "@/lib/admin";
import { assetUrl } from "@/lib/api";
import { http } from "@/lib/client";
import { useConfirm } from "./confirm";
import { Panel } from "./panel";

type AssetPage = Page<Asset> & { totalBytes: number };
type Orphans = { assets: Asset[]; totalBytes: number; boardsScanned: number };

const MIME_OPTIONS = ["image/png", "image/jpeg", "image/webp", "image/gif"].map((m) => ({
  label: m.replace("image/", "").toUpperCase(),
  value: m,
}));

const KEYS = [["admin", "assets"], ["admin", "boards"]];

/** Uploaded images: browse by board and type, delete one, or clean up the ones nothing uses. */
export const AssetBrowser = () => {
  const { params, tableProps } = useTableParams();
  const { dialog, confirm } = useConfirm();

  const list = useApiQuery<AssetPage>({
    keys: ["admin", "assets", "list"],
    url: "/api/admin/assets",
    // The list has no text search; paging and filters only.
    params: { ...params, search: undefined },
  });
  // Loads every board, so it only runs when asked.
  const orphans = useQuery({
    queryKey: ["admin", "assets", "orphans"],
    queryFn: () => http.get<Orphans>("/api/admin/assets/orphans"),
    enabled: false,
  });

  const remove = useApiMutation<{ id: string }>({
    keys: KEYS,
    method: "delete",
    url: ({ id }) => `/api/admin/assets/${id}`,
    successMessage: "Image deleted",
  });
  const removeOrphans = useApiMutation<void, Orphans>({
    keys: KEYS,
    method: "delete",
    url: "/api/admin/assets/orphans",
    successMessage: "Unused images deleted",
  });

  const columns = useMemo(
    () =>
      createColumns<Asset>({
        columns: [
          {
            id: "preview",
            header: "",
            cell: ({ row }) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="size-10 rounded border object-cover"
                loading="lazy"
                src={assetUrl(row.original.id)}
              />
            ),
          },
          {
            accessorKey: "boardTitle",
            header: "Board",
            cell: ({ row }) => boardName(row.original.boardTitle, row.original.boardId),
          },
          {
            accessorKey: "mime",
            header: "Type",
            cell: ({ row }) => row.original.mime.replace("image/", "").toUpperCase(),
          },
          { accessorKey: "size", header: "Size", cell: ({ row }) => formatBytes(row.original.size) },
          {
            accessorKey: "createdAt",
            header: "Uploaded",
            cell: ({ row }) => <DateCell date={row.original.createdAt} />,
          },
        ],
        actions: () => [
          {
            label: "Delete",
            icon: Trash2,
            variant: "destructive",
            onClick: (asset) =>
              confirm({
                title: "Delete this image?",
                description: "Any board showing it will show a broken image instead.",
                confirmLabel: "Delete",
                destructive: true,
                onConfirm: () => remove.mutate({ id: asset.id }),
              }),
          },
        ],
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const found = orphans.data;

  return (
    <div className="space-y-6">
      <Panel
        title="Unused Images"
        action={
          <Button
            disabled={orphans.isFetching}
            onClick={() => orphans.refetch()}
            size="sm"
            variant="outline"
          >
            <ScanSearch /> {orphans.isFetching ? "Scanning…" : "Scan boards"}
          </Button>
        }
      >
        {found ? (
          <div className="flex items-center justify-between gap-4 text-sm">
            <p>
              {found.assets.length
                ? `${found.assets.length} images (${formatBytes(found.totalBytes)}) aren't used by any of ${found.boardsScanned} boards.`
                : `Every image is in use across ${found.boardsScanned} boards.`}
            </p>
            {found.assets.length > 0 && (
              <Button
                disabled={removeOrphans.isPending}
                onClick={() =>
                  confirm({
                    title: `Delete ${found.assets.length} unused images?`,
                    description: `Frees ${formatBytes(found.totalBytes)}. Images uploaded in the last hour are never counted as unused.`,
                    confirmLabel: "Delete",
                    destructive: true,
                    onConfirm: () =>
                      removeOrphans.mutate(undefined, { onSuccess: () => orphans.refetch() }),
                  })
                }
                size="sm"
                variant="destructive"
              >
                Delete unused
              </Button>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">
            Finds images no board shows any more. It reads every board, so it can take a while.
          </p>
        )}
      </Panel>
      <div className="space-y-2">
        <p className="text-muted-foreground text-xs">
          {list.data ? `${list.data.total} images · ${formatBytes(list.data.totalBytes)}` : " "}
        </p>
        <DataTable
          {...tableProps}
          onSearch={undefined}
          columns={columns}
          data={list.data?.data ?? []}
          total={list.data?.total ?? 0}
          filters={[{ key: "mime", label: "Type", options: MIME_OPTIONS, type: "checkbox" }]}
          empty={{ title: "No images", description: "Nothing has been uploaded yet." }}
        />
      </div>
      {dialog}
    </div>
  );
};
