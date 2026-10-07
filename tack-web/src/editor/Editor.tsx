"use client";

import "./builtins";

import type { WebsocketProvider } from "y-websocket";
import { useEffect, useState } from "react";

import type { Role } from "@/lib/api";

import { useBoard, useConnectionStatus, useOnPermanentClose, usePeerCount } from "./sync/useBoard";
import { ShareDialog } from "./ShareDialog";
import { Editor as EditorApi } from "./editor-core";
import { Toolbar, ZoomControls } from "./Toolbar";
import { StylePanel } from "./StylePanel";
import type { BoardDoc } from "./sync/board-doc";
import { Canvas } from "./Canvas";
import { TextEditor } from "./TextEditor";
import { ComponentPanel } from "./ComponentPanel";

const USER_COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#46a758", "#0090ff", "#8e4ec6", "#d6409f"];

type EditorProps = {
  boardId: string;
  /** The share token this browser opened the board with. */
  token: string;
  role: Role;
  /** After this browser resets the links, it carries on with the new edit token. */
  onTokenChange: (token: string) => void;
  /** The server closed the connection for good: the link was reset or the board is gone. */
  onRevoked: () => void;
};

export default function Editor({ boardId, token, ...rest }: EditorProps) {
  const { board, provider } = useBoard(boardId, token);
  return (
    <BoardEditor board={board} provider={provider} boardId={boardId} token={token} {...rest} />
  );
}

function BoardEditor({
  board,
  provider,
  boardId,
  token,
  role,
  onTokenChange,
  onRevoked,
}: Omit<EditorProps, "boardId" | "token"> & {
  board: BoardDoc;
  provider: WebsocketProvider;
  boardId: string;
  token: string;
}) {
  // Lives as long as the board does (the loader remounts per board). Not destroyed in an effect
  // cleanup, because Strict Mode's mount/unmount/mount would leave a dead undo manager.
  const [editor] = useState(() => new EditorApi(board, { readOnly: role === "view" }));
  useOnPermanentClose(provider, onRevoked);

  // Dev-only handle for poking at the board from the console: window.__tack.board.shapes.toJSON()
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as Window & { __tack?: EditorApi }).__tack = editor;
  }, [editor]);

  useEffect(() => {
    const color = USER_COLORS[board.doc.clientID % USER_COLORS.length];
    provider.awareness.setLocalStateField("user", { name: "Anonymous", color });
  }, [board, provider]);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden" onContextMenu={onContextMenu}>
      <Canvas editor={editor} />
      <TextEditor editor={editor} />
      <Toolbar editor={editor} />
      <ComponentPanel />
      {!editor.readOnly && <StylePanel editor={editor} />}
      <ZoomControls editor={editor} />
      <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-2">
        {editor.readOnly && (
          <span className="text-ink/70 rounded-full border bg-white px-3 py-1 text-xs font-semibold shadow-sm">
            View only
          </span>
        )}
        <StatusBadge provider={provider} />
        <ShareDialog
          boardId={boardId}
          token={token}
          role={role}
          provider={provider}
          onTokenChange={onTokenChange}
        />
      </div>
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
    <div className="bg-background/90 text-muted-foreground flex items-center gap-2 rounded-full border px-3 py-1 text-xs shadow-sm">
      <span className={`size-2 rounded-full ${dot}`} />
      {label}
      <span className="text-muted-foreground/60">·</span>
      {peers} {peers === 1 ? "person" : "people"}
    </div>
  );
}
