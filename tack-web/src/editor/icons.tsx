import { Circle, Ellipse, Group, Line, Path, Rect, Text } from "react-konva";
import type { IconNode } from "lucide";

import { esc, n } from "./svg";

/**
 * An icon drawn as vectors on a 24×24 grid, so it stays sharp at any zoom and exports to SVG as
 * is. Three kinds:
 * - `brand`: a filled logo path (simple-icons, CC0) with the brand's own colour.
 * - `glyph`: a stroked line icon (lucide, ISC), drawn in whatever colour it's given.
 * - `monogram`: a short word, for brands whose logos we don't ship.
 */
export type IconSpec =
  | { kind: "brand"; path: string; hex: string }
  | { kind: "glyph"; node: IconNode }
  | { kind: "monogram"; text: string };

/** A simple-icons entry as an IconSpec. */
export const brand = (si: { path: string; hex: string }): IconSpec => ({
  kind: "brand",
  path: si.path,
  hex: `#${si.hex}`,
});

export const glyph = (node: IconNode): IconSpec => ({ kind: "glyph", node });

export const monogram = (text: string): IconSpec => ({ kind: "monogram", text });

/* ── Colour helpers ─────────────────────────────────────────────────────── */

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  const v = parseInt(full, 16);
  return Number.isNaN(v) ? [0, 0, 0] : [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const toHex = (c: number[]) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `hex` mixed towards white by `amount` (0–1). */
export const tint = (hex: string, amount: number) =>
  toHex(rgb(hex).map((v) => v + (255 - v) * amount));

/** `hex` mixed towards black by `amount` (0–1). */
export const shade = (hex: string, amount: number) => toHex(rgb(hex).map((v) => v * (1 - amount)));

/** A version of a brand colour that reads on white: very light colours (yellows) are darkened. */
export const readable = (hex: string) => (luminance(hex) > 0.55 ? shade(hex, 0.45) : hex);

/* ── Canvas ─────────────────────────────────────────────────────────────── */

const numAttr = (v: unknown) => Number(v ?? 0);

/** Lucide's node attributes are SVG strings; turn polyline points into a flat number list. */
const pointsOf = (s: unknown) =>
  String(s ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);

/** Draws an icon in a `size`×`size` box at (x, y). */
export function KonvaIcon({
  icon,
  color,
  x,
  y,
  size,
}: {
  icon: IconSpec;
  color: string;
  x: number;
  y: number;
  size: number;
}) {
  const scale = size / 24;
  if (icon.kind === "monogram") {
    return (
      <Text
        x={x}
        y={y}
        width={size}
        height={size}
        text={icon.text}
        align="center"
        verticalAlign="middle"
        fontSize={size * (icon.text.length > 2 ? 0.42 : 0.55)}
        fontStyle="800"
        fill={color}
        listening={false}
      />
    );
  }
  if (icon.kind === "brand") {
    return (
      <Path
        x={x}
        y={y}
        scaleX={scale}
        scaleY={scale}
        data={icon.path}
        fill={color}
        listening={false}
      />
    );
  }
  const stroke = { stroke: color, strokeWidth: 2, lineCap: "round", lineJoin: "round" } as const;
  return (
    <Group x={x} y={y} scaleX={scale} scaleY={scale} listening={false}>
      {icon.node.map(([tag, a], i) => {
        switch (tag) {
          case "path":
            return <Path key={i} data={String(a.d)} {...stroke} fillEnabled={false} />;
          case "circle":
            return (
              <Circle
                key={i}
                x={numAttr(a.cx)}
                y={numAttr(a.cy)}
                radius={numAttr(a.r)}
                {...stroke}
              />
            );
          case "ellipse":
            return (
              <Ellipse
                key={i}
                x={numAttr(a.cx)}
                y={numAttr(a.cy)}
                radiusX={numAttr(a.rx)}
                radiusY={numAttr(a.ry)}
                {...stroke}
              />
            );
          case "rect":
            return (
              <Rect
                key={i}
                x={numAttr(a.x)}
                y={numAttr(a.y)}
                width={numAttr(a.width)}
                height={numAttr(a.height)}
                cornerRadius={numAttr(a.rx)}
                {...stroke}
              />
            );
          case "line":
            return (
              <Line
                key={i}
                points={[numAttr(a.x1), numAttr(a.y1), numAttr(a.x2), numAttr(a.y2)]}
                {...stroke}
              />
            );
          case "polyline":
          case "polygon":
            return (
              <Line key={i} points={pointsOf(a.points)} closed={tag === "polygon"} {...stroke} />
            );
          default:
            return null;
        }
      })}
    </Group>
  );
}

/* ── DOM and SVG ────────────────────────────────────────────────────────── */

/** The icon's inner SVG markup on its 24×24 grid. */
function innerMarkup(icon: IconSpec, color: string): string {
  if (icon.kind === "brand") return `<path d="${esc(icon.path)}" fill="${esc(color)}"/>`;
  if (icon.kind === "monogram") {
    // Stretched to the grid's full width so it stays legible at small sizes.
    const long = icon.text.length > 2;
    const fit = long ? ` textLength="23" lengthAdjust="spacingAndGlyphs"` : "";
    return `<text x="12" y="12.5" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="800" font-size="${long ? 13 : 16}"${fit} fill="${esc(color)}">${esc(icon.text)}</text>`;
  }
  const attrs = (a: Record<string, unknown>) =>
    Object.entries(a)
      .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
      .join("");
  return (
    `<g fill="none" stroke="${esc(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    icon.node.map(([tag, a]) => `<${tag}${attrs(a)}/>`).join("") +
    "</g>"
  );
}

/** A standalone `<svg>` for an icon placed at (x, y), for SVG export. */
export const iconSvg = (icon: IconSpec, color: string, x: number, y: number, size: number) =>
  `<svg x="${n(x)}" y="${n(y)}" width="${n(size)}" height="${n(size)}" viewBox="0 0 24 24">${innerMarkup(icon, color)}</svg>`;

/** The icon as an inline DOM `<svg>`, for panels and menus. */
export function IconSvg({
  icon,
  color,
  size = 20,
  className,
}: {
  icon: IconSpec;
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      // Markup built from our own icon data (simple-icons and lucide), escaped throughout.
      dangerouslySetInnerHTML={{ __html: innerMarkup(icon, color) }}
    />
  );
}
