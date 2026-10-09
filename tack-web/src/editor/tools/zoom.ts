import { ZoomIn } from "lucide-react";

import { boxFromPoints, distance } from "../geometry";
import { MAX_ZOOM, zoomAt } from "@/stores/editor";
import type { Tool, Vec } from "../types";

/** Screen pixels the pointer must travel before a press draws a box instead of clicking. */
const DRAG_THRESHOLD = 4;
/** Room left round a zoomed-to box, in screen pixels. */
const MARGIN = 24;

let drag: { start: Vec; screen: Vec; dragging: boolean } | null = null;

/**
 * Drag a box over any part of the board to fill the screen with it. A click zooms in on that
 * spot, and Alt-click zooms out. Changes only the view, so view-only links can use it too.
 */
export const zoomTool: Tool = {
  id: "zoom",
  label: "Zoom to area",
  icon: ZoomIn,
  shortcut: "z",
  cursor: "zoom-in",
  // Its button sits with the other zoom controls.
  toolbar: false,

  onPointerDown(e) {
    drag = { start: e.point, screen: e.screen, dragging: false };
  },
  onPointerMove(e, editor) {
    if (!drag) return;
    if (!drag.dragging && distance(drag.screen, e.screen) < DRAG_THRESHOLD) return;
    drag.dragging = true;
    editor.ui.setBrush(boxFromPoints(drag.start, e.point));
  },
  onPointerUp(e, editor) {
    if (!drag) return;
    const { start, dragging } = drag;
    drag = null;
    editor.ui.setBrush(null);
    const { camera, setCamera } = editor.ui;
    if (dragging) {
      editor.zoomToFit({ box: boxFromPoints(start, e.point), margin: MARGIN, maxZoom: MAX_ZOOM });
    } else {
      setCamera(zoomAt(camera, e.screen, camera.zoom * (e.altKey ? 0.5 : 2)));
    }
  },
  onCancel(editor) {
    drag = null;
    editor.ui.setBrush(null);
  },
};
