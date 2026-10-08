import type { Box, Vec } from "./types";

/**
 * Something to draw while a snap is active, in page space:
 * - `line`: an alignment guide. `axis: "x"` is a vertical line at x = `at` from y = `from` to
 *   y = `to`; `axis: "y"` a horizontal one.
 * - `gap`: one of a set of equal gaps, drawn as a measurement across it. `axis: "x"` spans
 *   x = `from`…`to` at height y = `at`; `axis: "y"` spans y at x = `at`.
 */
export type Guide =
  | { kind: "line"; axis: "x" | "y"; at: number; from: number; to: number }
  | { kind: "gap"; axis: "x" | "y"; at: number; from: number; to: number };

/** How close (in screen pixels) an edge, centre or gap must come before it snaps. */
export const SNAP_DISTANCE = 6;

type Axis = "x" | "y";

const start = (b: Box, a: Axis) => (a === "x" ? b.x : b.y);
const size = (b: Box, a: Axis) => (a === "x" ? b.w : b.h);
const end = (b: Box, a: Axis) => start(b, a) + size(b, a);
const other = (a: Axis): Axis => (a === "x" ? "y" : "x");

/** Left, centre and right (or top, middle and bottom) of a box along one axis. */
const lines = (b: Box, a: Axis) => [start(b, a), start(b, a) + size(b, a) / 2, end(b, a)];

/** Whether two boxes overlap along an axis (so they sit side by side along the other one). */
const overlaps = (a: Box, b: Box, axis: Axis) =>
  start(a, axis) < end(b, axis) && start(b, axis) < end(a, axis);

/** The nearest of `values` to `v` within `threshold`, or null. */
export function nearestValue(v: number, values: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = threshold;
  for (const t of values) {
    const d = Math.abs(t - v);
    if (d <= bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

/** Every edge and centre line of the targets along an axis. */
export const targetLines = (targets: Box[], axis: Axis) => targets.flatMap((t) => lines(t, axis));

/* ── Equal spacing ──────────────────────────────────────────────────────── */

type Spacing = { shift: number; gaps: Guide[] };

/**
 * Positions along `axis` where `moving` would be evenly spaced: centred between its nearest
 * neighbours on either side, or one gap past a neighbour that's already the same gap from its
 * own neighbour. Only boxes level with `moving` (overlapping on the other axis) count.
 */
function spacing(moving: Box, targets: Box[], axis: Axis, threshold: number): Spacing | null {
  const across = other(axis);
  const level = targets.filter((t) => overlaps(t, moving, across));
  const before = level
    .filter((t) => end(t, axis) <= start(moving, axis) + threshold)
    .sort((a, b) => end(b, axis) - end(a, axis));
  const after = level
    .filter((t) => start(t, axis) >= end(moving, axis) - threshold)
    .sort((a, b) => start(a, axis) - start(b, axis));
  const len = size(moving, axis);
  // Measurements sit just past the shapes (below, for side-by-side ones), clear of the centre
  // alignment guide that often runs through the middle.
  const mid = (a: Box, b: Box) => Math.max(end(a, across), end(b, across)) + threshold * 2;
  const gap = (a: Box, b: Box): Guide => ({
    kind: "gap",
    axis,
    from: end(a, axis),
    to: start(b, axis),
    at: mid(a, b),
  });
  const at = (pos: number): Box => ({ ...moving, [axis]: pos });

  const options: Spacing[] = [];
  const [l, r] = [before[0], after[0]];
  // Centred between the two neighbours.
  if (l && r) {
    const pos = (end(l, axis) + start(r, axis) - len) / 2;
    if (pos >= end(l, axis)) {
      const placed = at(pos);
      options.push({ shift: pos - start(moving, axis), gaps: [gap(l, placed), gap(placed, r)] });
    }
  }
  // Continuing a run: the same gap as the neighbour has to its own neighbour.
  const ll = l && before.find((t) => end(t, axis) <= start(l, axis) && overlaps(t, l, across));
  if (l && ll) {
    const g = start(l, axis) - end(ll, axis);
    const placed = at(end(l, axis) + g);
    options.push({
      shift: end(l, axis) + g - start(moving, axis),
      gaps: [gap(ll, l), gap(l, placed)],
    });
  }
  const rr = r && after.find((t) => start(t, axis) >= end(r, axis) && overlaps(t, r, across));
  if (r && rr) {
    const g = start(rr, axis) - end(r, axis);
    const pos = start(r, axis) - g - len;
    const placed = at(pos);
    options.push({ shift: pos - start(moving, axis), gaps: [gap(placed, r), gap(r, rr)] });
  }
  const best = options
    .filter((o) => Math.abs(o.shift) <= threshold)
    .sort((a, b) => Math.abs(a.shift) - Math.abs(b.shift))[0];
  return best ?? null;
}

/* ── Snapping a moving box ──────────────────────────────────────────────── */

/**
 * Snaps a moving box so its edges or centre line up with other boxes' edges or centres, or so it
 * sits evenly spaced between them, each axis independently (the smaller adjustment wins).
 * Returns the shift to apply and the guides to show.
 */
export function snapBox(
  moving: Box,
  targets: Box[],
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const shift = { x: 0, y: 0 };
  const gapGuides: Guide[] = [];

  for (const axis of ["x", "y"] as const) {
    // Nearest edge/centre alignment.
    let align: number | null = null;
    let alignDist = threshold;
    const tl = targetLines(targets, axis);
    for (const m of lines(moving, axis)) {
      const t = nearestValue(m, tl, alignDist);
      if (t !== null && Math.abs(t - m) <= alignDist) {
        alignDist = Math.abs(t - m);
        align = t - m;
      }
    }
    const even = spacing(moving, targets, axis, threshold);
    if (even && (align === null || Math.abs(even.shift) < Math.abs(align))) {
      shift[axis] = even.shift;
      gapGuides.push(...even.gaps);
    } else if (align !== null) {
      shift[axis] = align;
    }
  }

  const snapped = { ...moving, x: moving.x + shift.x, y: moving.y + shift.y };
  return {
    dx: shift.x,
    dy: shift.y,
    guides: [...alignmentGuides(snapped, targets, threshold), ...gapGuides],
  };
}

/** A guide for every edge or centre of `box` that lines up with a target's, merged per line. */
function alignmentGuides(box: Box, targets: Box[], threshold: number): Guide[] {
  const eps = threshold / 100;
  const merged = new Map<string, Guide>();
  for (const t of targets) {
    for (const axis of ["x", "y"] as const) {
      const across = other(axis);
      const from = Math.min(start(box, across), start(t, across));
      const to = Math.max(end(box, across), end(t, across));
      for (const at of lines(t, axis)) {
        if (!lines(box, axis).some((m) => Math.abs(m - at) < eps)) continue;
        const key = `${axis}:${Math.round(at / eps)}`;
        const g = merged.get(key);
        if (g) {
          g.from = Math.min(g.from, from);
          g.to = Math.max(g.to, to);
        } else merged.set(key, { kind: "line", axis, at, from, to });
      }
    }
  }
  return [...merged.values()];
}

/* ── Snapping a single point ────────────────────────────────────────────── */

/**
 * Snaps a point (a corner being drawn or a resize handle) to target edges and centres, each axis
 * on its own; `axes` limits which ones may move. Returns the point and its guides.
 */
export function snapPoint(
  p: Vec,
  targets: Box[],
  threshold: number,
  axes: { x: boolean; y: boolean } = { x: true, y: true },
): { point: Vec; guides: Guide[] } {
  const out = { ...p };
  const guides: Guide[] = [];
  for (const axis of ["x", "y"] as const) {
    if (!axes[axis]) continue;
    const t = nearestValue(p[axis], targetLines(targets, axis), threshold);
    if (t === null) continue;
    out[axis] = t;
    // Span the guide over the point and every target with that line.
    const across = other(axis);
    let from = p[across];
    let to = p[across];
    for (const box of targets) {
      if (!lines(box, axis).some((v) => Math.abs(v - t) < threshold / 100)) continue;
      from = Math.min(from, start(box, across));
      to = Math.max(to, end(box, across));
    }
    guides.push({ kind: "line", axis, at: t, from, to });
  }
  return { point: out, guides };
}
