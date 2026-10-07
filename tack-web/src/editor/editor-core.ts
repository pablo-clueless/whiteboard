import { generateKeyBetween } from "fractional-indexing";
import type Konva from "konva";
import RBush from "rbush";
import * as Y from "yjs";

import { shapeRegistry } from "./shapes/registry";
import { useEditorStore } from "@/stores/editor";
import type { BoardDoc } from "./sync/board-doc";
import { type Axis, axisBetween, elbowEndpoint } from "./routing";
import {
  type Binding,
  EDGE_GAP,
  bindingId,
  boundEndpoint,
  containsPoint,
  localBox,
  type Terminal,
  toPage,
} from "./bindings";
import type { Box, Shape, Vec } from "./types";

/** Transaction origin for this client's own edits. The undo manager tracks only these. */
export const LOCAL_ORIGIN = "local";

const VIEWER_TOOLS = ["select", "hand"];

/** Separate edits closer together than this undo as one step (e.g. arrow-key nudges). */
const CAPTURE_MS = 400;

type ShapeInit = Pick<Shape, "type" | "x" | "y"> & Partial<Omit<Shape, "id" | "type" | "x" | "y">>;
type ShapePatch = Partial<Omit<Shape, "id" | "type">>;

export type ZOrderMove = "forward" | "backward" | "front" | "back";

type IndexItem = { minX: number; minY: number; maxX: number; maxY: number; id: string; z: string };

/** Reads a shape record out of its Y.Map. */
export function readShape(id: string, m: Y.Map<unknown>): Shape {
  return {
    id,
    type: m.get("type") as string,
    x: (m.get("x") as number) ?? 0,
    y: (m.get("y") as number) ?? 0,
    rotation: (m.get("rotation") as number) ?? 0,
    index: (m.get("index") as string) ?? "a0",
    parentId: (m.get("parentId") as string | null) ?? null,
    locked: (m.get("locked") as boolean) ?? false,
    props: m.get("props"),
  };
}

/** Bottom-to-top order. Ties (two clients picking the same key at once) break by id so every client agrees. */
const byZ = (a: { id: string; z: string }, b: { id: string; z: string }) =>
  a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1;

/** A tiny change signal for things outside React (the spatial index, frozen shapes). */
class Signal {
  private listeners = new Set<() => void>();
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  emit() {
    this.listeners.forEach((fn) => fn());
  }
}

/**
 * The editor's one door into the board. Tools and UI go through this rather than touching Yjs or
 * Konva directly, so every local edit gets the right origin and lands in undo history.
 */
export class Editor {
  readonly undoManager: Y.UndoManager;
  /** The Konva stage, once the canvas has mounted. */
  stage: Konva.Stage | null = null;

  /** Fires when any shape's bounds or z-order change, or shapes come and go. */
  readonly indexChanged = new Signal();
  /** Fires when a shape starts or stops being drawn from a frozen snapshot. */
  readonly frozenChanged = new Signal();

  private pendingWrite: (() => void) | null = null;
  private frame = 0;
  private spatial = new RBush<IndexItem>();
  private indexItems = new Map<string, IndexItem>();
  private frozen = new Map<string, Shape>();

  /** View links: nothing writes to the board. The server drops a viewer's edits anyway. */
  readonly readOnly: boolean;

  constructor(
    readonly board: BoardDoc,
    { readOnly = false }: { readOnly?: boolean } = {},
  ) {
    this.readOnly = readOnly;
    this.undoManager = new Y.UndoManager([board.shapes, board.bindings], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: CAPTURE_MS,
    });
    board.shapes.forEach((_, id) => this.reindex(id));
    board.shapes.observeDeep(this.onShapesChanged);
  }

  attachStage(stage: Konva.Stage | null) {
    this.stage = stage;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.board.shapes.unobserveDeep(this.onShapesChanged);
    this.undoManager.destroy();
  }

  /* ── UI state ─────────────────────────────────────────────────────────── */

  get ui() {
    return useEditorStore.getState();
  }

  setTool(id: string) {
    this.ui.setTool(id);
  }

  select(ids: string[]) {
    this.ui.setSelection(ids);
  }

  /* ── Reading ──────────────────────────────────────────────────────────── */

  getShape(id: string): Shape | null {
    const m = this.board.shapes.get(id);
    return m ? readShape(id, m) : null;
  }

  /** All shape ids, bottom to top. */
  sortedIds(): string[] {
    const entries: { id: string; z: string }[] = [];
    this.board.shapes.forEach((m, id) =>
      entries.push({ id, z: (m.get("index") as string) ?? "a0" }),
    );
    return entries.sort(byZ).map((e) => e.id);
  }

  /** The shape with its props validated, or null if its type is unknown or its props are broken. */
  getValidShape(id: string): Shape | null {
    const shape = this.getShape(id);
    const def = shape && shapeRegistry.get(shape.type);
    if (!shape || !def) return null;
    try {
      return { ...shape, props: def.validate(shape.props) };
    } catch {
      return null;
    }
  }

  getBounds(id: string): Box | null {
    const shape = this.getValidShape(id);
    return shape ? (shapeRegistry.get(shape.type)?.getBounds(shape) ?? null) : null;
  }

  /** Ids of shapes whose bounds touch `box` (page space), bottom to top. */
  shapesInBox(box: Box): string[] {
    return this.spatial
      .search({ minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h })
      .sort(byZ)
      .map((item) => item.id);
  }

  /** Bounds of everything on the board (page space), or null when it's empty. */
  contentBounds(): Box | null {
    const items = this.spatial.all();
    if (!items.length) return null;
    let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const it of items) {
      [minX, minY] = [Math.min(minX, it.minX), Math.min(minY, it.minY)];
      [maxX, maxY] = [Math.max(maxX, it.maxX), Math.max(maxY, it.maxY)];
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /** The Konva node drawing a shape, for imperative updates during gestures. */
  nodeFor(id: string): Konva.Node | undefined {
    return this.stage?.findOne(`#${id}`);
  }

  /* ── Spatial index ────────────────────────────────────────────────────── */

  private onShapesChanged = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    const ids = new Set<string>();
    for (const e of events) {
      if (e.target === this.board.shapes) e.changes.keys.forEach((_, id) => ids.add(id));
      else if (typeof e.path[0] === "string") ids.add(e.path[0]);
    }
    ids.forEach((id) => this.reindex(id));
    if (ids.size) this.indexChanged.emit();
  };

  private reindex(id: string) {
    const old = this.indexItems.get(id);
    if (old) {
      this.spatial.remove(old);
      this.indexItems.delete(id);
    }
    const shape = this.getShape(id);
    const b = shape && this.getBounds(id);
    if (!shape || !b) return;
    const item = { minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h, id, z: shape.index };
    this.spatial.insert(item);
    this.indexItems.set(id, item);
  }

  /* ── Writing ──────────────────────────────────────────────────────────── */

  transact(fn: () => void) {
    if (this.readOnly) return;
    this.board.doc.transact(fn, LOCAL_ORIGIN);
  }

  /** Tools a viewer may use: looking around and selecting, nothing that edits. */
  canUseTool(toolId: string) {
    return !this.readOnly || VIEWER_TOOLS.includes(toolId);
  }

  /**
   * Adds a shape on top of the stack. Props are always the shape's own defaults with `init.props`
   * (a tool preset such as `{ sides: 6 }`) on top. Nothing carries over from earlier shapes.
   */
  createShape(init: ShapeInit): string {
    const id = crypto.randomUUID();
    const { props: preset, ...rest } = init;
    const def = shapeRegistry.get(init.type);
    const ids = this.sortedIds();
    const top = ids.length ? this.getShape(ids[ids.length - 1])!.index : null;
    const base = (def?.defaultProps ?? {}) as Record<string, unknown>;
    const record: Omit<Shape, "id"> = {
      rotation: 0,
      parentId: null,
      locked: false,
      index: generateKeyBetween(top, null),
      ...rest,
      props: { ...base, ...(preset as Record<string, unknown> | undefined) },
    };
    this.transact(() => {
      this.board.shapes.set(id, new Y.Map(Object.entries(record)));
    });
    return id;
  }

  /**
   * Top-level fields merge per key across clients; `props` is replaced as a whole. Arrows bound
   * to any of these shapes are re-routed in the same transaction, so everyone sees them move
   * together.
   */
  updateShapes(patches: Record<string, ShapePatch>) {
    this.transact(() => {
      this.writePatches(patches);
      this.rerouteArrowsBoundTo(Object.keys(patches));
    });
  }

  private writePatches(patches: Record<string, ShapePatch>) {
    for (const [id, patch] of Object.entries(patches)) {
      const m = this.board.shapes.get(id);
      if (!m) continue;
      for (const [key, value] of Object.entries(patch)) {
        if (m.get(key) !== value) m.set(key, value);
      }
    }
  }

  /* ── Arrow bindings ───────────────────────────────────────────────────── */

  getBinding(arrowId: string, terminal: Terminal): Binding | null {
    return (this.board.bindings.get(bindingId(arrowId, terminal)) as Binding | undefined) ?? null;
  }

  /** Attaches an arrow end to a shape (or detaches it with `null`) and re-routes the arrow. */
  setBinding(arrowId: string, terminal: Terminal, to: { toId: string; anchor: Vec } | null) {
    this.transact(() => {
      const key = bindingId(arrowId, terminal);
      if (to)
        this.board.bindings.set(key, { type: "arrow", arrowId, terminal, ...to } satisfies Binding);
      else this.board.bindings.delete(key);
      this.rerouteArrow(arrowId);
    });
  }

  /** The topmost shape an arrow can attach to at a page point, ignoring `excludeId`. */
  bindableShapeAt(point: Vec, excludeId?: string): Shape | null {
    const ids = this.shapesInBox({ x: point.x, y: point.y, w: 0, h: 0 }).reverse();
    for (const id of ids) {
      if (id === excludeId) continue;
      const shape = this.getValidShape(id);
      if (shape && containsPoint(shape, point)) return shape;
    }
    return null;
  }

  private rerouteArrowsBoundTo(ids: string[]) {
    if (!this.board.bindings.size) return;
    const moved = new Set(ids);
    const arrows = new Set<string>();
    this.board.bindings.forEach((b) => {
      const binding = b as Binding;
      if (moved.has(binding.toId)) arrows.add(binding.arrowId);
    });
    arrows.forEach((id) => this.rerouteArrow(id));
  }

  /**
   * Recomputes an arrow from its bindings: each bound end sits on its target's edge, aimed along
   * the line between the two ends. Unbound ends stay where they are.
   */
  private rerouteArrow(arrowId: string) {
    const arrow = this.getValidShape(arrowId);
    if (!arrow || arrow.type !== "arrow") return;
    const path = (arrow.props as { path: number[] }).path;
    const ends: Record<Terminal, Vec> = {
      start: toPage(arrow, { x: path[0], y: path[1] }),
      end: toPage(arrow, { x: path[path.length - 2], y: path[path.length - 1] }),
    };
    const targets = {} as Record<Terminal, { shape: Shape; anchor: Vec } | null>;
    for (const terminal of ["start", "end"] as const) {
      const b = this.getBinding(arrowId, terminal);
      const shape = b && this.getValidShape(b.toId);
      targets[terminal] = shape && localBox(shape) ? { shape, anchor: b.anchor } : null;
    }
    // Aim each end at the other end's anchor (or its free position), then clip to the edge.
    const aim = (t: Terminal) => {
      const target = targets[t];
      if (!target) return ends[t];
      const box = localBox(target.shape)!;
      return toPage(target.shape, { x: target.anchor.x * box.w, y: target.anchor.y * box.h });
    };
    const props = arrow.props as { route?: string };
    let start: Vec;
    let end: Vec;
    let axis: Axis | null = null;
    if (props.route === "straight") {
      start = targets.start
        ? boundEndpoint(targets.start.shape, targets.start.anchor, aim("end"))
        : ends.start;
      end = targets.end
        ? boundEndpoint(targets.end.shape, targets.end.anchor, aim("start"))
        : ends.end;
    } else {
      // Elbows leave each shape from the side facing the other end, level with the anchor.
      axis = axisBetween(aim("start"), aim("end"));
      const side = (t: Terminal, other: Terminal) => {
        const bounds = this.getBounds(targets[t]!.shape.id)!;
        return elbowEndpoint(bounds, aim(t), aim(other), axis!, EDGE_GAP);
      };
      start = targets.start ? side("start", "end") : ends.start;
      end = targets.end ? side("end", "start") : ends.end;
    }
    this.writePatches({
      [arrowId]: {
        x: start.x,
        y: start.y,
        rotation: 0,
        props: { ...(arrow.props as object), path: [0, 0, end.x - start.x, end.y - start.y], axis },
      },
    });
  }

  /**
   * Sets props (fill, sides, …) on every selected shape that already has them, so a change never
   * adds fields a shape doesn't use. Only the selection changes; new shapes still start from
   * their defaults.
   */
  setStyle(
    patch: Partial<StyleProps & ShapeKnobs>,
    /** For continuous controls (sliders) inside start/endGesture: don't split the undo step. */
    { transient = false }: { transient?: boolean } = {},
  ) {
    const patches: Record<string, ShapePatch> = {};
    for (const id of this.ui.selectedIds) {
      const shape = this.getValidShape(id);
      if (!shape || shape.locked) continue;
      const next = withStyle(shape.props, patch);
      if (next !== shape.props) patches[id] = { props: next };
    }
    const apply = () =>
      this.transact(() => {
        this.updateShapes(patches);
        // Switching straight/elbow moves where attached ends sit.
        if ("route" in patch) Object.keys(patches).forEach((id) => this.rerouteArrow(id));
      });
    if (transient) return apply();
    this.markHistory();
    apply();
    this.markHistory();
  }

  /**
   * Sets each selected shape's rotation to `degrees`, turning it about its own centre (like the
   * rotate handle) rather than its top-left corner, so it doesn't swing away.
   */
  setRotation(degrees: number, { transient = false }: { transient?: boolean } = {}) {
    const rotation = normalizeDegrees(degrees);
    const patches: Record<string, ShapePatch> = {};
    for (const id of this.ui.selectedIds) {
      const shape = this.getValidShape(id);
      const def = shape && shapeRegistry.get(shape.type);
      if (!shape || !def || shape.locked || shape.rotation === rotation) continue;
      // The shape's own centre, from its bounds with no position or rotation applied.
      const local = def.getBounds({ ...shape, x: 0, y: 0, rotation: 0 });
      const centre = { x: local.x + local.w / 2, y: local.y + local.h / 2 };
      const pivot = toPage(shape, centre);
      const turned = toPage({ ...shape, x: 0, y: 0, rotation }, centre);
      patches[id] = { x: pivot.x - turned.x, y: pivot.y - turned.y, rotation };
    }
    if (transient) return this.updateShapes(patches);
    this.markHistory();
    this.updateShapes(patches);
    this.markHistory();
  }

  deleteShapes(ids: string[]) {
    if (!ids.length) return;
    const gone = new Set(ids);
    this.transact(() => {
      for (const id of ids) this.board.shapes.delete(id);
      // Arrows pointing at a deleted shape stay where they are, just no longer attached.
      const stale: string[] = [];
      this.board.bindings.forEach((b, key) => {
        const binding = b as Binding;
        if (gone.has(binding.arrowId) || gone.has(binding.toId)) stale.push(key);
      });
      stale.forEach((key) => this.board.bindings.delete(key));
    });
    this.select(this.ui.selectedIds.filter((id) => !ids.includes(id)));
  }

  /**
   * Moves shapes up or down the stack. Only the moved shapes get new index keys, so a concurrent
   * reorder of other shapes by someone else never conflicts.
   */
  reorder(ids: string[], move: ZOrderMove) {
    const moving = new Set(ids.filter((id) => this.board.shapes.has(id)));
    if (!moving.size) return;
    const order = this.sortedIds();

    let next: string[];
    if (move === "front")
      next = [...order.filter((id) => !moving.has(id)), ...order.filter((id) => moving.has(id))];
    else if (move === "back")
      next = [...order.filter((id) => moving.has(id)), ...order.filter((id) => !moving.has(id))];
    else {
      next = [...order];
      // Each moving shape hops over its nearest non-moving neighbour, so a group keeps its shape.
      if (move === "forward") {
        for (let i = next.length - 2; i >= 0; i--) {
          if (moving.has(next[i]) && !moving.has(next[i + 1]))
            [next[i], next[i + 1]] = [next[i + 1], next[i]];
        }
      } else {
        for (let i = 1; i < next.length; i++) {
          if (moving.has(next[i]) && !moving.has(next[i - 1]))
            [next[i], next[i - 1]] = [next[i - 1], next[i]];
        }
      }
    }
    if (next.join() === order.join()) return;

    const keys = new Map(order.map((id) => [id, this.getShape(id)!.index]));
    const patches: Record<string, ShapePatch> = {};
    next.forEach((id, i) => {
      if (!moving.has(id)) return;
      const before = i > 0 ? keys.get(next[i - 1])! : null;
      const after = next.slice(i + 1).find((other) => !moving.has(other));
      const afterKey = after ? keys.get(after)! : null;
      let key: string;
      try {
        key = generateKeyBetween(before, afterKey);
      } catch {
        // Neighbours share a key (rare concurrent case); go just above the lower one instead.
        key = generateKeyBetween(before, null);
      }
      keys.set(id, key);
      patches[id] = { index: key };
    });
    this.markHistory();
    this.updateShapes(patches);
    this.markHistory();
  }

  /**
   * Coalesces writes during a continuous gesture to at most one per animation frame. The latest
   * call wins; `flush` writes it immediately (on pointer up).
   */
  writeEachFrame(write: () => void) {
    this.pendingWrite = write;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => this.flush());
  }

  flush() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    const write = this.pendingWrite;
    this.pendingWrite = null;
    write?.();
  }

  /* ── Frozen shapes ────────────────────────────────────────────────────── */

  /**
   * While Konva transforms a node (scaling it), we keep drawing these shapes from a snapshot taken
   * at the start, so live writes for other clients don't resize the node a second time locally.
   */
  freeze(ids: string[]) {
    for (const id of ids) {
      const s = this.getShape(id);
      if (s) this.frozen.set(id, s);
    }
    this.frozenChanged.emit();
  }

  unfreeze() {
    if (!this.frozen.size) return;
    this.frozen.clear();
    this.frozenChanged.emit();
  }

  frozenShape(id: string): Shape | undefined {
    return this.frozen.get(id);
  }

  /* ── History ──────────────────────────────────────────────────────────── */

  /** Starts a new undo step, so the next edit doesn't merge with the previous one. */
  markHistory() {
    this.undoManager.stopCapturing();
  }

  /**
   * Everything until `endGesture` undoes as one step, however long the gesture takes. (Edits are
   * otherwise merged only when they're less than CAPTURE_MS apart, so pausing mid-drag would
   * split it.)
   */
  startGesture() {
    this.flush();
    this.undoManager.stopCapturing();
    this.undoManager.captureTimeout = Infinity;
  }

  endGesture() {
    this.flush();
    this.undoManager.captureTimeout = CAPTURE_MS;
    this.undoManager.stopCapturing();
  }

  undo() {
    this.flush();
    this.undoManager.undo();
    this.pruneSelection();
  }

  redo() {
    this.flush();
    this.undoManager.redo();
    this.pruneSelection();
  }

  /** Drops selected ids whose shapes no longer exist (deleted remotely, or undone). */
  pruneSelection() {
    const { selectedIds } = this.ui;
    const alive = selectedIds.filter((id) => this.board.shapes.has(id));
    if (alive.length !== selectedIds.length) this.select(alive);
  }
}

/** Style props the style panel edits. Shapes opt in simply by having these keys in their props. */
export type StyleProps = { fill: string; stroke: string; strokeWidth: number; radius: number };

/** Per-shape geometry the panel can edit. */
export type ShapeKnobs = {
  sides: number;
  points: number;
  innerRatio: number;
  color: string;
  fontSize: number;
  arrowStart: boolean;
  arrowEnd: boolean;
  route: "elbow" | "straight";
};

/** Any angle as its equivalent in (-180, 180], so 180 reads as 180 rather than -180. */
export function normalizeDegrees(deg: number): number {
  const d = 180 - ((((180 - deg) % 360) + 360) % 360);
  return Math.round(d * 10) / 10;
}

/** Applies the keys `props` already has. Returns `props` itself when nothing changes. */
function withStyle<P>(props: P, style: Partial<StyleProps & ShapeKnobs>): P {
  if (!props || typeof props !== "object") return props;
  const out = { ...props } as Record<string, unknown>;
  let changed = false;
  for (const [key, value] of Object.entries(style)) {
    if (key in out && out[key] !== value) {
      out[key] = value;
      changed = true;
    }
  }
  return changed ? (out as P) : props;
}
