import { MousePointer2 } from "lucide-react";

import { boxFromPoints, distance } from "../geometry";
import type { Tool, ToolEvent, Vec } from "../types";
import type { Editor } from "../editor-core";

/** Screen pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

type State =
  | { kind: "idle" }
  | { kind: "pointing"; start: Vec; screen: Vec; targetId: string }
  | { kind: "dragging"; start: Vec; origins: Map<string, Vec> }
  | { kind: "brushing"; start: Vec; base: string[] };

let state: State = { kind: "idle" };

function beginDrag(editor: Editor, start: Vec) {
  // Viewers can select to look, but moving would only move shapes on their own screen.
  if (editor.readOnly) {
    state = { kind: "idle" };
    return;
  }
  const origins = new Map<string, Vec>();
  for (const id of editor.ui.selectedIds) {
    const s = editor.getShape(id);
    if (s && !s.locked) origins.set(id, { x: s.x, y: s.y });
  }
  editor.startGesture();
  // An arrow dragged on its own lets go of the shapes it points at. Dragged together with its
  // targets, it stays attached and moves with them.
  for (const id of origins.keys()) {
    if (editor.getShape(id)?.type !== "arrow") continue;
    for (const terminal of ["start", "end"] as const) {
      const binding = editor.getBinding(id, terminal);
      if (binding && !origins.has(binding.toId)) editor.setBinding(id, terminal, null);
    }
  }
  state = { kind: "dragging", start, origins };
}

function moveTo(editor: Editor, origins: Map<string, Vec>, dx: number, dy: number) {
  // Move the Konva nodes now so the drag feels instant; sync at most once per frame.
  for (const [id, o] of origins) editor.nodeFor(id)?.position({ x: o.x + dx, y: o.y + dy });
  editor.writeEachFrame(() =>
    editor.updateShapes(
      Object.fromEntries([...origins].map(([id, o]) => [id, { x: o.x + dx, y: o.y + dy }])),
    ),
  );
}

export const selectTool: Tool = {
  id: "select",
  label: "Select",
  icon: MousePointer2,
  shortcut: "v",
  cursor: "default",

  onPointerDown(e: ToolEvent, editor) {
    const { selectedIds } = editor.ui;
    if (e.targetId) {
      const id = e.targetId;
      if (e.shiftKey) {
        editor.select(
          selectedIds.includes(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id],
        );
      } else if (!selectedIds.includes(id)) {
        editor.select([id]);
      }
      state = { kind: "pointing", start: e.point, screen: e.screen, targetId: id };
      return;
    }
    const base = e.shiftKey ? selectedIds : [];
    if (!e.shiftKey) editor.select([]);
    state = { kind: "brushing", start: e.point, base };
  },

  onPointerMove(e, editor) {
    switch (state.kind) {
      case "pointing":
        if (distance(state.screen, e.screen) < DRAG_THRESHOLD) return;
        // Shift-clicking a selected shape deselects it; dragging it should still move the group.
        if (!editor.ui.selectedIds.includes(state.targetId)) {
          editor.select([...editor.ui.selectedIds, state.targetId]);
        }
        beginDrag(editor, state.start);
        selectTool.onPointerMove!(e, editor);
        return;
      case "dragging":
        moveTo(editor, state.origins, e.point.x - state.start.x, e.point.y - state.start.y);
        return;
      case "brushing": {
        const brush = boxFromPoints(state.start, e.point);
        editor.ui.setBrush(brush);
        const hits = editor.shapesInBox(brush);
        editor.select([...new Set([...state.base, ...hits])]);
        return;
      }
    }
  },

  onPointerUp(_e, editor) {
    if (state.kind === "dragging") {
      editor.endGesture();
    }
    if (state.kind === "brushing") editor.ui.setBrush(null);
    state = { kind: "idle" };
  },

  onCancel(editor) {
    if (state.kind === "dragging") {
      moveTo(editor, state.origins, 0, 0);
      editor.endGesture();
    }
    editor.ui.setBrush(null);
    state = { kind: "idle" };
  },
};
