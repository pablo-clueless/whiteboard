/** Small helpers for `ShapeDef.toSvg`. Shapes draw in their own space, like their Component. */

import { type StrokeStyle, svgDash } from "./stroke";

/** Escapes text for use inside an SVG attribute or text node. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Rounds coordinates so exported files stay small. */
export const n = (v: number) => Math.round(v * 100) / 100;

/** Flat [x0, y0, x1, y1, …] as an SVG `points` value. */
export const points = (flat: number[]) => {
  const out: string[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push(`${n(flat[i])},${n(flat[i + 1])}`);
  return out.join(" ");
};

/**
 * Fill and stroke attributes, dashed or dotted as `style` says. A zero stroke width means no
 * outline, as in Konva. Joins and caps are always round, so callers mustn't add their own.
 */
export function paint(
  fill: string | null,
  stroke: string | null,
  strokeWidth = 0,
  style: StrokeStyle = "solid",
): string {
  const f = `fill="${fill ? esc(fill) : "none"}"`;
  const s =
    stroke && strokeWidth > 0
      ? ` stroke="${esc(stroke)}" stroke-width="${n(strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"${svgDash(style, strokeWidth)}`
      : "";
  return f + s;
}
