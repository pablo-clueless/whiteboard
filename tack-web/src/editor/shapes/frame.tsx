import { Group, Rect, Text } from "react-konva";

import { useEditorStore } from "@/stores/editor";
import type { ShapeDef } from "../types";
import { esc, n, paint } from "../svg";

import { boxBounds, boxResize, num, str } from "./box";
import { textFont } from "./text";

export type FrameProps = {
  w: number;
  h: number;
  name: string;
  fill: string;
};

/** The label sits this many screen pixels above the frame, at a fixed screen size. */
const LABEL_GAP = 10;
const LABEL_SIZE = 12;

/**
 * A titled area that holds other shapes. Shapes whose centre is inside it become its children
 * (their `parentId`) and move with it. Frames always draw below other shapes.
 *
 * Only the label takes clicks: pressing inside a frame starts a box selection, as on the empty
 * board, so it's easy to work with what's inside.
 */
export const frameShape: ShapeDef<FrameProps, "frame"> = {
  type: "frame",
  version: 1,
  isContainer: true,
  defaultProps: { w: 480, h: 320, name: "Frame", fill: "#ffffff" },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      w: Math.max(1, num(p.w, 480)),
      h: Math.max(1, num(p.h, 320)),
      name: str(p.name, "Frame"),
      fill: str(p.fill, "#ffffff"),
    };
  },
  getBounds: boxBounds,
  onResize: boxResize,
  label: {
    prop: "name",
    // The label keeps a fixed size on screen, above the frame.
    box: (shape, zoom) => {
      const size = LABEL_SIZE / zoom;
      return {
        x: 0,
        y: -(LABEL_GAP / zoom) - size * 1.2,
        w: Math.max(shape.props.w, 120 / zoom),
        h: size * 1.2,
        fontSize: size,
        fontWeight: 600,
      };
    },
  },
  toSvg: ({ props: p }) =>
    `<rect width="${n(p.w)}" height="${n(p.h)}" ${paint(p.fill, "#d4d4da", 1)}/>` +
    `<text x="0" y="${-LABEL_GAP}" font-family="${esc(textFont())}" font-size="${LABEL_SIZE}" fill="#6b6b75">${esc(p.name)}</text>`,
  Component: function Frame({ shape, isSelected }) {
    const zoom = useEditorStore((s) => s.camera.zoom);
    const editing = useEditorStore((s) => s.editingLabelId === shape.id);
    const p = shape.props;
    const label = LABEL_SIZE / zoom;
    return (
      <Group>
        <Rect
          width={p.w}
          height={p.h}
          fill={p.fill}
          stroke={isSelected ? "#3366ff" : "#d4d4da"}
          strokeWidth={1}
          strokeScaleEnabled={false}
          listening={false}
          perfectDrawEnabled={false}
        />
        <Text
          visible={!editing}
          name="frame-label"
          // Report no size, so the resize handles hug the frame and leave the label out. (Konva
          // skips zero-size children when measuring a group; clicks still use the drawn text.)
          ref={(node) => {
            if (node) node.getClientRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
          }}
          y={-(LABEL_GAP / zoom) - label}
          text={p.name}
          width={p.w}
          wrap="none"
          ellipsis
          fontSize={label}
          fontFamily={textFont()}
          fontStyle="600"
          fill="#6b6b75"
          hitStrokeWidth={0}
          perfectDrawEnabled={false}
        />
      </Group>
    );
  },
  migrations: [],
};
