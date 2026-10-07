import { Pencil } from "lucide-react";

import type { Tool, Vec } from "../types";

let drawing: { id: string; origin: Vec; samples: number[] } | null = null;

/**
 * Freehand pen. Pens use real pressure; mice and fingers fake it from speed. The stroke is
 * written at most once per frame, like a drag, so others see it being drawn.
 */
export const drawTool: Tool = {
  id: "draw",
  label: "Draw",
  icon: Pencil,
  shortcut: "d",
  cursor: "crosshair",

  onPointerDown(e, editor) {
    editor.startGesture();
    const samples = [0, 0, e.pressure];
    const id = editor.createShape({
      type: "freehand",
      x: e.point.x,
      y: e.point.y,
      props: { samples, simulatePressure: e.pointerType !== "pen" },
    });
    drawing = { id, origin: e.point, samples };
  },

  onPointerMove(e, editor) {
    if (!drawing) return;
    const { id, origin, samples } = drawing;
    samples.push(e.point.x - origin.x, e.point.y - origin.y, e.pressure);
    const shape = editor.getShape(id);
    if (!shape) return;
    const snapshot = [...samples];
    editor.writeEachFrame(() =>
      editor.updateShapes({ [id]: { props: { ...(shape.props as object), samples: snapshot } } }),
    );
  },

  onPointerUp(_e, editor) {
    if (!drawing) return;
    editor.endGesture(); // flushes the last frame's write
    drawing = null;
    // Stay on the pen so the next stroke can start straight away.
  },

  onCancel(editor) {
    if (drawing) {
      editor.deleteShapes([drawing.id]);
      editor.endGesture();
    }
    drawing = null;
  },
};
