import {
  Circle,
  Diamond,
  Frame,
  Hexagon,
  type LucideIcon,
  Octagon,
  Pentagon,
  Square,
  Star,
  Triangle,
} from "lucide-react";

import { boxFromPoints, distance } from "../geometry";
import type { Box, Tool, Vec } from "../types";

/** Screen pixels the pointer must travel before a press draws instead of placing a default. */
const DRAW_THRESHOLD = 4;

/**
 * Drag out a box shape; click to drop one at its default size. Shift keeps it square. Exported
 * for plugins: any shape with `w` and `h` props can get a drawing tool from this.
 */
export function boxTool(opts: {
  id: string;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  shapeType: string;
  /** Props that make this preset what it is, e.g. { sides: 6 } for a hexagon. */
  props?: Record<string, unknown>;
  group?: string;
}): Tool {
  let drawing: { start: Vec; screen: Vec; id: string | null } | null = null;

  const boxFor = (start: Vec, point: Vec, square: boolean): Box => {
    if (!square) return boxFromPoints(start, point);
    const size = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y));
    return boxFromPoints(start, {
      x: start.x + Math.sign(point.x - start.x || 1) * size,
      y: start.y + Math.sign(point.y - start.y || 1) * size,
    });
  };

  const tool: Tool = {
    id: opts.id,
    label: opts.label,
    icon: opts.icon,
    shortcut: opts.shortcut,
    group: opts.group,
    cursor: "crosshair",

    onPointerDown(e, editor) {
      editor.startGesture();
      drawing = { start: e.point, screen: e.screen, id: null };
    },

    onPointerMove(e, editor) {
      if (!drawing) return;
      if (!drawing.id) {
        if (distance(drawing.screen, e.screen) < DRAW_THRESHOLD) return;
        drawing.id = editor.createShape({
          type: opts.shapeType,
          x: drawing.start.x,
          y: drawing.start.y,
          props: opts.props,
        });
        editor.select([drawing.id]);
      }
      const id = drawing.id;
      const shape = editor.getShape(id);
      if (!shape) return;
      const b = boxFor(drawing.start, e.point, e.shiftKey);
      editor.writeEachFrame(() =>
        editor.updateShapes({
          [id]: {
            x: b.x,
            y: b.y,
            props: { ...(shape.props as object), w: Math.max(1, b.w), h: Math.max(1, b.h) },
          },
        }),
      );
    },

    onPointerUp(e, editor) {
      if (!drawing) return;
      let id = drawing.id;
      if (!id) {
        // A click: drop a default-sized shape centred on the pointer.
        id = editor.createShape({
          type: opts.shapeType,
          x: e.point.x,
          y: e.point.y,
          props: opts.props,
        });
        const s = editor.getShape(id)!;
        const { w, h } = s.props as { w: number; h: number };
        editor.updateShapes({ [id]: { x: e.point.x - w / 2, y: e.point.y - h / 2 } });
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
  return tool;
}

export const rectTool = boxTool({
  id: "rect",
  label: "Rectangle",
  icon: Square,
  shortcut: "r",
  shapeType: "rect",
});

export const ellipseTool = boxTool({
  id: "ellipse",
  label: "Ellipse",
  icon: Circle,
  shortcut: "o",
  shapeType: "ellipse",
});

/** Polygons and stars share one toolbar button; the menu picks the preset. */
const SHAPES_GROUP = "shapes";

export const polygonTools = [
  { id: "triangle", label: "Triangle", icon: Triangle, shortcut: "p", sides: 3 },
  { id: "diamond", label: "Diamond", icon: Diamond, sides: 4 },
  { id: "pentagon", label: "Pentagon", icon: Pentagon, sides: 5 },
  { id: "hexagon", label: "Hexagon", icon: Hexagon, sides: 6 },
  { id: "octagon", label: "Octagon", icon: Octagon, sides: 8 },
].map(({ sides, ...t }) =>
  boxTool({ ...t, shapeType: "polygon", props: { sides }, group: SHAPES_GROUP }),
);

export const starTool = boxTool({
  id: "star",
  label: "Star",
  icon: Star,
  shapeType: "star",
  group: SHAPES_GROUP,
});

export const frameTool = boxTool({
  id: "frame",
  label: "Frame",
  icon: Frame,
  shortcut: "f",
  shapeType: "frame",
});
