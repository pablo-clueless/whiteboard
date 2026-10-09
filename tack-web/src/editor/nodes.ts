/**
 * Editable outlines: a run of nodes (flat x, y pairs) joined by edges that are each straight or
 * curved. A curved edge is a cubic Bézier with two handles, stored per edge as
 * [c1x, c1y, c2x, c2y] in the same space as the nodes; a straight edge stores null. Open outlines
 * (lines, arrows) have one edge fewer than nodes; closed ones (polygons) join the last node back
 * to the first.
 */
import type { Box, Vec } from "./types";

export type Curve = [number, number, number, number] | null;
export type Curves = Curve[];

export const edgeCount = (nodes: number, closed: boolean) =>
  closed ? nodes : Math.max(0, nodes - 1);

const node = (pts: number[], i: number): Vec => ({ x: pts[i * 2], y: pts[i * 2 + 1] });

/** The node index an edge ends at (the first node, for a closed outline's last edge). */
const nextNode = (pts: number[], edge: number) => (edge + 1) % (pts.length / 2);

/** Curves read from stored data: exactly one entry per edge, anything malformed straight. */
export function validCurves(raw: unknown, edges: number): Curves {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: edges }, (_, i) => {
    const c = list[i];
    return Array.isArray(c) &&
      c.length === 4 &&
      c.every((v) => typeof v === "number" && isFinite(v))
      ? (c as [number, number, number, number])
      : null;
  });
}

export const hasCurves = (curves: Curves | undefined) => !!curves?.some(Boolean);

/** SVG / Konva path data for the outline. */
export function pathData(pts: number[], curves: Curves, closed: boolean): string {
  const n = pts.length / 2;
  if (n < 1) return "";
  const f = (v: number) => Math.round(v * 100) / 100;
  let d = `M${f(pts[0])} ${f(pts[1])}`;
  for (let e = 0; e < edgeCount(n, closed); e++) {
    const b = node(pts, nextNode(pts, e));
    const c = curves[e];
    d += c
      ? `C${f(c[0])} ${f(c[1])} ${f(c[2])} ${f(c[3])} ${f(b.x)} ${f(b.y)}`
      : `L${f(b.x)} ${f(b.y)}`;
  }
  return closed ? d + "Z" : d;
}

/** A point along a cubic Bézier. */
export function bezierAt(a: Vec, c1: Vec, c2: Vec, b: Vec, t: number): Vec {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
  };
}

/** The point halfway along an edge (by parameter): where its "add a node" marker sits. */
export function edgeMiddle(pts: number[], curves: Curves, edge: number): Vec {
  const a = node(pts, edge);
  const b = node(pts, nextNode(pts, edge));
  const c = curves[edge];
  if (!c) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return bezierAt(a, { x: c[0], y: c[1] }, { x: c[2], y: c[3] }, b, 0.5);
}

/**
 * Handles that bend an edge smoothly through its neighbours (a Catmull-Rom spline), so curving
 * every edge gives one flowing line through all the nodes. An edge with no neighbours bows out
 * to one side.
 */
export function smoothCurve(pts: number[], edge: number, closed: boolean): Curve {
  const n = pts.length / 2;
  const a = node(pts, edge);
  const b = node(pts, nextNode(pts, edge));
  const before = edge > 0 || closed ? node(pts, (edge - 1 + n) % n) : null;
  const after = edge + 2 < n || closed ? node(pts, (edge + 2) % n) : null;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!before && !after) {
    // A lone edge: an even arc, bulging a quarter of its length.
    const [nx, ny] = [-(b.y - a.y) / (len || 1), (b.x - a.x) / (len || 1)];
    const bulge = len * 0.33;
    return [
      a.x + (b.x - a.x) / 3 + nx * bulge,
      a.y + (b.y - a.y) / 3 + ny * bulge,
      a.x + ((b.x - a.x) * 2) / 3 + nx * bulge,
      a.y + ((b.y - a.y) * 2) / 3 + ny * bulge,
    ];
  }
  // Missing neighbours mirror the far node, so the ends leave straight towards it.
  const p0 = before ?? { x: 2 * a.x - b.x, y: 2 * a.y - b.y };
  const p3 = after ?? { x: 2 * b.x - a.x, y: 2 * b.y - a.y };
  return [
    a.x + (b.x - p0.x) / 6,
    a.y + (b.y - p0.y) / 6,
    b.x - (p3.x - a.x) / 6,
    b.y - (p3.y - a.y) / 6,
  ];
}

/** Moves node `i` by (dx, dy), carrying the curve handles beside it so its edges keep their bend. */
export function moveNode(
  pts: number[],
  curves: Curves,
  i: number,
  dx: number,
  dy: number,
  closed: boolean,
): { pts: number[]; curves: Curves } {
  const n = pts.length / 2;
  const out = [...pts];
  out[i * 2] += dx;
  out[i * 2 + 1] += dy;
  const next = curves.map((c) => (c ? ([...c] as Curve) : null));
  const leaving = i < edgeCount(n, closed) ? i : -1; // the edge that starts here
  const arriving = i > 0 ? i - 1 : closed ? n - 1 : -1; // the edge that ends here
  const l = leaving >= 0 ? next[leaving] : null;
  if (l) [l[0], l[1]] = [l[0] + dx, l[1] + dy];
  const r = arriving >= 0 ? next[arriving] : null;
  if (r) [r[2], r[3]] = [r[2] + dx, r[3] + dy];
  return { pts: out, curves: next };
}

/** Splits an edge in two at its middle, adding a node there. Curved edges keep their shape. */
export function insertNode(
  pts: number[],
  curves: Curves,
  edge: number,
): { pts: number[]; curves: Curves; index: number } {
  const a = node(pts, edge);
  const b = node(pts, nextNode(pts, edge));
  const c = curves[edge];
  let mid: Vec;
  let halves: [Curve, Curve];
  if (!c) {
    mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    halves = [null, null];
  } else {
    // De Casteljau at t = 0.5.
    const avg = (p: Vec, q: Vec) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    const [c1, c2] = [
      { x: c[0], y: c[1] },
      { x: c[2], y: c[3] },
    ];
    const [ab, bc, cd] = [avg(a, c1), avg(c1, c2), avg(c2, b)];
    const [abc, bcd] = [avg(ab, bc), avg(bc, cd)];
    mid = avg(abc, bcd);
    halves = [
      [ab.x, ab.y, abc.x, abc.y],
      [bcd.x, bcd.y, cd.x, cd.y],
    ];
  }
  const index = edge + 1;
  return {
    pts: [...pts.slice(0, index * 2), mid.x, mid.y, ...pts.slice(index * 2)],
    curves: [...curves.slice(0, edge), ...halves, ...curves.slice(edge + 1)],
    index,
  };
}

/**
 * Removes node `i`, joining its two edges into one: straight if both were, otherwise a curve
 * keeping the outer handles. Returns null when that would leave too few nodes.
 */
export function removeNode(
  pts: number[],
  curves: Curves,
  i: number,
  closed: boolean,
  minNodes: number,
): { pts: number[]; curves: Curves } | null {
  const n = pts.length / 2;
  if (n - 1 < minNodes) return null;
  const outPts = [...pts.slice(0, i * 2), ...pts.slice(i * 2 + 2)];
  const edges = edgeCount(n, closed);
  const arriving = i > 0 ? i - 1 : closed ? n - 1 : -1;
  const leaving = i < edges ? i : -1;
  // An end of an open outline: its one edge just goes.
  if (arriving < 0) return { pts: outPts, curves: curves.slice(1) };
  if (leaving < 0) return { pts: outPts, curves: curves.slice(0, -1) };
  const [inC, outC] = [curves[arriving], curves[leaving]];
  const a = node(pts, arriving);
  const b = node(pts, nextNode(pts, leaving));
  const joined: Curve =
    inC || outC
      ? [
          inC ? inC[0] : a.x + (b.x - a.x) / 3,
          inC ? inC[1] : a.y + (b.y - a.y) / 3,
          outC ? outC[2] : a.x + ((b.x - a.x) * 2) / 3,
          outC ? outC[3] : a.y + ((b.y - a.y) * 2) / 3,
        ]
      : null;
  const next = [...curves];
  next[arriving] = joined;
  next.splice(leaving, 1);
  // Removing node 0 of a closed outline: the joined edge (now ending at the old node 1) wrapped
  // round from the last edge, which the splice shifted; it stays last, as it should.
  return { pts: outPts, curves: next };
}

/** Box round the nodes and curve handles (a curve never strays outside its handles). */
export function outlineBox(pts: number[], curves: Curves): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    xs.push(pts[i]);
    ys.push(pts[i + 1]);
  }
  for (const c of curves) {
    if (!c) continue;
    xs.push(c[0], c[2]);
    ys.push(c[1], c[3]);
  }
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/** The outline as a polygon, curves sampled, e.g. for where arrows touch a curved shape. */
export function sampleOutline(pts: number[], curves: Curves, closed: boolean, steps = 12): Vec[] {
  const n = pts.length / 2;
  const out: Vec[] = [];
  for (let e = 0; e < edgeCount(n, closed); e++) {
    const a = node(pts, e);
    const b = node(pts, nextNode(pts, e));
    const c = curves[e];
    out.push(a);
    if (c)
      for (let s = 1; s < steps; s++)
        out.push(bezierAt(a, { x: c[0], y: c[1] }, { x: c[2], y: c[3] }, b, s / steps));
  }
  if (!closed && n) out.push(node(pts, n - 1));
  return out;
}

/** Scales every coordinate (nodes and handles) by (sx, sy) about the origin. */
export function scaleOutline(
  pts: number[],
  curves: Curves,
  sx: number,
  sy: number,
): { pts: number[]; curves: Curves } {
  return {
    pts: pts.map((v, i) => v * (i % 2 ? sy : sx)),
    curves: curves.map((c) => (c ? [c[0] * sx, c[1] * sy, c[2] * sx, c[3] * sy] : null)),
  };
}

/** Moves every coordinate by (dx, dy). */
export function shiftOutline(
  pts: number[],
  curves: Curves,
  dx: number,
  dy: number,
): { pts: number[]; curves: Curves } {
  return {
    pts: pts.map((v, i) => v + (i % 2 ? dy : dx)),
    curves: curves.map((c) => (c ? [c[0] + dx, c[1] + dy, c[2] + dx, c[3] + dy] : null)),
  };
}
