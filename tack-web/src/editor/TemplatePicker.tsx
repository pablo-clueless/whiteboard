"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { WebsocketProvider } from "y-websocket";

import { applyTemplate, TEMPLATES, type Template } from "./templates";
import { clearNewBoard, isNewBoard } from "@/lib/board-links";
import type { Editor } from "./editor-core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ── Thumbnails ─────────────────────────────────────────────────────────── */

const INK = "#4a4a52";
const LINE = { stroke: INK, strokeWidth: 1.2, fill: "none" } as const;

/** A small sketch of what each template puts on the board. */
const THUMBS: Record<string, ReactNode> = {
  blank: (
    <g>
      <rect
        x="62"
        y="34"
        width="36"
        height="32"
        rx="6"
        fill="none"
        stroke="#c9c9cf"
        strokeDasharray="3 3"
      />
      <path d="M80 44v12M74 50h12" stroke="#c9c9cf" strokeWidth="1.5" strokeLinecap="round" />
    </g>
  ),
  architecture: (
    <g>
      <rect x="44" y="14" width="108" height="72" rx="4" fill="#fff" stroke="#d4d4da" />
      {[
        [8, 42, "#4a4a52"],
        [52, 42, "#4a4a52"],
        [86, 26, "#12a594"],
        [86, 58, "#12a594"],
        [124, 20, "#4169e1"],
        [124, 42, "#ff4438"],
        [124, 64, "#8e4ec6"],
      ].map(([x, y, c]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width="24"
          height="14"
          rx="3"
          fill="#fff"
          stroke={c as string}
          strokeWidth="1.3"
        />
      ))}
      <path d="M32 49h20M76 49h4v-16h6M110 33h14M110 33v16h14M110 33v38h14" {...LINE} />
    </g>
  ),
  flowchart: (
    <g>
      <ellipse cx="60" cy="14" rx="16" ry="7" fill="#d8f2e2" stroke={INK} />
      <rect x="42" y="28" width="36" height="14" rx="2" fill="#fff" stroke={INK} />
      <path d="M60 50l14 9-14 9-14-9z" fill="#fff3b0" stroke={INK} />
      <rect x="42" y="76" width="36" height="12" rx="2" fill="#fff" stroke={INK} />
      <rect x="94" y="52" width="34" height="14" rx="2" fill="#fde0ee" stroke={INK} />
      <path d="M60 21v7M60 42v8M60 68v8M74 59h20M111 52v-17h-33" {...LINE} />
    </g>
  ),
  kanban: (
    <g>
      {[14, 62, 110].map((x, i) => (
        <g key={x}>
          <rect x={x} y="12" width="40" height="78" rx="3" fill="#f6f6f7" stroke="#d4d4da" />
          {Array.from({ length: [3, 2, 1][i] }, (_, j) => (
            <rect
              key={j}
              x={x + 5}
              y={18 + j * 18}
              width="30"
              height="13"
              rx="2"
              fill="#fff3b0"
              stroke="#f0dc7a"
            />
          ))}
        </g>
      ))}
    </g>
  ),
  retro: (
    <g>
      {(
        [
          [14, "#d8f2e2", 2],
          [62, "#fde0ee", 2],
          [110, "#d9e4ff", 1],
        ] as const
      ).map(([x, tint, n]) => (
        <g key={x}>
          <rect x={x} y="12" width="40" height="70" rx="3" fill={tint} stroke="#d4d4da" />
          {Array.from({ length: n }, (_, j) => (
            <rect
              key={j}
              x={x + 5}
              y={18 + j * 18}
              width="30"
              height="13"
              rx="2"
              fill="#fff"
              stroke="#d4d4da"
            />
          ))}
        </g>
      ))}
    </g>
  ),
  code: (
    <g>
      <rect x="14" y="16" width="56" height="68" rx="4" fill="#fff" stroke="#d4d4da" />
      {[26, 36, 46, 56, 66].map((y, i) => (
        <rect
          key={y}
          x={22 + (i % 2) * 6}
          y={y}
          width={[34, 26, 30, 20, 28][i]}
          height="4"
          rx="2"
          fill={i === 0 ? "#f56e0f" : "#c9c9cf"}
        />
      ))}
      <path d="M78 50h10m-4-4 4 4-4 4" stroke={INK} strokeWidth="1.4" fill="none" />
      <rect x="96" y="22" width="50" height="56" rx="3" fill="#f3f3f5" stroke="#d6d6dc" />
      <rect x="96" y="22" width="50" height="11" rx="3" fill="#2f6694" />
      {[40, 50, 60, 70].map((y) => (
        <rect key={y} x="101" y={y} width="40" height="3" rx="1.5" fill="#c9c9cf" />
      ))}
    </g>
  ),
  mindmap: (
    <g>
      {[
        [18, 18],
        [18, 45],
        [18, 72],
        [118, 18],
        [118, 45],
        [118, 72],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <path d={`M80 50L${x < 80 ? x + 24 : x} ${y + 5}`} stroke="#8a8a93" strokeWidth="1.2" />
          <rect x={x} y={y} width="24" height="10" rx="5" fill="#fff" stroke={INK} />
        </g>
      ))}
      <ellipse cx="80" cy="50" rx="20" ry="10" fill="#ffe0c7" stroke="#f56e0f" strokeWidth="1.5" />
    </g>
  ),
};

/* ── Picker ─────────────────────────────────────────────────────────────── */

/** Opens once the board has synced, if this browser just created it and it's still empty. */
function useShowPicker(boardId: string, editor: Editor, provider: WebsocketProvider) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (editor.readOnly || !isNewBoard(boardId)) return;
    const check = () => {
      if (!provider.synced) return;
      // Someone else may have got there first; only an empty board gets a template.
      if (editor.board.shapes.size === 0) setOpen(true);
      else clearNewBoard(boardId);
    };
    check();
    provider.on("sync", check);
    return () => provider.off("sync", check);
  }, [boardId, editor, provider]);
  return [open, setOpen] as const;
}

/**
 * Offered when a new board opens: start blank or from a template. Closing it (Escape, the close
 * button, or clicking outside) means blank. It's offered once per new board.
 */
export function TemplatePicker({
  boardId,
  editor,
  provider,
}: {
  boardId: string;
  editor: Editor;
  provider: WebsocketProvider;
}) {
  const [open, setOpen] = useShowPicker(boardId, editor, provider);

  const choose = (template: Template) => {
    clearNewBoard(boardId);
    setOpen(false);
    applyTemplate(editor, template);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) clearNewBoard(boardId);
        setOpen(next);
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto p-5 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-lg">Start your board</DialogTitle>
          <DialogDescription>
            Pick a template to get going, or start blank. Everything in a template can be changed
            afterwards, and one undo removes it.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {TEMPLATES.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                autoFocus={t.id === "blank"}
                onClick={() => choose(t)}
                className="group focus-visible:ring-primary/40 flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-white text-left transition-shadow outline-none hover:shadow-[0_10px_24px_-14px_rgb(14_14_16/0.45)] focus-visible:ring-3"
              >
                <svg
                  viewBox="0 0 160 100"
                  aria-hidden
                  className="group-hover:bg-primary/5 aspect-16/10 w-full bg-[#f6f6f7] transition-colors"
                >
                  {THUMBS[t.id]}
                </svg>
                <span className="flex flex-col gap-0.5 border-t p-3">
                  <span className="text-ink text-[13px] font-semibold">{t.name}</span>
                  <span className="text-ink/55 text-xs leading-snug">{t.description}</span>
                </span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => {
                clearNewBoard(boardId);
                setOpen(false);
                editor.ui.setImportOpen(true);
              }}
              className="group focus-visible:ring-primary/40 flex h-full w-full flex-col overflow-hidden rounded-2xl border bg-white text-left transition-shadow outline-none hover:shadow-[0_10px_24px_-14px_rgb(14_14_16/0.45)] focus-visible:ring-3"
            >
              <svg
                viewBox="0 0 160 100"
                aria-hidden
                className="group-hover:bg-primary/5 aspect-16/10 w-full bg-[#f6f6f7] transition-colors"
              >
                {THUMBS.code}
              </svg>
              <span className="flex flex-col gap-0.5 border-t p-3">
                <span className="text-ink text-[13px] font-semibold">From code</span>
                <span className="text-ink/55 text-xs leading-snug">
                  Paste DBML or Mermaid and get tables or a flowchart.
                </span>
              </span>
            </button>
          </li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
