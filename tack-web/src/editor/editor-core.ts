import { generateKeyBetween } from "fractional-indexing";
import Konva from "konva";
import RBush from "rbush";
import * as Y from "yjs";

import { arrange as arrangeLayout, type ArrangeEdge, type ArrangeMode } from "./arrange";
import { assetUrl, IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/api";
import { orthogonalRoute, type RouteEnd } from "./routing";
import { MIN_ZOOM, useEditorStore } from "@/stores/editor";
import { shapeRegistry } from "./shapes/registry";
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

/** Most shapes (besides the two it joins) a single arrow's route steers round. */
const MAX_OBSTACLES = 24;

/** How close (screen pixels) an arrow end must come to a connection point to snap to it. */
export const PORT_SNAP = 12;

/** Where an arrow end would attach: a shape's connection point. */
export type Connection = { shapeId: string; port: number; anchor: Vec; point: Vec };

/** Separate edits closer together than this undo as one step (e.g. arrow-key nudges). */
const CAPTURE_MS = 400;

type ShapeInit = Pick<Shape, "type" | "x" | "y"> & Partial<Omit<Shape, "id" | "type" | "x" | "y">>;
type ShapePatch = Partial<Omit<Shape, "id" | "type">>;

/** Which edge or centre line `align` lines things up by. */
export type AlignEdge = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

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
const GEOMETRY_KEYS = new Set(["x", "y", "rotation", "props", "type", "groups"]);

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
    groups: readGroups(m.get("groups")),
    opacity: readOpacity(m.get("opacity")),
  };
}

/**
 * Bottom-to-top order: containers first, then by index. Ties (two clients picking the same key
 * at once) break by id so every client agrees.
 */
const readOpacity = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;

const readGroups = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((g): g is string => typeof g === "string") : [];

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
      const outer = shape?.groups?.at(-1);
      const b = outer
        ? unionBox(this.membersOf(outer).map((m) => this.getBounds(m)))
        : this.getBounds(id);
      if (!shape || !b) continue;
      const parentId = this.containerAt({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      if (parentId !== shape.parentId) patches[id] = { parentId };
    }
    if (Object.keys(patches).length) this.transact(() => this.writePatches(patches));
  }

  /**
   * Lines and arrows have padded bounds (for arrowheads) that would snap oddly, so they're never
   * snap targets, and are snapped by their ends' box only.
   */
  isLinear(id: string): boolean {
    const type = this.getShape(id)?.type;
    return !!type && !!shapeRegistry.get(type)?.getHandles;
  }

  /** Bounds of the shapes in view, other than `exclude`, for moves and resizes to snap to. */
  snapTargets(exclude: Iterable<string>): Box[] {
    const skip = new Set(exclude);
    const { camera } = this.ui;
    const view = {
      x: -camera.x / camera.zoom,
      y: -camera.y / camera.zoom,
      w: (this.stage?.width() ?? window.innerWidth) / camera.zoom,
      h: (this.stage?.height() ?? window.innerHeight) / camera.zoom,
    };
    return this.shapesInBox(view)
      .filter((id) => !skip.has(id) && !this.isLinear(id))
      .map((id) => this.getBounds(id))
      .filter((b): b is Box => !!b);
  }

  /* ── Groups ─────────────────────────────────────────────────────────── */

  groupsOf(id: string): string[] {
    return readGroups(this.board.shapes.get(id)?.get("groups"));
  }

  /** Every shape in a group (including its subgroups). */
  membersOf(groupId: string): string[] {
    const out: string[] = [];
    this.board.shapes.forEach((m, id) => {
      if (readGroups(m.get("groups")).includes(groupId)) out.push(id);
    });
    return out;
  }

  /** A group and the groups around it, innermost first, as a member would store them. */
  private groupPath(groupId: string): string[] {
    const member = this.membersOf(groupId)[0];
    const groups = member ? this.groupsOf(member) : [];
    const i = groups.indexOf(groupId);
    return i >= 0 ? groups.slice(i) : [groupId];
  }

  /**
   * The group a click on `id` picks: its outermost group, or, inside a group you've
   * double-clicked into, its outermost group within that one. Null when it picks the shape alone.
   */
  unitGroup(id: string): string | null {
    let groups = this.groupsOf(id);
    const editing = this.ui.editingGroupId;
    if (editing) {
      const i = groups.indexOf(editing);
      if (i >= 0) groups = groups.slice(0, i);
    }
    return groups.at(-1) ?? null;
  }

  /** What a click on `id` selects: its group's shapes, or just it. */
  unitOf(id: string): string[] {
    const g = this.unitGroup(id);
    return g ? this.membersOf(g) : [id];
  }

  /** `ids` widened to whole groups, as clicks and box selection pick them. */
  expandToUnits(ids: string[]): string[] {
    const out = new Set<string>();
    const done = new Set<string>();
    for (const id of ids) {
      const g = this.unitGroup(id);
      if (!g) out.add(id);
      else if (!done.has(g)) {
        done.add(g);
        this.membersOf(g).forEach((m) => out.add(m));
      }
    }
    return [...out];
  }

  /** The whole groups among `ids` (at the current level). */
  groupsIn(ids: string[]): string[] {
    const selected = new Set(ids);
    const found = new Set<string>();
    for (const id of ids) {
      const g = this.unitGroup(id);
      if (g && this.membersOf(g).every((m) => selected.has(m))) found.add(g);
    }
    return [...found];
  }

  /** How many separately selectable things `ids` covers: whole groups count once. */
  unitCount(ids: string[]): number {
    const units = new Set(ids.map((id) => this.unitGroup(id) ?? id));
    return units.size;
  }

  /**
   * Puts `ids` (whole groups, as selected) in a new group, as one undo step. Inside a group
   * you've double-clicked into, the new group nests in it. Returns the group id.
   */
  group(ids: string[]): string | null {
    if (this.readOnly || this.unitCount(ids) < 2) return null;
    const id = crypto.randomUUID();
    const editing = this.ui.editingGroupId;
    const patches: Record<string, ShapePatch> = {};
    for (const member of this.expandToUnits(ids)) {
      const groups = this.groupsOf(member);
      // Just inside the group being edited (or outermost), so it wraps the selected groups.
      const at = editing && groups.includes(editing) ? groups.indexOf(editing) : groups.length;
      patches[member] = { groups: [...groups.slice(0, at), id, ...groups.slice(at)] };
    }
    this.markHistory();
    this.updateShapes(patches);
    this.markHistory();
    return id;
  }

  /** Splits the whole groups among `ids` back into their parts, as one undo step. */
  ungroup(ids: string[]): boolean {
    const groups = this.groupsIn(ids);
    if (this.readOnly || !groups.length) return false;
    const gone = new Set(groups);
    const patches: Record<string, ShapePatch> = {};
    for (const g of groups) {
      for (const member of this.membersOf(g)) {
        patches[member] = { groups: this.groupsOf(member).filter((x) => !gone.has(x)) };
      }
    }
    this.markHistory();
    this.updateShapes(patches);
    this.markHistory();
    return true;
  }

  /** Drops groups that have fewer than two shapes left (after a delete or a cut). */
  private dissolveSingletons() {
    const counts = new Map<string, number>();
    this.board.shapes.forEach((m) => {
      for (const g of readGroups(m.get("groups"))) counts.set(g, (counts.get(g) ?? 0) + 1);
    });
    const lonely = new Set([...counts].filter(([, n]) => n < 2).map(([g]) => g));
    if (!lonely.size) return;
    this.board.shapes.forEach((m) => {
      const groups = readGroups(m.get("groups"));
      if (groups.some((g) => lonely.has(g)))
        m.set(
          "groups",
          groups.filter((g) => !lonely.has(g)),
        );
    });
  }

  /**
   * Reroutes arrows (all of them by default) in one transaction. Routes avoid shapes found
   * through the spatial index, which only updates after a transaction, so code that builds
   * shapes and arrows together calls this afterwards for routes that see everything.
   */
  rerouteArrows(ids: string[] = this.sortedIds()) {
    this.transact(() => {
      for (const id of ids) if (this.getShape(id)?.type === "arrow") this.rerouteArrow(id);
    });
  }

  /** Moves and zooms the camera so everything on the board fits on screen, with a margin. */
  zoomToFit({
    maxZoom = 1,
    margin = 96,
    box = this.contentBounds(),
  }: { maxZoom?: number; margin?: number; box?: Box | null } = {}) {
    if (!box) return;
    const w = this.stage?.width() ?? window.innerWidth;
    const h = this.stage?.height() ?? window.innerHeight;
    const zoom = Math.max(
      MIN_ZOOM,
      Math.min(
        maxZoom,
        (w - margin * 2) / Math.max(box.w, 1),
        (h - margin * 2) / Math.max(box.h, 1),
      ),
    );
    this.ui.setCamera({
      zoom,
      x: w / 2 - (box.x + box.w / 2) * zoom,
      y: h / 2 - (box.y + box.h / 2) * zoom,
    });
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
      // Drawn inside a group you've double-clicked into: it joins that group.
      ...(this.ui.editingGroupId ? { groups: this.groupPath(this.ui.editingGroupId) } : {}),
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
    // Also steer round other shapes near the way, not just the two being joined. Containers
    // (frames) are left out: routes may pass into them. Capped, to keep rerouting cheap.
    const bound = new Set(
      obstacles.length
        ? [this.getBinding(arrowId, "start")?.toId, this.getBinding(arrowId, "end")?.toId]
        : [],
    );
    const span = unionBox([
      { x: ends.start.point.x, y: ends.start.point.y, w: 0, h: 0 },
      { x: ends.end.point.x, y: ends.end.point.y, w: 0, h: 0 },
      ...obstacles,
    ])!;
    const margin = 40;
    for (const id of this.shapesInBox({
      x: span.x - margin,
      y: span.y - margin,
      w: span.w + margin * 2,
      h: span.h + margin * 2,
    })) {
      if (obstacles.length >= MAX_OBSTACLES) break;
      if (id === arrowId || bound.has(id) || this.isLinear(id) || this.isContainer(id)) continue;
      if (this.getShape(id)?.type === "text") continue; // labels sit inside boxes anyway
      const b = this.getBounds(id);
      if (b) obstacles.push(b);
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
      this.dissolveSingletons();
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
      const opacity =
        shape.opacity !== undefined && shape.opacity < 1 ? ` opacity="${shape.opacity}"` : "";
      parts.push(`<g transform="${transform}"${opacity}>${def.toSvg(shape)}</g>`);
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
    // Pasted shapes form their own groups, separate from the ones they were copied from.
    const newGroups = new Map<string, string>();
    const regroup = (groups: unknown) =>
      readGroups(groups).map((g) => {
        if (!newGroups.has(g)) newGroups.set(g, crypto.randomUUID());
        return newGroups.get(g)!;
      });
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
          groups: regroup(shape.groups),
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

  /** What this tab last copied, for pasting when the system clipboard can't be read. */
  private lastCopied = "";
  /** Pasting the same copy again cascades instead of stacking exactly on the last paste. */
  private pasteRun = { text: "", pastes: 0 };

  /** Records a copy (or cut). After a cut, the first paste goes back where the shapes were. */
  noteCopied(text: string, { cut = false }: { cut?: boolean } = {}) {
    this.lastCopied = text;
    this.pasteRun = { text, pastes: cut ? 0 : 1 };
  }

  /** Pastes clipboard text, cascading repeat pastes. Null if it isn't Tack shapes. */
  pasteText(text: string): string[] | null {
    if (text !== this.pasteRun.text) this.pasteRun = { text, pastes: 1 };
    const nudge = this.pasteRun.pastes * PASTE_NUDGE;
    const ids = this.pasteSerialized(text, { x: nudge, y: nudge });
    if (ids) this.pasteRun.pastes++;
    return ids;
  }

  /** Copies (or cuts) shapes to the system clipboard, for menus rather than key presses. */
  async copy(ids: string[], { cut = false }: { cut?: boolean } = {}) {
    const text = this.serialize(ids);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard access: pasting in this tab still works from `lastCopied`.
    }
    this.noteCopied(text, { cut });
    if (cut && !this.readOnly) {
      this.markHistory();
      this.deleteShapes(this.unlocked(ids));
    }
  }

  /** Pastes from the system clipboard if it holds Tack shapes, else what this tab last copied. */
  async paste() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Clipboard reads need permission; fall back to this tab's copy.
    }
    if (!text.startsWith(CLIPBOARD_PREFIX)) text = this.lastCopied;
    if (text) this.pasteText(text);
  }

  /** The shapes among `ids` that aren't locked. Locked shapes can't be moved, edited or deleted. */
  unlocked(ids: string[]): string[] {
    return ids.filter((id) => {
      const s = this.getShape(id);
      return s && !s.locked;
    });
  }

  /**
   * Sets the opacity (0–1) of the shapes among `ids` that aren't locked. `transient` (a slider
   * mid-drag, inside start/endGesture) doesn't start a new undo step.
   */
  setOpacity(ids: string[], opacity: number, { transient = false }: { transient?: boolean } = {}) {
    const value = Math.round(Math.min(1, Math.max(0, opacity)) * 100) / 100;
    const patches = Object.fromEntries(this.unlocked(ids).map((id) => [id, { opacity: value }]));
    if (!transient) this.markHistory();
    this.updateShapes(patches);
    if (!transient) this.markHistory();
  }

  /* ── Alignment ──────────────────────────────────────────────────────── */

  /** Selected things as they move: whole groups (at the current level) or single shapes. */
  private alignUnits(ids: string[]): string[][] {
    const seen = new Map<string, string[]>();
    for (const id of ids) {
      if (this.isLinear(id)) continue; // arrows and lines follow what they're attached to
      const key = this.unitGroup(id) ?? id;
      if (!seen.has(key))
        seen.set(
          key,
          this.unitOf(id).filter((m) => !this.isLinear(m)),
        );
    }
    return [...seen.values()].filter((members) => members.length);
  }

  /**
   * The shape `ids` are layered on: the topmost shape beneath them (lower in the stack) whose box
   * holds their middle. Frames count; text and lines don't.
   */
  shapeUnder(ids: string[]): string | null {
    const moving = new Set(this.expandToUnits(ids));
    const box = unionBox([...moving].map((id) => this.getBounds(id)));
    if (!box) return null;
    const order = this.sortedIds();
    const lowest = Math.min(...[...moving].map((id) => order.indexOf(id)).filter((i) => i >= 0));
    const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const under = this.shapesInBox({ x: centre.x, y: centre.y, w: 0, h: 0 }).filter((id) => {
      if (moving.has(id) || this.isLinear(id) || this.getShape(id)?.type === "text") return false;
      // Containers draw below everything, so they're always "under", whatever their index.
      return this.isContainer(id) || order.indexOf(id) < lowest;
    });
    return under.at(-1) ?? null;
  }

  /**
   * What `ids` would line up with: the box round them all when there are several things, or the
   * shape a single thing sits on. Null when there's nothing to align to.
   */
  alignTarget(ids: string[]): { box: Box; under: string | null } | null {
    const units = this.alignUnits(ids);
    if (units.length >= 2) {
      const box = unionBox(units.flat().map((id) => this.getBounds(id)));
      return box ? { box, under: null } : null;
    }
    if (units.length !== 1) return null;
    const under = this.shapeUnder(units[0]);
    const box = under && this.getBounds(under);
    return box ? { box, under } : null;
  }

  /** Lines things up by an edge or centre (see `alignTarget`). One undo step. */
  align(ids: string[], edge: AlignEdge): boolean {
    const target = this.alignTarget(ids);
    if (!target || this.readOnly) return false;
    const t = target.box;
    const patches: Record<string, ShapePatch> = {};
    for (const members of this.alignUnits(ids)) {
      const b = unionBox(members.map((id) => this.getBounds(id)));
      if (!b) continue;
      const dx =
        edge === "left"
          ? t.x - b.x
          : edge === "centerX"
            ? t.x + t.w / 2 - (b.x + b.w / 2)
            : edge === "right"
              ? t.x + t.w - (b.x + b.w)
              : 0;
      const dy =
        edge === "top"
          ? t.y - b.y
          : edge === "centerY"
            ? t.y + t.h / 2 - (b.y + b.h / 2)
            : edge === "bottom"
              ? t.y + t.h - (b.y + b.h)
              : 0;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
      for (const id of this.unlocked(members)) {
        const s = this.getShape(id)!;
        patches[id] = { x: s.x + dx, y: s.y + dy };
      }
    }
    if (!Object.keys(patches).length) return false;
    this.markHistory();
    this.updateShapes(patches);
    this.markHistory();
    return true;
  }

  /* ── Auto-arrange ───────────────────────────────────────────────────── */

  /** Whether auto-arrange works on `ids` (two or more things) rather than the whole board. */
  arrangesSelection(ids: string[]): boolean {
    return this.alignUnits(ids).length >= 2;
  }

  /**
   * What auto-arrange moves, as units (a group, a frame with what's in it, or a shape): the
   * selection when it holds two or more things, otherwise everything on the board. Arrows follow
   * what they connect; locked things and things inside a frame being moved stay put.
   */
  arrangeUnits(ids: string[]): { key: string; members: string[] }[] {
    const scope = this.arrangesSelection(ids) ? ids : this.sortedIds();
    const containers = new Set(scope.filter((id) => this.isContainer(id)));
    const units: { key: string; members: string[] }[] = [];
    for (const members of this.alignUnits(scope)) {
      // Already carried by a frame that's moving.
      if (members.every((m) => containers.has(this.getShape(m)?.parentId ?? ""))) continue;
      if (members.some((m) => this.getShape(m)?.locked)) continue;
      units.push({ key: this.unitGroup(members[0]) ?? members[0], members });
    }
    return units;
  }

  /** Lays things out (see `arrangeUnits`) with one of the `arrange.ts` layouts. One undo step. */
  arrange(ids: string[], mode: ArrangeMode): boolean {
    if (this.readOnly) return false;
    const units = this.arrangeUnits(ids)
      .map((u) => ({ ...u, box: unionBox(u.members.map((id) => this.getBounds(id))) }))
      .filter((u): u is typeof u & { box: Box } => !!u.box);
    if (units.length < 2) return false;
    // Reading order (rows top to bottom, then left to right), which the layouts keep where
    // they can.
    const row = (b: Box) => Math.round((b.y + b.h / 2) / 80);
    units.sort((a, b) => row(a.box) - row(b.box) || a.box.x - b.box.x);

    // Arrows between units become the layout's connections.
    const unitOf = new Map<string, string>();
    for (const u of units) {
      for (const m of u.members) unitOf.set(m, u.key);
      if (this.isContainer(u.members[0]))
        for (const c of this.childrenOf(u.members[0])) unitOf.set(c, u.key);
    }
    const edges: ArrangeEdge[] = [];
    for (const id of this.sortedIds()) {
      if (this.getShape(id)?.type !== "arrow") continue;
      const from = unitOf.get(this.getBinding(id, "start")?.toId ?? "");
      const to = unitOf.get(this.getBinding(id, "end")?.toId ?? "");
      if (from && to) edges.push({ from, to });
    }

    const nodes = units.map((u) => ({ id: u.key, w: u.box.w, h: u.box.h }));
    const pos = arrangeLayout(nodes, edges, mode);
    // The layout starts where the things it moved started.
    const origin = unionBox(units.map((u) => u.box))!;
    const patches: Record<string, ShapePatch> = {};
    const moved: string[] = [];
    for (const u of units) {
      const p = pos.get(u.key);
      if (!p) continue;
      const [dx, dy] = [origin.x + p.x - u.box.x, origin.y + p.y - u.box.y];
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) continue;
      // The whole unit, lines in a group included; bound arrows are rerouted afterwards anyway.
      for (const id of this.withChildren(this.unitOf(u.members[0]))) {
        const s = this.getShape(id);
        if (!s || patches[id]) continue;
        patches[id] = { x: s.x + dx, y: s.y + dy };
        moved.push(id);
      }
    }
    if (!moved.length) return false;
    this.markHistory();
    this.updateShapes(patches);
    this.updateParents(moved.filter((id) => !this.isContainer(id)));
    this.rerouteArrows();
    this.markHistory();
    // Bring the result into view if it spread off screen (never zooming in).
    const box = unionBox(units.flatMap((u) => u.members.map((id) => this.getBounds(id))));
    const { camera } = this.ui;
    const [vw, vh] = [
      this.stage?.width() ?? window.innerWidth,
      this.stage?.height() ?? window.innerHeight,
    ];
    if (
      box &&
      (box.x * camera.zoom + camera.x < 0 ||
        box.y * camera.zoom + camera.y < 0 ||
        (box.x + box.w) * camera.zoom + camera.x > vw ||
        (box.y + box.h) * camera.zoom + camera.y > vh)
    )
      this.zoomToFit({ box, maxZoom: camera.zoom });
    return true;
  }

  /** Locks or unlocks shapes, as one undo step. */
  setLocked(ids: string[], locked: boolean) {
    this.markHistory();
    this.updateShapes(Object.fromEntries(ids.map((id) => [id, { locked }])));
    this.markHistory();
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
  /** Which look a shape with `variants` uses. */
  variant: string;
  /** Text renders markdown (true) or shows its source as typed. */
  markdown: boolean;
  /** Text wraps at this width; null grows to fit. */
  width: number | null;
  align: "left" | "center" | "right";
  lineHeight: number;
  letterSpacing: number;
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
