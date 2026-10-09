import { StickyNote } from "lucide-react";

import { STICKY_SIZE } from "../shapes/sticky";
import type { Tool } from "../types";

/** The colour the last note was given, so a run of notes comes out the same. */
let lastFill: string | null = null;

/** Remembers a note colour for the next note this tab places. */
export const rememberStickyFill = (fill: string) => {
  lastFill = fill;
};

/** Click to place a note and start typing on it, or click a note to edit its text. */
export const stickyTool: Tool = {
  id: "sticky",
  label: "Sticky note",
  icon: StickyNote,
  shortcut: "n",
  cursor: "crosshair",

  onPointerUp(e, editor) {
    // Placing the note and typing on it undo as one step; the text editor ends the gesture.
    editor.startGesture();
    const target = e.targetId ? editor.getShape(e.targetId) : null;
    let id: string;
    if (target?.type === "sticky" && !target.locked) {
      id = target.id;
    } else {
      id = editor.createShape({
        type: "sticky",
        x: e.point.x - STICKY_SIZE / 2,
        y: e.point.y - STICKY_SIZE / 2,
        props: lastFill ? { fill: lastFill } : {},
      });
    }
    editor.select([id]);
    editor.setTool("select");
    editor.ui.setEditingText(id);
  },
};
