"use client";

import { Copy, ExternalLink, Link2, Trash2, Unplug } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import React, { useState } from "react";
import { toast } from "sonner";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useApiMutation, useApiQuery } from "@/lib/query";
import type { BoardDetail } from "@/types/admin";
import { Button } from "@/components/ui/button";
import { ActivityList } from "./activity-list";
import { DetailRow, EmptyNote } from "./panel";
import { shareUrl } from "@/lib/board-links";
import { boardName, formatBytes } from "@/lib/admin";
import { useConfirm } from "./confirm";

interface Props {
  boardId: string | null;
  onClose: () => void;
}

const KEYS = [["admin", "boards"], ["admin", "board"], ["admin", "live"]];

const ago = (date: string | null) =>
  date ? formatDistanceToNow(new Date(date), { addSuffix: true }) : "never";

/** One board: storage, its live room, share links and activity. */
export const BoardSheet = ({ boardId, onClose }: Props) => {
  const { data: board } = useApiQuery<BoardDetail>({
    keys: ["admin", "board", boardId],
    url: `/api/admin/boards/${boardId}`,
    enabled: Boolean(boardId),
  });

  return (
    <Sheet open={Boolean(boardId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{boardId ? boardName(board?.name, boardId) : ""}</SheetTitle>
          <SheetDescription className="font-mono text-xs">{boardId}</SheetDescription>
        </SheetHeader>
        {board && board.id === boardId && <BoardDetails board={board} onDeleted={onClose} />}
      </SheetContent>
    </Sheet>
  );
};

const BoardDetails = ({ board, onDeleted }: { board: BoardDetail; onDeleted: () => void }) => {
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
    <div className="space-y-6 px-4 pb-6">
      <section className="divide-y">
        <DetailRow label="Status">
          <span className="capitalize">{board.status}</span>
          {board.archivedAt && ` ${ago(board.archivedAt)}`}
        </DetailRow>
        <DetailRow label="Locked">
          {board.lockedAt ? `Yes, ${ago(board.lockedAt)}` : "No"}
        </DetailRow>
        <DetailRow label="Owner">
          {board.owner ? `${board.owner} (${board.ownerEmail})` : "Nobody (created without an account)"}
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
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Live room</p>
          {board.room && (
            <Button
              disabled={closeRoom.isPending}
              onClick={() => closeRoom.mutate(undefined)}
              size="xs"
              variant="outline"
            >
              <Unplug /> Close room
            </Button>
          )}
        </div>
        {board.room ? (
          <div className="divide-y rounded-md border px-3">
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
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Share links ({board.links.length})</p>
          <div className="flex gap-1">
            <Button disabled={createLink.isPending} onClick={() => makeLink("view")} size="xs" variant="outline">
              <Link2 /> View link
            </Button>
            <Button disabled={createLink.isPending} onClick={() => makeLink("edit")} size="xs" variant="outline">
              <Link2 /> Edit link
            </Button>
          </div>
        </div>
        {newLink && (
          <div className="space-y-2 rounded-md border border-green-200 bg-green-50 p-3 text-xs">
            <p>
              New <strong>{newLink.role}</strong> link. Copy it now: it can&apos;t be shown again.
            </p>
            <div className="flex gap-1">
              <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1">{newLink.url}</code>
              <Button aria-label="Copy link" onClick={() => copy(newLink.url)} size="icon-xs" variant="outline">
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
              <li className="flex items-center justify-between gap-2 px-3 py-2 text-sm" key={link.id}>
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
      </section>

      <section className="space-y-2">
        <p className="text-sm font-semibold">Recent activity</p>
        <ActivityList items={board.recentActivity} />
      </section>

      <section className="flex gap-2 border-t pt-4">
        <Button disabled={archive.isPending} onClick={() => archive.mutate(undefined)} variant="outline">
          {board.status === "active" ? "Archive (make read-only)" : "Restore"}
        </Button>
        <Button
          disabled={lock.isPending}
          onClick={() => lock.mutate({ locked: !board.lockedAt })}
          title="Like the editor's read-only switch: nobody can edit a locked board until it's unlocked"
          variant="outline"
        >
          {board.lockedAt ? "Unlock" : "Lock"}
        </Button>
        <Button
          onClick={() =>
            confirm({
              title: "Delete this board?",
              description:
                "Its history, share links and images are deleted for good. Anyone connected is disconnected.",
              confirmLabel: "Delete board",
              destructive: true,
              onConfirm: () => remove.mutate(undefined, { onSuccess: onDeleted }),
            })
          }
          variant="destructive"
        >
          Delete
        </Button>
      </section>
      {dialog}
    </div>
  );
};
