import { create } from "zustand";

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
  setTool: (toolId: string) => void;
  setSelection: (ids: string[]) => void;
  setHovered: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  setCamera: (camera: Camera) => void;
  setBrush: (brush: Box | null) => void;
};

export const useEditorStore = create<EditorState>()((set) => ({
  toolId: "select",
  selectedIds: [],
  hoveredId: null,
  editingTextId: null,
  camera: { x: 0, y: 0, zoom: 1 },
  brush: null,
  setTool: (toolId) => set({ toolId }),
  setSelection: (selectedIds) => set({ selectedIds }),
  setHovered: (hoveredId) => set({ hoveredId }),
  setEditingText: (editingTextId) => set({ editingTextId }),
  setCamera: (camera) => set({ camera }),
  setBrush: (brush) => set({ brush }),
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
