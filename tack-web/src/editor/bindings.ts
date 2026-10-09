import { shapeRegistry } from "./shapes/registry";
import type { Shape, Vec } from "./types";

/**
 * An arrow end attached to a shape. Stored in `doc.bindings` under `${arrowId}:${terminal}`, so
 * each end has at most one. `anchor` is the connection point on the target, as a fraction of the
 * target's own (unrotated) box, so the end stays on that point when the target moves, resizes or
 * rotates. The end sits exactly on the target's outline there.
 */
export type Binding = {
  type: "arrow";
  arrowId: string;
  terminal: Terminal;
  toId: string;
  anchor: Vec;
};

export type Terminal = "start" | "end";

export const bindingId = (arrowId: string, terminal: Terminal) => `${arrowId}:${terminal}`;

/**
 * Whether an arrow end may attach at `to`, given where its other end is attached. Anywhere but
 * the other end's own connection point: another point on the same shape makes a self-loop, but
 * the same point would be an arrow of no length.
 */
export function canAttach(
  to: { shapeId: string; anchor: Vec },
  other: { toId: string; anchor: Vec } | null,
): boolean {
  if (!other || other.toId !== to.shapeId) return true;
  return (
    Math.abs(other.anchor.x - to.anchor.x) > 1e-6 || Math.abs(other.anchor.y - to.anchor.y) > 1e-6
  );
}

/** The w×h box a shape draws in, if it has one. Only these shapes can be arrow targets. */
export function localBox(shape: Shape): { w: number; h: number } | null {
  const p = shape.props as { w?: unknown; h?: unknown } | null;
  return p && typeof p.w === "number" && typeof p.h === "number" ? { w: p.w, h: p.h } : null;
}

function rotate(v: Vec, deg: number): Vec {
  if (!deg) return v;
  const r = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(r), Math.sin(r)];
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Page point → the shape's local space (origin at its top-left, unrotated). */
export function toLocal(shape: Shape, p: Vec): Vec {
  return rotate({ x: p.x - shape.x, y: p.y - shape.y }, -shape.rotation);
}

export function toPage(shape: Shape, p: Vec): Vec {
  const r = rotate(p, shape.rotation);
  return { x: r.x + shape.x, y: r.y + shape.y };
}

export function containsPoint(shape: Shape, p: Vec): boolean {
  const box = localBox(shape);
  if (!box) return false;
  const l = toLocal(shape, p);
  return l.x >= 0 && l.y >= 0 && l.x <= box.w && l.y <= box.h;
}

/* ── Connection points ──────────────────────────────────────────────────── */

/**
 * The shape's outline in its own space: its ShapeDef's `getOutline`, or its box. Arrow ends sit
 * exactly on this, so they touch ellipses and triangles as well as rectangles.
 */
export function outlineOf(shape: Shape): Vec[] | null {
  const box = localBox(shape);
  if (!box) return null;
  const custom = shapeRegistry.get(shape.type)?.getOutline?.(shape);
  if (custom && custom.length >= 3) return custom;
  return [
    { x: 0, y: 0 },
    { x: box.w, y: 0 },
    { x: box.w, y: box.h },
    { x: 0, y: box.h },
  ];
}

/** Where a ray from `from` along `dir` last crosses the outline (its outermost hit). */
function lastHit(poly: Vec[], from: Vec, dir: Vec): Vec | null {
  let best = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const e = { x: b.x - a.x, y: b.y - a.y };
    const denom = dir.x * e.y - dir.y * e.x;
    if (Math.abs(denom) < 1e-9) continue;
    const w = { x: a.x - from.x, y: a.y - from.y };
    const t = (w.x * e.y - w.y * e.x) / denom; // along the ray
    const u = (w.x * dir.y - w.y * dir.x) / denom; // along the edge
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t > best) best = t;
  }
  return best < 0 ? null : { x: from.x + dir.x * best, y: from.y + dir.y * best };
}

const centreOf = (box: { w: number; h: number }) => ({ x: box.w / 2, y: box.h / 2 });

/**
 * The point on the outline in the direction of `local` (shape space) as seen from the centre.
 * Anchors are stored as fractions of the box, so this keeps them on the outline after resizes.
 */
export function onOutline(shape: Shape, local: Vec): Vec | null {
  const box = localBox(shape);
  const poly = outlineOf(shape);
  if (!box || !poly) return null;
  const c = centreOf(box);
  const dir = { x: local.x - c.x, y: local.y - c.y };
  if (Math.hypot(dir.x, dir.y) < 1e-6) dir.y = -1;
  return lastHit(poly, c, dir) ?? local;
}

/**
 * Connection points, in shape space: the ShapeDef's `getAnchors`, or where the outline meets
 * the lines straight up, right, down and left from the centre (the middle of each side).
 */
export function portsOf(shape: Shape): Vec[] {
  const box = localBox(shape);
  if (!box) return [];
  const custom = shapeRegistry.get(shape.type)?.getAnchors?.(shape);
  if (custom?.length) return custom;
  const c = centreOf(box);
  return [
    { x: c.x, y: c.y - 1 },
    { x: c.x + 1, y: c.y },
    { x: c.x, y: c.y + 1 },
    { x: c.x - 1, y: c.y },
  ].map((p) => onOutline(shape, p)!);
}

/** A local point as an anchor: a fraction of the box, so it follows resizes. */
export function toAnchor(shape: Shape, local: Vec): Vec | null {
  const box = localBox(shape);
  return box ? { x: local.x / box.w, y: local.y / box.h } : null;
}

/** Where an anchored arrow end sits on the page: exactly on the target's outline. */
export function anchorPoint(shape: Shape, anchor: Vec): Vec | null {
  const box = localBox(shape);
  if (!box) return null;
  const local = onOutline(shape, { x: anchor.x * box.w, y: anchor.y * box.h });
  return local && toPage(shape, local);
}

/**
 * Which way a connector leaves the shape at an anchor, as a page-space unit vector along x or y:
 * out of the side the anchor is on, judged relative to the box so wide shapes behave.
 */
export function exitDirection(shape: Shape, anchor: Vec): Vec {
  const dx = anchor.x - 0.5;
  const dy = anchor.y - 0.5;
  const local =
    Math.abs(dx) >= Math.abs(dy)
      ? { x: Math.sign(dx) || 1, y: 0 }
      : { x: 0, y: Math.sign(dy) || 1 };
  const d = rotate(local, shape.rotation);
  // Routes are orthogonal: on a rotated shape, leave along the nearest axis.
  return Math.abs(d.x) >= Math.abs(d.y) ? { x: Math.sign(d.x), y: 0 } : { x: 0, y: Math.sign(d.y) };
}
