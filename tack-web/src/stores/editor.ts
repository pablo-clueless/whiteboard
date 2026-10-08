import { create } from "zustand";

import type { Guide } from "@/editor/snapping";
import type { Box, Vec } from "@/editor/types";

/** Camera: page point (0, 0) is drawn at screen (x, y), scaled by zoom. */
export type Camera = { x: number; y: number; zoom: number };

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

/** Local editor UI state. Never synced — the board itself lives in the Y.Doc. */
type EditorState = {
  toolId: string;
  selectedIds: string[];
  hoveredId: string | null;
  editingTextId: string | null;
  camera: Camera;
  /** Box-select rectangle in page space while dragging one out. */
  brush: Box | null;
  /** Ids being exported: drawn even when off screen, until the export finishes. */
  exporting: string[] | null;
  /** Shapes the eraser has passed over, drawn faded until the stroke ends and deletes them. */
  erasingIds: string[];
  /** Alignment guides shown while a drag is snapped to other shapes. */
  guides: Guide[];
  /** The shape whose connection points are showing, and the one an arrow would attach to. */
  connect: ConnectHint | null;
  /** The board was saved by a newer Tack: it opens read-only until the page is reloaded. */
  outdated: boolean;
  shortcutsOpen: boolean;
  /** The server says the board is at its size limit: edits made now wouldn't be kept. */
  boardFull: boolean;
  setTool: (toolId: string) => void;
  setSelection: (ids: string[]) => void;
  setHovered: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  setCamera: (camera: Camera) => void;
  setBrush: (brush: Box | null) => void;
  setExporting: (ids: string[] | null) => void;
  setErasing: (ids: string[]) => void;
  setGuides: (guides: Guide[]) => void;
  setConnect: (connect: ConnectHint | null) => void;
  setOutdated: (outdated: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setBoardFull: (full: boolean) => void;
};

export type ConnectHint = { shapeId: string; port: number | null };

export const useEditorStore = create<EditorState>()((set) => ({
  toolId: "select",
  selectedIds: [],
  hoveredId: null,
  editingTextId: null,
  camera: { x: 0, y: 0, zoom: 1 },
  brush: null,
  exporting: null,
  erasingIds: [],
  guides: [],
  connect: null,
  outdated: false,
  shortcutsOpen: false,
  boardFull: false,
  setTool: (toolId) => set({ toolId }),
  setSelection: (selectedIds) => set({ selectedIds }),
  setHovered: (hoveredId) => set({ hoveredId }),
  setEditingText: (editingTextId) => set({ editingTextId }),
  setCamera: (camera) => set({ camera }),
  setBrush: (brush) => set({ brush }),
  setExporting: (exporting) => set({ exporting }),
  setErasing: (erasingIds) => set({ erasingIds }),
  setOutdated: (outdated) => set({ outdated }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setBoardFull: (boardFull) => set({ boardFull }),
  setConnect: (connect) =>
    set((s) =>
      s.connect?.shapeId === connect?.shapeId && s.connect?.port === connect?.port
        ? s
        : { connect },
    ),
  setGuides: (guides) => set((s) => (s.guides.length || guides.length ? { guides } : s)),
}));

export function screenToPage(p: Vec, camera: Camera): Vec {
  return { x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom };
}

export function pageToScreen(p: Vec, camera: Camera): Vec {
  return { x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y };
}

/** Zooms to `zoom`, keeping the page point under `screen` fixed. */
export function zoomAt(camera: Camera, screen: Vec, zoom: number): Camera {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const page = screenToPage(screen, camera);
  return { x: screen.x - page.x * z, y: screen.y - page.y * z, zoom: z };
}
