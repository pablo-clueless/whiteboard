import { useEffect, useSyncExternalStore } from "react";
import { Text } from "react-konva";

import { useEditorStore } from "@/stores/editor";
import { rotatedBounds } from "../geometry";
import type { ShapeDef } from "../types";
import { clamp, num, str } from "./box";
import { esc, n } from "../svg";
import {
  closestWeight,
  DEFAULT_FONT,
  DEFAULT_WEIGHT,
  ensureFont,
  fontFamily,
  fontsVersion,
  onFontsLoaded,
  textFontById,
} from "../fonts";

export type TextProps = {
  text: string;
  fontSize: number;
  color: string;
  /** A font id from TEXT_FONTS. */
  fontFamily: string;
  /** 100–900, limited to what the font has. */
  fontWeight: number;
};

export const TEXT_LINE_HEIGHT = 1.25;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 400;

const DEFAULT_TEXT: TextProps = {
  text: "Write here",
  fontSize: 16,
  color: "#000000",
  fontFamily: DEFAULT_FONT,
  fontWeight: DEFAULT_WEIGHT,
};

/** The app's UI font (DM Sans), as a CSS font-family list Konva can use. */
export const textFont = () => fontFamily(DEFAULT_FONT);

/** A CSS `font` value for text props at a given pixel size. */
export const cssFont = (p: Pick<TextProps, "fontFamily" | "fontWeight">, size: number) =>
  `${p.fontWeight} ${size}px ${fontFamily(p.fontFamily)}`;

let measurer: CanvasRenderingContext2D | null = null;

/** Size of a block of text, one line per `\n`, in the given font. */
export function measureText(
  text: string,
  p: Pick<TextProps, "fontSize" | "fontFamily" | "fontWeight">,
): { w: number; h: number } {
  measurer ??= document.createElement("canvas").getContext("2d");
  const lines = text.split("\n");
  let w = 0;
  if (measurer) {
    measurer.font = cssFont(p, p.fontSize);
    for (const line of lines) w = Math.max(w, measurer.measureText(line).width);
  }
  // Keep an empty box clickable and visible while it's being typed into.
  return { w: Math.max(w, p.fontSize * 0.6), h: lines.length * p.fontSize * TEXT_LINE_HEIGHT };
}

export const textShape: ShapeDef<TextProps, "text"> = {
  type: "text",
  version: 2,
  defaultProps: DEFAULT_TEXT,
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      text: str(p.text, ""),
      fontSize: clamp(num(p.fontSize, DEFAULT_TEXT.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE),
      color: str(p.color, DEFAULT_TEXT.color),
      fontFamily: textFontById(str(p.fontFamily, DEFAULT_FONT)).id,
      fontWeight: closestWeight(
        str(p.fontFamily, DEFAULT_FONT),
        Math.round(num(p.fontWeight, DEFAULT_WEIGHT) / 100) * 100,
      ),
    };
  },
  getBounds: (s) => {
    const { w, h } = measureText(s.props.text, s.props);
    return rotatedBounds(s.x, s.y, w, h, s.rotation);
  },
  // Text scales as a whole: the font size follows the vertical stretch.
  onResize: (shape, { scaleY, initial }) => ({
    props: {
      ...shape.props,
      fontSize: clamp(
        Math.round((initial.props as TextProps).fontSize * Math.abs(scaleY) * 10) / 10,
        MIN_FONT_SIZE,
        MAX_FONT_SIZE,
      ),
    },
  }),
  toSvg: ({ props: p }) => {
    const lh = p.fontSize * TEXT_LINE_HEIGHT;
    const lines = p.text
      .split("\n")
      .map((line, i) => `<tspan x="0" y="${n((i + 0.5) * lh)}">${esc(line) || " "}</tspan>`)
      .join("");
    return `<text font-family="${esc(fontFamily(p.fontFamily))}" font-weight="${p.fontWeight}" font-size="${n(p.fontSize)}" fill="${esc(p.color)}" dominant-baseline="central" xml:space="preserve">${lines}</text>`;
  },
  Component: function TextBlock({ shape }) {
    // While someone types into the DOM editor here, it draws the text instead.
    const editing = useEditorStore((s) => s.editingTextId === shape.id);
    // Re-measure and redraw once the font file arrives; until then the fallback shows.
    const loadedFonts = useSyncExternalStore(onFontsLoaded, fontsVersion, fontsVersion);
    const p = shape.props;
    useEffect(() => ensureFont(p.fontFamily, p.fontWeight), [p.fontFamily, p.fontWeight]);
    if (editing) return <></>;
    const { w, h } = measureText(p.text, p);
    return (
      <Text
        key={loadedFonts}
        text={p.text}
        fontSize={p.fontSize}
        fontFamily={fontFamily(p.fontFamily)}
        // Konva puts this in front of the size in the canvas font string, so a weight works.
        fontStyle={String(p.fontWeight)}
        lineHeight={TEXT_LINE_HEIGHT}
        fill={p.color}
        width={w + 1}
        height={h}
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [
    // 1 → 2: text from before typefaces existed was always DM Sans at regular weight. Say so.
    (props) => {
      const p = (props ?? {}) as Record<string, unknown>;
      return {
        ...p,
        fontFamily: typeof p.fontFamily === "string" ? p.fontFamily : DEFAULT_FONT,
        fontWeight: typeof p.fontWeight === "number" ? p.fontWeight : DEFAULT_WEIGHT,
      };
    },
  ],
};
