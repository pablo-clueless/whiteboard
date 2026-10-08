import { Hand } from "lucide-react";

import type { Camera } from "@/stores/editor";
import type { Tool, Vec } from "../types";

let pan: { screen: Vec; camera: Camera } | null = null;

/** Drag to move around the board. Also used while Space or the middle button is held. */
export const handTool: Tool = {
  id: "hand",
  label: "Hand",
  icon: Hand,
  shortcut: "h",
  cursor: "grab",

  onPointerDown(e, editor) {
    pan = { screen: e.screen, camera: editor.ui.camera };
  },
  onPointerMove(e, editor) {
    if (!pan) return;
    editor.ui.setCamera({
      ...pan.camera,
      x: pan.camera.x + e.screen.x - pan.screen.x,
      y: pan.camera.y + e.screen.y - pan.screen.y,
    });
  },
  onPointerUp() {
    pan = null;
  },
  onCancel() {
    pan = null;
  },
};
