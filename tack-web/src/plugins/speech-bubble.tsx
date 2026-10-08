import { Path } from "react-konva";

import { boxBounds, boxResize, DEFAULT_BOX, validateBox, type BoxProps } from "@/editor/shapes/box";
import type { ShapeDef } from "@/editor/types";
import { esc, paint } from "@/editor/svg";

/**
 * A speech bubble: a rounded box with a tail at the bottom left. The tail is inside the w×h box,
 * so the stock box bounds, resizing, arrow attachment and style panel all just work.
 */
export type SpeechBubbleProps = BoxProps;

function bubblePath(w: number, h: number): string {
  const tail = Math.min(24, h * 0.25);
  const body = h - tail;
  const r = Math.min(14, w / 4, body / 4);
  const [t0, t1, tip] = [w * 0.22, w * 0.4, w * 0.14];
  return [
    `M ${r} 0`,
    `H ${w - r}`,
    `Q ${w} 0 ${w} ${r}`,
    `V ${body - r}`,
    `Q ${w} ${body} ${w - r} ${body}`,
    `H ${t1}`,
    `L ${tip} ${h}`,
    `L ${t0} ${body}`,
    `H ${r}`,
    `Q 0 ${body} 0 ${body - r}`,
    `V ${r}`,
    `Q 0 0 ${r} 0`,
    "Z",
  ].join(" ");
}

export const speechBubbleShape: ShapeDef<SpeechBubbleProps, "speech-bubble"> = {
  type: "speech-bubble",
  version: 1,
  defaultProps: { ...DEFAULT_BOX, w: 200, h: 130 },
  validate: validateBox,
  getBounds: boxBounds,
  onResize: boxResize,
  toSvg: ({ props: p }) =>
    `<path d="${esc(bubblePath(p.w, p.h))}" ${paint(p.fill, p.stroke, p.strokeWidth)}/>`,
  Component: ({ shape }) => {
    const p = shape.props;
    return (
      <Path
        data={bubblePath(p.w, p.h)}
        fill={p.fill}
        stroke={p.stroke}
        strokeWidth={p.strokeWidth}
        lineJoin="round"
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [],
};
