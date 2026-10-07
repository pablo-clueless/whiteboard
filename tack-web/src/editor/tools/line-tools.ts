import { MoveUpRight, Slash } from "lucide-react";

import { anchorFor } from "../bindings";
import type { Editor } from "../editor-core";
import { distance } from "../geometry";
import type { Shape, Tool, Vec } from "../types";

const DRAW_THRESHOLD = 4;
/** Length of a line dropped with a click instead of a drag. */
const CLICK_LENGTH = 160;
/** Shift snaps the angle to multiples of this. */
const ANGLE_STEP = Math.PI / 12;

function snapAngle(from: Vec, to: Vec): Vec {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const a = Math.round(Math.atan2(to.y - from.y, to.x - from.x) / ANGLE_STEP) * ANGLE_STEP;
  return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
}

/**
 * Drag from one point to another. Arrows attach to whatever shape they start or end on, and
 * stay attached when that shape moves.
 */
function makeLineTool(opts: {
  id: string;
  label: string;
  icon: Tool["icon"];
  shortcut: string;
  shapeType: "line" | "arrow";
}): Tool {
  let drawing: { start: Vec; screen: Vec; id: string | null; startTarget: Shape | null } | null =
    null;
  const binds = opts.shapeType === "arrow";

  const attach = (
    editor: Editor,
    id: string,
    terminal: "start" | "end",
    target: Shape | null,
    at: Vec,
  ) => {
    const anchor = target && anchorFor(target, at);
    if (target && anchor) editor.setBinding(id, terminal, { toId: target.id, anchor });
  };

  return {
    id: opts.id,
    label: opts.label,
    icon: opts.icon,
    shortcut: opts.shortcut,
    cursor: "crosshair",

    onPointerDown(e, editor) {
      editor.startGesture();
      drawing = {
        start: e.point,
        screen: e.screen,
        id: null,
        startTarget: binds ? editor.bindableShapeAt(e.point) : null,
      };
    },

    onPointerMove(e, editor) {
      if (!drawing) return;
      if (!drawing.id) {
        if (distance(drawing.screen, e.screen) < DRAW_THRESHOLD) return;
        drawing.id = editor.createShape({
          type: opts.shapeType,
          x: drawing.start.x,
          y: drawing.start.y,
          props: { path: [0, 0, 0, 0] },
        });
        editor.select([drawing.id]);
      }
      const id = drawing.id;
      const end = e.shiftKey ? snapAngle(drawing.start, e.point) : e.point;
      const shape = editor.getShape(id);
      if (!shape) return;
      const path = [0, 0, end.x - drawing.start.x, end.y - drawing.start.y];
      editor.writeEachFrame(() =>
        editor.updateShapes({ [id]: { props: { ...(shape.props as object), path } } }),
      );
    },

    onPointerUp(e, editor) {
      if (!drawing) return;
      editor.flush();
      let id = drawing.id;
      if (!id) {
        id = editor.createShape({
          type: opts.shapeType,
          x: e.point.x - CLICK_LENGTH / 2,
          y: e.point.y,
          props: { path: [0, 0, CLICK_LENGTH, 0] },
        });
      } else if (binds) {
        const end = e.shiftKey ? snapAngle(drawing.start, e.point) : e.point;
        const endTarget = editor.bindableShapeAt(end, id);
        attach(editor, id, "start", drawing.startTarget, drawing.start);
        // An arrow from a shape to itself has no direction; leave the end free instead.
        if (endTarget?.id !== drawing.startTarget?.id) attach(editor, id, "end", endTarget, end);
      }
      editor.endGesture();
      editor.select([id]);
      editor.setTool("select");
      drawing = null;
    },

    onCancel(editor) {
      if (drawing?.id) editor.deleteShapes([drawing.id]);
      if (drawing) editor.endGesture();
      drawing = null;
    },
  };
}

export const lineTool = makeLineTool({
  id: "line",
  label: "Line",
  icon: Slash,
  shortcut: "l",
  shapeType: "line",
});
export const arrowTool = makeLineTool({
  id: "arrow",
  label: "Arrow",
  icon: MoveUpRight,
  shortcut: "a",
  shapeType: "arrow",
});
