import { Ellipse, Rect } from "react-konva";

import type { ResizeInfo, Shape, ShapeDef } from "../types";
import { rotatedBounds } from "../geometry";

/** Props shared by the box-like shapes. TODO: generate from the Rust model via ts-rs. */
export type BoxProps = {
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
};

export type RectProps = BoxProps & {
  /** Corner radius in page units, clamped to half the shorter side when drawn. */
  radius: number;
};

/** Every new shape starts white with a 1px black outline. */
export const DEFAULT_BOX: BoxProps = {
  w: 160,
  h: 110,
  fill: "#ffffff",
  stroke: "#000000",
  strokeWidth: 1,
};

/** Largest stroke width the editor accepts. */
export const MAX_STROKE_WIDTH = 64;

export const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
export const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function validateBox(raw: unknown): BoxProps {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    w: Math.max(1, num(p.w, DEFAULT_BOX.w)),
    h: Math.max(1, num(p.h, DEFAULT_BOX.h)),
    fill: str(p.fill, DEFAULT_BOX.fill),
    stroke: str(p.stroke, DEFAULT_BOX.stroke),
    strokeWidth: clamp(num(p.strokeWidth, DEFAULT_BOX.strokeWidth), 0, MAX_STROKE_WIDTH),
  };
}

export const boxBounds = (s: Shape<BoxProps>) =>
  rotatedBounds(s.x, s.y, s.props.w, s.props.h, s.rotation);

export function boxResize<P extends BoxProps, T extends string>(
  shape: Shape<P, T>,
  { scaleX, scaleY, initial }: ResizeInfo,
): Partial<Shape<P, T>> {
  const start = initial.props as BoxProps;
  return {
    props: {
      ...shape.props,
      w: Math.max(1, Math.abs(start.w * scaleX)),
      h: Math.max(1, Math.abs(start.h * scaleY)),
    },
  };
}

/** Corner radius for new rectangles. */
const DEFAULT_RADIUS = 1;
/** Rectangles drawn before `radius` existed used a 10-unit corner; keep them looking the same. */
const LEGACY_RADIUS = 10;

export const rectShape: ShapeDef<RectProps, "rect"> = {
  type: "rect",
  version: 1,
  defaultProps: { ...DEFAULT_BOX, radius: DEFAULT_RADIUS },
  validate: (raw) => ({
    ...validateBox(raw),
    radius: Math.max(0, num((raw as Record<string, unknown> | null)?.radius, LEGACY_RADIUS)),
  }),
  getBounds: boxBounds,
  onResize: boxResize,
  Component: ({ shape }) => {
    const p = shape.props;
    return (
      <Rect
        width={p.w}
        height={p.h}
        fill={p.fill}
        stroke={p.stroke}
        strokeWidth={p.strokeWidth}
        cornerRadius={Math.min(p.radius, p.w / 2, p.h / 2)}
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [],
};

export const ellipseShape: ShapeDef<BoxProps, "ellipse"> = {
  type: "ellipse",
  version: 1,
  defaultProps: DEFAULT_BOX,
  validate: validateBox,
  getBounds: boxBounds,
  onResize: boxResize,
  Component: ({ shape }) => {
    const p = shape.props;
    return (
      <Ellipse
        x={p.w / 2}
        y={p.h / 2}
        radiusX={p.w / 2}
        radiusY={p.h / 2}
        fill={p.fill}
        stroke={p.stroke}
        strokeWidth={p.strokeWidth}
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [],
};
