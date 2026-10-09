"use client";

import { Circle, Group, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import { memo, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Awareness } from "y-protocols/awareness";
import Konva from "konva";

import { pageToScreen, screenToPage, useEditorStore, zoomAt } from "@/stores/editor";
import { useFrozenShape, useShape, useVisibleShapeIds } from "./sync/useShapes";
import type { Box, Shape, Tool, ToolEvent, Vec } from "./types";
import { SNAP_DISTANCE, snapPoint } from "./snapping";
import { type Terminal, toPage } from "./bindings";
import { shapeRegistry } from "./shapes/registry";
import { ALIGN_ACTIONS } from "./align-actions";
import { toggleTextStyle } from "./shapes/text";
import { toolRegistry } from "./tools/registry";
import type { Editor } from "./editor-core";
import { RemotePresence } from "./Presence";
import { handTool } from "./tools/hand";
import { unionBox } from "./geometry";

const SELECTION_BLUE = "#3366ff";
/** Gap (screen pixels) between a selected shape and its resize box. */
const TRANSFORM_PAD = 4;
/** Arrow-key nudge distances, in page units. */
const NUDGE = 1;
const NUDGE_BIG = 10;
/** How long the camera must be still before shapes become clickable again after a pan or zoom. */
const HIT_SETTLE_MS = 150;

export function Canvas({ editor, awareness }: { editor: Editor; awareness: Awareness }) {
  const size = useWindowSize();
  const camera = useEditorStore((s) => s.camera);
  const toolId = useEditorStore((s) => s.toolId);
  const stageRef = useRef<Konva.Stage>(null);
  const { handlers, cursor } = useCanvasInput(editor, toolId);

  useEffect(() => {
    editor.attachStage(stageRef.current);
    return () => editor.attachStage(null);
  }, [editor, size]);

  // Panning and zooming redraw every visible shape twice: once to the screen and once to Konva's
  // hidden hit-test canvas. Nobody clicks mid-pan, so skip the hit canvas until the camera settles.
  useEffect(() => {
    let timer = 0;
    const unsubscribe = useEditorStore.subscribe((s, prev) => {
      if (s.camera === prev.camera) return;
      const layer = editor.stage?.findOne<Konva.Layer>(".shapes");
      if (!layer) return;
      if (layer.listening()) layer.listening(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        layer.listening(true);
        layer.drawHit();
      }, HIT_SETTLE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [editor]);

  // Shapes can disappear under us (deleted by someone else, or undone).
  useEffect(() => {
    const prune = () => editor.pruneSelection();
    editor.board.shapes.observe(prune);
    return () => editor.board.shapes.unobserve(prune);
  }, [editor]);

  const grid = 22 * camera.zoom;

  return (
    <div
      className="absolute inset-0 touch-none"
      style={{
        cursor,
        backgroundColor: "#f6f6f7",
        // Dot grid that pans and zooms with the board; hidden when zoomed far out.
        backgroundImage:
          camera.zoom > 0.35
            ? "radial-gradient(circle, rgb(14 14 16 / 0.14) 1px, transparent 1.3px)"
            : undefined,
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${camera.x}px ${camera.y}px`,
      }}
    >
      {size && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={camera.x}
          y={camera.y}
          scaleX={camera.zoom}
          scaleY={camera.zoom}
          {...handlers}
        >
          <Layer name="shapes">
            <ShapeList editor={editor} width={size.width} height={size.height} />
          </Layer>
          <Layer name="overlay">
            <SelectionHandles editor={editor} width={size.width} height={size.height} />
            <EndpointHandles editor={editor} />
            <Brush />
            <Guides />
            <EditingGroupOutline editor={editor} />
            <ConnectionPorts editor={editor} />
          </Layer>
          <Layer name="presence" listening={false}>
            <RemotePresence editor={editor} awareness={awareness} />
          </Layer>
        </Stage>
      )}
    </div>
  );
}

/* ── Input ─────────────────────────────────────────────────────────────── */

function isEditable(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

/** The tool to route input to. Viewers fall back to select for anything that would edit. */
function toolFor(editor: Editor, toolId: string): Tool {
  const tool = toolRegistry.get(toolId) ?? handTool;
  return editor.canUseTool(tool.id) ? tool : (toolRegistry.get("select") ?? handTool);
}

/** Routes pointer, wheel and keyboard input to the active tool and the editor. */
function useCanvasInput(editor: Editor, toolId: string) {
  // The tool that owns the current press. Fixed at pointer down so switching tools mid-drag
  // can't hand a half-finished gesture to a different tool.
  const gesture = useRef<{ tool: Tool; pointerId: number } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);

  // For the cursor. Event handlers call currentTool() instead, so a shortcut followed immediately
  // by a click uses the new tool even before React re-renders.
  const activeTool = spaceHeld ? handTool : toolFor(editor, toolId);
  const spaceRef = useRef(false);
  const setSpace = (held: boolean) => {
    spaceRef.current = held;
    setSpaceHeld(held);
  };
  const currentTool = () => (spaceRef.current ? handTool : toolFor(editor, editor.ui.toolId));

  const cancelGesture = () => {
    gesture.current?.tool.onCancel?.(editor);
    gesture.current = null;
    setPanning(false);
  };

  const toEvent = (e: KonvaEventObject<PointerEvent>): ToolEvent => {
    const stage = e.target.getStage()!;
    const screen = stage.getPointerPosition() ?? { x: 0, y: 0 };
    const shapeNode = e.target.findAncestor(".shape", true);
    return {
      point: screenToPage(screen, editor.ui.camera),
      screen,
      pressure: e.evt.pressure || 0.5,
      pointerType: e.evt.pointerType,
      shiftKey: e.evt.shiftKey,
      altKey: e.evt.altKey,
      metaKey: e.evt.metaKey || e.evt.ctrlKey,
      targetId: shapeNode?.id() || null,
    };
  };

  const handlers = {
    onPointerDown(e: KonvaEventObject<PointerEvent>) {
      // Resize and rotate handles belong to Konva's Transformer.
      if (e.target.getParent() instanceof Konva.Transformer) return;
      // So do line and arrow endpoint handles, which drag themselves.
      if (e.target.hasName("handle")) return;
      if (gesture.current || (e.evt.button !== 0 && e.evt.button !== 1)) return;
      const tool = e.evt.button === 1 ? handTool : currentTool();
      try {
        // Keep receiving moves when the pointer leaves the canvas mid-drag.
        (e.evt.target as Element).setPointerCapture(e.evt.pointerId);
      } catch {
        // The pointer is already gone (e.g. released before this ran); nothing to capture.
      }
      gesture.current = { tool, pointerId: e.evt.pointerId };
      if (tool === handTool) setPanning(true);
      tool.onPointerDown?.(toEvent(e), editor);
    },
    onPointerMove(e: KonvaEventObject<PointerEvent>) {
      const g = gesture.current;
      if (!g) {
        if (e.evt.buttons === 0) currentTool().onHover?.(toEvent(e), editor);
        return;
      }
      if (g.pointerId !== e.evt.pointerId) return;
      g.tool.onPointerMove?.(toEvent(e), editor);
    },
    onPointerUp(e: KonvaEventObject<PointerEvent>) {
      const g = gesture.current;
      if (!g || g.pointerId !== e.evt.pointerId) return;
      gesture.current = null;
      setPanning(false);
      g.tool.onPointerUp?.(toEvent(e), editor);
    },
    onPointerCancel() {
      cancelGesture();
    },
    onPointerLeave() {
      if (!gesture.current) currentTool().onHover?.(null, editor);
    },
    onDblClick(e: KonvaEventObject<MouseEvent>) {
      // Double-click text to edit it, or a named shape (a card, a frame) to rename it.
      if (editor.readOnly) return;
      const id = e.target.findAncestor(".shape", true)?.id();
      const shape = id ? editor.getShape(id) : null;
      if (!id || !shape) return;
      // Double-clicking a grouped shape steps into its group, one level per double-click.
      const group = editor.unitGroup(id);
      if (group) {
        editor.ui.setEditingGroup(group);
        editor.select(editor.unitOf(id));
        return;
      }
      if (shape.locked) return;
      if (shape.type === "text") {
        editor.startGesture(); // the text editor ends it
        editor.select([id]);
        editor.ui.setEditingText(id);
      } else if (shapeRegistry.get(shape.type)?.label) {
        editor.startGesture(); // the label editor ends it
        editor.select([id]);
        editor.ui.setEditingLabel(id);
      }
    },
    onContextMenu(e: KonvaEventObject<PointerEvent>) {
      // The menu acts on the selection: right-clicking a shape outside it selects just that
      // shape, and right-clicking empty board clears it. (The menu itself opens from the DOM.)
      const id = e.target.findAncestor(".shape", true)?.id() || null;
      if (!id) editor.select([]);
      else if (!editor.ui.selectedIds.includes(id)) editor.select(editor.unitOf(id));
    },
    onWheel(e: KonvaEventObject<WheelEvent>) {
      e.evt.preventDefault();
      const { camera, setCamera } = editor.ui;
      const screen = e.target.getStage()!.getPointerPosition() ?? { x: 0, y: 0 };
      if (e.evt.ctrlKey || e.evt.metaKey) {
        // Ctrl + wheel, and trackpad pinch (which arrives as ctrl + wheel).
        setCamera(zoomAt(camera, screen, camera.zoom * Math.exp(-e.evt.deltaY * 0.01)));
      } else {
        setCamera({ ...camera, x: camera.x - e.evt.deltaX, y: camera.y - e.evt.deltaY });
      }
    },
  };

  // Connection points shown for one tool shouldn't linger into the next.
  useEffect(() => editor.ui.setConnect(null), [editor, toolId]);

  // Keep the latest closures for the window listeners without re-binding them every render.
  const latest = useRef({ currentTool, cancelGesture });
  useEffect(() => {
    latest.current = { currentTool, cancelGesture };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const { selectedIds } = editor.ui;

      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        editor.redo();
      } else if (mod && key === "a") {
        e.preventDefault();
        editor.select(editor.sortedIds());
      } else if (
        (mod && !e.shiftKey && (key === "b" || key === "i" || key === "u")) ||
        (mod && e.shiftKey && key === "x")
      ) {
        // Text styles (also keeps Ctrl+U from opening the page source).
        const style = ({ b: "bold", i: "italic", u: "underline", x: "strike" } as const)[
          key as "b" | "i" | "u" | "x"
        ];
        if (toggleTextStyle(editor, selectedIds, style)) e.preventDefault();
      } else if (e.altKey && !mod && ALIGN_ACTIONS.some((a) => a.code === e.code)) {
        // Alt+A/H/D align left/centre/right, Alt+W/V/S top/middle/bottom. By key position, so it
        // works whatever character Alt produces on the layout.
        e.preventDefault();
        const action = ALIGN_ACTIONS.find((a) => a.code === e.code)!;
        editor.align(selectedIds, action.edge);
      } else if (mod && key === "g") {
        // Group, or with Shift ungroup (rather than the browser's find-next).
        e.preventDefault();
        if (e.shiftKey) {
          const parts = selectedIds;
          if (editor.ungroup(parts)) editor.select(editor.expandToUnits(parts));
        } else if (editor.group(selectedIds)) {
          editor.select(editor.expandToUnits(selectedIds));
        }
      } else if (mod && key === "d") {
        // Duplicate, rather than the browser's bookmark shortcut.
        e.preventDefault();
        if (selectedIds.length) editor.duplicate(selectedIds);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedIds.length) return;
        e.preventDefault();
        editor.markHistory();
        editor.deleteShapes(editor.unlocked(selectedIds));
      } else if (e.key === "Escape") {
        latest.current.cancelGesture();
        // Inside a group, Escape steps out and selects the group; otherwise it deselects.
        const editing = editor.ui.editingGroupId;
        if (editing) {
          editor.ui.setEditingGroup(null);
          editor.select(editor.unitOf(editor.membersOf(editing)[0] ?? ""));
        } else editor.select([]);
        editor.setTool("select");
      } else if (e.key === " ") {
        e.preventDefault();
        if (!e.repeat) setSpace(true);
      } else if (e.key.startsWith("Arrow") && selectedIds.length) {
        e.preventDefault();
        const d = e.shiftKey ? NUDGE_BIG : NUDGE;
        const [dx, dy] = {
          ArrowLeft: [-d, 0],
          ArrowRight: [d, 0],
          ArrowUp: [0, -d],
          ArrowDown: [0, d],
        }[e.key] ?? [0, 0];
        editor.updateShapes(
          Object.fromEntries(
            selectedIds
              .map((id) => editor.getShape(id))
              .filter((s) => s && !s.locked)
              .map((s) => [s!.id, { x: s!.x + dx, y: s!.y + dy }]),
          ),
        );
      } else if ((e.key === "]" || e.key === "[") && selectedIds.length) {
        // ] / [ one step; with Ctrl/⌘ all the way to the front / back.
        e.preventDefault();
        const up = e.key === "]";
        editor.reorder(selectedIds, mod ? (up ? "front" : "back") : up ? "forward" : "backward");
      } else if (!mod && !e.altKey) {
        const tool = toolRegistry.byShortcut(key);
        if (tool && editor.canUseTool(tool.id)) {
          latest.current.cancelGesture();
          editor.setTool(tool.id);
        } else {
          latest.current.currentTool().onKeyDown?.(e, editor);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpace(false);
    };
    const onBlur = () => setSpace(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [editor]);

  const cursor = panning ? "grabbing" : activeTool.cursor;
  return { handlers, cursor };
}

/* ── Shapes ────────────────────────────────────────────────────────────── */

function ShapeList({ editor, width, height }: { editor: Editor; width: number; height: number }) {
  const ids = useVisibleShapeIds(editor, width, height);
  return ids.map((id) => <ShapeView key={id} editor={editor} id={id} />);
}

const ShapeView = memo(function ShapeView({ editor, id }: { editor: Editor; id: string }) {
  const live = useShape(editor, id);
  // During a local resize the node is scaled by Konva; draw the pre-resize snapshot until it ends.
  const frozen = useFrozenShape(editor, id);
  const shape = frozen ?? live;
  const isSelected = useEditorStore((s) => s.selectedIds.includes(id));
  const erasing = useEditorStore((s) => s.erasingIds.includes(id));
  if (!shape) return null;

  const def = shapeRegistry.get(shape.type);
  if (!def) return null; // A shape type this client doesn't know (newer version, or a plugin).

  let props: unknown;
  try {
    props = def.validate(shape.props);
  } catch {
    return null;
  }

  return (
    <Group
      id={id}
      name="shape"
      x={shape.x}
      y={shape.y}
      rotation={shape.rotation}
      // The eraser fades what it's about to remove, on top of the shape's own opacity.
      opacity={(shape.opacity ?? 1) * (erasing ? 0.25 : 1)}
    >
      <def.Component shape={{ ...shape, props }} isSelected={isSelected} />
    </Group>
  );
});

/* ── Overlay ───────────────────────────────────────────────────────────── */

type Patches = Parameters<Editor["updateShapes"]>[0];

function SelectionHandles({
  editor,
  width,
  height,
}: {
  editor: Editor;
  width: number;
  height: number;
}) {
  const trRef = useRef<Konva.Transformer>(null);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const ids = useVisibleShapeIds(editor, width, height);

  const anyLocked = selectedIds.some((id) => editor.getShape(id)?.locked);
  const resizable = selectedIds.every((id) => {
    const s = editor.getShape(id);
    return s && !s.locked && shapeRegistry.get(s.type)?.onResize;
  });

  // Attach to the selected nodes; re-attach when shapes mount or unmount.
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    // Lines and arrows are edited by their endpoint handles, not the resize box.
    const nodes = selectedIds
      .filter((id) => !hasEndpointHandles(editor, id))
      .map((id) => editor.nodeFor(id))
      .filter((n): n is Konva.Node => !!n);
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [editor, selectedIds, ids]);

  // Shapes resize from props (local or remote), which Konva doesn't notice on its own.
  useEffect(() => {
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!trRef.current?.isTransforming()) trRef.current?.forceUpdate();
      });
    };
    editor.board.shapes.observeDeep(refresh);
    return () => {
      cancelAnimationFrame(frame);
      editor.board.shapes.unobserveDeep(refresh);
    };
  }, [editor]);

  /** The shapes as Konva currently shows them: frozen props scaled by each node's transform. */
  const transformedPatches = (): Patches => {
    const patches: Patches = {};
    for (const node of trRef.current?.nodes() ?? []) {
      const start = editor.frozenShape(node.id());
      const def = start && shapeRegistry.get(start.type);
      if (!start || !def) continue;
      const initial = { ...start, props: def.validate(start.props) };
      const resized =
        def.onResize?.(initial, { scaleX: node.scaleX(), scaleY: node.scaleY(), initial }) ?? {};
      patches[start.id] = { ...resized, x: node.x(), y: node.y(), rotation: node.rotation() };
    }
    return patches;
  };

  // What the dragged handle can snap to, fixed when the resize starts.
  const snapTargets = useRef<Box[] | null>(null);

  // Shapes being resized by width (a side handle on a `liveWidth` shape, e.g. text): their
  // width prop changes as you drag, so text rewraps, instead of the node being stretched.
  const liveIds = useRef<Set<string>>(new Set());

  const onTransformStart = () => {
    editor.startGesture();
    const tr = trRef.current;
    const ids = tr?.nodes().map((n) => n.id()) ?? [];
    const side = /^middle-(left|right)$/.test(tr?.getActiveAnchor() ?? "");
    liveIds.current = new Set(
      side
        ? ids.filter((id) => {
            const s = editor.getShape(id);
            return !!s && !!shapeRegistry.get(s.type)?.liveWidth;
          })
        : [],
    );
    editor.freeze(ids.filter((id) => !liveIds.current.has(id)));
    snapTargets.current = editor.snapTargets(ids);
  };

  /** Turns this move's horizontal stretch of each live-width node into a new width prop. */
  const applyLiveWidths = () => {
    for (const node of trRef.current?.nodes() ?? []) {
      if (!liveIds.current.has(node.id())) continue;
      const sx = node.scaleX();
      // Konva measured this move's stretch against the node as last drawn (which can lag the
      // props by a frame), so scale that width, not the latest prop, or the stretches compound.
      const drawn = node.getClientRect({ skipTransform: true }).width;
      node.scale({ x: 1, y: 1 });
      const shape = editor.getValidShape(node.id());
      const live = shape && shapeRegistry.get(shape.type)?.liveWidth;
      if (!shape || !live) continue;
      const width = Math.max(live.min, (drawn || live.get(shape)) * Math.abs(sx));
      // Konva measures the node again on the next move, before React has re-rendered it; size
      // its box now so that measurement matches.
      (node as Konva.Group).findOne(".live-width-box")?.width(width);
      editor.updateShapes({
        [shape.id]: {
          x: node.x(),
          y: node.y(),
          props: { ...(shape.props as object), width },
        },
      });
    }
  };

  /**
   * Snaps the edge being dragged to other shapes' edges and centres. (Konva places the edge at
   * the position returned here; the resize box's padding is added on top.) Rotated shapes don't
   * snap, since their edges aren't axis-aligned, and Alt resizes freely.
   */
  const snapHandle = (pos: Vec, evt: unknown): Vec => {
    const tr = trRef.current;
    const anchor = tr?.getActiveAnchor() ?? "";
    const targets = snapTargets.current;
    const rotated = tr?.nodes().some((n) => Math.abs(n.rotation() % 360) > 0.01);
    if (!tr || !targets || anchor === "rotater" || rotated || (evt as MouseEvent)?.altKey) {
      editor.ui.setGuides([]);
      return pos;
    }
    const { camera } = editor.ui;
    const { point, guides } = snapPoint(
      screenToPage(pos, camera),
      targets,
      SNAP_DISTANCE / camera.zoom,
      { x: /left|right/.test(anchor), y: /top|bottom/.test(anchor) },
    );
    editor.ui.setGuides(guides);
    return pageToScreen(point, camera);
  };

  const onTransform = () => {
    applyLiveWidths();
    const patches = transformedPatches();
    editor.writeEachFrame(() => editor.updateShapes(patches));
  };

  const onTransformEnd = () => {
    applyLiveWidths();
    liveIds.current = new Set();
    const patches = transformedPatches();
    editor.flush();
    editor.updateShapes(patches);
    // Bake the scale into props so strokes and text stay crisp, then draw from live props again.
    for (const node of trRef.current?.nodes() ?? []) node.scale({ x: 1, y: 1 });
    editor.unfreeze();
    editor.endGesture();
    snapTargets.current = null;
    editor.ui.setGuides([]);
    // Rewrapped text may now be taller or shorter; fit the box to it once it has re-rendered.
    requestAnimationFrame(() => trRef.current?.forceUpdate());
  };
  return (
    <Transformer
      ref={trRef}
      resizeEnabled={resizable && !editor.readOnly}
      rotateEnabled={!editor.readOnly && !anyLocked}
      keepRatio={false}
      flipEnabled={false}
      ignoreStroke
      rotationSnaps={[0, 45, 90, 135, 180, 225, 270, 315]}
      rotationSnapTolerance={4}
      rotateAnchorOffset={22}
      anchorSize={9}
      anchorCornerRadius={2}
      anchorStroke={SELECTION_BLUE}
      anchorStrokeWidth={1.5}
      borderStroke={SELECTION_BLUE}
      borderStrokeWidth={1.5}
      padding={TRANSFORM_PAD}
      anchorDragBoundFunc={(_old, pos, evt) => snapHandle(pos, evt)}
      boundBoxFunc={(oldBox, newBox) => (newBox.width < 4 || newBox.height < 4 ? oldBox : newBox)}
      onTransformStart={onTransformStart}
      onTransform={onTransform}
      onTransformEnd={onTransformEnd}
    />
  );
}

function hasEndpointHandles(editor: Editor, id: string) {
  const shape = editor.getShape(id);
  return !!shape && !!shapeRegistry.get(shape.type)?.getHandles;
}

/**
 * Drag handles on the ends of the one selected line or arrow. Dropping an arrow end on a shape
 * attaches it there; dropping it on empty board detaches it.
 */
function EndpointHandles({ editor }: { editor: Editor }) {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const zoom = useEditorStore((s) => s.camera.zoom);
  const shape = useShape(editor, selectedIds.length === 1 ? selectedIds[0] : "");
  if (!shape || editor.readOnly || shape.locked) return null;
  const def = shapeRegistry.get(shape.type);
  if (!def?.getHandles) return null;
  let valid: Shape;
  try {
    valid = { ...shape, props: def.validate(shape.props) };
  } catch {
    return null;
  }

  const ends = () => {
    const s = editor.getValidShape(shape.id);
    const path = (s?.props as { path?: number[] } | undefined)?.path;
    if (!s || !path) return null;
    return {
      shape: s,
      start: toPage(s, { x: path[0], y: path[1] }),
      end: toPage(s, { x: path[path.length - 2], y: path[path.length - 1] }),
    };
  };

  /** Where a dragged end would connect: a connection point of another shape (arrows only). */
  const connectionFor = (terminal: Terminal, at: Vec) => {
    if (shape.type !== "arrow") return null;
    const other = editor.getBinding(shape.id, terminal === "start" ? "end" : "start");
    const c = editor.connectionAt(at, { excludeId: shape.id });
    // An arrow from a shape to itself has no direction; leave the end free instead.
    return c && c.shapeId !== other?.toId ? c : null;
  };

  const moveEnd = (terminal: Terminal, at: Vec) => {
    const current = ends();
    if (!current) return;
    const c = connectionFor(terminal, at);
    editor.ui.setConnect(c ? { shapeId: c.shapeId, port: c.port } : null);
    const to = c?.point ?? at;
    const start = terminal === "start" ? to : current.start;
    const end = terminal === "end" ? to : current.end;
    editor.writeEachFrame(() =>
      editor.transact(() => {
        // While dragged, the end is free; it attaches on release.
        if (editor.getBinding(shape.id, terminal)) editor.setBinding(shape.id, terminal, null);
        editor.updateShapes({
          [shape.id]: {
            x: start.x,
            y: start.y,
            rotation: 0,
            props: {
              ...(current.shape.props as object),
              path: [0, 0, end.x - start.x, end.y - start.y],
            },
          },
        });
        editor.rerouteArrow(shape.id);
      }),
    );
  };

  const dropEnd = (terminal: Terminal, at: Vec) => {
    editor.flush();
    editor.ui.setConnect(null);
    if (shape.type === "arrow") {
      const c = connectionFor(terminal, at);
      editor.setBinding(shape.id, terminal, c ? { toId: c.shapeId, anchor: c.anchor } : null);
    }
    editor.endGesture();
  };

  return def.getHandles(valid).map((h) => {
    const p = toPage(valid, h.point);
    const terminal = h.id as Terminal;
    return (
      <Circle
        key={h.id}
        name="handle"
        x={p.x}
        y={p.y}
        radius={6 / zoom}
        fill="white"
        stroke={SELECTION_BLUE}
        strokeWidth={1.5 / zoom}
        hitStrokeWidth={12 / zoom}
        draggable
        onMouseEnter={(e) => {
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "move";
        }}
        onMouseLeave={(e) => {
          const container = e.target.getStage()?.container();
          if (container) container.style.cursor = "";
        }}
        onDragStart={() => editor.startGesture()}
        onDragMove={(e) => moveEnd(terminal, e.target.position())}
        onDragEnd={(e) => dropEnd(terminal, e.target.position())}
      />
    );
  });
}

function Brush() {
  const brush = useEditorStore((s) => s.brush);
  const zoom = useEditorStore((s) => s.camera.zoom);
  if (!brush) return null;
  return (
    <Rect
      x={brush.x}
      y={brush.y}
      width={brush.w}
      height={brush.h}
      fill="rgb(51 102 255 / 0.08)"
      stroke={SELECTION_BLUE}
      strokeWidth={1 / zoom}
      listening={false}
    />
  );
}

/**
 * Connection points of the shape an arrow would attach to (or the one under the pointer), with
 * the one in use filled in.
 */
function ConnectionPorts({ editor }: { editor: Editor }) {
  const connect = useEditorStore((s) => s.connect);
  const zoom = useEditorStore((s) => s.camera.zoom);
  // Follow the shape if it moves while the points are showing.
  useShape(editor, connect?.shapeId ?? "");
  if (!connect) return null;
  return editor.portsOnPage(connect.shapeId).map((p, i) => {
    const active = i === connect.port;
    return (
      <Circle
        key={i}
        x={p.x}
        y={p.y}
        radius={(active ? 5.5 : 4) / zoom}
        fill={active ? SELECTION_BLUE : "white"}
        stroke={SELECTION_BLUE}
        strokeWidth={1.5 / zoom}
        listening={false}
      />
    );
  });
}

/** A dashed box round the group you've double-clicked into, so it's clear where you are. */
function EditingGroupOutline({ editor }: { editor: Editor }) {
  const editing = useEditorStore((s) => s.editingGroupId);
  const zoom = useEditorStore((s) => s.camera.zoom);
  // Follow the group's shapes as they move.
  useSyncExternalStore(
    (onChange) => editor.indexChanged.subscribe(onChange),
    () => editor.indexVersion,
  );
  if (!editing) return null;
  const box = unionBox(editor.membersOf(editing).map((id) => editor.getBounds(id)));
  if (!box) return null;
  const pad = 8 / zoom;
  return (
    <Rect
      x={box.x - pad}
      y={box.y - pad}
      width={box.w + pad * 2}
      height={box.h + pad * 2}
      stroke="#8a8a93"
      strokeWidth={1 / zoom}
      dash={[5 / zoom, 4 / zoom]}
      cornerRadius={6 / zoom}
      listening={false}
    />
  );
}

const GUIDE_COLOR = "#ff3d7f";

/** Alignment guides while a dragged shape is snapped to others. */
function Guides() {
  const guides = useEditorStore((s) => s.guides);
  const zoom = useEditorStore((s) => s.camera.zoom);
  // Lines run a little past the shapes at each end; gap ticks are a fixed size on screen.
  const overhang = 8 / zoom;
  const tick = 5 / zoom;
  return guides.map((g, i) => {
    const along = (a: number, b: number, across: number) =>
      g.axis === "x" ? [a, across, b, across] : [across, a, across, b];
    if (g.kind === "gap") {
      // A measurement across the gap: a solid line with a tick at each end.
      return (
        <Group key={i} listening={false}>
          <Line points={along(g.from, g.to, g.at)} stroke={GUIDE_COLOR} strokeWidth={1 / zoom} />
          {[g.from, g.to].map((v) => (
            <Line
              key={v}
              points={
                g.axis === "x" ? [v, g.at - tick, v, g.at + tick] : [g.at - tick, v, g.at + tick, v]
              }
              stroke={GUIDE_COLOR}
              strokeWidth={1 / zoom}
            />
          ))}
        </Group>
      );
    }
    return (
      <Line
        key={i}
        points={
          g.axis === "x"
            ? [g.at, g.from - overhang, g.at, g.to + overhang]
            : [g.from - overhang, g.at, g.to + overhang, g.at]
        }
        stroke={GUIDE_COLOR}
        strokeWidth={1 / zoom}
        dash={[4 / zoom, 3 / zoom]}
        listening={false}
      />
    );
  });
}

function useWindowSize() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}
