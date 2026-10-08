import { ImagePlus } from "lucide-react";

import { IMAGE_TYPES } from "@/lib/api";
import type { Tool } from "../types";

/**
 * Click where the image should go, then pick one or more files. (Pasting or dropping images onto
 * the board works with any tool.)
 */
export const imageTool: Tool = {
  id: "image",
  label: "Image",
  icon: ImagePlus,
  shortcut: "i",
  cursor: "copy",

  onPointerUp(e, editor) {
    const at = e.point;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_TYPES.join(",");
    input.multiple = true;
    input.onchange = () => {
      const files = [...(input.files ?? [])];
      if (files.length) void editor.insertImages(files, at);
    };
    input.click();
    editor.setTool("select");
  },
};
