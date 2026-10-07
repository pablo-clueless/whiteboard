"use client";

import { Circle, Group, Layer, Rect, Stage, Transformer } from "react-konva";
import { memo, useEffect, useRef, useState } from "react";
import type { KonvaEventObject } from "konva/lib/Node";
import Konva from "konva";

import { useFrozenShape, useShape, useVisibleShapeIds } from "./sync/useShapes";
import { screenToPage, useEditorStore, zoomAt } from "@/stores/editor";
import { anchorFor, type Terminal, toPage } from "./bindings";
import type { Shape, Tool, ToolEvent, Vec } from "./types";
import { shapeRegistry } from "./shapes/registry";
import { toolRegistry } from "./tools/registry";
import type { Editor } from "./editor-core";
import { handTool } from "./tools/hand";

const SELECTION_BLUE = "#3366ff";
/** Arrow-key nudge distances, in page units. */
const NUDGE = 1;
const NUDGE_BIG = 10;
/** How long the camera must be still before shapes become clickable again after a pan or zoom. */
const HIT_SETTLE_MS = 150;

export function Canvas({ editor }: { editor: Editor }) {
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
          </Layer>
          {/* TODO(M5): remote cursors */}
          <Layer name="presence" listening={false} />
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
      if (!g || g.pointerId !== e.evt.pointerId) return;
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
    onDblClick(e: KonvaEventObject<MouseEvent>) {
      // Double-click text to edit it.
      if (editor.readOnly) return;
      const id = e.target.findAncestor(".shape", true)?.id();
      if (id && editor.getShape(id)?.type === "text") {
        editor.startGesture(); // the text editor ends it
        editor.select([id]);
        editor.ui.setEditingText(id);
      }
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
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!selectedIds.length) return;
        e.preventDefault();
        editor.markHistory();
        editor.deleteShapes(selectedIds);
      } else if (e.key === "Escape") {
        latest.current.cancelGesture();
        editor.select([]);
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
    <Group id={id} name="shape" x={shape.x} y={shape.y} rotation={shape.rotation}>
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

  const onTransformStart = () => {
    editor.startGesture();
    editor.freeze(trRef.current?.nodes().map((n) => n.id()) ?? []);
  };

  // Others see the resize live; locally Konva is already showing it.
  const onTransform = () => {
    const patches = transformedPatches();
    editor.writeEachFrame(() => editor.updateShapes(patches));
  };

  const onTransformEnd = () => {
    const patches = transformedPatches();
    editor.flush();
    editor.updateShapes(patches);
    // Bake the scale into props so strokes and text stay crisp, then draw from live props again.
    for (const node of trRef.current?.nodes() ?? []) node.scale({ x: 1, y: 1 });
    editor.unfreeze();
    editor.endGesture();
  };
  return (
    <Transformer
      ref={trRef}
      resizeEnabled={resizable && !editor.readOnly}
      rotateEnabled={!editor.readOnly}
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
      padding={4}
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

  const moveEnd = (terminal: Terminal, to: Vec) => {
    const current = ends();
    if (!current) return;
    const start = terminal === "start" ? to : current.start;
    const end = terminal === "end" ? to : current.end;
    editor.writeEachFrame(() =>
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
      }),
    );
  };

  const dropEnd = (terminal: Terminal, at: Vec) => {
    editor.flush();
    if (shape.type === "arrow") {
      const other = editor.getBinding(shape.id, terminal === "start" ? "end" : "start");
      const target = editor.bindableShapeAt(at, shape.id);
      const anchor = target && target.id !== other?.toId ? anchorFor(target, at) : null;
      editor.setBinding(shape.id, terminal, target && anchor ? { toId: target.id, anchor } : null);
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
