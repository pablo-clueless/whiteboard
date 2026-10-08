import { generateKeyBetween } from "fractional-indexing";
import Konva from "konva";
import RBush from "rbush";
import * as Y from "yjs";

import { assetUrl, IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/api";
import { orthogonalRoute, type RouteEnd } from "./routing";
import { shapeRegistry } from "./shapes/registry";
import { useEditorStore } from "@/stores/editor";
import type { BoardDoc } from "./sync/board-doc";
import { whenImageLoaded } from "./shapes/image";
import type { Box, Shape, Vec } from "./types";
import { arrowHeadSize } from "./shapes/line";
import { onFontsLoaded } from "./fonts";
import { unionBox } from "./geometry";
import {
  anchorPoint,
  type Binding,
  bindingId,
  containsPoint,
  exitDirection,
  localBox,
  portsOf,
  type Terminal,
  toAnchor,
  toPage,
} from "./bindings";

/** Transaction origin for this client's own edits. The undo manager tracks only these. */
export const LOCAL_ORIGIN = "local";

const VIEWER_TOOLS = ["select", "hand"];

/** Inserted images are scaled down to at most this many screen pixels on their longer side. */
const IMAGE_MAX_SCREEN = 480;
/** White margin around exported PNGs, in page units. */
const EXPORT_PADDING = 24;

const nextFrames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number): void => {
      if (left) requestAnimationFrame(() => step(left - 1));
      else resolve();
    };
    step(n);
  });

/** Marks clipboard text as Tack shapes, so pasting other text never creates junk. */
const CLIPBOARD_PREFIX = "tack/shapes:";
/** How far pasted and duplicated shapes land from the originals, in page units. */
export const PASTE_NUDGE = 16;

type ClipboardData = { shapes: Shape[]; bindings: Binding[] };

/** How close (screen pixels) an arrow end must come to a connection point to snap to it. */
export const PORT_SNAP = 12;

/** Where an arrow end would attach: a shape's connection point. */
export type Connection = { shapeId: string; port: number; anchor: Vec; point: Vec };

/** Separate edits closer together than this undo as one step (e.g. arrow-key nudges). */
const CAPTURE_MS = 400;

type ShapeInit = Pick<Shape, "type" | "x" | "y"> & Partial<Omit<Shape, "id" | "type" | "x" | "y">>;
type ShapePatch = Partial<Omit<Shape, "id" | "type">>;

export type ZOrderMove = "forward" | "backward" | "front" | "back";

type IndexItem = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  id: string;
  z: string;
  /** 0 for containers (frames), which draw below everything else; 1 for other shapes. */
  rank: number;
};

/** Edits to these fields can move a shape into or out of a container. */
const GEOMETRY_KEYS = new Set(["x", "y", "rotation", "props", "type"]);

type ZEntry = { id: string; z: string; rank: number };

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
    v: (m.get("v") as number | undefined) ?? 1,
  };
}

/**
 * Bottom-to-top order: containers first, then by index. Ties (two clients picking the same key
 * at once) break by id so every client agrees.
 */
const byZ = (a: ZEntry, b: ZEntry) =>
  a.rank - b.rank || (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : 1);

const rankOf = (type: unknown) =>
  typeof type === "string" && shapeRegistry.get(type)?.isContainer ? 0 : 1;

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
  /** Bumped with every `indexChanged`, for useSyncExternalStore snapshots. */
  indexVersion = 0;
  /** Fires when a shape starts or stops being drawn from a frozen snapshot. */
  readonly frozenChanged = new Signal();

  private pendingWrite: (() => void) | null = null;
  private frame = 0;
  private spatial = new RBush<IndexItem>();
  private indexItems = new Map<string, IndexItem>();
  private frozen = new Map<string, Shape>();
  /** Shapes this client moved or added, to re-file into containers once the edit settles. */
  private toRefile = new Set<string>();

  /** Opened with a view link. The server drops a viewer's edits anyway. */
  private readonly viewOnly: boolean;

  /**
   * Nothing writes to the board: a view link, a board saved by a newer Tack than this one
   * (editing it could write data the newer version doesn't expect), or a board the server says
   * is full (it would drop the edits).
   */
  get readOnly(): boolean {
    const { outdated, boardFull } = this.ui;
    return this.viewOnly || outdated || boardFull;
  }
  /** Uploads an image for this board and returns its asset id. Set by the app. */
  private uploadAsset: ((file: Blob) => Promise<{ assetId: string }>) | null = null;
  readonly notify: (message: string, kind?: "error" | "info") => void;

  constructor(
    readonly board: BoardDoc,
    {
      readOnly = false,
      notify = () => {},
    }: {
      readOnly?: boolean;
      /** Shows a short message to the person using the editor (e.g. a toast). */
      notify?: (message: string, kind?: "error" | "info") => void;
    } = {},
  ) {
    this.viewOnly = readOnly;
    this.notify = notify;
    this.undoManager = new Y.UndoManager([board.shapes, board.bindings], {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
      captureTimeout: CAPTURE_MS,
    });
    board.shapes.forEach((_, id) => this.reindex(id));
    board.shapes.observeDeep(this.onShapesChanged);
    // Text is measured in its font; a font arriving late changes text bounds.
    this.offFonts = onFontsLoaded(() => {
      this.board.shapes.forEach((_, id) => this.reindex(id));
      this.indexVersion++;
      this.indexChanged.emit();
    });
  }

  private offFonts: () => void;

  setAssetUploader(upload: ((file: Blob) => Promise<{ assetId: string }>) | null) {
    this.uploadAsset = upload;
  }

  attachStage(stage: Konva.Stage | null) {
    this.stage = stage;
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.board.shapes.unobserveDeep(this.onShapesChanged);
    this.offFonts();
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
    const entries: ZEntry[] = [];
    this.board.shapes.forEach((m, id) =>
      entries.push({ id, z: (m.get("index") as string) ?? "a0", rank: rankOf(m.get("type")) }),
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

  /**
   * The topmost shape drawn at a screen point, using Konva's hit canvas, so thin lines count
   * with their padded hit area.
   */
  shapeAtScreen(screen: Vec): string | null {
    const node = this.stage?.getIntersection(screen);
    return node?.findAncestor(".shape", true)?.id() || null;
  }

  isContainer(id: string): boolean {
    const type = this.board.shapes.get(id)?.get("type");
    return rankOf(type) === 0;
  }

  /** Shapes whose parent is `id`. */
  childrenOf(id: string): string[] {
    const out: string[] = [];
    this.board.shapes.forEach((m, child) => {
      if (m.get("parentId") === id) out.push(child);
    });
    return out;
  }

  /** `ids` plus the children of any containers among them. */
  withChildren(ids: string[]): string[] {
    const out = new Set(ids);
    for (const id of ids) if (this.isContainer(id)) this.childrenOf(id).forEach((c) => out.add(c));
    return [...out];
  }

  /** The topmost container whose box holds a page point. */
  containerAt(point: Vec): string | null {
    const ids = this.shapesInBox({ x: point.x, y: point.y, w: 0, h: 0 }).reverse();
    for (const id of ids) {
      if (!this.isContainer(id)) continue;
      const shape = this.getValidShape(id);
      if (shape && containsPoint(shape, point)) return id;
    }
    return null;
  }

  /**
   * Re-files shapes into the container their centre is in (or none). Pass the shapes that moved
   * or were created; a container in the list re-files everything it now covers or held before.
   */
  updateParents(ids: string[]) {
    const affected = new Set<string>();
    for (const id of ids) {
      if (!this.isContainer(id)) {
        affected.add(id);
        continue;
      }
      this.childrenOf(id).forEach((c) => affected.add(c));
      const b = this.getBounds(id);
      if (b) this.shapesInBox(b).forEach((c) => affected.add(c));
    }
    const patches: Record<string, ShapePatch> = {};
    for (const id of affected) {
      if (this.isContainer(id)) continue;
      const shape = this.getShape(id);
      const b = this.getBounds(id);
      if (!shape || !b) continue;
      const parentId = this.containerAt({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      if (parentId !== shape.parentId) patches[id] = { parentId };
    }
    if (Object.keys(patches).length) this.transact(() => this.writePatches(patches));
  }

  /** The Konva node drawing a shape, for imperative updates during gestures. */
  nodeFor(id: string): Konva.Node | undefined {
    return this.stage?.findOne(`#${id}`);
  }

  /* ── Spatial index ────────────────────────────────────────────────────── */

  private onShapesChanged = (events: Y.YEvent<Y.AbstractType<unknown>>[], txn: Y.Transaction) => {
    const ids = new Set<string>();
    for (const e of events) {
      if (e.target === this.board.shapes) {
        e.changes.keys.forEach((change, id) => {
          ids.add(id);
          if (change.action !== "delete") this.toRefile.add(id);
        });
      } else if (typeof e.path[0] === "string") {
        ids.add(e.path[0]);
        const keys = (e as Y.YMapEvent<unknown>).keysChanged;
        if (keys && [...keys].some((k) => GEOMETRY_KEYS.has(k))) this.toRefile.add(e.path[0]);
      }
    }
    ids.forEach((id) => this.reindex(id));
    if (ids.size) {
      this.indexVersion++;
      this.indexChanged.emit();
    }
    // Our own edits that moved, resized or added shapes may have taken them into or out of a
    // container. Remote edits are filed by whoever made them, so clients never fight over it.
    // Done right away (Yjs runs it as a follow-up transaction) so it lands in the same undo step.
    if (txn.origin !== LOCAL_ORIGIN) {
      this.toRefile.clear();
    } else if (this.toRefile.size) {
      const pending = [...this.toRefile].filter((id) => this.board.shapes.has(id));
      this.toRefile.clear();
      this.updateParents(pending);
    }
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
    const item = {
      ...{ minX: b.x, minY: b.y, maxX: b.x + b.w, maxY: b.y + b.h },
      ...{ id, z: shape.index, rank: rankOf(shape.type) },
    };
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
      // Stamped so a later version of this shape knows which migrations it still needs.
      v: def?.version ?? 1,
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

  /** A shape's connection points on the page, in port order. */
  portsOnPage(id: string): Vec[] {
    const shape = this.getValidShape(id);
    return shape ? portsOf(shape).map((p) => toPage(shape, p)) : [];
  }

  /**
   * Where an arrow end at `point` would connect: the nearest connection point within
   * PORT_SNAP screen pixels of any shape, or, over a shape, its nearest connection point.
   * `nearOnly` skips the second (for the select tool, where pressing a shape means moving it).
   */
  connectionAt(
    point: Vec,
    { excludeId, nearOnly = false }: { excludeId?: string; nearOnly?: boolean } = {},
  ): Connection | null {
    const tol = PORT_SNAP / this.ui.camera.zoom;
    let best: Connection | null = null;
    let bestDist = tol;
    const nearby = this.shapesInBox({ x: point.x - tol, y: point.y - tol, w: tol * 2, h: tol * 2 });
    for (const id of nearby.reverse()) {
      if (id === excludeId) continue;
      const shape = this.getValidShape(id);
      if (!shape || !localBox(shape)) continue;
      portsOf(shape).forEach((local, port) => {
        const p = toPage(shape, local);
        const d = Math.hypot(p.x - point.x, p.y - point.y);
        if (d <= bestDist) {
          bestDist = d;
          best = { shapeId: id, port, anchor: toAnchor(shape, local)!, point: p };
        }
      });
    }
    if (best || nearOnly) return best;
    const shape = this.bindableShapeAt(point, excludeId);
    if (!shape) return null;
    let nearest: Connection | null = null;
    let nearestDist = Infinity;
    portsOf(shape).forEach((local, port) => {
      const p = toPage(shape, local);
      const d = Math.hypot(p.x - point.x, p.y - point.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = { shapeId: shape.id, port, anchor: toAnchor(shape, local)!, point: p };
      }
    });
    return nearest;
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
   * Recomputes an arrow from its ends. A bound end sits exactly on its connection point and
   * leaves straight out of that side; a free end stays where it is. Elbow arrows then find an
   * orthogonal way between the two that doesn't cut through the shapes they connect; straight
   * ones just join the two points. Call inside a transaction when changing an end yourself.
   */
  rerouteArrow(arrowId: string) {
    const arrow = this.getValidShape(arrowId);
    if (!arrow || arrow.type !== "arrow") return;
    const props = arrow.props as { path: number[]; route?: string; strokeWidth: number };
    const path = props.path;
    const ends: Record<Terminal, RouteEnd> = {
      start: { point: toPage(arrow, { x: path[0], y: path[1] }), dir: null },
      end: {
        point: toPage(arrow, { x: path[path.length - 2], y: path[path.length - 1] }),
        dir: null,
      },
    };
    const obstacles: Box[] = [];
    for (const terminal of ["start", "end"] as const) {
      const b = this.getBinding(arrowId, terminal);
      const shape = b && this.getValidShape(b.toId);
      const point = shape && anchorPoint(shape, b.anchor);
      if (!shape || !point) continue;
      ends[terminal] = { point, dir: exitDirection(shape, b.anchor) };
      const bounds = this.getBounds(shape.id);
      if (bounds) obstacles.push(bounds);
    }
    const { start, end } = ends;
    const route =
      props.route === "straight"
        ? [start.point.x, start.point.y, end.point.x, end.point.y]
        : orthogonalRoute(
            start,
            end,
            obstacles,
            Math.max(24, arrowHeadSize(props.strokeWidth) * 1.6),
          );
    const x = start.point.x;
    const y = start.point.y;
    this.writePatches({
      [arrowId]: {
        x,
        y,
        rotation: 0,
        props: {
          ...(arrow.props as object),
          path: route.map((v, i) => v - (i % 2 ? y : x)),
          axis: null,
        },
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

  /** Deletes shapes; deleting a container deletes what's in it too. */
  deleteShapes(ids: string[]) {
    if (!ids.length) return;
    ids = this.withChildren(ids);
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

  /* ── Images ───────────────────────────────────────────────────────────── */

  /**
   * Uploads image files and places them centred on `at` (page space), cascading a little when
   * there are several. Each lands at up to IMAGE_MAX_SCREEN pixels on screen at the current zoom.
   */
  async insertImages(files: File[], at: Vec): Promise<string[]> {
    if (this.readOnly || !this.uploadAsset) return [];
    const ids: string[] = [];
    let offset = 0;
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) {
        this.notify(`${file.name || "That file"} isn't a PNG, JPEG, WebP or GIF image.`, "error");
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        this.notify(`${file.name || "That image"} is over 5 MB.`, "error");
        continue;
      }
      try {
        const bitmap = await createImageBitmap(file);
        const [nw, nh] = [bitmap.width, bitmap.height];
        bitmap.close();
        const { assetId } = await this.uploadAsset(file);
        const scale = Math.min(1, IMAGE_MAX_SCREEN / this.ui.camera.zoom / Math.max(nw, nh));
        const [w, h] = [nw * scale, nh * scale];
        this.markHistory();
        ids.push(
          this.createShape({
            type: "image",
            x: at.x - w / 2 + offset,
            y: at.y - h / 2 + offset,
            props: { assetId, w, h },
          }),
        );
        this.markHistory();
        offset += 24;
      } catch {
        this.notify(`Couldn't add ${file.name || "the image"}. Try again.`, "error");
      }
    }
    if (ids.length) this.select(ids);
    return ids;
  }

  /* ── Export ───────────────────────────────────────────────────────────── */

  /**
   * Renders shapes to a PNG: the given ones, or the whole board. Culling is switched off for the
   * moment it takes, so shapes outside the viewport are drawn too.
   */
  async exportPng(onlyIds?: string[]): Promise<Blob | null> {
    const { ids, wanted, box } = this.exportTarget(onlyIds) ?? {};
    if (!ids || !wanted || !box || !this.stage) return null;
    const pad = EXPORT_PADDING;

    this.ui.setExporting(ids);
    const container = document.createElement("div");
    let off: Konva.Stage | null = null;
    try {
      // Let React mount every exported shape, and let any images finish loading.
      await nextFrames(2);
      await Promise.all(
        ids
          .map((id) => this.getShape(id))
          .filter((s) => s?.type === "image")
          .map((s) => whenImageLoaded((s!.props as { assetId: string }).assetId)),
      );
      await nextFrames(1);
      const layer = this.stage.findOne<Konva.Layer>(".shapes");
      if (!layer) return null;
      const copy = layer.clone({
        x: -box.x + pad,
        y: -box.y + pad,
        scaleX: 1,
        scaleY: 1,
        listening: false,
      });
      copy.find(".shape").forEach((n) => {
        if (!wanted.has(n.id())) n.hide();
      });
      off = new Konva.Stage({ container, width: box.w + pad * 2, height: box.h + pad * 2 });
      const background = new Konva.Layer({ listening: false });
      background.add(
        new Konva.Rect({ width: box.w + pad * 2, height: box.h + pad * 2, fill: "#ffffff" }),
      );
      off.add(background, copy);
      return (await off.toBlob({ pixelRatio: 2, mimeType: "image/png" })) as Blob;
    } finally {
      off?.destroy();
      this.ui.setExporting(null);
    }
  }

  /** The given shapes (or the whole board), bottom to top, and the box around them. */
  private exportTarget(onlyIds?: string[]) {
    const wanted = new Set(onlyIds?.length ? this.withChildren(onlyIds) : this.sortedIds());
    const ids = this.sortedIds().filter((id) => wanted.has(id));
    const box = unionBox(ids.map((id) => this.getBounds(id)));
    return ids.length && box ? { ids, wanted, box } : null;
  }

  /**
   * Renders shapes to a standalone SVG through each ShapeDef's `toSvg`. Images are embedded, so
   * the file works without the server. Shapes whose type has no `toSvg` are left out and
   * counted in `skipped`.
   */
  async exportSvg(onlyIds?: string[]): Promise<{ blob: Blob; skipped: number } | null> {
    const target = this.exportTarget(onlyIds);
    if (!target) return null;
    const { ids, box } = target;
    const pad = EXPORT_PADDING;
    let skipped = 0;
    const assets = new Set<string>();
    const parts: string[] = [];
    for (const id of ids) {
      const shape = this.getValidShape(id);
      const def = shape && shapeRegistry.get(shape.type);
      if (!shape || !def?.toSvg) {
        skipped++;
        continue;
      }
      if (shape.type === "image") assets.add((shape.props as { assetId: string }).assetId);
      const transform = `translate(${shape.x} ${shape.y})${shape.rotation ? ` rotate(${shape.rotation})` : ""}`;
      parts.push(`<g transform="${transform}">${def.toSvg(shape)}</g>`);
    }
    let body = parts.join("\n");
    // Swap each image URL for its bytes.
    await Promise.all(
      [...assets].map(async (assetId) => {
        const url = assetUrl(assetId);
        try {
          const blob = await (await fetch(url)).blob();
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          body = body.split(`href="${url}"`).join(`href="${data}"`);
        } catch {
          // Leave the URL: the image still shows wherever the server is reachable.
        }
      }),
    );
    const [x, y, w, h] = [box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2];
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}">\n` +
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#ffffff"/>\n${body}\n</svg>\n`;
    return { blob: new Blob([svg], { type: "image/svg+xml" }), skipped };
  }

  /* ── Clipboard ────────────────────────────────────────────────────────── */

  /**
   * Serialises shapes, plus the arrow bindings between them, for the clipboard. Bindings to
   * shapes outside the set are dropped: a pasted arrow keeps its position but isn't attached.
   */
  serialize(ids: string[]): string | null {
    const wanted = new Set(this.withChildren(ids));
    const shapes = this.sortedIds()
      .filter((id) => wanted.has(id))
      .map((id) => this.getShape(id)!);
    if (!shapes.length) return null;
    const bindings: Binding[] = [];
    this.board.bindings.forEach((b) => {
      const binding = b as Binding;
      if (wanted.has(binding.arrowId) && wanted.has(binding.toId)) bindings.push(binding);
    });
    return CLIPBOARD_PREFIX + JSON.stringify({ shapes, bindings } satisfies ClipboardData);
  }

  /**
   * Adds shapes from `serialize` with new ids, on top of the stack in their original order, moved
   * by `offset`. Returns the new ids (selected), or null if `text` isn't Tack clipboard data.
   */
  pasteSerialized(text: string, offset: Vec): string[] | null {
    if (this.readOnly || !text.startsWith(CLIPBOARD_PREFIX)) return null;
    let data: ClipboardData;
    try {
      data = JSON.parse(text.slice(CLIPBOARD_PREFIX.length)) as ClipboardData;
      if (!Array.isArray(data.shapes) || !Array.isArray(data.bindings)) return null;
    } catch {
      return null;
    }
    const newIds = new Map(data.shapes.map((s) => [s.id, crypto.randomUUID()]));
    const ids = this.sortedIds();
    let below = ids.length ? this.getShape(ids[ids.length - 1])!.index : null;

    this.markHistory();
    this.transact(() => {
      for (const { id, ...shape } of data.shapes) {
        if (typeof shape.type !== "string") continue;
        below = generateKeyBetween(below, null);
        const record: Omit<Shape, "id"> = {
          ...shape,
          x: (shape.x ?? 0) + offset.x,
          y: (shape.y ?? 0) + offset.y,
          index: below,
          parentId: shape.parentId ? (newIds.get(shape.parentId) ?? null) : null,
        };
        this.board.shapes.set(newIds.get(id)!, new Y.Map(Object.entries(record)));
      }
      for (const b of data.bindings) {
        const arrowId = newIds.get(b.arrowId);
        const toId = newIds.get(b.toId);
        if (!arrowId || !toId) continue;
        this.board.bindings.set(bindingId(arrowId, b.terminal), { ...b, arrowId, toId });
      }
    });
    this.markHistory();
    const pasted = [...newIds.values()].filter((id) => this.board.shapes.has(id));
    this.select(pasted);
    return pasted;
  }

  /** Copies the shapes and pastes them a little down and to the right. */
  duplicate(ids: string[]): string[] {
    const text = this.serialize(ids);
    if (!text) return [];
    return this.pasteSerialized(text, { x: PASTE_NUDGE, y: PASTE_NUDGE }) ?? [];
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
  fontFamily: string;
  fontWeight: number;
  /** A shape's visible name, e.g. a component card's. */
  label: string;
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
