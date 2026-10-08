"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { Download } from "lucide-react";

import { useEditorStore } from "@/stores/editor";
import type { Editor } from "./editor-core";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");

/** Exports the board, or the selection, and downloads it. Problems are shown as notices. */
export async function exportToFile(editor: Editor, selectionOnly: boolean, format: "png" | "svg") {
  try {
    const ids = selectionOnly ? editor.ui.selectedIds : undefined;
    let blob: Blob | null = null;
    if (format === "png") {
      blob = await editor.exportPng(ids);
    } else {
      const result = await editor.exportSvg(ids);
      blob = result?.blob ?? null;
      if (result?.skipped)
        editor.notify(
          `${result.skipped} shape${result.skipped === 1 ? "" : "s"} can't be drawn as SVG and ${result.skipped === 1 ? "was" : "were"} left out.`,
          "info",
        );
    }
    if (!blob) {
      editor.notify("There's nothing on the board to export yet.", "info");
      return;
    }
    download(blob, `tack-${selectionOnly ? "selection" : "board"}-${stamp()}.${format}`);
  } catch {
    editor.notify("Couldn't export. Try again.", "error");
  }
}

/** Exports the board, or just the selection, as a PNG at 2× resolution or as an SVG. */
export function ExportMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasSelection = useEditorStore((s) => s.selectedIds.length > 0);
  const root = useRef<HTMLDivElement>(null);

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

  const run = async (selectionOnly: boolean, format: "png" | "svg") => {
    setOpen(false);
    setBusy(true);
    try {
      await exportToFile(editor, selectionOnly, format);
    } finally {
      setBusy(false);
    }
  };

  const item =
    "text-ink focus-visible:ring-primary/40 flex w-full items-center rounded-xl px-3 py-2 text-left text-sm outline-none hover:bg-[#f1f1f3] focus-visible:ring-3 disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div ref={root} className="pointer-events-auto relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="text-ink focus-visible:ring-primary/40 flex h-8 items-center gap-1.5 rounded-full border bg-white px-3 text-xs font-semibold shadow-sm outline-none hover:bg-[#f8f8f9] focus-visible:ring-3 disabled:opacity-60"
      >
        <Download className="size-3.5" />
        {busy ? "Exporting…" : "Export"}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Export"
          className="absolute top-full right-0 mt-2 w-56 rounded-2xl border bg-white p-1.5 shadow-[0_12px_30px_-12px_rgb(14_14_16/0.35)]"
        >
          {(["png", "svg"] as const).map((format) => (
            <Fragment key={format}>
              <button
                type="button"
                role="menuitem"
                className={item}
                onClick={() => run(false, format)}
              >
                Board as {format.toUpperCase()}
              </button>
              <button
                type="button"
                role="menuitem"
                className={item}
                disabled={!hasSelection}
                onClick={() => run(true, format)}
              >
                Selection as {format.toUpperCase()}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
