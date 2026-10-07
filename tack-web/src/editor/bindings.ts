import type { Shape, Vec } from "./types";

/**
 * An arrow end attached to a shape. Stored in `doc.bindings` under `${arrowId}:${terminal}`, so
 * each end has at most one. `anchor` is where on the target the end points, as a fraction of the
 * target's own (unrotated) box, so it stays put when the target moves, resizes or rotates.
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

/** Gap left between an arrow tip and the edge of the shape it points at. */
export const EDGE_GAP = 6;

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

/** The anchor (0..1 in the shape's box) for a page point, clamped inside the box. */
export function anchorFor(shape: Shape, p: Vec): Vec | null {
  const box = localBox(shape);
  if (!box) return null;
  const l = toLocal(shape, p);
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp(l.x / box.w), y: clamp(l.y / box.h) };
}

export function containsPoint(shape: Shape, p: Vec): boolean {
  const box = localBox(shape);
  if (!box) return false;
  const l = toLocal(shape, p);
  return l.x >= 0 && l.y >= 0 && l.x <= box.w && l.y <= box.h;
}

/**
 * Where an arrow end bound to `target` should sit: on the target's edge, on the line from the
 * arrow's other end (`from`) to the anchor, pulled back by a small gap. If `from` is inside the
 * target there's no edge to stop at, so the end sits on the anchor itself.
 */
export function boundEndpoint(target: Shape, anchor: Vec, from: Vec): Vec {
  const box = localBox(target);
  if (!box) return { x: target.x, y: target.y };
  const a = { x: anchor.x * box.w, y: anchor.y * box.h };
  const f = toLocal(target, from);
  const inside = f.x >= 0 && f.y >= 0 && f.x <= box.w && f.y <= box.h;
  if (inside) return toPage(target, a);

  // Walk from the anchor towards `from` and find where that ray leaves the box.
  const d = { x: f.x - a.x, y: f.y - a.y };
  const exits = [
    d.x > 0 ? (box.w - a.x) / d.x : d.x < 0 ? -a.x / d.x : Infinity,
    d.y > 0 ? (box.h - a.y) / d.y : d.y < 0 ? -a.y / d.y : Infinity,
  ];
  const t = Math.min(...exits);
  const len = Math.hypot(d.x, d.y) || 1;
  const gap = Math.min(EDGE_GAP / len, 1 - t); // don't overshoot `from`
  const edge = { x: a.x + d.x * (t + gap), y: a.y + d.y * (t + gap) };
  return toPage(target, edge);
}
