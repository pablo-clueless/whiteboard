"use client";

import { Circle, Group, Line, Path, Rect } from "react-konva";
import type { KonvaEventObject } from "konva/lib/Node";

import { type Curves, edgeCount, edgeMiddle, insertNode, moveNode, pathData } from "./nodes";
import { canAttach, type Terminal, toLocal, toPage } from "./bindings";
import { screenToPage, useEditorStore } from "@/stores/editor";
import type { Editor } from "./editor-core";
import { useShape } from "./sync/useShapes";
import type { Shape, Vec } from "./types";

const BLUE = "#3366ff";
/** Screen pixels the pointer must move before a press on a handle becomes a drag. */
const DRAG_THRESHOLD = 3;

/**
 * Whether a shape shows its points without being in point editing: lines with more than two
 * points and arrows whose points were placed by hand. Their ends must move without flattening
 * the points between, so these handles stand in for the plain endpoint ones.
 */
export function showsNodesWhenSelected(editor: Editor, id: string): boolean {
  const s = editor.getShape(id);
  if (!s) return false;
  const p = s.props as { path?: number[]; manual?: boolean };
  return (s.type === "line" && (p.path?.length ?? 0) > 4) || (s.type === "arrow" && !!p.manual);
}

type Press = {
  /** What's being dragged: a point, an edge's middle (which adds a point), or a curve handle. */
  kind: "node" | "edge" | "c1" | "c2";
  index: number;
  screen: Vec;
  moved: boolean;
  /** The shape and outline when the drag began; every move is worked out from these. */
  from: Shape;
  pts: number[];
  curves: Curves;
  /** The point being dragged, once there is one (an edge drag adds it on the first move). */
  node: number | null;
  /** Arrow ends attach to shapes: which end this is, if it is one. */
  terminal: Terminal | null;
};

/**
 * Point editing: a handle on every point of the selected line, arrow or polygon, a marker in the
 * middle of each edge (drag it to add a point there, click it to pick the edge) and the handles
 * of curved edges. Delete removes the picked point; the style panel curves or straightens edges.
 */
export function NodeHandles({ editor }: { editor: Editor }) {
  const editing = useEditorStore((s) => s.editingNodes);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const zoom = useEditorStore((s) => s.camera.zoom);
  const single = selectedIds.length === 1 ? selectedIds[0] : "";
  const id = editing?.id ?? (single && showsNodesWhenSelected(editor, single) ? single : "");
  // Subscribing re-renders the handles whenever the shape changes, here or remotely.
  const shape = useShape(editor, id);
  if (!id || !shape || shape.locked || editor.readOnly) return null;
  const outline = editor.readNodes(id);
  if (!outline) return null;
  const { pts, curves, closed } = outline;
  const n = pts.length / 2;
  const full = editing?.id === id;
  const ends = full ? null : [0, n - 1];
  const page = (x: number, y: number) => toPage(outline.shape, { x, y });

  const pageAt = (ev: PointerEvent, container: HTMLElement) => {
    const rect = container.getBoundingClientRect();
    return screenToPage({ x: ev.clientX - rect.left, y: ev.clientY - rect.top }, editor.ui.camera);
  };

  const pick = (node: number | null, edge: number | null) =>
    editor.ui.setEditingNodes(full ? { id, node, edge } : null);

  const begin = (e: KonvaEventObject<PointerEvent>, kind: Press["kind"], index: number) => {
    if (e.evt.button !== 0) return;
    e.cancelBubble = true;
    const container = e.target.getStage()?.container();
    const start = editor.readNodes(id);
    if (!container || !start) return;
    const terminal =
      start.shape.type === "arrow" && kind === "node"
        ? index === 0
          ? "start"
          : index === n - 1
            ? "end"
            : null
        : null;
    const press: Press = {
      kind,
      index,
      screen: { x: e.evt.clientX, y: e.evt.clientY },
      moved: false,
      from: start.shape,
      pts: start.pts,
      curves: start.curves,
      node: kind === "node" ? index : null,
      terminal,
    };
    if (kind === "node") pick(index, null);

    const onMove = (ev: PointerEvent) => {
      if (!press.moved) {
        if (Math.hypot(ev.clientX - press.screen.x, ev.clientY - press.screen.y) < DRAG_THRESHOLD)
          return;
        press.moved = true;
        editor.startGesture();
        // A hand-placed arrow from here on. A dragged end lets go of its shape until dropped.
        editor.writeNodes(id, press.pts, press.curves, press.from);
        if (press.terminal && editor.getBinding(id, press.terminal))
          editor.setBinding(id, press.terminal, null);
        const now = editor.readNodes(id)!;
        [press.from, press.pts, press.curves] = [now.shape, now.pts, now.curves];
        if (kind === "edge") {
          const r = insertNode(press.pts, press.curves, index);
          [press.pts, press.curves, press.node] = [r.pts, r.curves, r.index];
          pick(r.index, null);
        }
      }
      let at = pageAt(ev, container);
      if (press.terminal) {
        const other = editor.getBinding(id, press.terminal === "start" ? "end" : "start");
        const c = editor.connectionAt(at, { excludeId: id });
        const hit = c && canAttach(c, other) ? c : null;
        editor.ui.setConnect(hit ? { shapeId: hit.shapeId, port: hit.port } : null);
        if (hit) at = hit.point;
      }
      const local = toLocal(press.from, at);
      let next: { pts: number[]; curves: Curves };
      if (press.node !== null) {
        const i = press.node;
        next = moveNode(
          press.pts,
          press.curves,
          i,
          local.x - press.pts[i * 2],
          local.y - press.pts[i * 2 + 1],
          closed,
        );
      } else {
        const curvesNext = [...press.curves];
        const c = [...(press.curves[index] ?? [0, 0, 0, 0])] as [number, number, number, number];
        if (kind === "c1") [c[0], c[1]] = [local.x, local.y];
        else [c[2], c[3]] = [local.x, local.y];
        curvesNext[index] = c;
        next = { pts: press.pts, curves: curvesNext };
      }
      editor.writeEachFrame(() => editor.writeNodes(id, next.pts, next.curves, press.from));
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!press.moved) {
        // A click: picks the point (done on press) or the edge.
        if (kind === "edge") pick(null, index);
        return;
      }
      editor.flush();
      editor.ui.setConnect(null);
      if (press.terminal) {
        const at = pageAt(ev, container);
        const other = editor.getBinding(id, press.terminal === "start" ? "end" : "start");
        const c = editor.connectionAt(at, { excludeId: id });
        if (c && canAttach(c, other))
          editor.setBinding(id, press.terminal, { toId: c.shapeId, anchor: c.anchor });
      }
      editor.endGesture();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const cursor = (value: string) => (e: KonvaEventObject<MouseEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = value;
  };
  const common = {
    name: "handle",
    onMouseEnter: cursor("move"),
    onMouseLeave: cursor(""),
  };
  const r = 5 / zoom;
  const line = 1.5 / zoom;

  const showNode = (i: number) => !ends || ends.includes(i);
  const edges = edgeCount(n, closed);

  return (
    <Group>
      {full && (
        // The outline being edited, traced in blue.
        <Group x={outline.shape.x} y={outline.shape.y} rotation={outline.shape.rotation}>
          <Path
            data={pathData(pts, curves, closed)}
            stroke={BLUE}
            strokeWidth={1 / zoom}
            listening={false}
            fillEnabled={false}
          />
        </Group>
      )}
      {full &&
        curves.map((c, e) => {
          if (!c) return null;
          const a = page(pts[e * 2], pts[e * 2 + 1]);
          const bi = (e + 1) % n;
          const b = page(pts[bi * 2], pts[bi * 2 + 1]);
          const [h1, h2] = [page(c[0], c[1]), page(c[2], c[3])];
          const s = 7 / zoom;
          return (
            <Group key={`curve-${e}`}>
              <Line
                points={[a.x, a.y, h1.x, h1.y]}
                stroke={BLUE}
                strokeWidth={1 / zoom}
                opacity={0.6}
                listening={false}
              />
              <Line
                points={[b.x, b.y, h2.x, h2.y]}
                stroke={BLUE}
                strokeWidth={1 / zoom}
                opacity={0.6}
                listening={false}
              />
              {(
                [
                  ["c1", h1],
                  ["c2", h2],
                ] as const
              ).map(([kind, h]) => (
                <Rect
                  key={kind}
                  {...common}
                  x={h.x}
                  y={h.y}
                  width={s}
                  height={s}
                  offsetX={s / 2}
                  offsetY={s / 2}
                  rotation={45}
                  fill="white"
                  stroke={BLUE}
                  strokeWidth={line}
                  hitStrokeWidth={10 / zoom}
                  onPointerDown={(ev) => begin(ev, kind, e)}
                />
              ))}
            </Group>
          );
        })}
      {full &&
        Array.from({ length: edges }, (_, e) => {
          const m = edgeMiddle(pts, curves, e);
          const p = page(m.x, m.y);
          const picked = editing?.edge === e;
          return (
            <Circle
              key={`edge-${e}`}
              {...common}
              x={p.x}
              y={p.y}
              radius={(picked ? 4.5 : 3.5) / zoom}
              fill={picked ? BLUE : "rgba(51, 102, 255, 0.35)"}
              hitStrokeWidth={10 / zoom}
              onPointerDown={(ev) => begin(ev, "edge", e)}
            />
          );
        })}
      {Array.from({ length: n }, (_, i) => {
        if (!showNode(i)) return null;
        const p = page(pts[i * 2], pts[i * 2 + 1]);
        const picked = editing?.node === i;
        return (
          <Circle
            key={`node-${i}`}
            {...common}
            x={p.x}
            y={p.y}
            radius={r}
            fill={picked ? BLUE : "white"}
            stroke={BLUE}
            strokeWidth={line}
            hitStrokeWidth={12 / zoom}
            onPointerDown={(ev) => begin(ev, "node", i)}
          />
        );
      })}
    </Group>
  );
}
