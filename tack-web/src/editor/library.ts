import { useEffect, useSyncExternalStore } from "react";
import { LayoutTemplate } from "lucide";
import type * as Y from "yjs";

import { componentCatalog, type ComponentItem } from "./component-catalog";
import { COMPONENT_SHAPE, insertComponent } from "./ComponentGroup";
import { CLIPBOARD_PREFIX, type Editor } from "./editor-core";
import { glyph, type IconSpec, monogram } from "./icons";
import { shapeRegistry } from "./shapes/registry";
import type { Box, Shape, Vec } from "./types";
import { unionBox } from "./geometry";
import { esc, n } from "./svg";

/**
 * Components people make on a board, kept in the board's Y.Doc (`library`) so everyone on it
 * shares them and they stay with the board. Two kinds:
 * - a card: a name, an icon and a colour, drawn by the same `component` shape as the built-in
 *   catalog (it's registered as the "This board" provider);
 * - shapes: a saved selection, added back as a fresh copy (arrows between them still attached).
 */
export type LibraryIcon =
  /** An icon from the built-in catalog. */
  | { kind: "ref"; provider: string; item: string }
  | { kind: "monogram"; text: string }
  /** An uploaded image (a board asset). */
  | { kind: "image"; assetId: string };

export type CardEntry = {
  kind: "card";
  id: string;
  label: string;
  /** Shown under the name; empty uses the provider's name. */
  caption: string;
  icon: LibraryIcon;
  color: string;
  createdAt: number;
};

export type ShapesEntry = {
  kind: "shapes";
  id: string;
  label: string;
  /** The shapes as `Editor.serialize` writes them. */
  clip: string;
  /** Where they sat when saved; inserting centres this box on the drop point. */
  box: Box;
  count: number;
  createdAt: number;
};

export type LibraryEntry = CardEntry | ShapesEntry;

/** The catalog provider id this board's cards are registered under. */
export const BOARD_PROVIDER = "board";
const BOARD_PROVIDER_LABEL = "This board";
export const DEFAULT_CARD_COLOR = "#3366ff";
const MAX_LABEL = 80;

/** Big saved selections would bloat every board load; past these, saving is refused. */
export const MAX_SAVED_SHAPES = 300;
const MAX_SAVED_CHARS = 250_000;

/** MIME type for dragging a saved selection from the panel onto the board. */
export const LIBRARY_DRAG_TYPE = "application/x-tack-library";

/* ── Reading ────────────────────────────────────────────────────────────── */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function readIcon(raw: unknown): LibraryIcon {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.kind === "ref" && typeof r.provider === "string" && typeof r.item === "string")
    return { kind: "ref", provider: r.provider, item: r.item };
  if (r.kind === "image" && typeof r.assetId === "string" && r.assetId)
    return { kind: "image", assetId: r.assetId };
  return { kind: "monogram", text: text(r.text, 3) || "?" };
}

/** An entry as stored, checked field by field; null if it's unusable. */
export function readEntry(id: string, raw: unknown): LibraryEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const label = text(r.label, MAX_LABEL).trim();
  const createdAt = isNum(r.createdAt) ? r.createdAt : 0;
  if (!label) return null;
  if (r.kind === "card") {
    return {
      kind: "card",
      id,
      label,
      caption: text(r.caption, MAX_LABEL),
      icon: readIcon(r.icon),
      color:
        typeof r.color === "string" && /^#[0-9a-f]{3,8}$/i.test(r.color)
          ? r.color
          : DEFAULT_CARD_COLOR,
      createdAt,
    };
  }
  if (r.kind === "shapes") {
    const b = (r.box ?? {}) as Record<string, unknown>;
    if (typeof r.clip !== "string" || !r.clip.startsWith(CLIPBOARD_PREFIX)) return null;
    if (![b.x, b.y, b.w, b.h].every(isNum)) return null;
    return {
      kind: "shapes",
      id,
      label,
      clip: r.clip,
      box: { x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number },
      count: isNum(r.count) ? r.count : 0,
      createdAt,
    };
  }
  return null;
}

/** Oldest first, so the panel keeps its order as entries are added. */
function readLibrary(map: Y.Map<unknown>): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  map.forEach((raw, id) => {
    const entry = readEntry(id, raw);
    if (entry) out.push(entry);
  });
  return out.sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

type Store = { entries: LibraryEntry[]; listeners: Set<() => void> };
/** One snapshot per board's library map, kept current by a single observer. */
const stores = new WeakMap<Y.Map<unknown>, Store>();

function storeFor(map: Y.Map<unknown>): Store {
  let store = stores.get(map);
  if (store) return store;
  const created: Store = { entries: readLibrary(map), listeners: new Set() };
  map.observe(() => {
    created.entries = readLibrary(map);
    created.listeners.forEach((fn) => fn());
  });
  stores.set(map, created);
  store = created;
  return store;
}

/** The board's components, re-rendering when anyone adds, edits or removes one. */
export function useLibrary(editor: Editor): LibraryEntry[] {
  const store = storeFor(editor.board.library);
  return useSyncExternalStore(
    (fn) => {
      store.listeners.add(fn);
      return () => void store.listeners.delete(fn);
    },
    () => store.entries,
    () => store.entries,
  );
}

export function getEntry(editor: Editor, id: string): LibraryEntry | null {
  return readEntry(id, editor.board.library.get(id));
}

/** The icon a card draws. Catalog icons that have gone away fall back to the name's initial. */
export function resolveIcon(icon: LibraryIcon, label: string): IconSpec {
  if (icon.kind === "image") return { kind: "image", assetId: icon.assetId };
  if (icon.kind === "monogram") return monogram(icon.text);
  const found = icon.provider === BOARD_PROVIDER ? null : componentCatalog.find(icon);
  return found?.item.icon ?? monogram(label.slice(0, 1).toUpperCase() || "?");
}

const toItem = (card: CardEntry): ComponentItem => ({
  id: card.id,
  label: card.label,
  icon: resolveIcon(card.icon, card.label),
  color: card.color,
  ...(card.caption.trim() ? { caption: card.caption.trim() } : {}),
});

/**
 * Keeps the board's cards registered in the component catalog (as the "This board" provider),
 * so `component` shapes draw them like any built-in. Mount once per editor.
 */
export function useBoardComponents(editor: Editor) {
  const entries = useLibrary(editor);
  useEffect(() => {
    componentCatalog.register({
      id: BOARD_PROVIDER,
      label: BOARD_PROVIDER_LABEL,
      color: "#4a4a52",
      logo: glyph(LayoutTemplate),
      items: entries.filter((e): e is CardEntry => e.kind === "card").map(toItem),
    });
  }, [entries]);
  // Leaving the board takes its cards out of the catalog.
  useEffect(() => () => componentCatalog.unregister(BOARD_PROVIDER), []);
}

/* ── Writing ────────────────────────────────────────────────────────────── */

type CardFields = Pick<CardEntry, "label" | "caption" | "icon" | "color">;

/** Adds a card, or updates the one with `id`. Returns its id. */
export function saveCard(editor: Editor, fields: CardFields, id?: string): string | null {
  if (editor.readOnly) return null;
  const existing = id ? getEntry(editor, id) : null;
  const entryId = existing?.id ?? crypto.randomUUID();
  const entry: Omit<CardEntry, "id"> = {
    kind: "card",
    label: fields.label.trim().slice(0, MAX_LABEL),
    caption: fields.caption.trim().slice(0, MAX_LABEL),
    // Only the fields an icon has, whatever object it came in.
    icon: readIcon(fields.icon),
    color: fields.color,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  if (!entry.label) return null;
  editor.board.library.set(entryId, entry);
  return entryId;
}

/**
 * Saves the shapes (with their frames' contents and the arrows between them) as a component.
 * Returns its id, or null with a notice when there's nothing to save or it's too big.
 */
export function saveSelection(editor: Editor, ids: string[], label: string): string | null {
  if (editor.readOnly) return null;
  const all = editor.withChildren(ids);
  if (all.length > MAX_SAVED_SHAPES) {
    editor.notify(
      `That's ${all.length} shapes; a component can hold up to ${MAX_SAVED_SHAPES}.`,
      "error",
    );
    return null;
  }
  const clip = editor.serialize(ids);
  const box = unionBox(all.map((id) => editor.getBounds(id)));
  if (!clip || !box) return null;
  if (clip.length > MAX_SAVED_CHARS) {
    editor.notify("Those shapes are too big to save as one component. Try fewer.", "error");
    return null;
  }
  const id = crypto.randomUUID();
  const entry: Omit<ShapesEntry, "id"> = {
    kind: "shapes",
    label: label.trim().slice(0, MAX_LABEL) || "Component",
    clip,
    box,
    count: all.length,
    createdAt: Date.now(),
  };
  editor.board.library.set(id, entry);
  return id;
}

/** Removes an entry. Returns what was stored, so it can be put back (undo). */
export function removeEntry(editor: Editor, id: string): unknown {
  if (editor.readOnly) return null;
  const stored = editor.board.library.get(id);
  editor.board.library.delete(id);
  return stored;
}

/** Puts back an entry `removeEntry` returned. */
export function restoreEntry(editor: Editor, id: string, stored: unknown) {
  if (editor.readOnly || !stored) return;
  editor.board.library.set(id, stored);
}

/** How many component cards on the board use this card. */
export function usesOf(editor: Editor, cardId: string): number {
  let count = 0;
  editor.board.shapes.forEach((m) => {
    const p = m.get("props") as { provider?: unknown; item?: unknown } | undefined;
    if (m.get("type") === COMPONENT_SHAPE && p?.provider === BOARD_PROVIDER && p.item === cardId)
      count++;
  });
  return count;
}

/** Adds a copy of an entry centred on `at` (page space) and selects it. */
export function insertEntry(editor: Editor, entry: LibraryEntry, at: Vec): string[] | null {
  if (editor.readOnly) return null;
  if (entry.kind === "card") {
    // By label: a card made a moment ago isn't in the catalog until the next render.
    const id = insertComponent(
      editor,
      { provider: BOARD_PROVIDER, item: entry.id },
      at,
      entry.label,
    );
    return id ? [id] : null;
  }
  const { box } = entry;
  const ids = editor.pasteSerialized(entry.clip, {
    x: at.x - (box.x + box.w / 2),
    y: at.y - (box.y + box.h / 2),
  });
  editor.setTool("select");
  return ids;
}

/* ── Preview ────────────────────────────────────────────────────────────── */

/**
 * A saved selection drawn as a standalone SVG, through each shape's `toSvg`, for its tile in
 * the panel. Meant for an <img>, so nothing in it runs or fetches.
 */
export function shapesPreviewSvg(entry: ShapesEntry): string | null {
  let shapes: Shape[];
  try {
    shapes = (JSON.parse(entry.clip.slice(CLIPBOARD_PREFIX.length)) as { shapes: Shape[] }).shapes;
    if (!Array.isArray(shapes)) return null;
  } catch {
    return null;
  }
  const parts: string[] = [];
  for (const shape of shapes) {
    const def = shapeRegistry.get(shape.type);
    if (!def?.toSvg) continue;
    try {
      const valid = { ...shape, props: def.validate(shape.props) };
      const transform = `translate(${n(shape.x ?? 0)} ${n(shape.y ?? 0)})${shape.rotation ? ` rotate(${n(shape.rotation)})` : ""}`;
      const opacity =
        isNum(shape.opacity) && shape.opacity < 1 ? ` opacity="${n(shape.opacity)}"` : "";
      parts.push(`<g transform="${esc(transform)}"${opacity}>${def.toSvg(valid)}</g>`);
    } catch {
      // A shape that can't be drawn is left out of the preview.
    }
  }
  if (!parts.length) return null;
  const { x, y, w, h } = entry.box;
  const pad = Math.max(w, h) * 0.04;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(x - pad)} ${n(y - pad)} ${n(w + pad * 2)} ${n(h + pad * 2)}">` +
    parts.join("") +
    "</svg>"
  );
}
