import { Group, Line, Path } from "react-konva";

import { type Axis, axisBetween, elbowPoints, roundedPathData } from "../routing";
import type { Box, Shape, ShapeDef, Vec } from "../types";

import { clamp, MAX_STROKE_WIDTH, num, str } from "./box";

/** Shared by lines and arrows. `path` is flat [x0, y0, x1, y1] in the shape's own space. */
export type LineProps = {
  path: number[];
  stroke: string;
  strokeWidth: number;
};

export type ArrowProps = LineProps & {
  arrowStart: boolean;
  arrowEnd: boolean;
  /** Elbow arrows run horizontally/vertically with rounded corners; straight ones don't bend. */
  route: "elbow" | "straight";
  /** Which way an elbow leaves its start. Set when attached to shapes; otherwise inferred. */
  axis: Axis | null;
};

const DEFAULT_LINE: LineProps = { path: [0, 0, 160, 0], stroke: "#000000", strokeWidth: 1 };

/** Pointer-friendly hit area for thin lines, in page units. */
const HIT_WIDTH = 14;

function validatePath(raw: unknown): number[] {
  return Array.isArray(raw) &&
    raw.length >= 4 &&
    raw.length % 2 === 0 &&
    raw.every((n) => typeof n === "number" && Number.isFinite(n))
    ? (raw as number[])
    : DEFAULT_LINE.path;
}

function validateLine(raw: unknown): LineProps {
  const p = (raw ?? {}) as Record<string, unknown>;
  return {
    path: validatePath(p.path),
    stroke: str(p.stroke, DEFAULT_LINE.stroke),
    strokeWidth: clamp(num(p.strokeWidth, DEFAULT_LINE.strokeWidth), 0.5, MAX_STROKE_WIDTH),
  };
}

export const arrowHeadSize = (strokeWidth: number) => Math.max(10, strokeWidth * 4);

/** Page-space bounds of a path, padded for the stroke (and arrowheads). */
function pathBounds(shape: Shape<LineProps>, pad: number): Box {
  const r = (shape.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  const { path } = shape.props;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < path.length; i += 2) {
    const x = shape.x + path[i] * c - path[i + 1] * s;
    const y = shape.y + path[i] * s + path[i + 1] * c;
    [minX, minY, maxX, maxY] = [
      Math.min(minX, x),
      Math.min(minY, y),
      Math.max(maxX, x),
      Math.max(maxY, y),
    ];
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

/** The two ends, in the shape's own space. The editor draws drag handles on these. */
const endHandles = (shape: Shape<LineProps>) => {
  const p = shape.props.path;
  return [
    { id: "start", point: { x: p[0], y: p[1] } },
    { id: "end", point: { x: p[p.length - 2], y: p[p.length - 1] } },
  ];
};

export const lineShape: ShapeDef<LineProps, "line"> = {
  type: "line",
  version: 1,
  defaultProps: DEFAULT_LINE,
  validate: validateLine,
  getBounds: (s) => pathBounds(s, s.props.strokeWidth / 2),
  getHandles: endHandles,
  Component: ({ shape }) => {
    const p = shape.props;
    return (
      <Line
        points={p.path}
        stroke={p.stroke}
        strokeWidth={p.strokeWidth}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={Math.max(HIT_WIDTH, p.strokeWidth)}
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [],
};

/** Corner radius of elbow arrows, in page units. */
const ELBOW_CORNER = 12;

/** Shortens a polyline by `fromStart` / `fromEnd` along its first / last segment. */
function trimEnds(pts: number[], fromStart: number, fromEnd: number): number[] {
  const out = [...pts];
  const pull = (i: number, j: number, d: number) => {
    const len = Math.hypot(out[j] - out[i], out[j + 1] - out[i + 1]);
    if (!d || len === 0) return;
    const t = Math.min(d, len) / len;
    out[i] += (out[j] - out[i]) * t;
    out[i + 1] += (out[j + 1] - out[i + 1]) * t;
  };
  pull(0, 2, fromStart);
  pull(out.length - 2, out.length - 4, fromEnd);
  return out;
}

/** A filled arrowhead with its tip at `tip`, pointing away from `from`. */
function headPoints(from: Vec, tip: Vec, size: number): number[] {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const [ux, uy] = [(tip.x - from.x) / len, (tip.y - from.y) / len];
  const [bx, by] = [tip.x - ux * size, tip.y - uy * size];
  const half = size * 0.42;
  return [tip.x, tip.y, bx - uy * half, by + ux * half, bx + uy * half, by - ux * half];
}

/** The polyline an arrow draws: straight between its ends, or an elbow route. */
export function arrowRoute(p: ArrowProps): number[] {
  const s = { x: p.path[0], y: p.path[1] };
  const e = { x: p.path[p.path.length - 2], y: p.path[p.path.length - 1] };
  return p.route === "straight" ? p.path : elbowPoints(s, e, p.axis ?? axisBetween(s, e));
}

export const arrowShape: ShapeDef<ArrowProps, "arrow"> = {
  type: "arrow",
  version: 1,
  defaultProps: { ...DEFAULT_LINE, arrowStart: false, arrowEnd: true, route: "elbow", axis: null },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      ...validateLine(raw),
      arrowStart: p.arrowStart === true,
      arrowEnd: p.arrowEnd !== false,
      route: p.route === "straight" ? "straight" : "elbow",
      axis: p.axis === "h" || p.axis === "v" ? p.axis : null,
    };
  },
  // An elbow route never leaves the box spanned by its two ends, so the ends' bounds cover it.
  getBounds: (s) => pathBounds(s, arrowHeadSize(s.props.strokeWidth)),
  getHandles: endHandles,
  Component: ({ shape }) => {
    const p = shape.props;
    const head = arrowHeadSize(p.strokeWidth);
    const route = arrowRoute(p);
    const n = route.length;
    // Stop the line at the base of each head so thick strokes don't poke past the tip.
    const line = trimEnds(route, p.arrowStart ? head * 0.8 : 0, p.arrowEnd ? head * 0.8 : 0);
    const at = (i: number) => ({ x: route[i], y: route[i + 1] });
    return (
      <Group>
        <Path
          data={roundedPathData(line, ELBOW_CORNER)}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          lineCap="round"
          lineJoin="round"
          fillEnabled={false}
          hitStrokeWidth={Math.max(HIT_WIDTH, p.strokeWidth)}
          perfectDrawEnabled={false}
        />
        {p.arrowEnd && (
          <Line
            points={headPoints(at(n - 4), at(n - 2), head)}
            closed
            fill={p.stroke}
            stroke={p.stroke}
            strokeWidth={p.strokeWidth}
            lineJoin="round"
            perfectDrawEnabled={false}
          />
        )}
        {p.arrowStart && (
          <Line
            points={headPoints(at(2), at(0), head)}
            closed
            fill={p.stroke}
            stroke={p.stroke}
            strokeWidth={p.strokeWidth}
            lineJoin="round"
            perfectDrawEnabled={false}
          />
        )}
      </Group>
    );
  },
  migrations: [],
};
