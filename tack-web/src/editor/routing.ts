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

/**
 * Where an elbow arrow end attached to a shape should sit: on the side of the shape's bounds
 * facing the other end, level with the anchor, pulled out by `gap`.
 */
export function elbowEndpoint(
  bounds: Box,
  anchor: Vec,
  towards: Vec,
  axis: Axis,
  gap: number,
): Vec {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  if (axis === "h") {
    const right = towards.x >= anchor.x;
    return {
      x: right ? bounds.x + bounds.w + gap : bounds.x - gap,
      y: clamp(anchor.y, bounds.y, bounds.y + bounds.h),
    };
  }
  const below = towards.y >= anchor.y;
  return {
    x: clamp(anchor.x, bounds.x, bounds.x + bounds.w),
    y: below ? bounds.y + bounds.h + gap : bounds.y - gap,
  };
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
