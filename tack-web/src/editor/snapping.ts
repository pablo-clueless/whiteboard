import type { Box } from "./types";

/**
 * A guide line in page space. `axis: "x"` is a vertical line at x = `at` running from y = `from`
 * to y = `to`; `axis: "y"` is a horizontal one.
 */
export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

/** How close (in screen pixels) an edge or centre must come to another before it snaps. */
export const SNAP_DISTANCE = 6;

/** Left, centre and right (or top, middle and bottom) of a box along one axis. */
const lines = (b: Box, axis: "x" | "y") =>
  axis === "x" ? [b.x, b.x + b.w / 2, b.x + b.w] : [b.y, b.y + b.h / 2, b.y + b.h];

/** The smallest shift (within `threshold`) that lines `moving` up with any target, or 0. */
function nearest(moving: Box, targets: Box[], axis: "x" | "y", threshold: number): number {
  let best = 0;
  let bestDist = threshold;
  const own = lines(moving, axis);
  for (const t of targets) {
    for (const at of lines(t, axis)) {
      for (const m of own) {
        const d = Math.abs(at - m);
        if (d <= bestDist) {
          bestDist = d;
          best = at - m;
        }
      }
    }
  }
  return best;
}

/**
 * Snaps a moving box so its edges or centre line up with other boxes' edges or centres, each
 * axis independently. Returns the shift to apply and a guide for every alignment it ends up in,
 * so centring a shape on another shows both centre lines.
 */
export function snapBox(
  moving: Box,
  targets: Box[],
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const dx = nearest(moving, targets, "x", threshold);
  const dy = nearest(moving, targets, "y", threshold);
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };

  // Guides for every line that now coincides, merged so each spans all the boxes on it.
  const eps = threshold / 100;
  const merged = new Map<string, Guide>();
  const add = (axis: "x" | "y", at: number, from: number, to: number) => {
    const key = `${axis}:${Math.round(at / eps)}`;
    const g = merged.get(key);
    if (g) {
      g.from = Math.min(g.from, from);
      g.to = Math.max(g.to, to);
    } else merged.set(key, { axis, at, from, to });
  };
  for (const t of targets) {
    for (const axis of ["x", "y"] as const) {
      // A vertical guide spans the boxes' vertical extent, and vice versa.
      const [s0, s1, t0, t1] =
        axis === "x"
          ? [snapped.y, snapped.y + snapped.h, t.y, t.y + t.h]
          : [snapped.x, snapped.x + snapped.w, t.x, t.x + t.w];
      for (const at of lines(t, axis)) {
        if (lines(snapped, axis).some((m) => Math.abs(m - at) < eps)) {
          add(axis, at, Math.min(s0, t0), Math.max(s1, t1));
        }
      }
    }
  }
  return { dx, dy, guides: [...merged.values()] };
}
