import type { LucideIcon } from "lucide-react";
import type { JSX } from "react";

import type { Editor } from "./editor-core";

export type Vec = { x: number; y: number };
export type Box = { x: number; y: number; w: number; h: number };

/**
 * A shape record as stored in `doc.shapes`. Top-level fields merge independently across clients;
 * `props` is replaced as a whole (last writer wins).
 */
export type Shape<P = unknown, T extends string = string> = {
  id: string;
  type: T;
  x: number;
  y: number;
  rotation: number;
  /** Fractional index (z-order). */
  index: string;
  /** Frame / group parent. */
  parentId: string | null;
  locked: boolean;
  props: P;
};

export type Handle = { id: string; point: Vec };

export type ResizeInfo = {
  /** Scale relative to the shape's state when the resize started. */
  scaleX: number;
  scaleY: number;
  initial: Shape;
};

/** Every shape, built-in or custom, is described by a ShapeDef. The editor only talks to shapes through it. */
export type ShapeDef<P = unknown, T extends string = string> = {
  type: T;
  version: number;
  defaultProps: P;
  validate: (props: unknown) => P;
  /**
   * Draws the shape in its own local space: (0, 0) is the shape's top-left. The editor applies
   * x, y and rotation.
   */
  Component: (p: { shape: Shape<P, T>; isSelected: boolean }) => JSX.Element;
  getBounds: (shape: Shape<P, T>) => Box;
  /** Defaults to a bounds check. Thin shapes must implement it with a screen-space tolerance. */
  hitTest?: (shape: Shape<P, T>, point: Vec, tolerance: number) => boolean;
  getHandles?: (shape: Shape<P, T>) => Handle[];
  onResize?: (shape: Shape<P, T>, info: ResizeInfo) => Partial<Shape<P, T>>;
  getAnchors?: (shape: Shape<P, T>) => Vec[];
  toSvg?: (shape: Shape<P, T>) => string;
  /** Ordered: `migrations[n]` upgrades props from version n to n + 1. */
  migrations: ((props: unknown) => unknown)[];
};

export type ToolEvent = {
  /** Pointer position in page space. */
  point: Vec;
  /** Pointer position in screen space. */
  screen: Vec;
  pressure: number;
  /** "mouse", "pen" or "touch". Only pens report real pressure. */
  pointerType: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** Id of the shape under the pointer, if any. */
  targetId: string | null;
};

/**
 * Each tool is a small state machine driven by pointer and key events. Handlers get the editor so
 * tools never reach into Yjs or Konva directly.
 */
export type Tool = {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Single key that selects the tool, e.g. "r". */
  shortcut?: string;
  /**
   * Tools with the same group share one toolbar button with a menu, which shows the last one
   * used. Ungrouped tools get their own button.
   */
  group?: string;
  cursor: string;
  onPointerDown?: (e: ToolEvent, editor: Editor) => void;
  onPointerMove?: (e: ToolEvent, editor: Editor) => void;
  onPointerUp?: (e: ToolEvent, editor: Editor) => void;
  onKeyDown?: (e: KeyboardEvent, editor: Editor) => void;
  /** Escape, or switching tools mid-gesture. Undo any half-finished work. */
  onCancel?: (editor: Editor) => void;
};
