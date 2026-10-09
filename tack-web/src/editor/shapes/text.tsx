import { useEffect, useSyncExternalStore } from "react";
import { Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";

import { layoutMarkdown, type MarkdownLayout, type TextAlign } from "../markdown";
import { useEditorStore } from "@/stores/editor";
import type { Shape, ShapeDef } from "../types";
import type { Editor } from "../editor-core";
import { rotatedBounds } from "../geometry";
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
  /** Render markdown (headings, emphasis, lists…). Off shows the source as typed. */
  markdown: boolean;
  /** Wrap at this width; null grows the box to fit the longest line. */
  width: number | null;
  align: TextAlign;
  /** Multiple of the font size. */
  lineHeight: number;
  /** Extra px after every character. */
  letterSpacing: number;
  /** Whole-text styles (bold is the weight). Markdown can still style parts on top. */
  italic: boolean;
  underline: boolean;
  strike: boolean;
};

export const MIN_LINE_HEIGHT = 0.8;
export const MAX_LINE_HEIGHT = 3;
export const MIN_LETTER_SPACING = -5;
export const MAX_LETTER_SPACING = 40;

export const TEXT_LINE_HEIGHT = 1.25;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 400;

/** The size new text starts at. */
export const DEFAULT_FONT_SIZE = 16;

const DEFAULT_TEXT: TextProps = {
  text: "Write here",
  fontSize: DEFAULT_FONT_SIZE,
  color: "#000000",
  fontFamily: DEFAULT_FONT,
  fontWeight: DEFAULT_WEIGHT,
  markdown: true,
  width: null,
  align: "left",
  lineHeight: 1.25,
  letterSpacing: 0,
  italic: false,
  underline: false,
  strike: false,
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

export type TextStyleKey = "bold" | "italic" | "underline" | "strike";

/** Weights from here up count as bold. */
const BOLD_FROM = 600;

/** Whether a text's whole-text style is on. */
export const hasTextStyle = (p: TextProps, key: TextStyleKey) =>
  key === "bold" ? p.fontWeight >= BOLD_FROM : p[key];

/**
 * Toggles bold, italic, underline or strikethrough on the text shapes among `ids`: on for all if
 * any lacks it, otherwise off for all. Bold moves to the nearest weight the typeface has (700
 * on, 400 off). One undo step. Returns whether any text was changed.
 */
export function toggleTextStyle(editor: Editor, ids: string[], key: TextStyleKey): boolean {
  const texts = editor
    .unlocked(ids)
    .map((id) => editor.getValidShape(id))
    .filter((s) => s?.type === "text") as Shape<TextProps>[];
  if (!texts.length) return false;
  const on = !texts.every((s) => hasTextStyle(s.props, key));
  editor.markHistory();
  editor.updateShapes(
    Object.fromEntries(
      texts.map((s) => [
        s.id,
        {
          props: {
            ...s.props,
            ...(key === "bold"
              ? { fontWeight: closestWeight(s.props.fontFamily, on ? 700 : 400) }
              : { [key]: on }),
          },
        },
      ]),
    ),
  );
  editor.markHistory();
  return true;
}

/** The w×h a text shape draws in, wrapped and spaced as its props say. */
export function textBox(p: TextProps): { w: number; h: number } {
  const { w, h } = layoutMarkdown(p.text, p);
  return { w, h };
}

/** Opens a markdown link on Ctrl/⌘-click (a plain click selects the text, as anywhere else). */
function openLink(href: string, evt: MouseEvent) {
  if (!(evt.ctrlKey || evt.metaKey)) return;
  window.open(href, "_blank", "noopener,noreferrer");
}

/** Makes a node report a zero-size client rect; Konva leaves such children out of a group's size. */
const reportNoSize = (node: Konva.Group | null) => {
  if (node) node.getClientRect = () => ({ x: 0, y: 0, width: 0, height: 0 });
};

/** Draws laid-out markdown: text runs, code and quote backgrounds, rules and checkboxes. */
function MarkdownText({ p }: { p: TextProps }) {
  const { pieces, w, h } = layoutMarkdown(p.text, p);
  // Bold, italic and code use faces the plain text doesn't; fetch them (redraws when they land).
  const faces = [
    ...new Set(
      pieces.flatMap((q) =>
        q.kind === "text" ? [`${q.mono ? "mono" : p.fontFamily}|${q.weight}|${q.italic}`] : [],
      ),
    ),
  ].join(",");
  useEffect(() => {
    for (const face of faces.split(",").filter(Boolean)) {
      const [id, weight, italic] = face.split("|");
      ensureFont(id, Number(weight), italic === "true");
    }
  }, [faces]);
  return (
    <Group>
      {/* Takes the clicks for the whole block; the pieces themselves don't listen. Named so a
          live width resize can resize it straight away, before the text re-renders. */}
      <Rect name="live-width-box" width={w} height={h} fill="transparent" />
      {/* The pieces report no size of their own, so the shape measures as its layout box (the
          rect above) even mid-resize, while the drawn lines lag a frame behind. */}
      <Group ref={reportNoSize}>
        {pieces.map((piece, i) => {
          switch (piece.kind) {
            case "rect":
              return (
                <Rect
                  key={i}
                  x={piece.x}
                  y={piece.y}
                  width={piece.w}
                  height={piece.h}
                  fill={piece.fill}
                  cornerRadius={piece.radius}
                  listening={false}
                />
              );
            case "line":
              return (
                <Line
                  key={i}
                  points={piece.points}
                  stroke={piece.stroke}
                  strokeWidth={piece.width}
                  listening={false}
                />
              );
            case "check":
              return (
                <Group key={i} x={piece.x} y={piece.y} listening={false}>
                  <Rect
                    width={piece.size}
                    height={piece.size}
                    cornerRadius={piece.size * 0.2}
                    stroke={piece.color}
                    strokeWidth={Math.max(1, piece.size / 10)}
                    fill={piece.done ? piece.color : undefined}
                  />
                  {piece.done && (
                    <Line
                      points={[0.24, 0.52, 0.43, 0.7, 0.76, 0.3].map((v) => v * piece.size)}
                      stroke="#ffffff"
                      strokeWidth={Math.max(1.2, piece.size / 8)}
                      lineCap="round"
                      lineJoin="round"
                    />
                  )}
                </Group>
              );
            default: {
              const decoration = [piece.underline && "underline", piece.strike && "line-through"]
                .filter(Boolean)
                .join(" ");
              return (
                <Text
                  key={i}
                  x={piece.x}
                  y={piece.y}
                  text={piece.text}
                  fontSize={piece.size}
                  lineHeight={1}
                  fontFamily={fontFamily(piece.mono ? "mono" : p.fontFamily)}
                  fontStyle={`${piece.italic ? "italic " : ""}${piece.weight}`}
                  letterSpacing={piece.letterSpacing}
                  textDecoration={decoration}
                  fill={piece.color}
                  listening={!!piece.href}
                  onClick={piece.href ? (e) => openLink(piece.href!, e.evt) : undefined}
                  perfectDrawEnabled={false}
                />
              );
            }
          }
        })}
      </Group>
    </Group>
  );
}

/** The same pieces as SVG, for export. */
function markdownSvg(l: MarkdownLayout, p: TextProps): string {
  return l.pieces
    .map((piece) => {
      switch (piece.kind) {
        case "rect":
          return `<rect x="${n(piece.x)}" y="${n(piece.y)}" width="${n(piece.w)}" height="${n(piece.h)}" rx="${piece.radius}" fill="${piece.fill}"/>`;
        case "line":
          return `<line x1="${n(piece.points[0])}" y1="${n(piece.points[1])}" x2="${n(piece.points[2])}" y2="${n(piece.points[3])}" stroke="${piece.stroke}" stroke-width="${piece.width}"/>`;
        case "check":
          return (
            `<rect x="${n(piece.x)}" y="${n(piece.y)}" width="${n(piece.size)}" height="${n(piece.size)}" rx="${n(piece.size * 0.2)}" fill="${piece.done ? esc(piece.color) : "none"}" stroke="${esc(piece.color)}"/>` +
            (piece.done
              ? `<polyline points="${[0.24, 0.52, 0.43, 0.7, 0.76, 0.3].map((v, i) => n((i % 2 ? piece.y : piece.x) + v * piece.size)).join(" ")}" fill="none" stroke="#ffffff" stroke-width="${n(Math.max(1.2, piece.size / 8))}" stroke-linecap="round" stroke-linejoin="round"/>`
              : "")
          );
        default: {
          const decoration = [piece.underline && "underline", piece.strike && "line-through"]
            .filter(Boolean)
            .join(" ");
          const text = `<text x="${n(piece.x)}" y="${n(piece.y + piece.size / 2)}" dominant-baseline="central" font-family="${esc(fontFamily(piece.mono ? "mono" : p.fontFamily))}" font-size="${n(piece.size)}" font-weight="${piece.weight}"${piece.italic ? ' font-style="italic"' : ""}${piece.letterSpacing ? ` letter-spacing="${piece.letterSpacing}"` : ""}${decoration ? ` text-decoration="${decoration}"` : ""} fill="${esc(piece.color)}" xml:space="preserve">${esc(piece.text)}</text>`;
          return piece.href ? `<a href="${esc(piece.href)}">${text}</a>` : text;
        }
      }
    })
    .join("");
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
      markdown: p.markdown !== false,
      width: typeof p.width === "number" && p.width > 0 ? Math.max(8, p.width) : null,
      align: p.align === "center" || p.align === "right" ? p.align : "left",
      lineHeight: clamp(num(p.lineHeight, 1.25), MIN_LINE_HEIGHT, MAX_LINE_HEIGHT),
      letterSpacing: clamp(num(p.letterSpacing, 0), MIN_LETTER_SPACING, MAX_LETTER_SPACING),
      italic: p.italic === true,
      underline: p.underline === true,
      strike: p.strike === true,
    };
  },
  // Side handles set the wrap width (rewrapping as you drag); corners scale the font, below.
  liveWidth: { min: 24, get: (s) => textBox(s.props).w },
  getBounds: (s) => {
    const { w, h } = textBox(s.props);
    return rotatedBounds(s.x, s.y, w, h, s.rotation);
  },
  // A corner scales the text: the font size follows the vertical stretch, and a fixed wrap
  // width the horizontal one.
  onResize: (shape, { scaleX, scaleY, initial }) => {
    const start = initial.props as TextProps;
    return {
      props: {
        ...shape.props,
        fontSize: clamp(
          Math.round(start.fontSize * Math.abs(scaleY) * 10) / 10,
          MIN_FONT_SIZE,
          MAX_FONT_SIZE,
        ),
        width: start.width ? Math.max(24, start.width * Math.abs(scaleX)) : null,
      },
    };
  },
  // Plain text goes through the same layout as markdown, with parsing off.
  toSvg: ({ props: p }) => markdownSvg(layoutMarkdown(p.text, p), p),
  Component: function TextBlock({ shape }) {
    // While someone types into the DOM editor here, it draws the text instead.
    const editing = useEditorStore((s) => s.editingTextId === shape.id);
    // Re-measure and redraw once the font file arrives; until then the fallback shows.
    const loadedFonts = useSyncExternalStore(onFontsLoaded, fontsVersion, fontsVersion);
    const p = shape.props;
    useEffect(() => ensureFont(p.fontFamily, p.fontWeight), [p.fontFamily, p.fontWeight]);
    if (editing) return <></>;
    return <MarkdownText key={loadedFonts} p={p} />;
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
