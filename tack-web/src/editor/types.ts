import type { JSX } from "react";

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
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** Id of the shape under the pointer, if any. */
  targetId: string | null;
};

/** Each tool is a small state machine driven by pointer and key events. */
export type Tool = {
  id: string;
  label: string;
  cursor: string;
  onPointerDown?: (e: ToolEvent) => void;
  onPointerMove?: (e: ToolEvent) => void;
  onPointerUp?: (e: ToolEvent) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onCancel?: () => void;
};
