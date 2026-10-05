import { create } from "zustand";

import type { Vec } from "@/editor/types";

/** Camera: page point (0, 0) is drawn at screen (x, y), scaled by zoom. */
export type Camera = { x: number; y: number; zoom: number };

/** Local editor UI state. Never synced — the board itself lives in the Y.Doc. */
type EditorState = {
  toolId: string;
  selectedIds: string[];
  hoveredId: string | null;
  editingTextId: string | null;
  camera: Camera;
  setTool: (toolId: string) => void;
  setSelection: (ids: string[]) => void;
  setHovered: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  setCamera: (camera: Camera) => void;
};

export const useEditorStore = create<EditorState>()((set) => ({
  toolId: "select",
  selectedIds: [],
  hoveredId: null,
  editingTextId: null,
  camera: { x: 0, y: 0, zoom: 1 },
  setTool: (toolId) => set({ toolId }),
  setSelection: (selectedIds) => set({ selectedIds }),
  setHovered: (hoveredId) => set({ hoveredId }),
  setEditingText: (editingTextId) => set({ editingTextId }),
  setCamera: (camera) => set({ camera }),
}));

export function screenToPage(p: Vec, camera: Camera): Vec {
  return { x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom };
}

export function pageToScreen(p: Vec, camera: Camera): Vec {
  return { x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y };
}
