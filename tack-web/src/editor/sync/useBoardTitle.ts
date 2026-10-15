"use client";

import { useEffect, useSyncExternalStore } from "react";

import type { BoardDoc } from "./board-doc";

/** Longest title we store. The server copies it to `boards.title` for the admin. */
export const MAX_TITLE_LENGTH = 120;

/** The board's name from `meta.title`, or "" when it has none. */
export function useBoardTitle(board: BoardDoc): string {
  return useSyncExternalStore(
    (onChange) => {
      const handler = (e: { keysChanged: Set<string> }) => {
        if (e.keysChanged.has("title")) onChange();
      };
      board.meta.observe(handler);
      return () => board.meta.unobserve(handler);
    },
    () => readTitle(board),
    () => "",
  );
}

export function readTitle(board: BoardDoc): string {
  const title = board.meta.get("title");
  return typeof title === "string" ? title : "";
}

/** Names the board for everyone on it. Not part of undo history (the undo manager skips `meta`). */
export function setBoardTitle(board: BoardDoc, title: string) {
  const next = title.trim().slice(0, MAX_TITLE_LENGTH);
  if (next === readTitle(board)) return;
  if (next) board.meta.set("title", next);
  else board.meta.delete("title");
}

/** Shows the board's name in the browser tab. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    const before = document.title;
    document.title = title ? `${title} · Tack` : "Untitled board · Tack";
    return () => {
      document.title = before;
    };
  }, [title]);
}
