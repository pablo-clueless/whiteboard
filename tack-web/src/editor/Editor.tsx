"use client";

import type { WebsocketProvider } from "y-websocket";
import { useEffect, useState } from "react";
import { Layer, Stage } from "react-konva";

import { useBoard, useConnectionStatus, usePeerCount } from "./sync/useBoard";
import { useEditorStore } from "@/stores/editor";
import type { BoardDoc } from "./sync/board-doc";

const USER_COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f"];

export default function Editor({ boardId }: { boardId: string }) {
  const { board, provider } = useBoard(boardId);
  return <BoardEditor board={board} provider={provider} />;
}

function BoardEditor({ board, provider }: { board: BoardDoc; provider: WebsocketProvider }) {
  const size = useWindowSize();
  const camera = useEditorStore((s) => s.camera);

  useEffect(() => {
    const color = USER_COLORS[board.doc.clientID % USER_COLORS.length];
    provider.awareness.setLocalStateField("user", { name: "Anonymous", color });
  }, [board, provider]);

  return (
    <div className="bg-background relative h-dvh w-full overflow-hidden">
      {size && (
        <Stage
          width={size.width}
          height={size.height}
          x={camera.x}
          y={camera.y}
          scaleX={camera.zoom}
          scaleY={camera.zoom}
        >
          {/* Separate layers so cursor movement doesn't redraw shapes. */}
          <Layer name="shapes" />
          <Layer name="overlay" />
          <Layer name="presence" listening={false} />
        </Stage>
      )}
      <StatusBadge provider={provider} />
    </div>
  );
}

function StatusBadge({ provider }: { provider: WebsocketProvider }) {
  const { status, synced } = useConnectionStatus(provider);
  const peers = usePeerCount(provider);
  const label =
    status === "connected"
      ? synced
        ? "Live"
        : "Syncing…"
      : status === "connecting"
        ? "Connecting…"
        : "Offline";
  const dot =
    status === "connected" && synced
      ? "bg-emerald-500"
      : status === "disconnected"
        ? "bg-red-500"
        : "bg-amber-500";

  return (
    <div className="bg-background/90 text-muted-foreground pointer-events-none absolute top-3 right-3 flex items-center gap-2 rounded-full border px-3 py-1 text-xs shadow-sm">
      <span className={`size-2 rounded-full ${dot}`} />
      {label}
      <span className="text-muted-foreground/60">·</span>
      {peers} {peers === 1 ? "person" : "people"}
    </div>
  );
}

function useWindowSize() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}
