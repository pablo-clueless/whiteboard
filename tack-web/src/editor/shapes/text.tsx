import { Text } from "react-konva";

import { useEditorStore } from "@/stores/editor";

import { rotatedBounds } from "../geometry";
import type { ShapeDef } from "../types";

import { clamp, num, str } from "./box";

export type TextProps = {
  text: string;
  fontSize: number;
  color: string;
};

export const TEXT_LINE_HEIGHT = 1.25;
export const MIN_FONT_SIZE = 6;
export const MAX_FONT_SIZE = 400;

const DEFAULT_TEXT: TextProps = { text: "", fontSize: 24, color: "#000000" };

let family: string | null = null;

/** The app's UI font (DM Sans via next/font), as a CSS font-family list Konva can use. */
export function textFont(): string {
  if (family) return family;
  const value =
    typeof document === "undefined"
      ? ""
      : getComputedStyle(document.documentElement).getPropertyValue("--font-dm-sans").trim();
  family = value || "sans-serif";
  return family;
}

let measurer: CanvasRenderingContext2D | null = null;

/** Size of a block of text, one line per `\n`, at the given font size. */
export function measureText(text: string, fontSize: number): { w: number; h: number } {
  measurer ??= document.createElement("canvas").getContext("2d");
  const lines = text.split("\n");
  let w = 0;
  if (measurer) {
    measurer.font = `${fontSize}px ${textFont()}`;
    for (const line of lines) w = Math.max(w, measurer.measureText(line).width);
  }
  // Keep an empty box clickable and visible while it's being typed into.
  return { w: Math.max(w, fontSize * 0.6), h: lines.length * fontSize * TEXT_LINE_HEIGHT };
}

export const textShape: ShapeDef<TextProps, "text"> = {
  type: "text",
  version: 1,
  defaultProps: DEFAULT_TEXT,
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    return {
      text: str(p.text, ""),
      fontSize: clamp(num(p.fontSize, DEFAULT_TEXT.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE),
      color: str(p.color, DEFAULT_TEXT.color),
    };
  },
  getBounds: (s) => {
    const { w, h } = measureText(s.props.text, s.props.fontSize);
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
  Component: function TextBlock({ shape }) {
    // While someone types into the DOM editor here, it draws the text instead.
    const editing = useEditorStore((s) => s.editingTextId === shape.id);
    const p = shape.props;
    if (editing) return <></>;
    const { w, h } = measureText(p.text, p.fontSize);
    return (
      <Text
        text={p.text}
        fontSize={p.fontSize}
        fontFamily={textFont()}
        lineHeight={TEXT_LINE_HEIGHT}
        fill={p.color}
        width={w + 1}
        height={h}
        perfectDrawEnabled={false}
      />
    );
  },
  migrations: [],
};
