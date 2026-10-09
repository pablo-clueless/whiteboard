"use client";

import { useEffect, useRef, useState } from "react";
import {
  Columns3,
  LayoutFreeform,
  LayoutGrid,
  type LucideIcon,
  Snowflake,
  Workflow,
} from "lucide-react";

import { ARRANGE_MODES, type ArrangeMode } from "./arrange";
import { useEditorStore } from "@/stores/editor";
import type { Editor } from "./editor-core";

export const ARRANGE_ICONS: Record<ArrangeMode, LucideIcon> = {
  lr: Workflow,
  pipeline: Columns3,
  snowflake: Snowflake,
  compact: LayoutGrid,
};

/** Runs a layout on the selection (two or more things) or the whole board, with a notice if
 * there's nothing to move. */
export function runArrange(editor: Editor, mode: ArrangeMode) {
  if (!editor.arrange(editor.ui.selectedIds, mode))
    editor.notify("Nothing to arrange: it takes at least two unlocked things.", "info");
}

/** The "Arrange" button: auto-layouts for the selection, or the whole board. */
export function ArrangeMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const root = useRef<HTMLDivElement>(null);
  const units = open ? editor.arrangeUnits(selectedIds).length : 0;
  const selection = open && editor.arrangesSelection(selectedIds);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
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
    <div ref={root} className="pointer-events-auto relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Auto-arrange the selection, or the whole board"
        aria-label="Arrange"
        onClick={() => setOpen((o) => !o)}
        className={`focus-visible:ring-primary/40 grid size-9 place-items-center rounded-xl transition-colors outline-none focus-visible:ring-3 ${open ? "text-ink bg-[#f1f1f3]" : "text-ink/75 hover:bg-[#f1f1f3]"}`}
      >
        <LayoutFreeform className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Arrange"
          className="absolute right-0 bottom-full mb-3 w-72 rounded-2xl border bg-white p-1.5 shadow-[0_12px_30px_-12px_rgb(14_14_16/0.35)]"
        >
          <p className="text-ink/50 px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide uppercase">
            {selection ? `Arrange ${units} selected` : "Arrange the whole board"}
          </p>
          {ARRANGE_MODES.map(({ mode, label, description }) => {
            const Icon = ARRANGE_ICONS[mode];
            return (
              <button
                key={mode}
                type="button"
                role="menuitem"
                disabled={units < 2}
                onClick={() => {
                  setOpen(false);
                  runArrange(editor, mode);
                }}
                className="focus-visible:ring-primary/40 flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left outline-none hover:bg-[#f1f1f3] focus-visible:ring-3 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Icon className="text-ink/70 mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="text-ink block text-sm">{label}</span>
                  <span className="text-ink/55 block text-xs leading-snug">{description}</span>
                </span>
              </button>
            );
          })}
          {units < 2 && (
            <p className="text-ink/55 px-3 pt-1 pb-1.5 text-xs">
              Add a few things to the board to arrange them.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
