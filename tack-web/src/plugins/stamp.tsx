import { Stamp } from "lucide-react";
import { Text } from "react-konva";

import { clamp, num, str } from "@/editor/shapes/box";
import type { ShapeDef, Tool } from "@/editor/types";
import { rotatedBounds } from "@/editor/geometry";
import { esc, n } from "@/editor/svg";

/** Reactions people drop on a board to vote or react. Keys 1–6 pick one while the tool is on. */
export const STAMPS = ["👍", "❤️", "⭐", "✅", "❓", "🔥"];

export type StampProps = { emoji: string; size: number };

const MIN_SIZE = 16;
const MAX_SIZE = 512;

export const stampShape: ShapeDef<StampProps, "stamp"> = {
  type: "stamp",
  version: 1,
  defaultProps: { emoji: STAMPS[0], size: 48 },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      emoji: str(p.emoji, STAMPS[0]).slice(0, 16),
      size: clamp(num(p.size, 48), MIN_SIZE, MAX_SIZE),
    };
  },
  getBounds: (s) => rotatedBounds(s.x, s.y, s.props.size, s.props.size, s.rotation),
  // Stamps stay square: the larger stretch wins.
  onResize: (shape, { scaleX, scaleY, initial }) => ({
    props: {
      ...shape.props,
      size: clamp(
        (initial.props as StampProps).size * Math.max(Math.abs(scaleX), Math.abs(scaleY)),
        MIN_SIZE,
        MAX_SIZE,
      ),
    },
  }),
  toSvg: ({ props: p }) =>
    `<text x="${n(p.size / 2)}" y="${n(p.size / 2)}" font-size="${n(p.size * 0.8)}" text-anchor="middle" dominant-baseline="central">${esc(p.emoji)}</text>`,
  Component: ({ shape }) => {
    const { emoji, size } = shape.props;
    const fontSize = size * 0.8;
    const width = measure(emoji, fontSize);
    // Centred by hand: an emoji can measure wider than the box, and Konva drops a line that
    // doesn't fit a fixed width.
    return (
      <Text
        text={emoji}
        x={(size - width) / 2}
        y={(size - fontSize) / 2}
        fontSize={fontSize}
        lineHeight={1}
        fill="#000000"
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [],
};

let measurer: CanvasRenderingContext2D | null = null;

/** Width of `text` at `fontSize` in Konva's default font. */
function measure(text: string, fontSize: number): number {
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return fontSize;
  measurer.font = `${fontSize}px Arial`;
  return measurer.measureText(text).width;
}

let current = STAMPS[0];

/**
 * Click to drop the current stamp centred on the pointer; keep clicking to drop more. Built only
 * against the `Tool` interface: it exercises pointer and key events and editor writes.
 */
export const stampTool: Tool = {
  id: "stamp",
  label: "Stamp (1–6 to pick)",
  icon: Stamp,
  shortcut: "s",
  cursor: "copy",

  onPointerDown(e, editor) {
    const size = 48 / editor.ui.camera.zoom;
    editor.markHistory();
    const id = editor.createShape({
      type: "stamp",
      x: e.point.x - size / 2,
      y: e.point.y - size / 2,
      props: { emoji: current, size },
    });
    editor.markHistory();
    editor.select([id]);
  },

  onKeyDown(e, editor) {
    const pick = STAMPS[Number(e.key) - 1];
    if (!pick) return;
    current = pick;
    editor.notify(`Stamp: ${pick}`, "info");
  },
};
