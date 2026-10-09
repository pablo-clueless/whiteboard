"use client";

import { useMemo, useSyncExternalStore } from "react";
import type * as Y from "yjs";

import { type Editor, readShape } from "../editor-core";
import { useEditorStore } from "@/stores/editor";
import type { Shape } from "../types";

type Store<T> = { subscribe: (onChange: () => void) => () => void; get: () => T };

function shapeIdsStore(editor: Editor): Store<string[]> {
  const { shapes } = editor.board;
  let snapshot = editor.sortedIds();
  return {
    subscribe(onChange) {
      const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
        const relevant = events.some(
          (e) =>
            e.target === shapes ||
            ["index", "parentId"].some((k) => (e as Y.YMapEvent<unknown>).keysChanged?.has(k)),
        );
        if (!relevant) return;
        const next = editor.sortedIds();
        if (next.join() === snapshot.join()) return;
        snapshot = next;
        onChange();
      };
      snapshot = editor.sortedIds();
      shapes.observeDeep(handler);
      return () => shapes.unobserveDeep(handler);
    },
    get: () => snapshot,
  };
}

function shapeStore(editor: Editor, id: string): Store<Shape | null> {
  const m = editor.board.shapes.get(id) as Y.Map<unknown> | undefined;
  let snapshot = m ? readShape(id, m) : null;
  return {
    subscribe(onChange) {
      if (!m) return () => {};
      const handler = () => {
        snapshot = readShape(id, m);
        onChange();
      };
      snapshot = readShape(id, m);
      m.observe(handler);
      return () => m.unobserve(handler);
    },
    get: () => snapshot,
  };
}

/** Extra margin around the viewport, as a fraction of its size, so panning doesn't pop shapes in. */
const CULL_MARGIN = 0.5;

function visibleIdsStore(editor: Editor, width: number, height: number): Store<string[]> {
  const compute = () => {
    const { camera, selectedIds, exporting } = useEditorStore.getState();
    // Exporting draws shapes that may be off screen, so mount exactly those for the moment.
    if (exporting) return exporting;
    const w = width / camera.zoom;
    const h = height / camera.zoom;
    const ids = editor.shapesInBox({
      x: -camera.x / camera.zoom - w * CULL_MARGIN,
      y: -camera.y / camera.zoom - h * CULL_MARGIN,
      w: w * (1 + 2 * CULL_MARGIN),
      h: h * (1 + 2 * CULL_MARGIN),
    });
    // Selected shapes stay mounted so the transform handles always have a node to hold.
    const missing = selectedIds.filter((id) => !ids.includes(id) && editor.board.shapes.has(id));
    return missing.length
      ? editor.sortedIds().filter((id) => ids.includes(id) || missing.includes(id))
      : ids;
  };
  let snapshot = compute();
  return {
    subscribe(onChange) {
      const update = () => {
        const next = compute();
        if (next.join() === snapshot.join()) return;
        snapshot = next;
        onChange();
      };
      snapshot = compute();
      const offIndex = editor.indexChanged.subscribe(update);
      const offStore = useEditorStore.subscribe((s, prev) => {
        if (
          s.camera !== prev.camera ||
          s.selectedIds !== prev.selectedIds ||
          s.exporting !== prev.exporting
        )
          update();
      });
      return () => {
        offIndex();
        offStore();
      };
    },
    get: () => snapshot,
  };
}

/**
 * Ids of shapes near the viewport, bottom to top. Re-renders only when that set or its order
 * changes — not on every pan frame, and never when a shape just changes colour.
 */
export function useVisibleShapeIds(editor: Editor, width: number, height: number): string[] {
  const store = useMemo(() => visibleIdsStore(editor, width, height), [editor, width, height]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** The snapshot a shape is frozen at during a local transform, if any. */
export function useFrozenShape(editor: Editor, id: string): Shape | undefined {
  return useSyncExternalStore(
    editor.frozenChanged.subscribe,
    () => editor.frozenShape(id),
    () => undefined,
  );
}

/**
 * All shape ids bottom to top. Re-renders only when shapes are added, removed or reordered — never
 * when one moves or changes colour.
 */
export function useShapeIds(editor: Editor): string[] {
  const store = useMemo(() => shapeIdsStore(editor), [editor]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/** One shape's record. Re-renders only when that shape changes. */
export function useShape(editor: Editor, id: string): Shape | null {
  const store = useMemo(() => shapeStore(editor, id), [editor, id]);
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
