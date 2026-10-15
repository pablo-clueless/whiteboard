"use client";

import { useState } from "react";

import {
  MAX_TITLE_LENGTH,
  setBoardTitle,
  useBoardTitle,
  useDocumentTitle,
} from "./sync/useBoardTitle";
import { useEditorStore } from "@/stores/editor";
import type { BoardDoc } from "./sync/board-doc";

/**
 * The board's name, top left. Editors rename it in place (Enter or clicking away keeps it, Escape
 * puts it back); everyone sees the change live. Hidden while the style panel takes that corner.
 */
export function BoardTitle({ board, readOnly }: { board: BoardDoc; readOnly: boolean }) {
  const title = useBoardTitle(board);
  const selecting = useEditorStore((s) => s.selectedIds.length > 0);
  // The text being typed; null when not editing, so remote renames show straight away.
  const [draft, setDraft] = useState<string | null>(null);
  useDocumentTitle(title);

  if (selecting && !readOnly) return null;

  const pill =
    "text-ink pointer-events-auto absolute top-3 left-3 h-8 max-w-[min(320px,calc(100vw-24px))] rounded-full border bg-white px-3 text-xs font-semibold shadow-sm";

  if (readOnly) {
    return (
      <h1 className={`${pill} flex items-center truncate`} title={title || undefined}>
        {title || "Untitled board"}
      </h1>
    );
  }

  const commit = () => {
    if (draft !== null) setBoardTitle(board, draft);
    setDraft(null);
  };

  return (
    <input
      aria-label="Board name"
      value={draft ?? title}
      placeholder="Untitled board"
      maxLength={MAX_TITLE_LENGTH}
      size={Math.max(14, (draft ?? title).length + 1)}
      onFocus={(e) => {
        setDraft(title);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Keys typed here never reach the canvas shortcuts.
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(null);
          // Blurring after the reset keeps the old title.
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
      className={`${pill} focus-visible:ring-primary/40 placeholder:text-ink/40 outline-none hover:bg-[#f8f8f9] focus-visible:ring-3`}
    />
  );
}
