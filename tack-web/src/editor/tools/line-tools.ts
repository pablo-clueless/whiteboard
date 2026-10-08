import { MoveUpRight, Slash } from "lucide-react";

import type { Connection, Editor } from "../editor-core";
import type { Tool, ToolEvent, Vec } from "../types";
import { distance } from "../geometry";

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
 * Drag from one point to another. Arrows connect to shapes at their connection points (the
 * middle of each side): starting or ending near one snaps to it, and anywhere over a shape uses
 * its nearest. Connected ends stay on those points when the shapes move.
 */
function makeLineTool(opts: {
  id: string;
  label: string;
  icon: Tool["icon"];
  shortcut: string;
  shapeType: "line" | "arrow";
}): Tool {
  let drawing: { start: Vec; screen: Vec; id: string | null; from: Connection | null } | null =
    null;
  const binds = opts.shapeType === "arrow";

  /** Shows the connection points of the shape under the pointer, highlighting the one in use. */
  const hint = (editor: Editor, c: Connection | null) =>
    editor.ui.setConnect(c ? { shapeId: c.shapeId, port: c.port } : null);

  return {
    id: opts.id,
    label: opts.label,
    icon: opts.icon,
    shortcut: opts.shortcut,
    cursor: "crosshair",

    onHover(e, editor) {
      if (binds) hint(editor, e && editor.connectionAt(e.point));
    },

    onPointerDown(e, editor) {
      editor.startGesture();
      const from = binds ? editor.connectionAt(e.point) : null;
      drawing = { start: from?.point ?? e.point, screen: e.screen, id: null, from };
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
        // Bind the start now, so the preview leaves its shape the way the result will.
        if (drawing.from)
          editor.setBinding(drawing.id, "start", {
            toId: drawing.from.shapeId,
            anchor: drawing.from.anchor,
          });
      }
      const id = drawing.id;
      const to = binds ? endConnection(editor, drawing, e.point, id) : null;
      hint(editor, to);
      const end = to?.point ?? (e.shiftKey ? snapAngle(drawing.start, e.point) : e.point);
      editor.writeEachFrame(() => {
        const shape = editor.getShape(id);
        if (!shape) return;
        editor.transact(() => {
          editor.updateShapes({
            [id]: {
              props: {
                ...(shape.props as object),
                path: [0, 0, end.x - shape.x, end.y - shape.y],
              },
            },
          });
          // Route the preview as it will end up, from the (possibly bound) start.
          if (binds) editor.rerouteArrow(id);
        });
      });
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
        const to = endConnection(editor, drawing, e.point, id);
        if (to) editor.setBinding(id, "end", { toId: to.shapeId, anchor: to.anchor });
      }
      editor.ui.setConnect(null);
      editor.endGesture();
      editor.select([id]);
      editor.setTool("select");
      drawing = null;
    },

    onCancel(editor) {
      if (drawing?.id) editor.deleteShapes([drawing.id]);
      if (drawing) editor.endGesture();
      editor.ui.setConnect(null);
      drawing = null;
    },
  };
}

/** Where the end would connect. An arrow from a shape to itself is left free instead. */
function endConnection(
  editor: Editor,
  drawing: { from: Connection | null },
  point: Vec,
  arrowId: string,
): Connection | null {
  const to = editor.connectionAt(point, { excludeId: arrowId });
  return to && to.shapeId !== drawing.from?.shapeId ? to : null;
}

/**
 * Starts drawing an arrow from a connection point, for tools that hand a press over (the select
 * tool, when a press lands on a shape's connection point).
 */
export function startArrowFrom(e: ToolEvent, editor: Editor) {
  arrowTool.onPointerDown!(e, editor);
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
