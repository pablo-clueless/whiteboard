import { Type } from "lucide-react";

import { TEXT_LINE_HEIGHT } from "../shapes/text";
import type { Tool } from "../types";

/** Click to add text, or click existing text to edit it. Typing happens in a DOM overlay. */
export const textTool: Tool = {
  id: "text",
  label: "Text",
  icon: Type,
  shortcut: "t",
  cursor: "text",

  onPointerUp(e, editor) {
    // Creating the box and typing into it undo as one step; the text editor ends the gesture.
    editor.startGesture();
    const target = e.targetId ? editor.getShape(e.targetId) : null;
    let id: string;
    if (target?.type === "text") {
      id = target.id;
    } else {
      // Put the click roughly on the first line's middle, like a text cursor.
      const fontSize = 24;
      id = editor.createShape({
        type: "text",
        x: e.point.x,
        y: e.point.y - (fontSize * TEXT_LINE_HEIGHT) / 2,
        props: { text: "", fontSize },
      });
    }
    editor.select([id]);
    editor.setTool("select");
    editor.ui.setEditingText(id);
  },
};
