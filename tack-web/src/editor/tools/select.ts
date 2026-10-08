import { MousePointer2 } from "lucide-react";

import { boxFromPoints, distance, unionBox } from "../geometry";
import type { Box, Tool, ToolEvent, Vec } from "../types";
import { arrowTool, startArrowFrom } from "./line-tools";
import { SNAP_DISTANCE, snapBox } from "../snapping";
import type { Editor } from "../editor-core";

/** Screen pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

type State =
  | { kind: "idle" }
  | { kind: "pointing"; start: Vec; screen: Vec; targetId: string }
  | {
      kind: "dragging";
      start: Vec;
      origins: Map<string, Vec>;
      /** Bounds of what's being dragged, at the start of the drag. */
      box: Box | null;
      /** Bounds of the other shapes in view, to snap to. */
      targets: Box[];
    }
  | { kind: "brushing"; start: Vec; base: string[] }
  /** Pressed on a connection point: dragging draws an arrow from it. */
  | { kind: "connecting"; screen: Vec; shapeId: string; moved: boolean };

let state: State = { kind: "idle" };

function beginDrag(editor: Editor, start: Vec) {
  // Viewers can select to look, but moving would only move shapes on their own screen.
  if (editor.readOnly) {
    state = { kind: "idle" };
    return;
  }
  const origins = new Map<string, Vec>();
  // Containers carry what's inside them.
  for (const id of editor.withChildren(editor.ui.selectedIds)) {
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
  state = { kind: "dragging", start, origins, ...snapSetup(editor, [...origins.keys()]) };
}

/** Clicking a shape outside the group you've double-clicked into leaves that group. */
function leaveGroupUnlessInside(editor: Editor, id: string) {
  const editing = editor.ui.editingGroupId;
  if (editing && !editor.groupsOf(id).includes(editing)) editor.ui.setEditingGroup(null);
}

function snapSetup(editor: Editor, moving: string[]) {
  const solid = moving.filter((id) => !editor.isLinear(id));
  const box = unionBox((solid.length ? solid : moving).map((id) => editor.getBounds(id)));
  return { box, targets: editor.snapTargets(moving) };
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

  onHover(e, editor) {
    if (!e || editor.readOnly) return editor.ui.setConnect(null);
    // Connection points show on the shape under the pointer, and on one it's close to the edge of.
    const near = editor.connectionAt(e.point, { nearOnly: true });
    if (near) return editor.ui.setConnect({ shapeId: near.shapeId, port: near.port });
    const over = e.targetId && editor.portsOnPage(e.targetId).length ? e.targetId : null;
    editor.ui.setConnect(over ? { shapeId: over, port: null } : null);
  },

  onPointerDown(e: ToolEvent, editor) {
    const { selectedIds } = editor.ui;
    const port = editor.readOnly ? null : editor.connectionAt(e.point, { nearOnly: true });
    if (port) {
      state = { kind: "connecting", screen: e.screen, shapeId: port.shapeId, moved: false };
      startArrowFrom(e, editor);
      return;
    }
    if (e.targetId) {
      const id = e.targetId;
      leaveGroupUnlessInside(editor, id);
      // A click picks the shape's whole group (or, inside an entered group, its subgroup).
      const unit = editor.unitOf(id);
      const picked = unit.every((u) => selectedIds.includes(u));
      if (e.shiftKey) {
        editor.select(
          picked
            ? selectedIds.filter((s) => !unit.includes(s))
            : [...new Set([...selectedIds, ...unit])],
        );
      } else if (!picked) {
        editor.select(unit);
      }
      state = { kind: "pointing", start: e.point, screen: e.screen, targetId: id };
      return;
    }
    const base = e.shiftKey ? selectedIds : [];
    if (!e.shiftKey) {
      editor.select([]);
      // Pressing empty board leaves an entered group.
      editor.ui.setEditingGroup(null);
    }
    state = { kind: "brushing", start: e.point, base };
  },

  onPointerMove(e, editor) {
    switch (state.kind) {
      case "connecting":
        if (!state.moved && distance(state.screen, e.screen) < DRAG_THRESHOLD) return;
        state.moved = true;
        arrowTool.onPointerMove!(e, editor);
        return;
      case "pointing":
        if (distance(state.screen, e.screen) < DRAG_THRESHOLD) return;
        // Shift-clicking a selected shape deselects it; dragging it should still move it.
        if (!editor.ui.selectedIds.includes(state.targetId)) {
          editor.select([...new Set([...editor.ui.selectedIds, ...editor.unitOf(state.targetId)])]);
        }
        beginDrag(editor, state.start);
        selectTool.onPointerMove!(e, editor);
        return;
      case "dragging": {
        let dx = e.point.x - state.start.x;
        let dy = e.point.y - state.start.y;
        // Snap edges and centres to other shapes; Alt moves freely.
        if (state.box && !e.altKey) {
          const moved = { ...state.box, x: state.box.x + dx, y: state.box.y + dy };
          const snap = snapBox(moved, state.targets, SNAP_DISTANCE / editor.ui.camera.zoom);
          dx += snap.dx;
          dy += snap.dy;
          editor.ui.setGuides(snap.guides);
        } else {
          editor.ui.setGuides([]);
        }
        moveTo(editor, state.origins, dx, dy);
        return;
      }
      case "brushing": {
        const brush = boxFromPoints(state.start, e.point);
        editor.ui.setBrush(brush);
        // A container is picked only when the box swallows it whole, so a box dragged inside a
        // frame selects what's in the frame rather than the frame.
        const hits = editor.shapesInBox(brush).filter((id) => {
          if (!editor.isContainer(id)) return true;
          const b = editor.getBounds(id);
          return (
            !!b &&
            b.x >= brush.x &&
            b.y >= brush.y &&
            b.x + b.w <= brush.x + brush.w &&
            b.y + b.h <= brush.y + brush.h
          );
        });
        // Inside an entered group, only its shapes can be picked; groups come whole.
        const editing = editor.ui.editingGroupId;
        const inScope = editing ? hits.filter((id) => editor.groupsOf(id).includes(editing)) : hits;
        editor.select([...new Set([...state.base, ...editor.expandToUnits(inScope)])]);
        return;
      }
    }
  },

  onPointerUp(e, editor) {
    if (state.kind === "connecting") {
      // A click on a connection point, without a drag, just selects the shape.
      if (state.moved) arrowTool.onPointerUp!(e, editor);
      else {
        arrowTool.onCancel!(editor);
        editor.select([state.shapeId]);
      }
      state = { kind: "idle" };
      return;
    }
    if (state.kind === "dragging") {
      editor.endGesture();
      editor.ui.setGuides([]);
    }
    if (state.kind === "brushing") editor.ui.setBrush(null);
    state = { kind: "idle" };
  },

  onCancel(editor) {
    if (state.kind === "connecting") arrowTool.onCancel!(editor);
    if (state.kind === "dragging") {
      moveTo(editor, state.origins, 0, 0);
      editor.endGesture();
      editor.ui.setGuides([]);
    }
    editor.ui.setBrush(null);
    state = { kind: "idle" };
  },
};
