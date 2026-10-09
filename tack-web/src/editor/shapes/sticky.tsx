import { useEffect, useSyncExternalStore } from "react";
import { Group, Rect } from "react-konva";

import { DEFAULT_FONT, DEFAULT_WEIGHT, ensureFont, fontsVersion, onFontsLoaded } from "../fonts";
import { layoutMarkdown, type MarkdownLayout } from "../markdown";
import { boxBounds, boxResize, clamp, num, str } from "./box";
import { useEditorStore } from "@/stores/editor";
import type { ShapeDef } from "../types";
import { esc, n } from "../svg";
import {
  DEFAULT_TEXT,
  MarkdownText,
  markdownSvg,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  type TextProps,
} from "./text";

/**
 * A sticky note: a coloured square with text on it. The text wraps inside the note and shrinks
 * when there's too much of it, so a note never overflows; `fontSize` is the size it starts at.
 * Markdown works as in text (lists, **bold**, tasks).
 */
export type StickyProps = {
  text: string;
  fill: string;
  /** Text colour. */
  color: string;
  /** The largest the text draws at; longer notes shrink below it to fit. */
  fontSize: number;
  w: number;
  h: number;
};

/** Note colours, light enough for dark text. The first is the default. */
export const STICKY_COLORS = [
  { value: "#fff3b0", label: "Yellow" },
  { value: "#ffd8a8", label: "Orange" },
  { value: "#ffc9de", label: "Pink" },
  { value: "#e5d4ff", label: "Violet" },
  { value: "#c9ddff", label: "Blue" },
  { value: "#c3f0e0", label: "Teal" },
  { value: "#d3f2b8", label: "Green" },
  { value: "#ececef", label: "Grey" },
] as const;

export const STICKY_SIZE = 200;
const DEFAULT_STICKY: StickyProps = {
  text: "Start writing...",
  fill: STICKY_COLORS[0].value,
  color: "#0e0e10",
  fontSize: 16,
  w: STICKY_SIZE,
  h: STICKY_SIZE,
};

/** Text never shrinks below this to fit; past it, it's clipped at the note's edge. */
const MIN_FIT_SIZE = 8;

/** Space between the note's edge and its text. */
export const stickyPadding = (p: { w: number; h: number }) =>
  Math.max(4, Math.min(16, p.w * 0.08, p.h * 0.08));

/** The text style a note draws at a given size, wrapping at `width`. */
function textStyle(p: StickyProps, size: number, width: number, markdown: boolean): TextProps {
  return {
    ...DEFAULT_TEXT,
    text: p.text,
    fontSize: size,
    color: p.color,
    fontFamily: DEFAULT_FONT,
    fontWeight: DEFAULT_WEIGHT,
    markdown,
    width,
    align: "left",
  };
}

export type StickyLayout = {
  /** The text's style at its fitted size. */
  style: TextProps;
  layout: MarkdownLayout;
  /** Where the text block's top-left sits in the note: its top-left corner, inside the padding. */
  x: number;
  y: number;
};

/**
 * Fits the note's text: the largest size up to `fontSize` whose wrapped height fits inside the
 * padding. `markdown: false` lays out the source as typed, for the text editor.
 */
export function stickyLayout(p: StickyProps, { markdown = true } = {}): StickyLayout {
  const pad = stickyPadding(p);
  const innerW = Math.max(1, p.w - pad * 2);
  const innerH = Math.max(1, p.h - pad * 2);
  let size = p.fontSize;
  let style = textStyle(p, size, innerW, markdown);
  // Layouts are cached, so refitting an unchanged note costs a few map lookups.
  let layout = layoutMarkdown(p.text || " ", style);
  while (layout.h > innerH && size > MIN_FIT_SIZE) {
    size = Math.max(MIN_FIT_SIZE, Math.min(size - 1, Math.floor(size * 0.92)));
    style = textStyle(p, size, innerW, markdown);
    layout = layoutMarkdown(p.text || " ", style);
  }
  return { style, layout, x: pad, y: pad };
}

const SHADOW = { shadowColor: "#0e0e10", shadowBlur: 10, shadowOffsetY: 4, shadowOpacity: 0.16 };

export const stickyShape: ShapeDef<StickyProps, "sticky"> = {
  type: "sticky",
  version: 1,
  defaultProps: DEFAULT_STICKY,
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      text: str(p.text, ""),
      fill: str(p.fill, DEFAULT_STICKY.fill),
      color: str(p.color, DEFAULT_STICKY.color),
      fontSize: clamp(num(p.fontSize, DEFAULT_STICKY.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE),
      w: Math.max(24, num(p.w, DEFAULT_STICKY.w)),
      h: Math.max(24, num(p.h, DEFAULT_STICKY.h)),
    };
  },
  getBounds: boxBounds,
  onResize: boxResize,
  toSvg: ({ props: p }) => {
    const fit = stickyLayout(p);
    return (
      `<rect width="${n(p.w)}" height="${n(p.h)}" rx="4" fill="${esc(p.fill)}" stroke="rgba(14,14,16,0.08)"/>` +
      `<g transform="translate(${n(fit.x)} ${n(fit.y)})">${markdownSvg(fit.layout, fit.style)}</g>`
    );
  },
  Component: function StickyNote({ shape }) {
    // While someone types into the note, the text editor draws its text instead.
    const editing = useEditorStore((s) => s.editingTextId === shape.id);
    // Re-fit once the font arrives; until then the fallback's measurements are used.
    const loadedFonts = useSyncExternalStore(onFontsLoaded, fontsVersion, fontsVersion);
    useEffect(() => ensureFont(DEFAULT_FONT, DEFAULT_WEIGHT), []);
    const p = shape.props;
    const fit = p.text && !editing ? stickyLayout(p) : null;

    return (
      <Group>
        <Rect
          width={p.w}
          height={p.h}
          cornerRadius={4}
          fill={p.fill}
          {...SHADOW}
          perfectDrawEnabled={false}
        />
        {fit && (
          // Clipped to the note, for text too long to fit even at the smallest size.
          <Group clipX={0} clipY={0} clipWidth={p.w} clipHeight={p.h} listening={false}>
            <Group x={fit.x} y={fit.y}>
              <MarkdownText key={loadedFonts} p={fit.style} />
            </Group>
          </Group>
        )}
      </Group>
    );
  },
  migrations: [],
};
