// @vitest-environment jsdom
// jsdom has no canvas, so text measures at a fixed 8px per character: widths here are exact.
import { describe, expect, it } from "vitest";

// No canvas in jsdom: say so quietly (instead of a "not implemented" warning per measurement).
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

import { layoutMarkdown, parseInline, parseMarkdown, type Piece, type Run } from "./markdown";

/** Runs as a compact string: [B:bold], [I:italic], [C:code], [L(url):link]. */
const show = (runs: Run[]) =>
  runs
    .map((r) => {
      const f = [
        r.bold && "B",
        r.italic && "I",
        r.strike && "S",
        r.code && "C",
        r.href && `L(${r.href})`,
      ]
        .filter(Boolean)
        .join("");
      return f ? `[${f}:${r.text}]` : r.text;
    })
    .join("");

describe("parseInline", () => {
  it.each([
    ["**bold** and *italic* and _also_", "[B:bold] and [I:italic] and [I:also]"],
    ["~~gone~~ `code *not italic*` end", "[S:gone] [C:code *not italic*] end"],
    ["a **bold *nested* bold** b", "a [B:bold ][BI:nested][B: bold] b"],
    ["[Tack](https://tack.dev)", "[L(https://tack.dev):Tack]"],
    ["[wiki](https://x.org/Foo_(bar)) after", "[L(https://x.org/Foo_(bar)):wiki] after"],
  ])("styles %s", (src, expected) => expect(show(parseInline(src))).toBe(expected));

  it.each([
    ["2 * 3 * 4 = 24"],
    ["snake_case_name"],
    ["unclosed **bold"],
    [String.raw`escaped \*not italic\*`],
  ])("leaves %s alone", (src) => {
    const runs = parseInline(src);
    expect(runs.every((r) => !r.bold && !r.italic)).toBe(true);
  });

  it("drops unsafe link targets but keeps the text", () => {
    expect(show(parseInline("[bad](javascript:alert(1)) x"))).toBe("bad x");
  });
});

describe("parseMarkdown", () => {
  it("reads every block kind", () => {
    const kinds = parseMarkdown(
      "# T\n## S\n#### Deep\np\n- a\n  - b\n1. one\n- [ ] todo\n- [x] done\n> q\n---\n```\ncode\n```\n\nend",
    ).map((b) => {
      if (b.kind === "h") return `h${b.level}`;
      if (b.kind === "li") return `li${b.depth}${b.marker}`;
      if (b.kind === "task") return `task${b.done ? "x" : " "}`;
      return b.kind;
    });
    expect(kinds).toEqual([
      "h1",
      "h2",
      "h3",
      "p",
      "li0•",
      "li1•",
      "li01.",
      "task ",
      "taskx",
      "quote",
      "hr",
      "code",
      "blank",
      "p",
    ]);
  });
});

const STYLE = { fontSize: 10, fontFamily: "sans", fontWeight: 400, color: "#000" };
const texts = (pieces: Piece[]) =>
  pieces.filter((p) => p.kind === "text") as Extract<Piece, { kind: "text" }>[];

describe("layoutMarkdown", () => {
  it("grows to the longest line by default", () => {
    const l = layoutMarkdown("abcd\nab", { ...STYLE, markdown: false });
    expect(l.w).toBe(32);
    expect(l.h).toBe(2 * 10 * 1.25);
  });

  it("wraps words at a fixed width", () => {
    const l = layoutMarkdown("aaaa bbbb cccc", { ...STYLE, markdown: false, width: 80 });
    expect(texts(l.pieces).map((t) => t.text.trim())).toEqual(["aaaa bbbb", "cccc"]);
    expect(l.w).toBe(80);
    expect(l.h).toBe(2 * 12.5);
  });

  it("breaks a word longer than the whole line", () => {
    const l = layoutMarkdown("abcdefghij", { ...STYLE, markdown: false, width: 40 });
    expect(texts(l.pieces).map((t) => t.text)).toEqual(["abcde", "fghij"]);
  });

  it("aligns lines within the box", () => {
    const centre = layoutMarkdown("ab", { ...STYLE, markdown: false, width: 100, align: "center" });
    expect(texts(centre.pieces)[0].x).toBe((100 - 16) / 2);
    const right = layoutMarkdown("ab", { ...STYLE, markdown: false, width: 100, align: "right" });
    expect(texts(right.pieces)[0].x).toBe(100 - 16);
  });

  it("applies line height and letter spacing", () => {
    expect(layoutMarkdown("a\nb", { ...STYLE, markdown: false, lineHeight: 2 }).h).toBe(40);
    // Spacing goes between characters: 4 chars → 3 gaps.
    expect(layoutMarkdown("abcd", { ...STYLE, markdown: false, letterSpacing: 2 }).w).toBe(32 + 6);
  });

  it("wraps list items with a hanging indent", () => {
    const l = layoutMarkdown("- aaaa bbbb", { ...STYLE, width: 70 });
    const [marker, first, second] = texts(l.pieces);
    expect(marker.text).toBe("•");
    expect(first.text.trim()).toBe("aaaa");
    expect(second.text).toBe("bbbb");
    // The continuation line starts under the text, not under the bullet.
    expect(second.x).toBe(first.x);
  });

  it("shows markdown source as typed when markdown is off", () => {
    const l = layoutMarkdown("**bold**", { ...STYLE, markdown: false });
    expect(texts(l.pieces).map((t) => [t.text, t.weight])).toEqual([["**bold**", 400]]);
  });
});
