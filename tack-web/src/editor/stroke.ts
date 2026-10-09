/** How an outline or line is drawn: one solid stroke, dashes, or round dots. */
export type StrokeStyle = "solid" | "dashed" | "dotted";

export const STROKE_STYLES: { value: StrokeStyle; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

/** A stored value as a stroke style; anything unknown is solid. */
export const readStrokeStyle = (v: unknown): StrokeStyle =>
  v === "dashed" || v === "dotted" ? v : "solid";

/**
 * Dash and gap lengths for a style at a stroke width, scaled so thick lines keep the same look.
 * Dots are near-zero dashes drawn with round caps, so each one is a circle as wide as the line.
 */
export function dashArray(style: StrokeStyle, width: number): number[] | null {
  if (style === "dashed") return [Math.max(6, width * 4), Math.max(4, width * 3)];
  if (style === "dotted") return [0.001, Math.max(4, width * 2.5)];
  return null;
}

/** Konva props for a style: spread onto a shape that has a stroke. */
export function konvaDash(style: StrokeStyle, width: number) {
  const dash = dashArray(style, width);
  return dash ? { dash, dashEnabled: true, lineCap: "round" as const } : {};
}

/** SVG attributes for a style, to add after `paint` (which already rounds the caps). */
export function svgDash(style: StrokeStyle, width: number): string {
  const dash = dashArray(style, width);
  return dash
    ? ` stroke-dasharray="${dash.map((d) => Math.round(d * 1000) / 1000).join(" ")}"`
    : "";
}
