/** Small helpers for `ShapeDef.toSvg`. Shapes draw in their own space, like their Component. */

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

/** Fill and stroke attributes. A zero stroke width means no outline, as in Konva. */
export function paint(fill: string | null, stroke: string | null, strokeWidth = 0): string {
  const f = `fill="${fill ? esc(fill) : "none"}"`;
  const s =
    stroke && strokeWidth > 0
      ? ` stroke="${esc(stroke)}" stroke-width="${n(strokeWidth)}" stroke-linejoin="round" stroke-linecap="round"`
      : "";
  return f + s;
}
