import type { Box, Vec } from "./types";

/** Normalised box between two corners. */
export function boxFromPoints(a: Vec, b: Vec): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function distance(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Axis-aligned bounds of a w×h box placed at (x, y) and rotated `rotation` degrees about that
 * top-left corner (Konva's convention).
 */
export function rotatedBounds(x: number, y: number, w: number, h: number, rotation: number): Box {
  if (!rotation) return { x, y, w, h };
  const r = (rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ].map(([cx, cy]) => ({ x: x + cx * cos - cy * sin, y: y + cx * sin + cy * cos }));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/** The smallest box containing all of `boxes` (nulls ignored), or null if there are none. */
export function unionBox(boxes: (Box | null)[]): Box | null {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    if (!b) continue;
    [minX, minY] = [Math.min(minX, b.x), Math.min(minY, b.y)];
    [maxX, maxY] = [Math.max(maxX, b.x + b.w), Math.max(maxY, b.y + b.h)];
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
