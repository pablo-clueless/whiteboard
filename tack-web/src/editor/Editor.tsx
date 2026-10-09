"use client";

import "./builtins";
// Custom shapes and tools, registered after the built-ins so they sit at the end of the toolbar.
import "@/plugins";

import type { WebsocketProvider } from "y-websocket";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { COMPONENT_DRAG_TYPE, type ComponentRef } from "./component-catalog";
import { describe, detectDiagram, insertDiagram } from "./import/diagram";
import { ComponentGroup, insertComponent } from "./ComponentGroup";
import { screenToPage, useEditorStore } from "@/stores/editor";
import { useMigrations } from "./sync/useMigrations";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Editor as EditorApi } from "./editor-core";
import { Toolbar, ZoomControls } from "./Toolbar";
import { usePresencePublisher } from "./Presence";
import { TemplatePicker } from "./TemplatePicker";
import { Toaster } from "@/components/ui/sonner";
import type { BoardDoc } from "./sync/board-doc";
import { ImportDialog } from "./ImportDialog";
import { LabelEditor } from "./LabelEditor";
import { ShareDialog } from "./ShareDialog";
import { api, type Role } from "@/lib/api";
import { CanvasMenu } from "./CanvasMenu";
import { ExportMenu } from "./ExportMenu";
import { StylePanel } from "./StylePanel";
import { TextEditor } from "./TextEditor";
import { Code2 } from "lucide-react";
import { Canvas } from "./Canvas";
import {
  useBoard,
  useConnectionStatus,
  useOnBoardFull,
  useOnPermanentClose,
  usePeerCount,
} from "./sync/useBoard";

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
  const [editor] = useState(
    () =>
      new EditorApi(board, {
        readOnly: role === "view",
        notify: (message, kind) => (kind === "error" ? toast.error(message) : toast(message)),
      }),
  );
  useOnPermanentClose(provider, onRevoked);
  useMigrations(editor, board, provider, { viewOnly: role === "view" });
  useOnBoardFull(provider, () => editor.ui.setBoardFull(true));
  // The flag lives in a store shared by every board this tab opens.
  useEffect(() => editor.ui.setBoardFull(false), [editor]);
  // Read-only can switch on mid-session (a newer Tack edits the board, or it fills up);
  // re-render when it does.
  const outdated = useEditorStore((s) => s.outdated);
  const full = useEditorStore((s) => s.boardFull);
  const locked = outdated ? "outdated" : full ? "full" : null;
  useEffect(() => {
    if (locked) editor.setTool("select");
  }, [editor, locked]);

  // Uploads use the current token: it changes if this browser resets the links.
  useEffect(() => {
    editor.setAssetUploader((file) => api.uploadAsset(boardId, token, file));
  }, [editor, boardId, token]);

  // Dev-only handle for poking at the board from the console: window.__tack.board.shapes.toJSON()
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    (window as Window & { __tack?: EditorApi }).__tack = editor;
  }, [editor]);

  usePresencePublisher(editor, provider.awareness);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // Copy, cut and paste shapes; paste images from the clipboard into the middle of the screen.
  useEffect(() => {
    const isField = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
    };

    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (isField(e.target) || !e.clipboardData) return;
      const ids = editor.ui.selectedIds;
      const text = editor.serialize(ids);
      if (!text) return;
      e.preventDefault();
      e.clipboardData.setData("text/plain", text);
      editor.noteCopied(text, { cut });
      if (cut && !editor.readOnly) {
        editor.markHistory();
        editor.deleteShapes(editor.unlocked(ids));
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (editor.readOnly || isField(e.target) || !e.clipboardData) return;
      const text = e.clipboardData.getData("text/plain");
      if (text && editor.pasteText(text)) {
        e.preventDefault();
        return;
      }
      // DBML or Mermaid becomes a diagram.
      const diagram = text ? detectDiagram(text) : null;
      if (diagram) {
        e.preventDefault();
        if (diagram.kind === "unsupported") {
          editor.notify(`${describe(diagram)}. Flowcharts and ER diagrams are.`, "info");
        } else if (insertDiagram(editor, diagram).length) {
          editor.notify(`Drew ${describe(diagram)}.`, "info");
        }
        return;
      }
      const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      e.preventDefault();
      const middle = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      void editor.insertImages(files, screenToPage(middle, editor.ui.camera));
    };

    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
      window.removeEventListener("paste", onPaste);
    };
  }, [editor]);

  // Drop image files, or components dragged from the panel, where they're released.
  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (editor.readOnly || !(types.includes("Files") || types.includes(COMPONENT_DRAG_TYPE)))
      return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (e: React.DragEvent) => {
    if (editor.readOnly) return;
    const at = screenToPage({ x: e.clientX, y: e.clientY }, editor.ui.camera);
    const component = e.dataTransfer.getData(COMPONENT_DRAG_TYPE);
    if (component) {
      e.preventDefault();
      try {
        insertComponent(editor, JSON.parse(component) as ComponentRef, at);
      } catch {
        // Not our data after all.
      }
      return;
    }
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    void editor.insertImages([...e.dataTransfer.files], at);
  };

  return (
    <div
      className="relative h-dvh w-full overflow-hidden"
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <CanvasMenu editor={editor}>
        <Canvas editor={editor} awareness={provider.awareness} />
      </CanvasMenu>
      <TextEditor editor={editor} />
      <LabelEditor editor={editor} />
      <Toolbar editor={editor} />
      <ComponentGroup editor={editor} />
      {!editor.readOnly && <StylePanel editor={editor} />}
      <ZoomControls editor={editor} />
      <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-2">
        {editor.readOnly && !locked && (
          <span className="text-ink/70 rounded-full border bg-white px-3 py-1 text-xs font-semibold shadow-sm">
            View only
          </span>
        )}
        <StatusBadge provider={provider} />
        {!editor.readOnly && (
          <button
            type="button"
            title="Diagram from code (DBML, Mermaid)"
            onClick={() => editor.ui.setImportOpen(true)}
            className="text-ink focus-visible:ring-primary/40 pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-semibold shadow-sm outline-none hover:bg-[#f8f8f9] focus-visible:ring-3"
          >
            <Code2 className="size-3.5" />
            From code
          </button>
        )}
        <ExportMenu editor={editor} />
        <ShareDialog
          boardId={boardId}
          token={token}
          role={role}
          provider={provider}
          onTokenChange={onTokenChange}
        />
      </div>
      {locked && <LockedBanner reason={locked} />}
      <ShortcutsDialog editor={editor} />
      <ImportDialog editor={editor} />
      <TemplatePicker boardId={boardId} editor={editor} provider={provider} />
      <Toaster theme="light" position="bottom-center" offset={80} />
    </div>
  );
}

/**
 * Why an editor can't edit right now: the board was saved by a newer Tack (refreshing loads the
 * newer version), or it's full (the server would drop new edits; refreshing drops any that
 * didn't save).
 */
function LockedBanner({ reason }: { reason: "outdated" | "full" }) {
  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-full border bg-white py-1.5 pr-1.5 pl-4 text-xs shadow-[0_12px_30px_-18px_rgb(14_14_16/0.45)]"
    >
      <span className="text-ink">
        <strong className="font-semibold">Read-only.</strong>{" "}
        {reason === "outdated"
          ? "This board was saved by a newer version of Tack."
          : "This board is full, so new changes can't be saved. Export it, or start a new board."}
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="bg-primary focus-visible:ring-primary/40 h-7 shrink-0 rounded-full px-3 font-semibold text-white outline-none hover:brightness-105 focus-visible:ring-3"
      >
        {reason === "outdated" ? "Refresh to update" : "Refresh"}
      </button>
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
