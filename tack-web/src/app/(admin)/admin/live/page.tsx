"use client";

import { Activity, ExternalLink, Lock, Pencil, Radio, Unplug, Users, X } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { formatDistanceToNow } from "date-fns";
import React, { useState } from "react";
import Link from "next/link";
import { cn } from "cn";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { EmptyNote, Panel, useConfirm } from "@/components/admin";
import type { ChartConfig } from "@/components/ui/chart";
import { useLiveStream, type StreamStatus } from "@/hooks/use-live-stream";
import type { LiveConnection, Live, RoomStats } from "@/types/admin";
import { useApiMutation, useApiQuery } from "@/lib/query";
import { boardName, formatBytes } from "@/lib/admin";
import { Statistics } from "@/components/shared";
import { Button, buttonVariants } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

/** Polling while the stream is down. */
const FALLBACK_REFRESH_MS = 5000;
const LIVE_KEY = ["admin", "live"];
/** The key useApiQuery gives LIVE_KEY with no params, which the stream writes to. */
const LIVE_QUERY_KEY = [...LIVE_KEY, {}];

const timelineConfig: ChartConfig = {
  connections: { label: "Connections", color: "var(--color-primary)" },
};

const StatusPill = ({ status, updatedAt }: { status: StreamStatus; updatedAt: Date | null }) => {
  const label = {
    connecting: "Connecting…",
    live: "Live",
    reconnecting: "Reconnecting… (refreshing every 5 s)",
    stopped: "Updates stopped",
  }[status];
  return (
    <div className="text-muted-foreground flex items-center gap-2 text-xs">
      <span className="relative flex size-2">
        {status === "live" && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-400 opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            status === "live" ? "bg-green-500" : status === "stopped" ? "bg-red-500" : "bg-amber-500",
          )}
        />
      </span>
      <span>{label}</span>
      {updatedAt && status === "live" && (
        <span title={updatedAt.toLocaleString()}>· updated {formatDate(updatedAt, "HH:mm:ss")}</span>
      )}
    </div>
  );
};

const Bars = ({ counts, total }: { counts: Record<string, number>; total: number }) => {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <EmptyNote>Nobody is connected.</EmptyNote>;
  return (
    <div className="space-y-2">
      {entries.map(([name, count]) => (
        <div className="space-y-1" key={name}>
          <div className="flex justify-between text-xs">
            <span className="capitalize">{name}</span>
            <span className="text-muted-foreground">{count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-100">
            <div
              className="bg-primary h-full rounded-full transition-[width]"
              style={{ width: `${(count / Math.max(total, 1)) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

const Badge = ({ children, tone }: { children: React.ReactNode; tone: "amber" | "red" | "gray" }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
      tone === "amber" && "bg-amber-100 text-amber-700",
      tone === "red" && "bg-red-100 text-red-700",
      tone === "gray" && "bg-gray-100 text-gray-600",
    )}
  >
    {children}
  </span>
);

const RoomItem = ({
  room,
  selected,
  onSelect,
}: {
  room: RoomStats;
  selected: boolean;
  onSelect: () => void;
}) => {
  const used = Math.min(100, (room.docBytes / Math.max(room.maxDocBytes, 1)) * 100);
  return (
    <li>
      <button
        aria-pressed={selected}
        className={cn(
          "w-full space-y-1.5 rounded-md border px-3 py-2 text-left text-sm transition-colors",
          selected ? "border-primary bg-primary/5" : "border-transparent hover:bg-gray-50",
        )}
        onClick={onSelect}
        type="button"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="truncate font-medium">{boardName(room.title, room.boardId)}</p>
          <span className="text-muted-foreground shrink-0 text-xs">{room.clients.length} here</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {room.locked && (
            <Badge tone="amber">
              <Lock className="size-2.5" /> Locked
            </Badge>
          )}
          {room.full && <Badge tone="red">Full</Badge>}
          <span className="text-muted-foreground text-xs">
            {room.editors} editing · {room.viewers} viewing · {room.updatesLastMinute} edits/min
          </span>
        </div>
        <div className="space-y-0.5">
          <div className="h-1 rounded-full bg-gray-100">
            <div
              className={cn("h-full rounded-full", used > 90 ? "bg-red-500" : "bg-primary")}
              style={{ width: `${Math.max(used, 1)}%` }}
            />
          </div>
          <p className="text-muted-foreground text-[11px]">
            {formatBytes(room.docBytes)} of {formatBytes(room.maxDocBytes)} · saved{" "}
            {room.lastSnapshotAt
              ? formatDistanceToNow(new Date(room.lastSnapshotAt), { addSuffix: true })
              : "never"}
            {room.updatesSinceSnapshot > 0 && ` · ${room.updatesSinceSnapshot} edits since`}
          </p>
        </div>
      </button>
    </li>
  );
};

const ConnectionItem = ({
  connection: c,
  showBoard,
  disabled,
  onKick,
}: {
  connection: LiveConnection;
  showBoard: boolean;
  disabled: boolean;
  onKick: () => void;
}) => (
  <li className="flex items-center justify-between gap-4 py-2 text-sm">
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold",
          c.userName ? "bg-primary/10 text-primary" : "bg-gray-100 text-gray-500",
        )}
      >
        {(c.userName ?? "?").slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium">
          {c.userName ?? "Anonymous"}{" "}
          {showBoard && (
            <span className="text-muted-foreground font-normal">on {boardName(c.boardTitle, c.boardId)}</span>
          )}
        </p>
        <p className="text-muted-foreground truncate text-xs">
          <span className={c.role === "edit" ? "text-primary font-medium" : undefined}>
            {c.role === "edit" ? "Editing" : "Viewing"}
          </span>{" "}
          · <span className="capitalize">{c.browser}</span> · <span className="capitalize">{c.device}</span> ·
          joined {formatDistanceToNow(new Date(c.connectedAt), { addSuffix: true })}
        </p>
      </div>
    </div>
    <Button
      aria-label="Disconnect"
      disabled={disabled}
      onClick={onKick}
      size="icon-sm"
      title="Disconnect. They rejoin on their own if their link still works."
      variant="ghost"
    >
      <X />
    </Button>
  </li>
);

const Page = () => {
  const { status, updatedAt } = useLiveStream(LIVE_QUERY_KEY);
  const { data, isPending } = useApiQuery<Live>({
    keys: LIVE_KEY,
    url: "/api/admin/live",
    refetchInterval: status === "live" ? undefined : FALLBACK_REFRESH_MS,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { dialog, confirm } = useConfirm();

  const kick = useApiMutation<{ boardId: string; id: string }>({
    keys: LIVE_KEY,
    method: "delete",
    url: ({ boardId, id }) => `/api/admin/live/rooms/${boardId}/connections/${id}`,
    successMessage: "Disconnected. They'll rejoin if their link still works.",
  });
  const disconnectAll = useApiMutation<{ boardId: string }>({
    keys: LIVE_KEY,
    method: "post",
    url: ({ boardId }) => `/api/admin/live/rooms/${boardId}/disconnect`,
    successMessage: "Everyone was disconnected",
  });
  const closeRoom = useApiMutation<{ boardId: string }>({
    keys: LIVE_KEY,
    method: "post",
    url: ({ boardId }) => `/api/admin/live/rooms/${boardId}/close`,
    successMessage: "Room saved and closed",
  });

  // A room that closed drops out of the selection on its own.
  const selected = data?.rooms.find((r) => r.boardId === selectedId) ?? null;
  const connections = (data?.connections ?? []).filter((c) => !selected || c.boardId === selected.boardId);
  const timeline = (data?.timeline ?? []).map((p) => ({
    time: formatDate(p.time, "HH:mm"),
    connections: p.connections,
  }));
  const busy = kick.isPending || disconnectAll.isPending || closeRoom.isPending;

  return (
    <div className="space-y-6 overflow-y-auto">
      <div className="flex justify-end">
        <StatusPill status={status} updatedAt={updatedAt} />
      </div>
      <Statistics
        items={
          data
            ? [
                {
                  icon: Radio,
                  label: "Open Rooms",
                  value: data.openRooms,
                  description: "Boards loaded on the server",
                },
                {
                  icon: Users,
                  label: "Connected",
                  value: data.connectedClients,
                  description: `${data.editors} editing · ${data.viewers} viewing`,
                },
                {
                  icon: Pencil,
                  label: "Signed-in Users",
                  value: data.signedInUsers,
                  description: "Counted once across boards",
                },
                {
                  icon: Activity,
                  label: "Edits / min",
                  value: data.updatesLastMinute.toLocaleString(),
                  description: "Across every open room",
                },
              ]
            : []
        }
        isLoading={isPending}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel title={`Open Rooms${data?.rooms.length ? ` (${data.rooms.length})` : ""}`}>
          {data?.rooms.length ? (
            <ul className="-mx-1 max-h-[28rem] space-y-1 overflow-y-auto px-1">
              {data.rooms.map((room) => (
                <RoomItem
                  key={room.boardId}
                  onSelect={() => setSelectedId(room.boardId === selectedId ? null : room.boardId)}
                  room={room}
                  selected={room.boardId === selected?.boardId}
                />
              ))}
            </ul>
          ) : (
            <EmptyNote>{isPending ? "Loading…" : "No rooms are open."}</EmptyNote>
          )}
        </Panel>
        <Panel
          className="lg:col-span-2"
          title={selected ? `On ${boardName(selected.title, selected.boardId)}` : "Everyone Connected"}
          action={
            selected ? (
              <div className="flex items-center gap-1.5">
                <Link
                  className={buttonVariants({ size: "xs", variant: "ghost" })}
                  href={`/admin/boards?board=${selected.boardId}`}
                >
                  <ExternalLink /> Board
                </Link>
                <Button
                  disabled={busy || !selected.clients.length}
                  onClick={() =>
                    confirm({
                      title: "Disconnect everyone?",
                      description:
                        "Everyone on this board is disconnected. Anyone whose link still works rejoins straight away; to keep someone out, revoke their link on the board's page.",
                      confirmLabel: "Disconnect everyone",
                      destructive: true,
                      onConfirm: () => disconnectAll.mutate({ boardId: selected.boardId }),
                    })
                  }
                  size="xs"
                  variant="outline"
                >
                  <Users /> Disconnect all
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    confirm({
                      title: "Close this room?",
                      description:
                        "The board is saved and unloaded, and everyone is disconnected. They reconnect and it loads again, so this is mostly for freeing memory or picking up a fresh copy.",
                      confirmLabel: "Save and close",
                      onConfirm: () => closeRoom.mutate({ boardId: selected.boardId }),
                    })
                  }
                  size="xs"
                  variant="outline"
                >
                  <Unplug /> Close room
                </Button>
                <Button
                  aria-label="Show everyone"
                  onClick={() => setSelectedId(null)}
                  size="icon-xs"
                  title="Show everyone"
                  variant="ghost"
                >
                  <X />
                </Button>
              </div>
            ) : (
              data?.rooms.length ? (
                <span className="text-muted-foreground text-xs">Pick a room to see who&apos;s on it</span>
              ) : null
            )
          }
        >
          {connections.length ? (
            <ul className="max-h-[28rem] divide-y overflow-y-auto">
              {connections.map((c) => (
                <ConnectionItem
                  connection={c}
                  disabled={busy}
                  key={c.id}
                  onKick={() => kick.mutate({ boardId: c.boardId, id: c.id })}
                  showBoard={!selected}
                />
              ))}
            </ul>
          ) : (
            <EmptyNote>
              {isPending ? "Loading…" : selected ? "Nobody is on this board." : "Nobody is connected right now."}
            </EmptyNote>
          )}
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Connections, Last Hour">
          <ChartContainer className="max-h-72 w-full" config={timelineConfig}>
            <AreaChart accessibilityLayer data={timeline}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis
                allowDecimals={false}
                domain={[0, "auto"]}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12 }}
              />
              <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
              <Area
                dataKey="connections"
                fill="var(--color-primary)"
                fillOpacity={0.15}
                stroke="var(--color-primary)"
                type="linear"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ChartContainer>
        </Panel>
        <Panel title="Browsers & Devices">
          <Bars counts={data?.byBrowser ?? {}} total={data?.connectedClients ?? 0} />
          {Boolean(data?.connectedClients) && (
            <div className="border-t pt-4">
              <Bars counts={data?.byDevice ?? {}} total={data?.connectedClients ?? 0} />
            </div>
          )}
        </Panel>
      </div>
      {dialog}
    </div>
  );
};

export default Page;
