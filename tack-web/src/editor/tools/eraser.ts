import { Eraser } from "lucide-react";

import type { Tool, Vec } from "../types";

/** Screen pixels between hit tests along a fast stroke, so quick swipes don't skip shapes. */
const STEP = 4;

let erasing: { last: Vec; ids: Set<string> } | null = null;

function sweep(from: Vec, to: Vec, hit: (p: Vec) => string | null, into: Set<string>) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / STEP));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const id = hit({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    if (id) into.add(id);
  }
}

/**
 * Drag across shapes to erase them. They fade as the eraser passes and are deleted together when
 * it lifts, as one undo step. Escape keeps them.
 */
export const eraserTool: Tool = {
  id: "eraser",
  label: "Eraser",
  icon: Eraser,
  shortcut: "e",
  cursor: "cell",

  onPointerDown(e, editor) {
    erasing = { last: e.screen, ids: new Set() };
    const id = editor.shapeAtScreen(e.screen);
    if (id) erasing.ids.add(id);
    editor.ui.setErasing(erasable(editor, erasing.ids));
  },

  onPointerMove(e, editor) {
    if (!erasing) return;
    const before = erasing.ids.size;
    sweep(erasing.last, e.screen, (p) => editor.shapeAtScreen(p), erasing.ids);
    erasing.last = e.screen;
    if (erasing.ids.size !== before) editor.ui.setErasing(erasable(editor, erasing.ids));
  },

  onPointerUp(_e, editor) {
    if (!erasing) return;
    const ids = erasable(editor, erasing.ids);
    erasing = null;
    editor.ui.setErasing([]);
    if (!ids.length) return;
    editor.markHistory();
    editor.deleteShapes(ids);
    editor.markHistory();
  },

  onCancel(editor) {
    erasing = null;
    editor.ui.setErasing([]);
  },
};

/** Grouped shapes go with their whole group; locked shapes are skipped. */
function erasable(editor: Parameters<NonNullable<Tool["onCancel"]>>[0], ids: Set<string>) {
  return editor.expandToUnits([...ids]).filter((id) => {
    const shape = editor.getShape(id);
    return shape && !shape.locked;
  });
}
