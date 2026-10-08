/**
 * Typefaces for text shapes. Each is a variable Google font loaded by `app/layout.tsx` into a CSS
 * variable, and offers only the weights the typeface actually has.
 */
export type TextFont = {
  id: string;
  label: string;
  /** CSS variable `next/font` sets to the font's family list. */
  cssVar: string;
  fallback: string;
  weights: number[];
};

const range = (from: number, to: number) =>
  Array.from({ length: (to - from) / 100 + 1 }, (_, i) => from + i * 100);

export const TEXT_FONTS: TextFont[] = [
  {
    id: "sans",
    label: "Sans",
    cssVar: "--font-dm-sans",
    fallback: "sans-serif",
    weights: range(100, 900),
  },
  {
    id: "serif",
    label: "Serif",
    cssVar: "--font-source-serif",
    fallback: "serif",
    weights: range(200, 900),
  },
  {
    id: "display",
    label: "Display",
    cssVar: "--font-playfair",
    fallback: "serif",
    weights: range(400, 900),
  },
  {
    id: "mono",
    label: "Mono",
    cssVar: "--font-jetbrains-mono",
    fallback: "monospace",
    weights: range(100, 800),
  },
  {
    id: "hand",
    label: "Handwritten",
    cssVar: "--font-caveat",
    fallback: "cursive",
    weights: range(400, 700),
  },
];

export const DEFAULT_FONT = "sans";
export const DEFAULT_WEIGHT = 400;

export const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "Extra light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semibold",
  700: "Bold",
  800: "Extra bold",
  900: "Black",
};

export function textFontById(id: string): TextFont {
  return TEXT_FONTS.find((f) => f.id === id) ?? TEXT_FONTS[0];
}

/** The nearest weight the font has, so switching typeface never asks for one it lacks. */
export function closestWeight(fontId: string, weight: number): number {
  const { weights } = textFontById(fontId);
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best));
}

const families = new Map<string, string>();

/** The CSS font-family list for a font id, as the canvas and the DOM editor need it. */
export function fontFamily(id: string): string {
  const cached = families.get(id);
  if (cached) return cached;
  const font = textFontById(id);
  const value =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue(font.cssVar).trim();
  const family = value ? `${value}, ${font.fallback}` : font.fallback;
  if (value) families.set(id, family);
  return family;
}

/* ── Loading ────────────────────────────────────────────────────────────── */

// Canvas text doesn't make the browser download a font the page hasn't used yet; it just draws
// the fallback. So ask for each family and weight once, and tell listeners when it arrives so
// text re-measures and redraws.

const requested = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

export const fontsVersion = () => version;

export function onFontsLoaded(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function ensureFont(id: string, weight: number) {
  if (typeof document === "undefined" || !document.fonts) return;
  const key = `${id}:${weight}`;
  if (requested.has(key)) return;
  requested.add(key);
  const spec = `${weight} 16px ${fontFamily(id)}`;
  if (document.fonts.check(spec)) return;
  document.fonts
    .load(spec)
    .then((loaded) => {
      if (!loaded.length) return;
      version++;
      listeners.forEach((fn) => fn());
    })
    .catch(() => {
      // Offline or blocked: the fallback font stays.
    });
}
