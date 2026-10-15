"use client";

import {
  Archive,
  ArchiveRestore,
  Copy,
  ExternalLink,
  Link2,
  Lock,
  LockOpen,
  Trash2,
  Unplug,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useRouter } from "next/navigation";
import React, { useState } from "react";
import { toast } from "sonner";

import { useApiMutation, useApiQuery } from "@/lib/query";
import { useBreadcrumbLabel } from "@/stores/breadcrumbs";
import { boardName, formatBytes } from "@/lib/admin";
import { StatusCell } from "@/config/columns/core";
import { DetailRow, EmptyNote, Panel } from "./panel";
import { EmptyState } from "@/components/shared";
import type { BoardDetail } from "@/types/admin";
import { Button } from "@/components/ui/button";
import { shareUrl } from "@/lib/board-links";
import { ActivityList } from "./activity-list";
import { BackLink } from "./user-detail";
import { HttpError } from "@/lib/client";
import { useConfirm } from "./confirm";

const KEYS = [
  ["admin", "boards"],
  ["admin", "board"],
  ["admin", "live"],
];

const ago = (date: string | null) =>
  date ? formatDistanceToNow(new Date(date), { addSuffix: true }) : "never";

/** One board's page: storage, its live room, share links and activity. */
export const BoardDetailView = ({ boardId }: { boardId: string }) => {
  const { data: board, error } = useApiQuery<BoardDetail>({
    keys: ["admin", "board", boardId],
    url: `/api/admin/boards/${boardId}`,
  });
  useBreadcrumbLabel(boardId, board ? boardName(board.name, board.id) : undefined);

  if (error && !board) {
    const missing = error instanceof HttpError && error.status === 404;
    return (
      <div className="space-y-4">
        <BackLink href="/admin/boards">Boards</BackLink>
        <EmptyState
          description={missing ? "It may have been deleted." : error.message}
          title={missing ? "No such board" : "Couldn't load this board"}
        />
      </div>
    );
  }
  if (!board || board.id !== boardId) {
    return <p className="text-muted-foreground py-10 text-center text-sm">Loading…</p>;
  }
  return <BoardDetails board={board} />;
};

const BoardDetails = ({ board }: { board: BoardDetail }) => {
  const router = useRouter();
  const { dialog, confirm } = useConfirm();
  // A link made here is shown once: the server only keeps its hash.
  const [newLink, setNewLink] = useState<{ url: string; role: string } | null>(null);

  const archive = useApiMutation({
    keys: KEYS,
    method: "post",
    url: `/api/admin/boards/${board.id}/${board.status === "active" ? "archive" : "unarchive"}`,
    successMessage: board.status === "active" ? "Board archived" : "Board restored",
  });
  const lock = useApiMutation<{ locked: boolean }>({
    keys: KEYS,
    method: "patch",
    url: `/api/admin/boards/${board.id}`,
    successMessage: board.lockedAt ? "Board unlocked" : "Board locked",
  });
  const remove = useApiMutation({
    keys: KEYS,
    method: "delete",
    url: `/api/admin/boards/${board.id}`,
    successMessage: "Board deleted",
  });
  const closeRoom = useApiMutation({
    keys: KEYS,
    method: "post",
    url: `/api/admin/live/rooms/${board.id}/close`,
    successMessage: "Room saved and closed",
  });
  const createLink = useApiMutation<{ role: "edit" | "view" }, { token: string; role: string }>({
    keys: KEYS,
    method: "post",
    url: `/api/admin/boards/${board.id}/tokens`,
    successMessage: false,
  });
  const revokeLink = useApiMutation<{ id: string }>({
    keys: KEYS,
    method: "delete",
    url: ({ id }) => `/api/admin/boards/${board.id}/tokens/${id}`,
    successMessage: "Link revoked",
  });

  const makeLink = (role: "edit" | "view") =>
    createLink.mutate(
      { role },
      { onSuccess: (link) => setNewLink({ url: shareUrl(board.id, link.token), role: link.role }) },
    );

  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => toast.success("Copied"),
      () => toast.error("Couldn't copy"),
    );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <BackLink href="/admin/boards">Boards</BackLink>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xl font-medium">
            <span className="truncate">{boardName(board.name, board.id)}</span>
            <StatusCell config={{ active: "success", archived: "neutral" }} status={board.status} />
            {board.lockedAt && (
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <Lock className="size-3" /> Locked
              </span>
            )}
          </p>
          <p className="text-muted-foreground truncate font-mono text-xs">{board.id}</p>
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel
            action={
              board.room && (
                <Button
                  disabled={closeRoom.isPending}
                  onClick={() => closeRoom.mutate(undefined)}
                  size="xs"
                  variant="outline"
                >
                  <Unplug /> Close room
                </Button>
              )
            }
            title="Live room"
          >
            {board.room ? (
              <div className="divide-y">
                <DetailRow label="Connected">
                  {board.room.editors} editing · {board.room.viewers} viewing
                </DetailRow>
                <DetailRow label="Edits / min">{board.room.updatesLastMinute}</DetailRow>
                <DetailRow label="Open since">{ago(board.room.openedAt)}</DetailRow>
                <DetailRow label="Size">
                  {formatBytes(board.room.docBytes)} of {formatBytes(board.room.maxDocBytes)}
                  {board.room.full && <span className="text-red-500"> (full)</span>}
                </DetailRow>
              </div>
            ) : (
              <EmptyNote>Nobody has it open.</EmptyNote>
            )}
          </Panel>

          <Panel
            action={
              <div className="flex gap-1">
                <Button
                  disabled={createLink.isPending}
                  onClick={() => makeLink("view")}
                  size="xs"
                  variant="outline"
                >
                  <Link2 /> View link
                </Button>
                <Button
                  disabled={createLink.isPending}
                  onClick={() => makeLink("edit")}
                  size="xs"
                  variant="outline"
                >
                  <Link2 /> Edit link
                </Button>
              </div>
            }
            title={`Share links (${board.links.length})`}
          >
            {newLink && (
              <div className="space-y-2 rounded-md border border-green-200 bg-green-50 p-3 text-xs">
                <p>
                  New <strong>{newLink.role}</strong> link. Copy it now: it can&apos;t be shown
                  again.
                </p>
                <div className="flex gap-1">
                  <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1">
                    {newLink.url}
                  </code>
                  <Button
                    aria-label="Copy link"
                    onClick={() => copy(newLink.url)}
                    size="icon-xs"
                    variant="outline"
                  >
                    <Copy />
                  </Button>
                  <a
                    aria-label="Open board"
                    className="hover:bg-muted grid size-6 place-items-center rounded-md border bg-white"
                    href={newLink.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
            )}
            {board.links.length ? (
              <ul className="divide-y rounded-md border">
                {board.links.map((link) => (
                  <li
                    className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                    key={link.id}
                  >
                    <div className="min-w-0">
                      <p className="capitalize">{link.role} link</p>
                      <p className="text-muted-foreground truncate font-mono text-xs">
                        {link.id.slice(0, 12)}… · made {ago(link.createdAt)}
                      </p>
                    </div>
                    <Button
                      aria-label="Revoke link"
                      disabled={revokeLink.isPending}
                      onClick={() =>
                        confirm({
                          title: `Revoke this ${link.role} link?`,
                          description:
                            "It stops working straight away. Everyone on the board is disconnected; people with another working link rejoin.",
                          confirmLabel: "Revoke",
                          destructive: true,
                          onConfirm: () => revokeLink.mutate({ id: link.id }),
                        })
                      }
                      size="icon-sm"
                      variant="ghost"
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyNote>No links: nobody can open this board.</EmptyNote>
            )}
          </Panel>

          <Panel title="Recent activity">
            <ActivityList items={board.recentActivity} />
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Details">
            <div className="divide-y">
              <DetailRow label="Status">
                <span className="capitalize">{board.status}</span>
                {board.archivedAt && ` ${ago(board.archivedAt)}`}
              </DetailRow>
              <DetailRow label="Locked">
                {board.lockedAt ? `Yes, ${ago(board.lockedAt)}` : "No"}
              </DetailRow>
              <DetailRow label="Owner">
                {board.owner ? `${board.owner} (${board.ownerEmail})` : "Nobody (no account)"}
              </DetailRow>
              <DetailRow label="Created">{new Date(board.createdAt).toLocaleString()}</DetailRow>
              <DetailRow label="Last edited">{ago(board.updatedAt)}</DetailRow>
              <DetailRow label="Board size">
                {formatBytes(board.sizeBytes)} · {board.pendingUpdates} updates since the snapshot
              </DetailRow>
              <DetailRow label="Snapshot">{ago(board.snapshotAt)}</DetailRow>
              <DetailRow label="Images">
                {board.assetCount} · {formatBytes(board.assetBytes)}
              </DetailRow>
              <DetailRow label="Last 30 days">
                {board.sessionsLast30Days} sessions · {board.visitorsLast30Days} visitors
              </DetailRow>
            </div>
          </Panel>

          <Panel title="Actions">
            <div className="flex flex-col gap-2">
              <Button
                disabled={archive.isPending}
                onClick={() => archive.mutate(undefined)}
                variant="outline"
              >
                {board.status === "active" ? (
                  <>
                    <Archive /> Archive (make read-only)
                  </>
                ) : (
                  <>
                    <ArchiveRestore /> Restore
                  </>
                )}
              </Button>
              <Button
                disabled={lock.isPending}
                onClick={() => lock.mutate({ locked: !board.lockedAt })}
                title="Like the editor's read-only switch: nobody can edit a locked board until it's unlocked"
                variant="outline"
              >
                {board.lockedAt ? (
                  <>
                    <LockOpen /> Unlock
                  </>
                ) : (
                  <>
                    <Lock /> Lock
                  </>
                )}
              </Button>
              <Button
                onClick={() =>
                  confirm({
                    title: "Delete this board?",
                    description:
                      "Its history, share links and images are deleted for good. Anyone connected is disconnected.",
                    confirmLabel: "Delete board",
                    destructive: true,
                    onConfirm: () =>
                      remove.mutate(undefined, { onSuccess: () => router.push("/admin/boards") }),
                  })
                }
                variant="destructive"
              >
                <Trash2 /> Delete board
              </Button>
            </div>
          </Panel>
        </div>
      </div>
      {dialog}
    </div>
  );
};
