import { Line, Path } from "react-konva";

import { type BoxProps, boxBounds, boxResize, clamp, DEFAULT_BOX, num, validateBox } from "./box";
import type { Shape, ShapeDef } from "../types";
import { paint, points } from "../svg";
import { toPage } from "../bindings";
import {
  type Curves,
  hasCurves,
  outlineBox,
  pathData,
  sampleOutline,
  scaleOutline,
  shiftOutline,
  validCurves,
} from "../nodes";

export const MIN_SIDES = 3;
export const MAX_SIDES = 12;
export const MIN_POINTS = 3;
export const MAX_POINTS = 12;

/**
 * Corners placed by hand (point editing), replacing the regular outline: flat x, y pairs as
 * fractions of the w×h box, so the shape still resizes. Null for the regular shape.
 */
type Edited = {
  nodes: number[] | null;
  /** Per edge, as fractions of the box like `nodes` (see `nodes.ts`). */
  curves: Curves;
};

export type PolygonProps = BoxProps &
  Edited & {
    /** Number of sides: 3 is a triangle, 4 a diamond, 5 a pentagon… */
    sides: number;
  };

export type StarProps = BoxProps &
  Edited & {
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

function validateEdited(raw: unknown): Edited {
  const p = (raw ?? {}) as Record<string, unknown>;
  const nodes =
    Array.isArray(p.nodes) &&
    p.nodes.length >= 6 &&
    p.nodes.length % 2 === 0 &&
    p.nodes.every((v) => typeof v === "number" && Number.isFinite(v))
      ? (p.nodes as number[])
      : null;
  // Curves only mean something on hand-placed corners.
  return { nodes, curves: nodes ? validCurves(p.curves, nodes.length / 2) : [] };
}

/** The outline in the shape's own space: hand-placed corners, or the regular ones. */
function outline(p: BoxProps & Edited, regular: () => number[]) {
  if (!p.nodes) return { pts: regular(), curves: [] as Curves, edited: false };
  const scaled = scaleOutline(p.nodes, p.curves, p.w, p.h);
  return { ...scaled, edited: true };
}

/**
 * Point editing for both: reads the outline, and writes new corners back as fractions of the box
 * round them (moving the shape so they stay where they were put on the page).
 */
function editableNodes<P extends BoxProps & Edited, T extends string>(
  regular: (p: P) => number[],
): NonNullable<ShapeDef<P, T>["nodes"]> {
  return {
    closed: true,
    minNodes: 3,
    read: ({ props: p }) => {
      const o = outline(p, () => regular(p));
      return { pts: o.pts, curves: o.edited ? o.curves : validCurves([], o.pts.length / 2) };
    },
    write: (shape: Shape<P, T>, pts, curves) => {
      const box = outlineBox(pts, curves);
      const [w, h] = [Math.max(1, box.w), Math.max(1, box.h)];
      const moved = shiftOutline(pts, curves, -box.x, -box.y);
      const unit = scaleOutline(moved.pts, moved.curves, 1 / w, 1 / h);
      const origin = toPage(shape, { x: box.x, y: box.y });
      return {
        x: origin.x,
        y: origin.y,
        props: { ...shape.props, w, h, nodes: unit.pts, curves: unit.curves },
      };
    },
  };
}

/** Draws an outline: as a polygon when its edges are all straight, else as a path. */
function OutlineShape({ pts, curves, p }: { pts: number[]; curves: Curves; p: BoxProps }) {
  if (hasCurves(curves))
    return (
      <Path
        data={pathData(pts, curves, true)}
        fill={p.fill}
        stroke={p.stroke}
        strokeWidth={p.strokeWidth}
        lineJoin="round"
        perfectDrawEnabled={false}
      />
    );
  return (
    <Line
      points={pts}
      closed
      fill={p.fill}
      stroke={p.stroke}
      strokeWidth={p.strokeWidth}
      lineJoin="round"
      perfectDrawEnabled={false}
    />
  );
}

const outlineSvg = (pts: number[], curves: Curves, p: BoxProps) =>
  hasCurves(curves)
    ? `<path d="${pathData(pts, curves, true)}" ${paint(p.fill, p.stroke, p.strokeWidth)} stroke-linejoin="round"/>`
    : `<polygon points="${points(pts)}" ${paint(p.fill, p.stroke, p.strokeWidth)}/>`;

const regularPolygon = (p: PolygonProps) => polygonPoints(p.sides, p.w, p.h);
const regularStar = (p: StarProps) => starPoints(p.points, p.innerRatio, p.w, p.h);

export const polygonShape: ShapeDef<PolygonProps, "polygon"> = {
  type: "polygon",
  version: 1,
  defaultProps: { ...DEFAULT_BOX, w: 140, h: 120, sides: 3, nodes: null, curves: [] },
  validate: (raw) => ({
    ...validateBox(raw),
    ...validateEdited(raw),
    sides: Math.round(
      clamp(num((raw as Record<string, unknown> | null)?.sides, 3), MIN_SIDES, MAX_SIDES),
    ),
  }),
  getBounds: boxBounds,
  onResize: boxResize,
  nodes: editableNodes(regularPolygon),
  getOutline: ({ props: p }) => {
    const o = outline(p, () => regularPolygon(p));
    return sampleOutline(o.pts, o.curves, true);
  },
  toSvg: ({ props: p }) => {
    const o = outline(p, () => regularPolygon(p));
    return outlineSvg(o.pts, o.curves, p);
  },
  Component: ({ shape }) => {
    const p = shape.props;
    const o = outline(p, () => regularPolygon(p));
    return <OutlineShape pts={o.pts} curves={o.curves} p={p} />;
  },
  migrations: [],
};

export const starShape: ShapeDef<StarProps, "star"> = {
  type: "star",
  version: 1,
  defaultProps: {
    ...DEFAULT_BOX,
    w: 140,
    h: 140,
    points: 5,
    innerRatio: 0.45,
    nodes: null,
    curves: [],
  },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      ...validateBox(raw),
      ...validateEdited(raw),
      points: Math.round(clamp(num(p.points, 5), MIN_POINTS, MAX_POINTS)),
      innerRatio: clamp(num(p.innerRatio, 0.45), 0.1, 0.95),
    };
  },
  getBounds: boxBounds,
  onResize: boxResize,
  nodes: editableNodes(regularStar),
  getOutline: ({ props: p }) => {
    const o = outline(p, () => regularStar(p));
    return sampleOutline(o.pts, o.curves, true);
  },
  toSvg: ({ props: p }) => {
    const o = outline(p, () => regularStar(p));
    return outlineSvg(o.pts, o.curves, p);
  },
  Component: ({ shape }) => {
    const p = shape.props;
    const o = outline(p, () => regularStar(p));
    return <OutlineShape pts={o.pts} curves={o.curves} p={p} />;
  },
  migrations: [],
};
