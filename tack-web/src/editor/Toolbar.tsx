"use client";

import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronUp, Keyboard, Maximize, Minus, Plus, Redo2, RotateCcw, Undo2 } from "lucide-react";
import { cn } from "cn";

import { useEditorStore, zoomAt } from "@/stores/editor";
import { toolRegistry } from "./tools/registry";
import type { Editor } from "./editor-core";
import type { Tool } from "./types";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-9 place-items-center rounded-xl transition-colors outline-none",
        "focus-visible:ring-primary/40 focus-visible:ring-3 disabled:opacity-35",
        active ? "bg-primary text-white" : "text-ink/75 enabled:hover:bg-[#f1f1f3]",
      )}
    >
      {children}
    </button>
  );
}

function useUndoState(editor: Editor) {
  const um = editor.undoManager;
  const subscribe = (onChange: () => void) => {
    const events = ["stack-item-added", "stack-item-popped", "stack-cleared"] as const;
    events.forEach((ev) => um.on(ev, onChange));
    return () => events.forEach((ev) => um.off(ev, onChange));
  };
  const canUndo = useSyncExternalStore(
    subscribe,
    () => um.canUndo(),
    () => false,
  );
  const canRedo = useSyncExternalStore(
    subscribe,
    () => um.canRedo(),
    () => false,
  );
  return { canUndo, canRedo };
}

const toolLabel = (tool: Tool) =>
  tool.shortcut ? `${tool.label} (${tool.shortcut.toUpperCase()})` : tool.label;

function ToolIcon({ tool }: { tool: Tool }) {
  return <tool.icon className="size-4.5" strokeWidth={2} />;
}

/** Tools in registration order, with each group collapsed into one entry where it first appears. */
function groupTools(tools: Tool[]): Tool[][] {
  const entries: Tool[][] = [];
  const groups = new Map<string, Tool[]>();
  for (const tool of tools) {
    if (!tool.group) {
      entries.push([tool]);
      continue;
    }
    let group = groups.get(tool.group);
    if (!group) {
      group = [];
      groups.set(tool.group, group);
      entries.push(group);
    }
    group.push(tool);
  }
  return entries;
}

/** One button for a group of tools: it shows the last one used, and the caret opens the rest. */
function ToolGroup({ tools, toolId, editor }: { tools: Tool[]; toolId: string; editor: Editor }) {
  const [lastId, setLastId] = useState(tools[0].id);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const activeInGroup = tools.find((t) => t.id === toolId);
  const shown = activeInGroup ?? tools.find((t) => t.id === lastId) ?? tools[0];

  const choose = (tool: Tool) => {
    setLastId(tool.id);
    editor.setTool(tool.id);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>(
        "[role=menuitemradio][aria-checked=true], [role=menuitemradio]",
      )
      ?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={root} className="relative flex items-center">
      <IconButton label={toolLabel(shown)} active={!!activeInGroup} onClick={() => choose(shown)}>
        <ToolIcon tool={shown} />
      </IconButton>
      <button
        type="button"
        aria-label="More shapes"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-ink/50 hover:text-ink focus-visible:ring-primary/40 -ml-0.5 grid h-9 w-4 place-items-center rounded-md outline-none hover:bg-[#f1f1f3] focus-visible:ring-3"
      >
        <ChevronUp className={cn("size-3.5 transition-transform", open || "rotate-180")} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Shapes"
          className="absolute bottom-full left-1/2 mb-3 w-44 -translate-x-1/2 rounded-2xl border bg-white p-1.5 shadow-[0_12px_30px_-12px_rgb(14_14_16/0.35)]"
        >
          {tools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              role="menuitemradio"
              aria-checked={tool.id === shown.id}
              onClick={() => choose(tool)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm outline-none",
                "focus-visible:ring-primary/40 hover:bg-[#f1f1f3] focus-visible:ring-3",
                tool.id === shown.id ? "text-primary font-semibold" : "text-ink/80",
              )}
            >
              <ToolIcon tool={tool} />
              <span className="flex-1">{tool.label}</span>
              {tool.shortcut && (
                <kbd className="text-ink/40 font-mono text-[11px]">
                  {tool.shortcut.toUpperCase()}
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toolbar({ editor }: { editor: Editor }) {
  const toolId = useEditorStore((s) => s.toolId);
  const { canUndo, canRedo } = useUndoState(editor);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label="Tools"
        className="pointer-events-auto flex items-center gap-1 rounded-2xl border bg-white p-1.5 shadow-[0_12px_30px_-18px_rgb(14_14_16/0.45)]"
      >
        {groupTools(toolRegistry.all().filter((t) => editor.canUseTool(t.id))).map((entry) =>
          entry.length === 1 && !entry[0].group ? (
            <IconButton
              key={entry[0].id}
              label={toolLabel(entry[0])}
              active={entry[0].id === toolId}
              onClick={() => editor.setTool(entry[0].id)}
            >
              <ToolIcon tool={entry[0]} />
            </IconButton>
          ) : (
            <ToolGroup key={entry[0].group} tools={entry} toolId={toolId} editor={editor} />
          ),
        )}
        {!editor.readOnly && (
          <>
            <span className="mx-1 h-6 w-px bg-[#e6e6ea]" aria-hidden />
            <IconButton label={`Undo (${MOD}Z)`} disabled={!canUndo} onClick={() => editor.undo()}>
              <Undo2 className="size-4.5" />
            </IconButton>
            <IconButton
              label={`Redo (${MOD}Shift+Z)`}
              disabled={!canRedo}
              onClick={() => editor.redo()}
            >
              <Redo2 className="size-4.5" />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

export function ZoomControls({ editor }: { editor: Editor }) {
  const camera = useEditorStore((s) => s.camera);
  const setCamera = useEditorStore((s) => s.setCamera);
  const screenCentre = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  const zoomBy = (factor: number) =>
    setCamera(zoomAt(camera, screenCentre(), camera.zoom * factor));

  /** Moves the board so its content sits in the middle of the window, at the current zoom. */
  const centreContent = () => {
    const box = editor.contentBounds();
    const c = screenCentre();
    if (!box) return setCamera({ ...camera, x: c.x, y: c.y }); // empty board: page origin
    setCamera({
      ...camera,
      x: c.x - (box.x + box.w / 2) * camera.zoom,
      y: c.y - (box.y + box.h / 2) * camera.zoom,
    });
  };

  return (
    <div
      role="toolbar"
      aria-label="Zoom"
      className="absolute right-4 bottom-4 flex items-center gap-0.5 rounded-2xl border bg-white p-1 shadow-[0_12px_30px_-18px_rgb(14_14_16/0.45)]"
    >
      <IconButton
        label="Keyboard shortcuts (?)"
        onClick={() => useEditorStore.getState().setShortcutsOpen(true)}
      >
        <Keyboard className="size-4" />
      </IconButton>
      <IconButton label="Centre on screen" onClick={centreContent}>
        <Maximize className="size-4" />
      </IconButton>
      <IconButton
        label="Restore zoom to 100%"
        disabled={camera.zoom === 1}
        onClick={() => setCamera(zoomAt(camera, screenCentre(), 1))}
      >
        <RotateCcw className="size-4" />
      </IconButton>
      <span className="mx-0.5 h-5 w-px bg-[#e6e6ea]" aria-hidden />
      <IconButton label="Zoom out" onClick={() => zoomBy(1 / 1.25)}>
        <Minus className="size-4" />
      </IconButton>
      <span
        aria-live="polite"
        aria-label={`Zoom ${Math.round(camera.zoom * 100)}%`}
        className="text-ink/75 grid h-9 min-w-12 place-items-center px-1 font-mono text-xs tabular-nums"
      >
        {Math.round(camera.zoom * 100)}%
      </span>
      <IconButton label="Zoom in" onClick={() => zoomBy(1.25)}>
        <Plus className="size-4" />
      </IconButton>
    </div>
  );
}
