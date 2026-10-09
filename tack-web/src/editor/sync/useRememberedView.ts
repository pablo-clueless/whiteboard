"use client";

import type { WebsocketProvider } from "y-websocket";
import { useEffect } from "react";

import { type Camera, MAX_ZOOM, MIN_ZOOM, useEditorStore } from "@/stores/editor";
import { toolRegistry } from "../tools/registry";
import type { Editor } from "../editor-core";

/** What this browser remembers about how it was looking at a board. */
type View = { camera: Camera; toolId: string; selectedIds: string[] };

const key = (boardId: string) => `tack:view:${boardId}`;
/** Writes wait this long after the last change, so panning doesn't write every frame. */
const SAVE_DELAY = 250;

function load(boardId: string): View | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key(boardId)) ?? "null") as Partial<View> | null;
    const c = raw?.camera;
    if (!c || ![c.x, c.y, c.zoom].every((v) => typeof v === "number" && Number.isFinite(v)))
      return null;
    return {
      camera: { x: c.x, y: c.y, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom)) },
      toolId: typeof raw.toolId === "string" ? raw.toolId : "select",
      selectedIds: Array.isArray(raw.selectedIds)
        ? raw.selectedIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    // Storage unavailable or junk: start from the default view.
    return null;
  }
}

function save(boardId: string) {
  const { camera, toolId, selectedIds } = useEditorStore.getState();
  try {
    localStorage.setItem(
      key(boardId),
      JSON.stringify({ camera, toolId, selectedIds } satisfies View),
    );
  } catch {
    // Not remembered this time; nothing depends on it.
  }
}

/**
 * Keeps where you were on a board (pan and zoom, the tool in hand, what was selected) across
 * reloads, per board, in this browser. The selection comes back once the board has synced, for
 * whichever of those shapes still exist.
 */
export function useRememberedView(editor: Editor, boardId: string, provider: WebsocketProvider) {
  useEffect(() => {
    const saved = load(boardId);
    // The store outlives a board, so a board with nothing remembered starts from the default.
    editor.ui.setCamera(saved?.camera ?? { x: 0, y: 0, zoom: 1 });
    const tool = saved && toolRegistry.get(saved.toolId);
    editor.setTool(tool && editor.canUseTool(tool.id) ? tool.id : "select");
    editor.select([]);

    const restoreSelection = (synced: boolean) => {
      if (!synced) return;
      provider.off("sync", restoreSelection);
      const ids = (saved?.selectedIds ?? []).filter((id) => editor.board.shapes.has(id));
      // Only if nothing has been picked since the page opened.
      if (ids.length && !editor.ui.selectedIds.length) editor.select(ids);
    };
    if (provider.synced) restoreSelection(true);
    else provider.on("sync", restoreSelection);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useEditorStore.subscribe((s, prev) => {
      if (
        s.camera === prev.camera &&
        s.toolId === prev.toolId &&
        s.selectedIds === prev.selectedIds
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => save(boardId), SAVE_DELAY);
    });
    // A reload inside the delay still keeps the latest view.
    const flush = () => {
      clearTimeout(timer);
      save(boardId);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      provider.off("sync", restoreSelection);
      unsubscribe();
      window.removeEventListener("pagehide", flush);
      clearTimeout(timer);
    };
  }, [editor, boardId, provider]);
}
