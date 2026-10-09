/**
 * Markdown for text shapes: a small parser for the common subset (headings, emphasis, code,
 * strikethrough, links, lists, task lists, quotes, rules and code blocks) and a layout that
 * turns it into positioned pieces the canvas, the SVG export and the bounds all share.
 *
 * Lines never wrap: each source line is one line on the board, as with plain text.
 */

import { fontFamily, fontsVersion } from "./fonts";

/* ── Parsing ────────────────────────────────────────────────────────────── */

export type Run = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
  /** Only http(s) and mailto links are kept. */
  href?: string;
};

export type Block =
  | { kind: "p"; runs: Run[] }
  | { kind: "h"; level: 1 | 2 | 3; runs: Run[] }
  | { kind: "li"; depth: number; marker: string; runs: Run[] }
  | { kind: "task"; depth: number; done: boolean; runs: Run[] }
  | { kind: "quote"; runs: Run[] }
  | { kind: "code"; text: string }
  | { kind: "hr" }
  | { kind: "blank" };

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

type Style = Omit<Run, "text">;

/** Inline markdown → styled runs. Delimiters only count when they have a partner later on. */
export function parseInline(src: string): Run[] {
  const runs: Run[] = [];
  const style: Style = {};
  let buf = "";
  const flush = () => {
    if (buf) runs.push({ text: buf, ...style });
    buf = "";
  };
  const closes = (delim: string, from: number) => src.indexOf(delim, from) !== -1;

  for (let i = 0; i < src.length;) {
    const ch = src[i];
    const rest = src.slice(i);

    if (ch === "\\" && i + 1 < src.length && /[\\`*_~[\]()#>+\-.!|]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        runs.push({ text: src.slice(i + 1, end), ...style, code: true });
        i = end + 1;
        continue;
      }
    }
    // URLs may contain one level of brackets, e.g. Wikipedia's `Foo_(bar)`.
    const link = rest.match(/^\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/);
    if (link) {
      flush();
      const href = SAFE_URL.test(link[2]) ? link[2] : undefined;
      for (const r of parseInline(link[1])) runs.push({ ...style, ...r, href });
      i += link[0].length;
      continue;
    }
    // Bold and strikethrough before single-character italics.
    const toggles: [string, "bold" | "italic" | "strike"][] = [
      ["**", "bold"],
      ["__", "bold"],
      ["~~", "strike"],
      ["*", "italic"],
      ["_", "italic"],
    ];
    let toggled = false;
    for (const [delim, key] of toggles) {
      if (!rest.startsWith(delim)) continue;
      const before = src[i - 1] ?? " ";
      const after = src[i + delim.length] ?? " ";
      const opening = !style[key];
      // `_` inside words (snake_case) is text, not emphasis.
      if (delim[0] === "_" && /\w/.test(opening ? before : after)) break;
      if (opening ? /\s/.test(after) || !closes(delim, i + delim.length) : /\s/.test(before)) break;
      flush();
      style[key] = opening || undefined;
      i += delim.length;
      toggled = true;
      break;
    }
    if (toggled) continue;
    buf += ch;
    i++;
  }
  flush();
  return runs;
}

/** Markdown source → blocks, one per line (a code block is one block). */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    let m: RegExpMatchArray | null;
    if (!line.trim()) blocks.push({ kind: "blank" });
    else if ((m = line.match(/^(#{1,6})\s+(.*)$/)))
      blocks.push({
        kind: "h",
        level: Math.min(3, m[1].length) as 1 | 2 | 3,
        runs: parseInline(m[2]),
      });
    else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) blocks.push({ kind: "hr" });
    else if ((m = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/)))
      blocks.push({
        kind: "task",
        depth: Math.floor(m[1].length / 2),
        done: m[2] !== " ",
        runs: parseInline(m[3]),
      });
    else if ((m = line.match(/^(\s*)([-*+])\s+(.*)$/)))
      blocks.push({
        kind: "li",
        depth: Math.floor(m[1].length / 2),
        marker: "•",
        runs: parseInline(m[3]),
      });
    else if ((m = line.match(/^(\s*)(\d+)([.)])\s+(.*)$/)))
      blocks.push({
        kind: "li",
        depth: Math.floor(m[1].length / 2),
        marker: `${m[2]}.`,
        runs: parseInline(m[4]),
      });
    else if ((m = line.match(/^>\s?(.*)$/)))
      blocks.push({ kind: "quote", runs: parseInline(m[1]) });
    else blocks.push({ kind: "p", runs: parseInline(line) });
  }
  return blocks;
}

/* ── Layout ─────────────────────────────────────────────────────────────── */

export type Piece =
  | {
      kind: "text";
      x: number;
      y: number;
      text: string;
      size: number;
      weight: number;
      italic: boolean;
      mono: boolean;
      color: string;
      underline: boolean;
      strike: boolean;
      href?: string;
      /** Extra space after every character, in px. */
      letterSpacing: number;
      w: number;
    }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: string; radius: number }
  | { kind: "line"; points: number[]; stroke: string; width: number }
  | { kind: "check"; x: number; y: number; size: number; done: boolean; color: string };

export type MarkdownLayout = { pieces: Piece[]; w: number; h: number };

export type TextAlign = "left" | "center" | "right";

export type TextStyle = {
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  /** Parse markdown, or lay the text out exactly as typed. */
  markdown?: boolean;
  /** Wrap lines at this width; null or missing grows to fit the longest line. */
  width?: number | null;
  align?: TextAlign;
  /** Multiple of the font size. */
  lineHeight?: number;
  /** Extra px after every character. */
  letterSpacing?: number;
  /** Whole-text styles, on top of any markdown styling. */
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};

export const LINE_HEIGHT = 1.25;
const LINK_COLOR = "#2563eb";
const MUTED = "#6b6b75";
const CODE_BG = "rgba(14, 14, 16, 0.07)";
const RULE = "#d4d4da";

let ctx: CanvasRenderingContext2D | null = null;
/** Text width the way Konva computes it: the run's width plus spacing between its characters. */
const measure = (text: string, font: string, letterSpacing = 0) => {
  ctx ??= document.createElement("canvas").getContext("2d");
  let plain = text.length * 8;
  if (ctx) {
    ctx.font = font;
    plain = ctx.measureText(text).width;
  }
  return plain + (text.length > 1 ? letterSpacing * (text.length - 1) : 0);
};

export const cssFontOf = (
  p: { italic: boolean; weight: number; size: number; mono: boolean },
  family: string,
) =>
  `${p.italic ? "italic " : ""}${p.weight} ${p.size}px ${p.mono ? fontFamily("mono") : fontFamily(family)}`;

const cache = new Map<string, MarkdownLayout>();

/** Lays out text at the given style. Cached; re-measured when fonts finish loading. */
export function layoutMarkdown(source: string, style: TextStyle): MarkdownLayout {
  const key = [
    fontsVersion(),
    style.fontSize,
    style.fontFamily,
    style.fontWeight,
    style.color,
    style.markdown !== false,
    style.width ?? "auto",
    style.align ?? "left",
    style.lineHeight ?? LINE_HEIGHT,
    style.letterSpacing ?? 0,
    !!style.italic,
    !!style.underline,
    !!style.strike,
    source,
  ].join("|");
  const hit = cache.get(key);
  if (hit) return hit;
  const result = layout(source, style);
  if (cache.size > 400) cache.clear();
  cache.set(key, result);
  return result;
}

type TextPiece = Extract<Piece, { kind: "text" }>;

/** One line as drawn: its pieces, where its content ends, and whether alignment moves it. */
type VisualLine = { pieces: Piece[]; end: number; align: boolean };

type Wrapped = { pieces: TextPiece[]; end: number };

function layout(source: string, s: TextStyle): MarkdownLayout {
  const base = s.fontSize;
  const lh = s.lineHeight ?? LINE_HEIGHT;
  const ls = s.letterSpacing ?? 0;
  const maxWidth = s.width ?? Infinity;
  const bold = Math.min(900, Math.max(700, s.fontWeight + 300));
  const lines: VisualLine[] = [];
  let y = 0;

  const blocks: Block[] =
    s.markdown === false
      ? source
          .split("\n")
          .map((l): Block => (l ? { kind: "p", runs: [{ text: l }] } : { kind: "blank" }))
      : parseMarkdown(source);

  /**
   * Places styled runs from x = `left`, wrapping at the width: a word that doesn't fit moves to a
   * new line, and a word longer than a whole line is split. Returns one entry per visual line.
   */
  const wrapRuns = (
    runs: Run[],
    left: number,
    size: number,
    opts: { weight?: number; color?: string; done?: boolean } = {},
  ): Wrapped[] => {
    const out: Wrapped[] = [{ pieces: [], end: left }];
    let x = left;
    const styleOf = (r: Run) => {
      const mono = !!r.code;
      return {
        mono,
        size: mono ? size * 0.9 : size,
        weight: r.bold ? bold : (opts.weight ?? s.fontWeight),
        italic: !!r.italic || !!s.italic,
        color: r.href ? LINK_COLOR : (opts.color ?? s.color),
        underline: !!r.href || !!s.underline,
        strike: !!r.strike || !!opts.done || !!s.strike,
        href: r.href,
      };
    };
    type Style = ReturnType<typeof styleOf>;
    const lineEnd = (line: Wrapped) => {
      const last = line.pieces[line.pieces.length - 1];
      return last ? last.x + last.w : left;
    };
    const newLine = () => {
      // Trailing spaces on a wrapped line don't count towards its width.
      const cur = out[out.length - 1];
      const last = cur.pieces[cur.pieces.length - 1];
      if (last && /^\s+$/.test(last.text)) cur.pieces.pop();
      cur.end = lineEnd(cur);
      out.push({ pieces: [], end: left });
      x = left;
    };
    const place = (text: string, st: Style, font: string) => {
      const cur = out[out.length - 1];
      const prev = cur.pieces[cur.pieces.length - 1];
      // Merge with the previous piece when it's the same style, to keep the node count down.
      if (
        prev &&
        prev.mono === st.mono &&
        prev.size === st.size &&
        prev.weight === st.weight &&
        prev.italic === st.italic &&
        prev.color === st.color &&
        prev.strike === st.strike &&
        prev.href === st.href
      ) {
        prev.text += text;
        prev.w = measure(prev.text, font, ls);
        x = prev.x + prev.w + ls;
      } else {
        const w = measure(text, font, ls);
        cur.pieces.push({ kind: "text", x, y: 0, text, ...st, letterSpacing: ls, w });
        x += w + ls;
      }
      cur.end = lineEnd(cur);
    };

    for (const r of runs) {
      const st = styleOf(r);
      const font = cssFontOf(st, s.fontFamily);
      for (const token of r.text.split(/(\s+)/).filter(Boolean)) {
        const space = /^\s+$/.test(token);
        const cur = out[out.length - 1];
        // No leading spaces on a wrapped line.
        if (space && !cur.pieces.length && out.length > 1) continue;
        const w = measure(token, font, ls);
        if (!space && x + w > maxWidth && cur.pieces.some((p) => /\S/.test(p.text))) newLine();
        if (!space && w > maxWidth - left) {
          // Longer than a whole line: break it character by character.
          let chunk = "";
          for (const ch of token) {
            if (chunk && x + measure(chunk + ch, font, ls) > maxWidth) {
              place(chunk, st, font);
              newLine();
              chunk = "";
            }
            chunk += ch;
          }
          if (chunk) place(chunk, st, font);
          continue;
        }
        place(token, st, font);
      }
    }
    const last = out[out.length - 1];
    const tail = last.pieces[last.pieces.length - 1];
    if (tail && /^\s+$/.test(tail.text) && last.pieces.length > 1) last.pieces.pop();
    last.end = lineEnd(last);
    return out;
  };

  /** Adds wrapped lines at the current y, with any prefix pieces (markers, quote bars). */
  const addLines = (
    wrapped: Wrapped[],
    size: number,
    prefix: (top: number, lineH: number, first: boolean) => Piece[] = () => [],
  ) => {
    const lineH = size * lh;
    wrapped.forEach((line, k) => {
      const pieces: Piece[] = prefix(y, lineH, k === 0);
      for (const p of line.pieces) {
        p.y = y + (lineH - p.size) / 2;
        if (p.mono)
          pieces.push({
            kind: "rect",
            x: p.x - 2,
            y: y + (lineH - p.size * 1.35) / 2,
            w: p.w + 4,
            h: p.size * 1.35,
            fill: CODE_BG,
            radius: 3,
          });
        pieces.push(p);
      }
      lines.push({ pieces, end: line.end, align: true });
      y += lineH;
    });
  };

  const markerPiece = (text: string, top: number, lineH: number): TextPiece => {
    const font = cssFontOf(
      { italic: false, weight: s.fontWeight, size: base, mono: false },
      s.fontFamily,
    );
    return {
      kind: "text",
      x: 0,
      y: top + (lineH - base) / 2,
      text,
      size: base,
      weight: s.fontWeight,
      italic: false,
      mono: false,
      color: MUTED,
      underline: false,
      strike: false,
      letterSpacing: 0,
      w: measure(text, font),
    };
  };

  blocks.forEach((b, i) => {
    switch (b.kind) {
      case "blank":
        lines.push({ pieces: [], end: 0, align: false });
        y += base * lh;
        break;
      case "p":
        addLines(wrapRuns(b.runs, 0, base), base);
        break;
      case "h": {
        const size = base * [0, 1.75, 1.4, 1.15][b.level];
        if (i > 0) y += base * 0.35;
        addLines(wrapRuns(b.runs, 0, size, { weight: bold }), size);
        y += base * 0.15;
        break;
      }
      case "li":
      case "task": {
        const indent = b.depth * base * 1.4;
        const markerW = base * 1.3;
        const done = b.kind === "task" && b.done;
        const wrapped = wrapRuns(
          b.runs,
          indent + markerW,
          base,
          done ? { color: MUTED, done: true } : {},
        );
        addLines(wrapped, base, (top, lineH, first) => {
          if (!first) return [];
          if (b.kind === "li") {
            const m = markerPiece(b.marker, top, lineH);
            m.x = indent + (markerW - m.w) / 2 - base * 0.15;
            return [m];
          }
          const box = base * 0.8;
          return [
            {
              kind: "check",
              x: indent + (markerW - box) / 2 - base * 0.15,
              y: top + (lineH - box) / 2,
              size: box,
              done: b.done,
              color: s.color,
            },
          ];
        });
        break;
      }
      case "quote":
        addLines(wrapRuns(b.runs, base * 0.9, base, { color: MUTED }), base, (top, lineH) => [
          { kind: "rect", x: 0, y: top, w: 3, h: lineH, fill: RULE, radius: 1.5 },
        ]);
        break;
      case "hr": {
        const lineH = base * lh;
        // Stretched to the full width once that's known.
        lines.push({
          pieces: [
            {
              kind: "line",
              points: [0, y + lineH / 2, 0, y + lineH / 2],
              stroke: RULE,
              width: 1.5,
            },
          ],
          end: 0,
          align: false,
        });
        y += lineH;
        break;
      }
      case "code": {
        // Code keeps its own lines: no wrapping, always left-aligned.
        const size = base * 0.9;
        const codeLines = b.text.split("\n");
        const ch = size * lh;
        const pad = base * 0.5;
        const font = cssFontOf({ italic: false, weight: 400, size, mono: true }, s.fontFamily);
        const w = Math.max(base * 4, ...codeLines.map((l) => measure(l, font))) + pad * 2;
        const pieces: Piece[] = [
          {
            kind: "rect",
            x: 0,
            y: y + base * 0.15,
            w,
            h: codeLines.length * ch + pad * 2,
            fill: CODE_BG,
            radius: 6,
          },
        ];
        codeLines.forEach((l, j) => {
          pieces.push({
            kind: "text",
            x: pad,
            y: y + base * 0.15 + pad + j * ch + (ch - size) / 2,
            text: l,
            size,
            weight: 400,
            italic: false,
            mono: true,
            color: s.color,
            underline: false,
            strike: false,
            letterSpacing: 0,
            w: measure(l, font),
          });
        });
        lines.push({ pieces, end: w, align: false });
        y += codeLines.length * ch + pad * 2 + base * 0.3;
        break;
      }
    }
  });

  const contentWidth = Math.max(base * 0.6, ...lines.map((l) => l.end));
  const hasRule = lines.some((l) => l.pieces.some((p) => p.kind === "line"));
  const width = s.width ?? Math.max(contentWidth, hasRule ? base * 6 : 0);

  // Align each line within the box, then stretch rules across it.
  const align = s.align ?? "left";
  const pieces: Piece[] = [];
  for (const line of lines) {
    const shift =
      !line.align || align === "left" ? 0 : (width - line.end) / (align === "center" ? 2 : 1);
    for (const p of line.pieces) {
      if (shift && p.kind !== "line") p.x += shift;
      if (p.kind === "line") p.points[2] = width;
      pieces.push(p);
    }
  }
  return { pieces, w: width, h: Math.max(y, base * lh) };
}
