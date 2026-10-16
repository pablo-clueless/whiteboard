"use client";

import "./builtins";
// Custom shapes and tools, registered after the built-ins so they sit at the end of the toolbar.
import "@/plugins";

import type { WebsocketProvider } from "y-websocket";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";

import { getEntry, insertEntry, LIBRARY_DRAG_TYPE, useBoardComponents } from "./library";
import { COMPONENT_DRAG_TYPE, type ComponentRef } from "./component-catalog";
import { describe, detectDiagram, insertDiagram } from "./import/diagram";
import { ComponentGroup, insertComponent } from "./ComponentGroup";
import { screenToPage, useEditorStore } from "@/stores/editor";
import { useRememberedView } from "./sync/useRememberedView";
import { useMigrations } from "./sync/useMigrations";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Editor as EditorApi } from "./editor-core";
import { Toolbar, ZoomControls } from "./Toolbar";
import { usePresencePublisher } from "./Presence";
import { TemplatePicker } from "./TemplatePicker";
import { LibraryDialogs } from "./LibraryDialogs";
import { Toaster } from "@/components/ui/sonner";
import type { BoardDoc } from "./sync/board-doc";
import { ImportDialog } from "./ImportDialog";
import { LabelEditor } from "./LabelEditor";
import { ShareDialog } from "./ShareDialog";
import { MAX_DISPLAY_NAME_LENGTH, useProfileStore } from "@/stores/user";
import { usePublicConfig } from "@/lib/public-config";
import { LatencyOverlay, useShowLatency } from "./LatencyOverlay";
import { BoardTitle } from "./BoardTitle";
import { api, type Role } from "@/lib/api";
import { CanvasMenu } from "./CanvasMenu";
import { ExportMenu } from "./ExportMenu";
import { StylePanel } from "./StylePanel";
import { TextEditor } from "./TextEditor";
import { Code2, Lock, LockOpen } from "lucide-react";
import { Canvas } from "./Canvas";
import {
  useBoard,
  useConnectionStatus,
  useOnBoardFull,
  useOnBoardLocked,
  useOnPermanentClose,
  usePeerCount,
  usePeers,
} from "./sync/useBoard";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

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
  // Reloading puts you back where you were: same pan, zoom, tool and selection.
  useRememberedView(editor, boardId, provider);
  useMigrations(editor, board, provider, { viewOnly: role === "view" });
  useOnBoardFull(provider, () => editor.ui.setBoardFull(true));
  useOnBoardLocked(provider, (locked) => editor.ui.setBoardLocked(locked));
  // The flags live in a store shared by every board this tab opens.
  useEffect(() => {
    editor.ui.setBoardFull(false);
    editor.ui.setBoardLocked(false);
  }, [editor]);
  // Read-only can switch on mid-session (a newer Tack edits the board, it fills up, or an editor
  // locks it); re-render when it does.
  const outdated = useEditorStore((s) => s.outdated);
  const full = useEditorStore((s) => s.boardFull);
  const boardLocked = useEditorStore((s) => s.boardLocked);
  const locked = outdated ? "outdated" : full ? "full" : boardLocked ? "locked" : null;
  const config = usePublicConfig();
  // On until the server says otherwise, so a slow config request doesn't hide anything.
  const canImport = config?.board.diagramImport ?? true;
  // Off until the server says it's allowed, since the server refuses it otherwise.
  const canLock = role === "edit" && (config?.board.readOnlySwitch ?? false);
  const [lockPending, setLockPending] = useState(false);
  const setBoardLock = async (lock: boolean) => {
    setLockPending(true);
    try {
      await api.setBoardLocked(boardId, token, lock);
      // The server tells everyone, this tab included; set it now so the button doesn't lag.
      editor.ui.setBoardLocked(lock);
      toast(
        lock ? "Board locked. Nobody can edit it until an editor unlocks it." : "Board unlocked",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the lock");
    } finally {
      setLockPending(false);
    }
  };
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
  const showLatency = useShowLatency();
  // Components made on this board draw like the built-in ones.
  useBoardComponents(editor);

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
      // DBML, Mermaid or PlantUML becomes a diagram, unless an admin turned diagram import off.
      const diagram = text && canImport ? detectDiagram(text) : null;
      if (diagram) {
        e.preventDefault();
        if (diagram.kind === "unsupported") {
          editor.notify(
            `${describe(diagram)}. Tack draws flowcharts, activity, ER, class, sequence and state diagrams.`,
            "info",
          );
        } else if (insertDiagram(editor, diagram, text).length) {
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
  }, [editor, canImport]);

  // Drop image files, or components and saved shapes dragged from the panel, where released.
  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    const ours = types.includes(COMPONENT_DRAG_TYPE) || types.includes(LIBRARY_DRAG_TYPE);
    if (editor.readOnly || !(types.includes("Files") || ours)) return;
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
    const saved = e.dataTransfer.getData(LIBRARY_DRAG_TYPE);
    if (saved) {
      e.preventDefault();
      const entry = getEntry(editor, saved);
      if (entry) insertEntry(editor, entry, at);
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
      <BoardTitle board={board} readOnly={editor.readOnly} />
      {showLatency && <LatencyOverlay editor={editor} provider={provider} />}
      {!editor.readOnly && <StylePanel editor={editor} />}
      <ZoomControls editor={editor} />
      <div className="pointer-events-none absolute top-3 right-3 flex items-center gap-2">
        {editor.readOnly && !locked && (
          <span className="text-ink/70 rounded-full border bg-white px-3 py-1 text-xs font-semibold shadow-sm">
            View only
          </span>
        )}
        <StatusBadge provider={provider} />
        {!editor.readOnly && canImport && (
          <button
            type="button"
            title="Diagram from code (DBML, Mermaid, PlantUML)"
            onClick={() => editor.ui.setImportOpen(true)}
            className="text-ink focus-visible:ring-primary/40 pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-semibold shadow-sm outline-none hover:bg-[#f8f8f9] focus-visible:ring-3"
          >
            <Code2 className="size-3.5" />
            From code
          </button>
        )}
        {canLock && !editor.readOnly && (
          <button
            type="button"
            title="Lock the board so nobody can edit it until an editor unlocks it"
            disabled={lockPending}
            onClick={() => setBoardLock(true)}
            className="text-ink focus-visible:ring-primary/40 pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-semibold shadow-sm outline-none hover:bg-[#f8f8f9] focus-visible:ring-3 disabled:opacity-60"
          >
            <Lock className="size-3.5" />
            Lock
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
      {locked && (
        <LockedBanner
          reason={locked}
          onUnlock={canLock && !lockPending ? () => setBoardLock(false) : undefined}
        />
      )}
      <ShortcutsDialog editor={editor} />
      <ImportDialog editor={editor} />
      <LibraryDialogs editor={editor} />
      <TemplatePicker boardId={boardId} editor={editor} provider={provider} />
      <Toaster theme="light" position="bottom-center" offset={80} />
    </div>
  );
}

/**
 * Why an editor can't edit right now: the board was saved by a newer Tack (refreshing loads the
 * newer version), or it's full (the server would drop new edits; refreshing drops any that
 * didn't save), or an editor locked it (another editor can unlock it; `onUnlock` is set when
 * this one can).
 */
function LockedBanner({
  reason,
  onUnlock,
}: {
  reason: "outdated" | "full" | "locked";
  onUnlock?: () => void;
}) {
  const buttonClass =
    "bg-primary focus-visible:ring-primary/40 flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 font-semibold text-white outline-none hover:brightness-105 focus-visible:ring-3";
  return (
    <div
      role="status"
      className={cn(
        "absolute top-3 left-1/2 flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-full border bg-white py-1.5 pl-4 text-xs shadow-[0_12px_30px_-18px_rgb(14_14_16/0.45)]",
        reason === "locked" && !onUnlock ? "pr-4" : "pr-1.5",
      )}
    >
      <span className="text-ink">
        {reason === "locked" ? (
          <>
            <Lock className="mr-1 inline size-3 -translate-y-px" />
            <strong className="font-semibold">Locked.</strong> Nobody can edit this board until an
            editor unlocks it.
          </>
        ) : (
          <>
            <strong className="font-semibold">Read-only.</strong>{" "}
            {reason === "outdated"
              ? "This board was saved by a newer version of Tack."
              : "This board is full, so new changes can't be saved. Export it, or start a new board."}
          </>
        )}
      </span>
      {reason === "locked" ? (
        onUnlock && (
          <button type="button" onClick={onUnlock} className={buttonClass}>
            <LockOpen className="size-3.5" />
            Unlock
          </button>
        )
      ) : (
        <button type="button" onClick={() => window.location.reload()} className={buttonClass}>
          {reason === "outdated" ? "Refresh to update" : "Refresh"}
        </button>
      )}
    </div>
  );
}

function StatusBadge({ provider }: { provider: WebsocketProvider }) {
  const { status, synced } = useConnectionStatus(provider);
  const peersCount = usePeerCount(provider);
  const peers = usePeers(provider);
  const me = provider.awareness.clientID;

  // Everyone else; this browser gets its own row with the name field.
  const users = useMemo(() => {
    if (!peers) return [];
    return Array.from(peers)
      .filter(([id]) => id !== me)
      .map(([, state]) => state.user)
      .filter((user): user is NonNullable<typeof user> => user != null);
  }, [peers, me]);
  const myColor = peers?.get(me)?.user?.color;
  const myName = peers?.get(me)?.user?.name;

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
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Who's here, and your name"
            className="text-ink focus-visible:ring-primary/40 pointer-events-auto flex h-8 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-semibold shadow-sm outline-none hover:bg-[#f8f8f9] focus-visible:ring-3"
          >
            <span className={`size-2 rounded-full ${dot}`} />
            {label}
            <span className="text-muted-foreground/60">·</span>
            {peersCount} {peersCount === 1 ? "person" : "people"}
          </button>
        }
      />
      <PopoverContent align="end" className="sm:max-w-75">
        <PopoverHeader>
          <PopoverTitle>Collaborators</PopoverTitle>
          <PopoverDescription>Your name shows on your cursor.</PopoverDescription>
        </PopoverHeader>
        <div className="space-y-1">
          <NameField color={myColor} current={myName} />
          {users.map((user) => (
            <div
              key={user.id}
              className="text-ink flex items-center gap-x-2 rounded px-2 py-1 text-xs"
            >
              <span className="size-2 rounded-full" style={{ background: user.color }} />
              <span className="truncate">{user.name}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * This browser's name on the board. Empty goes back to the account name, or an animal. Saved on
 * Enter or clicking away, and remembered for every board.
 */
function NameField({ color, current }: { color?: string; current?: string }) {
  const displayName = useProfileStore((s) => s.displayName);
  const setDisplayName = useProfileStore((s) => s.setDisplayName);
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (draft !== null) setDisplayName(draft);
    setDraft(null);
  };
  return (
    <label className="text-ink flex items-center gap-x-2 rounded px-2 py-1 text-xs">
      <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
      <input
        aria-label="Your name"
        value={draft ?? displayName ?? ""}
        placeholder={current ?? "Your name"}
        maxLength={MAX_DISPLAY_NAME_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className="focus-visible:ring-primary/40 placeholder:text-ink/50 h-7 min-w-0 flex-1 rounded-md border px-2 outline-none focus-visible:ring-3"
      />
      <span className="text-muted-foreground shrink-0">You</span>
    </label>
  );
}
