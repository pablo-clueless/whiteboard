import type { Box, Vec } from "./types";

/**
 * Elbow ("orthogonal") connectors, like an ERD diagram: leave the start horizontally (or
 * vertically), turn once in the middle, and arrive at the end the same way. When the two ends
 * already line up, the route is a straight line.
 *
 * Arrows store only their two ends; the route is derived from them when drawing, so syncing and
 * endpoint handles stay simple.
 */

export type Axis = "h" | "v";

/** Below this offset (page units) the ends count as lined up and the route is straight. */
const ALIGNED = 1;

/** Which way to leave and arrive: across the wider gap. */
export function axisBetween(a: Vec, b: Vec): Axis {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "h" : "v";
}

/** Corner points of the elbow route from `s` to `e` (flat [x, y, …], including both ends). */
export function elbowPoints(s: Vec, e: Vec, axis: Axis): number[] {
  if (axis === "h") {
    if (Math.abs(e.y - s.y) < ALIGNED) return [s.x, s.y, e.x, e.y];
    const mx = (s.x + e.x) / 2;
    return [s.x, s.y, mx, s.y, mx, e.y, e.x, e.y];
  }
  if (Math.abs(e.x - s.x) < ALIGNED) return [s.x, s.y, e.x, e.y];
  const my = (s.y + e.y) / 2;
  return [s.x, s.y, s.x, my, e.x, my, e.x, e.y];
}

/* ── Routing between fixed connection points ────────────────────────────── */

/** One end of a connector: where it is, and which way it leaves its shape (null when free). */
export type RouteEnd = { point: Vec; dir: Vec | null };

/** Clearance kept around shapes when a route goes round them. */
const CLEARANCE = 16;
/** Cost of each bend, in page units of length, so tidier routes win near-ties. */
const BEND_COST = 24;
/** Effectively forbids a route through a connected shape, or doubling back on its way out. */
const BLOCKED = 1e6;

const same = (a: number, b: number) => Math.abs(a - b) < 0.01;

/** Drops repeated points and middle points of straight runs. */
function simplify(pts: Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && same(last.x, p.x) && same(last.y, p.y)) continue;
    const prev = out[out.length - 2];
    if (
      prev &&
      last &&
      ((same(prev.x, last.x) && same(last.x, p.x)) || (same(prev.y, last.y) && same(last.y, p.y)))
    ) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Whether an axis-aligned segment passes through the inside of a box. */
function crosses(a: Vec, b: Vec, box: Box): boolean {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const inset = 1;
  return (
    x1 > box.x + inset &&
    x0 < box.x + box.w - inset &&
    y1 > box.y + inset &&
    y0 < box.y + box.h - inset
  );
}

/**
 * An orthogonal route between two connection points. Each attached end leaves straight out of
 * its side (a short stub) and the middle is the cheapest of a handful of one- and two-bend
 * candidates, including ones that go round the connected shapes. Cheapest means shortest, with
 * a cost per bend, never through a connected shape and never doubling back into its own side.
 *
 * Returns flat [x, y, …] in page space, from `a.point` to `b.point`.
 */
export function orthogonalRoute(
  a: RouteEnd,
  b: RouteEnd,
  obstacles: Box[],
  stub: number,
): number[] {
  const s = a.dir ? { x: a.point.x + a.dir.x * stub, y: a.point.y + a.dir.y * stub } : a.point;
  const e = b.dir ? { x: b.point.x + b.dir.x * stub, y: b.point.y + b.dir.y * stub } : b.point;

  const xs = new Set([s.x, e.x, (s.x + e.x) / 2]);
  const ys = new Set([s.y, e.y, (s.y + e.y) / 2]);
  for (const o of obstacles) {
    xs.add(o.x - CLEARANCE).add(o.x + o.w + CLEARANCE);
    ys.add(o.y - CLEARANCE).add(o.y + o.h + CLEARANCE);
  }

  const middles: Vec[][] = [
    [{ x: e.x, y: s.y }],
    [{ x: s.x, y: e.y }],
    ...[...xs].map((x) => [
      { x, y: s.y },
      { x, y: e.y },
    ]),
    ...[...ys].map((y) => [
      { x: s.x, y },
      { x: e.x, y },
    ]),
  ];

  let best: Vec[] | null = null;
  let bestCost = Infinity;
  for (const middle of middles) {
    const pts = simplify([a.point, s, ...middle, e, b.point]);
    let cost = 0;
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1], pts[i]];
      cost += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      if (!same(p.x, q.x) && !same(p.y, q.y)) cost += BLOCKED; // not orthogonal
      if (obstacles.some((o) => crosses(p, q, o))) cost += BLOCKED;
    }
    cost += (pts.length - 2) * BEND_COST;
    // The first leg must head out of the start's side, and the last leg into the end's side.
    if (a.dir && pts.length > 1) {
      const d = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
      if (d.x * a.dir.x + d.y * a.dir.y <= 0) cost += BLOCKED;
    }
    if (b.dir && pts.length > 1) {
      const [p, q] = [pts[pts.length - 2], pts[pts.length - 1]];
      if ((q.x - p.x) * b.dir.x + (q.y - p.y) * b.dir.y >= 0) cost += BLOCKED;
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = pts;
    }
  }
  return (best ?? [a.point, b.point]).flatMap((p) => [p.x, p.y]);
}

/**
 * SVG path data for a polyline with its corners rounded off by up to `radius` (less where the
 * segments are short, so tight elbows still look right).
 */
export function roundedPathData(pts: number[], radius: number): string {
  if (pts.length < 4) return "";
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 2; i + 3 < pts.length; i += 2) {
    const [px, py, cx, cy, nx, ny] = [
      pts[i - 2],
      pts[i - 1],
      pts[i],
      pts[i + 1],
      pts[i + 2],
      pts[i + 3],
    ];
    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += ` L${cx} ${cy}`;
      continue;
    }
    const before = { x: cx - ((cx - px) / inLen) * r, y: cy - ((cy - py) / inLen) * r };
    const after = { x: cx + ((nx - cx) / outLen) * r, y: cy + ((ny - cy) / outLen) * r };
    d += ` L${before.x} ${before.y} Q${cx} ${cy} ${after.x} ${after.y}`;
  }
  return `${d} L${pts[pts.length - 2]} ${pts[pts.length - 1]}`;
}
