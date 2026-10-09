import { Group, Label, Line, Path, Tag, Text } from "react-konva";

import { type Axis, axisBetween, elbowPoints, roundedPathData } from "../routing";
import type { Box, Shape, ShapeDef, Vec } from "../types";
import { clamp, MAX_STROKE_WIDTH, num, str } from "./box";
import { useEditorStore } from "@/stores/editor";
import { measureText, textFont } from "./text";
import { esc, paint, points } from "../svg";
import { type Curves, edgeCount, hasCurves, pathData, sampleOutline, validCurves } from "../nodes";

/** Shared by lines and arrows. `path` is flat [x0, y0, x1, y1] in the shape's own space. */
export type LineProps = {
  path: number[];
  /** Per edge of `path`: null for straight, or the two handles of a curve (see `nodes.ts`). */
  curves: Curves;
  stroke: string;
  strokeWidth: number;
};

/**
 * What an arrow end draws when it has a head: a filled arrow, or the UML marks: a hollow
 * triangle (inherits from), a hollow diamond (aggregation) or a filled one (composition).
 */
export type ArrowHead = "arrow" | "triangle" | "diamond" | "diamondFilled";
export const ARROW_HEADS: ArrowHead[] = ["arrow", "triangle", "diamond", "diamondFilled"];

export type ArrowProps = LineProps & {
  arrowStart: boolean;
  arrowEnd: boolean;
  startHead: ArrowHead;
  endHead: ArrowHead;
  /** Elbow arrows run horizontally/vertically with rounded corners; straight ones don't bend. */
  route: "elbow" | "straight";
  /** Which way an elbow leaves its start. Set when attached to shapes; otherwise inferred. */
  axis: Axis | null;
  /** Text in the middle of the line, e.g. "Yes" on a flowchart branch. Empty for none. */
  label: string;
  /** Small text by each end, e.g. "1" and "*" for a relationship's cardinality. */
  startLabel: string;
  endLabel: string;
  dashed: boolean;
  /**
   * Its points were placed by hand (in point editing): rerouting then moves only the attached
   * ends and keeps the rest. Off again when the line style is switched.
   */
  manual: boolean;
};

const LABEL_SIZE = 12;
const END_LABEL_SIZE = 12;
const LABEL_FONT = { fontSize: LABEL_SIZE, fontFamily: "sans", fontWeight: 500 };

/** The point `t` (0–1) of the way along a polyline, by length. */
function pointAlong(pts: number[], t: number): Vec {
  let total = 0;
  for (let i = 2; i < pts.length; i += 2)
    total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  let left = total * t;
  for (let i = 2; i < pts.length; i += 2) {
    const len = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    if (left <= len && len > 0) {
      const k = left / len;
      return {
        x: pts[i - 2] + (pts[i] - pts[i - 2]) * k,
        y: pts[i - 1] + (pts[i + 1] - pts[i - 1]) * k,
      };
    }
    left -= len;
  }
  return { x: pts[pts.length - 2], y: pts[pts.length - 1] };
}

/** Where the middle label sits: a box centred on the route's midpoint, sized to its text. */
export function arrowLabelBox(p: ArrowProps) {
  const mid = pointAlong(arrowPolyline(p), 0.5);
  const { w } = measureText(p.label || "Label", LABEL_FONT);
  const bw = Math.max(48, w + 16);
  const bh = LABEL_SIZE * 1.2 + 8;
  return {
    x: mid.x - bw / 2,
    y: mid.y - bh / 2,
    w: bw,
    h: bh,
    fontSize: LABEL_SIZE,
    fontWeight: 500,
    align: "center" as const,
  };
}

/**
 * Anchor points for the end labels: a little way along the first (or last) segment, and off to
 * one side of the line, so "1" and "*" sit beside the end rather than on it.
 */
function endLabelPoints(route: number[], p: ArrowProps): { start: Vec; end: Vec } {
  const at = (from: number, to: number, text: string) => {
    const [x0, y0, x1, y1] = [route[from], route[from + 1], route[to], route[to + 1]];
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
    const along = Math.min(16, len / 2);
    // Far enough to the side that the text's near edge clears the line, however wide it is.
    const side =
      Math.abs(uy) * (endLabelWidth(text) / 2 + 5) + Math.abs(ux) * (END_LABEL_SIZE / 2 + 4);
    return { x: x0 + ux * along + uy * side, y: y0 + uy * along - ux * side };
  };
  const n = route.length;
  return { start: at(0, 2, p.startLabel), end: at(n - 2, n - 4, p.endLabel) };
}

const endLabelWidth = (text: string) =>
  measureText(text || " ", { fontSize: END_LABEL_SIZE, fontFamily: "sans", fontWeight: 600 }).w;

const DEFAULT_LINE: LineProps = {
  path: [0, 0, 160, 0],
  curves: [],
  stroke: "#000000",
  strokeWidth: 1,
};

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
  const path = validatePath(p.path);
  return {
    path,
    curves: validCurves(p.curves, edgeCount(path.length / 2, false)),
    stroke: str(p.stroke, DEFAULT_LINE.stroke),
    strokeWidth: clamp(num(p.strokeWidth, DEFAULT_LINE.strokeWidth), 0.5, MAX_STROKE_WIDTH),
  };
}

export const arrowHeadSize = (strokeWidth: number) => Math.max(10, strokeWidth * 4);

/** Page-space bounds of a path, padded for the stroke (and arrowheads). */
function pathBounds(shape: Shape<LineProps>, pad: number): Box {
  const r = (shape.rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  // Curve handles too: a curve never strays outside them.
  const path = [...shape.props.path, ...shape.props.curves.flatMap((c) => (c ? [...c] : []))];
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
  nodes: {
    closed: false,
    minNodes: 2,
    read: ({ props: p }) => ({ pts: p.path, curves: p.curves }),
    write: (shape, pts, curves) => ({ props: { ...shape.props, path: pts, curves } }),
  },
  toSvg: ({ props: p }) =>
    hasCurves(p.curves)
      ? `<path d="${pathData(p.path, p.curves, false)}" ${paint(null, p.stroke, p.strokeWidth)} stroke-linecap="round" stroke-linejoin="round"/>`
      : `<polyline points="${points(p.path)}" ${paint(null, p.stroke, p.strokeWidth)}/>`,
  Component: ({ shape }) => {
    const p = shape.props;
    if (hasCurves(p.curves))
      return (
        <Path
          data={pathData(p.path, p.curves, false)}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          lineCap="round"
          lineJoin="round"
          fillEnabled={false}
          hitStrokeWidth={Math.max(HIT_WIDTH, p.strokeWidth)}
          perfectDrawEnabled={false}
        />
      );
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

/** How far each head reaches back from its tip, as a multiple of the head size. */
const HEAD_LENGTH: Record<ArrowHead, number> = {
  arrow: 1,
  triangle: 1.15,
  diamond: 1.7,
  diamondFilled: 1.7,
};

/** A head's outline with its tip at `tip`, pointing away from `from`. */
function headPoints(kind: ArrowHead, from: Vec, tip: Vec, size: number): number[] {
  const len = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const [ux, uy] = [(tip.x - from.x) / len, (tip.y - from.y) / len];
  const back = size * HEAD_LENGTH[kind];
  const [bx, by] = [tip.x - ux * back, tip.y - uy * back];
  if (kind === "diamond" || kind === "diamondFilled") {
    const [mx, my] = [tip.x - (ux * back) / 2, tip.y - (uy * back) / 2];
    const half = size * 0.45;
    return [tip.x, tip.y, mx - uy * half, my + ux * half, bx, by, mx + uy * half, my - ux * half];
  }
  const half = size * (kind === "triangle" ? 0.55 : 0.42);
  return [tip.x, tip.y, bx - uy * half, by + ux * half, bx + uy * half, by - ux * half];
}

/** Hollow heads are filled with white, so the line under them doesn't show through. */
const headFill = (kind: ArrowHead, stroke: string) =>
  kind === "triangle" || kind === "diamond" ? "#ffffff" : stroke;

/** The path data (trimmed for the heads) and the heads an arrow draws, in its own space. */
function arrowGeometry(p: ArrowProps): {
  data: string;
  heads: { points: number[]; fill: string }[];
} {
  const head = arrowHeadSize(p.strokeWidth);
  const route = arrowRoute(p);
  const len = route.length;
  const at = (i: number) => ({ x: route[i], y: route[i + 1] });
  const curved = p.manual && hasCurves(p.curves);
  // Which way each end points: along its curve's handle when the end edge is curved.
  const first = curved ? p.curves[0] : null;
  const last = curved ? p.curves[p.curves.length - 1] : null;
  const towardStart =
    first && (first[0] !== route[0] || first[1] !== route[1])
      ? { x: first[0], y: first[1] }
      : at(2);
  const towardEnd =
    last && (last[2] !== route[len - 2] || last[3] !== route[len - 1])
      ? { x: last[2], y: last[3] }
      : at(len - 4);
  const heads: { points: number[]; fill: string }[] = [];
  if (p.arrowEnd)
    heads.push({
      points: headPoints(p.endHead, towardEnd, at(len - 2), head),
      fill: headFill(p.endHead, p.stroke),
    });
  if (p.arrowStart)
    heads.push({
      points: headPoints(p.startHead, towardStart, at(0), head),
      fill: headFill(p.startHead, p.stroke),
    });
  // The line stops inside a filled arrow (its point stays sharp) and at the back of other heads.
  const trim = (on: boolean, kind: ArrowHead) =>
    !on ? 0 : kind === "arrow" ? head * 0.8 : head * HEAD_LENGTH[kind];
  const [trimStart, trimEnd] = [trim(p.arrowStart, p.startHead), trim(p.arrowEnd, p.endHead)];
  if (curved) {
    // Pull each end in along the direction it leaves in; the curve's handles stay put.
    const pull = (from: Vec, toward: Vec, d: number) => {
      const l = Math.hypot(toward.x - from.x, toward.y - from.y);
      const k = l ? Math.min(d, l) / l : 0;
      return { x: from.x + (toward.x - from.x) * k, y: from.y + (toward.y - from.y) * k };
    };
    const s = pull(at(0), towardStart, trimStart);
    const e = pull(at(len - 2), towardEnd, trimEnd);
    const pts = [s.x, s.y, ...route.slice(2, -2), e.x, e.y];
    return { data: pathData(pts, p.curves, false), heads };
  }
  const line = trimEnds(route, trimStart, trimEnd);
  // Points placed by hand keep their sharp corners; routed elbows get rounded ones.
  return {
    data: p.manual ? pathData(line, p.curves, false) : roundedPathData(line, ELBOW_CORNER),
    heads,
  };
}

/** The arrow as a polyline, curves sampled: for placing its labels. */
function arrowPolyline(p: ArrowProps): number[] {
  if (!(p.manual && hasCurves(p.curves))) return arrowRoute(p);
  return sampleOutline(p.path, p.curves, false).flatMap((v) => [v.x, v.y]);
}

/**
 * The polyline an arrow draws. Arrows the editor has routed store their whole route in `path`;
 * a bare two-point path (mid-drag, or from before routing) is straight, or one elbow.
 */
export function arrowRoute(p: ArrowProps): number[] {
  if (p.manual || p.route === "straight" || p.path.length > 4) return p.path;
  const s = { x: p.path[0], y: p.path[1] };
  const e = { x: p.path[2], y: p.path[3] };
  return elbowPoints(s, e, p.axis ?? axisBetween(s, e));
}

export const arrowShape: ShapeDef<ArrowProps, "arrow"> = {
  type: "arrow",
  version: 1,
  defaultProps: {
    ...DEFAULT_LINE,
    arrowStart: false,
    arrowEnd: true,
    startHead: "arrow",
    endHead: "arrow",
    route: "elbow",
    axis: null,
    label: "",
    startLabel: "",
    endLabel: "",
    dashed: false,
    manual: false,
  },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      ...validateLine(raw),
      arrowStart: p.arrowStart === true,
      arrowEnd: p.arrowEnd !== false,
      startHead: ARROW_HEADS.includes(p.startHead as ArrowHead)
        ? (p.startHead as ArrowHead)
        : "arrow",
      endHead: ARROW_HEADS.includes(p.endHead as ArrowHead) ? (p.endHead as ArrowHead) : "arrow",
      route: p.route === "straight" ? "straight" : "elbow",
      axis: p.axis === "h" || p.axis === "v" ? p.axis : null,
      label: str(p.label, "").slice(0, 200),
      startLabel: str(p.startLabel, "").slice(0, 8),
      endLabel: str(p.endLabel, "").slice(0, 8),
      dashed: p.dashed === true,
      manual: p.manual === true,
    };
  },
  // Double-click an arrow to give it (or change) its middle label.
  label: { prop: "label", box: (s) => arrowLabelBox(s.props) },
  // `path` holds every corner of a routed arrow, so its bounds cover the route.
  getBounds: (s) => pathBounds(s, arrowHeadSize(s.props.strokeWidth)),
  getHandles: endHandles,
  nodes: {
    closed: false,
    minNodes: 2,
    // A routed arrow's points are its route, elbows included.
    read: ({ props: p }) => {
      const pts = arrowRoute(p);
      return {
        pts,
        curves: p.manual ? p.curves : validCurves([], edgeCount(pts.length / 2, false)),
      };
    },
    write: (shape, pts, curves) => ({
      props: { ...shape.props, path: pts, curves, manual: true, axis: null },
    }),
  },
  toSvg: ({ props: p }) => {
    const { data, heads } = arrowGeometry(p);
    const dash = p.dashed ? ` stroke-dasharray="${p.strokeWidth * 4} ${p.strokeWidth * 3}"` : "";
    const body = `<path d="${esc(data)}" ${paint(null, p.stroke, p.strokeWidth)}${dash}/>`;
    const text = (t: string, x: number, y: number, size: number) =>
      `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="${esc(textFont())}" font-size="${size}" fill="#4a4a52">${esc(t)}</text>`;
    let labels = "";
    if (p.label) {
      const b = arrowLabelBox(p);
      labels += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="#ffffff"/>`;
      labels += text(p.label, b.x + b.w / 2, b.y + b.h / 2, LABEL_SIZE);
    }
    const ends = endLabelPoints(arrowPolyline(p), p);
    if (p.startLabel) labels += text(p.startLabel, ends.start.x, ends.start.y, END_LABEL_SIZE);
    if (p.endLabel) labels += text(p.endLabel, ends.end.x, ends.end.y, END_LABEL_SIZE);
    return (
      body +
      heads
        .map(
          (h) =>
            `<polygon points="${points(h.points)}" ${paint(h.fill, p.stroke, p.strokeWidth)} stroke-linejoin="round"/>`,
        )
        .join("") +
      labels
    );
  },
  Component: function ArrowShape({ shape }) {
    const p = shape.props;
    const { data, heads } = arrowGeometry(p);
    const editing = useEditorStore((s) => s.editingLabelId === shape.id);
    const box = p.label && !editing ? arrowLabelBox(p) : null;
    const ends = p.startLabel || p.endLabel ? endLabelPoints(arrowPolyline(p), p) : null;
    const endText = (t: string, at: Vec) => (
      <Text
        x={at.x - endLabelWidth(t) / 2 - 4}
        y={at.y - END_LABEL_SIZE / 2}
        width={endLabelWidth(t) + 8}
        wrap="none"
        text={t}
        align="center"
        fontSize={END_LABEL_SIZE}
        fontFamily={textFont()}
        fontStyle="600"
        fill="#4a4a52"
        listening={false}
      />
    );
    return (
      <Group>
        <Path
          data={data}
          stroke={p.stroke}
          strokeWidth={p.strokeWidth}
          dash={p.dashed ? [p.strokeWidth * 4, p.strokeWidth * 3] : undefined}
          lineCap="round"
          lineJoin="round"
          fillEnabled={false}
          hitStrokeWidth={Math.max(HIT_WIDTH, p.strokeWidth)}
          perfectDrawEnabled={false}
        />
        {heads.map((h, i) => (
          <Line
            key={i}
            points={h.points}
            closed
            fill={h.fill}
            stroke={p.stroke}
            strokeWidth={p.strokeWidth}
            lineJoin="round"
            perfectDrawEnabled={false}
          />
        ))}
        {box && (
          <Label x={box.x} y={box.y}>
            <Tag fill="#ffffff" cornerRadius={6} />
            <Text
              text={p.label}
              width={box.w}
              height={box.h}
              align="center"
              verticalAlign="middle"
              fontSize={LABEL_SIZE}
              fontFamily={textFont()}
              fontStyle="500"
              fill="#2a2a30"
            />
          </Label>
        )}
        {ends && p.startLabel && endText(p.startLabel, ends.start)}
        {ends && p.endLabel && endText(p.endLabel, ends.end)}
      </Group>
    );
  },
  migrations: [],
};
