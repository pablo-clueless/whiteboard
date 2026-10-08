import { Line } from "react-konva";

import type { ShapeDef } from "../types";
import { paint, points } from "../svg";

import { type BoxProps, boxBounds, boxResize, clamp, DEFAULT_BOX, num, validateBox } from "./box";

export const MIN_SIDES = 3;
export const MAX_SIDES = 12;
export const MIN_POINTS = 3;
export const MAX_POINTS = 12;

export type PolygonProps = BoxProps & {
  /** Number of sides: 3 is a triangle, 4 a diamond, 5 a pentagon… */
  sides: number;
};

export type StarProps = BoxProps & {
  points: number;
  /** Inner radius as a fraction of the outer one. Smaller is spikier. */
  innerRatio: number;
};

/**
 * Corners of a regular polygon (alternating radii for a star), starting at the top, stretched so
 * they exactly fill a w×h box. Returned flat, as Konva's Line wants them.
 */
function fitToBox(radii: number[], w: number, h: number): number[] {
  const n = radii.length;
  const raw = radii.map((r, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  const xs = raw.map(([x]) => x);
  const ys = raw.map(([, y]) => y);
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  ];
  return raw.flatMap(([x, y]) => [
    ((x - minX) / (maxX - minX)) * w,
    ((y - minY) / (maxY - minY)) * h,
  ]);
}

export function polygonPoints(sides: number, w: number, h: number) {
  return fitToBox(Array(sides).fill(1), w, h);
}

export function starPoints(points: number, innerRatio: number, w: number, h: number) {
  return fitToBox(
    Array.from({ length: points * 2 }, (_, i) => (i % 2 ? innerRatio : 1)),
    w,
    h,
  );
}

const toVecs = (flat: number[]) =>
  Array.from({ length: flat.length / 2 }, (_, i) => ({ x: flat[i * 2], y: flat[i * 2 + 1] }));

export const polygonShape: ShapeDef<PolygonProps, "polygon"> = {
  type: "polygon",
  version: 1,
  defaultProps: { ...DEFAULT_BOX, w: 140, h: 120, sides: 3 },
  validate: (raw) => ({
    ...validateBox(raw),
    sides: Math.round(
      clamp(num((raw as Record<string, unknown> | null)?.sides, 3), MIN_SIDES, MAX_SIDES),
    ),
  }),
  getBounds: boxBounds,
  onResize: boxResize,
  getOutline: ({ props: p }) => toVecs(polygonPoints(p.sides, p.w, p.h)),
  toSvg: ({ props: p }) =>
    `<polygon points="${points(polygonPoints(p.sides, p.w, p.h))}" ${paint(p.fill, p.stroke, p.strokeWidth)}/>`,
  Component: ({ shape }) => {
    const p = shape.props;
    return (
      <Line
        points={polygonPoints(p.sides, p.w, p.h)}
        closed
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

export const starShape: ShapeDef<StarProps, "star"> = {
  type: "star",
  version: 1,
  defaultProps: { ...DEFAULT_BOX, w: 140, h: 140, points: 5, innerRatio: 0.45 },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      ...validateBox(raw),
      points: Math.round(clamp(num(p.points, 5), MIN_POINTS, MAX_POINTS)),
      innerRatio: clamp(num(p.innerRatio, 0.45), 0.1, 0.95),
    };
  },
  getBounds: boxBounds,
  onResize: boxResize,
  getOutline: ({ props: p }) => toVecs(starPoints(p.points, p.innerRatio, p.w, p.h)),
  toSvg: ({ props: p }) =>
    `<polygon points="${points(starPoints(p.points, p.innerRatio, p.w, p.h))}" ${paint(p.fill, p.stroke, p.strokeWidth)}/>`,
  Component: ({ shape }) => {
    const p = shape.props;
    return (
      <Line
        points={starPoints(p.points, p.innerRatio, p.w, p.h)}
        closed
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
