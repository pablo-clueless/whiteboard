import { Ellipse, Rect } from "react-konva";

import { konvaDash, readStrokeStyle, type StrokeStyle } from "../stroke";
import type { ResizeInfo, Shape, ShapeDef } from "../types";
import { rotatedBounds } from "../geometry";
import { n, paint } from "../svg";

/** Props shared by the box-like shapes. TODO: generate from the Rust model via ts-rs. */
export type BoxProps = {
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
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
  strokeStyle: "solid",
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
    strokeStyle: readStrokeStyle(p.strokeStyle),
  };
}

export const boxBounds = (s: Shape<{ w: number; h: number }>) =>
  rotatedBounds(s.x, s.y, s.props.w, s.props.h, s.rotation);

export function boxResize<P extends { w: number; h: number }, T extends string>(
  shape: Shape<P, T>,
  { scaleX, scaleY, initial }: ResizeInfo,
): Partial<Shape<P, T>> {
  const start = initial.props as { w: number; h: number };
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
  version: 2,
  defaultProps: { ...DEFAULT_BOX, radius: DEFAULT_RADIUS },
  validate: (raw) => ({
    ...validateBox(raw),
    radius: Math.max(0, num((raw as Record<string, unknown> | null)?.radius, LEGACY_RADIUS)),
  }),
  getBounds: boxBounds,
  onResize: boxResize,
  toSvg: ({ props: p }) => {
    const r = n(Math.min(p.radius, p.w / 2, p.h / 2));
    return `<rect width="${n(p.w)}" height="${n(p.h)}" rx="${r}" ${paint(p.fill, p.stroke, p.strokeWidth, p.strokeStyle)}/>`;
  },
  Component: ({ shape }) => {
    const p = shape.props;
    return (
      <Rect
        width={p.w}
        height={p.h}
        fill={p.fill}
        stroke={p.stroke}
        strokeWidth={p.strokeWidth}
        {...konvaDash(p.strokeStyle, p.strokeWidth)}
        cornerRadius={Math.min(p.radius, p.w / 2, p.h / 2)}
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [
    // 1 → 2: rectangles from before `radius` existed drew a 10-unit corner. Store it, so the
    // corner is an ordinary prop the style panel shows and edits.
    (props) => {
      const p = (props ?? {}) as Record<string, unknown>;
      return typeof p.radius === "number" ? p : { ...p, radius: LEGACY_RADIUS };
    },
  ],
};

export const ellipseShape: ShapeDef<BoxProps, "ellipse"> = {
  type: "ellipse",
  version: 1,
  defaultProps: DEFAULT_BOX,
  validate: validateBox,
  getBounds: boxBounds,
  onResize: boxResize,
  // A 48-gon is within a fraction of a unit of the true ellipse at board sizes.
  getOutline: ({ props: p }) =>
    Array.from({ length: 48 }, (_, i) => {
      const a = (i / 48) * Math.PI * 2;
      return { x: p.w / 2 + (Math.cos(a) * p.w) / 2, y: p.h / 2 + (Math.sin(a) * p.h) / 2 };
    }),
  toSvg: ({ props: p }) =>
    `<ellipse cx="${n(p.w / 2)}" cy="${n(p.h / 2)}" rx="${n(p.w / 2)}" ry="${n(p.h / 2)}" ${paint(p.fill, p.stroke, p.strokeWidth, p.strokeStyle)}/>`,
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
        {...konvaDash(p.strokeStyle, p.strokeWidth)}
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [],
};
