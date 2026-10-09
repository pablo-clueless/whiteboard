"use client";

import { AnimatePresence, MotionConfig, motion, type Transition } from "motion/react";
import { useMemo, useState, useSyncExternalStore } from "react";
import {
  ChevronRight,
  PanelRightClose,
  Pencil,
  Plus,
  Search,
  Shapes,
  Trash2,
  X,
} from "lucide-react";

import { IconSvg, readable, tint } from "./icons";
import { shapeRegistry } from "./shapes/registry";
import { deleteEntry } from "./LibraryDialogs";
import { screenToPage } from "@/stores/editor";
import type { Editor } from "./editor-core";
import type { Vec } from "./types";
import {
  BOARD_PROVIDER,
  insertEntry,
  LIBRARY_DRAG_TYPE,
  type LibraryEntry,
  resolveIcon,
  type ShapesEntry,
  shapesPreviewSvg,
  useLibrary,
} from "./library";
import {
  COMPONENT_DRAG_TYPE,
  type ComponentItem,
  type ComponentProvider,
  type ComponentRef,
  componentCatalog,
  itemColor,
} from "./component-catalog";

/** The shape type that draws catalog items. Registered by the components plugin. */
export const COMPONENT_SHAPE = "component";

/**
 * Places a component centred on `at` (page space) and selects it. `label` names it without
 * looking it up in the catalog.
 */
export function insertComponent(
  editor: Editor,
  ref: ComponentRef,
  at: Vec,
  label?: string,
): string | null {
  const name = label ?? componentCatalog.find(ref)?.item.label;
  if (name === undefined || editor.readOnly) return null;
  const size = (shapeRegistry.get(COMPONENT_SHAPE)?.defaultProps ?? { w: 0, h: 0 }) as {
    w: number;
    h: number;
  };
  editor.markHistory();
  const id = editor.createShape({
    type: COMPONENT_SHAPE,
    x: at.x - size.w / 2,
    y: at.y - size.h / 2,
    props: { ...ref, label: name },
  });
  editor.markHistory();
  editor.select([id]);
  editor.setTool("select");
  return id;
}

/* ── Remembered panel state ─────────────────────────────────────────────── */

const STORAGE_KEY = "tack:component-panel";

type Saved = { open: boolean; expanded: string[] };

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { open: true, expanded: [], ...(JSON.parse(raw) as Partial<Saved>) };
  } catch {
    // Storage unavailable or junk: use the defaults.
  }
  return { open: true, expanded: [BOARD_PROVIDER, "aws"] };
}

function save(state: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Not remembered this time; nothing else depends on it.
  }
}

/* ── Motion ─────────────────────────────────────────────────────────────── */

/** Quick and settled: the panel should not wobble while people are working. */
const PANEL_SPRING: Transition = { type: "spring", stiffness: 520, damping: 40, mass: 0.8 };
const ACCORDION_EASE: Transition = { duration: 0.22, ease: [0.22, 1, 0.36, 1] };

/* ── Panel ──────────────────────────────────────────────────────────────── */

const matches = (provider: ComponentProvider, item: ComponentItem, q: string) =>
  `${item.label} ${item.keywords ?? ""} ${provider.label}`.toLowerCase().includes(q);

/**
 * Components grouped by provider (AWS, Docker, databases…), each with its logo and colours.
 * Click one to drop it in the middle of the screen, or drag it to where it should go.
 */
export function ComponentGroup({ editor }: { editor: Editor }) {
  const providers = useSyncExternalStore(
    componentCatalog.subscribe,
    componentCatalog.all,
    componentCatalog.all,
  );
  const library = useLibrary(editor);
  // The editor renders only in the browser (no SSR), so storage can be read up front.
  const [state, setState] = useState<Saved>(load);
  const [query, setQuery] = useState("");
  // Functional, so several quick toggles each build on the last.
  const update = (change: (prev: Saved) => Saved) =>
    setState((prev) => {
      const next = change(prev);
      save(next);
      return next;
    });

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      providers
        // This board's cards are listed with its saved shapes, above the rest.
        .filter((p) => p.id !== BOARD_PROVIDER)
        .map((p) => ({ provider: p, items: q ? p.items.filter((i) => matches(p, i, q)) : p.items }))
        .filter((g) => g.items.length),
    [providers, q],
  );
  const own = q ? library.filter((e) => e.label.toLowerCase().includes(q)) : library;

  if (editor.readOnly) return null;

  const toggle = (id: string) =>
    update((s) => ({
      ...s,
      expanded: s.expanded.includes(id) ? s.expanded.filter((e) => e !== id) : [...s.expanded, id],
    }));

  const insertAtCentre = (ref: ComponentRef) => {
    const middle = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    insertComponent(editor, ref, screenToPage(middle, editor.ui.camera));
  };

  return (
    // "user": people who ask their system for less motion get fades without movement.
    <MotionConfig reducedMotion="user">
      <AnimatePresence initial={false}>
        {state.open ? (
          <motion.aside
            key="panel"
            aria-label="Components"
            initial={{ opacity: 0, x: 24, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.97 }}
            transition={PANEL_SPRING}
            style={{ transformOrigin: "top right" }}
            className="absolute top-14 right-3 z-10 flex max-h-[calc(100dvh-136px)] w-66 flex-col overflow-hidden rounded-2xl border bg-white shadow-[0_12px_30px_-18px_rgb(14_14_16/0.45)]"
          >
            <div className="flex items-center justify-between px-3.5 pt-3 pb-2">
              <p className="text-ink text-sm font-semibold">Components</p>
              <button
                type="button"
                title="Hide components"
                aria-label="Hide components"
                onClick={() => update((s) => ({ ...s, open: false }))}
                className="text-ink/60 focus-visible:ring-primary/40 grid size-7 place-items-center rounded-lg outline-none hover:bg-[#f1f1f3] focus-visible:ring-3"
              >
                <PanelRightClose className="size-4" />
              </button>
            </div>
            <div className="px-3 pb-2">
              <label className="focus-within:border-primary focus-within:ring-primary/20 flex h-8 items-center gap-2 rounded-lg border bg-white px-2.5 focus-within:ring-3">
                <Search className="text-ink/40 size-3.5 shrink-0" />
                <input
                  type="search"
                  aria-label="Search components"
                  placeholder="Search Lambda, Postgres, Kafka…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                  className="text-ink placeholder:text-ink/35 min-w-0 flex-1 bg-transparent text-xs outline-none [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setQuery("")}
                    className="text-ink/40 hover:text-ink/70"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </label>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {(!q || own.length > 0) && (
                <BoardSection
                  editor={editor}
                  entries={own}
                  open={!!q || state.expanded.includes(BOARD_PROVIDER)}
                  onToggle={() => toggle(BOARD_PROVIDER)}
                />
              )}
              {filtered.length === 0 && own.length === 0 && (
                <p className="text-ink/50 px-2 py-6 text-center text-xs">
                  Nothing matches “{query.trim()}”.
                </p>
              )}
              {filtered.map(({ provider, items }) => {
                // Searching opens every group with a match.
                const open = !!q || state.expanded.includes(provider.id);
                const accent = readable(provider.color);
                return (
                  <section key={provider.id} className="mb-0.5">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => toggle(provider.id)}
                      className="focus-visible:ring-primary/40 flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left outline-none hover:bg-[#f6f6f7] focus-visible:ring-3"
                    >
                      <span
                        className="grid size-7 shrink-0 place-items-center rounded-lg border"
                        style={{ background: tint(accent, 0.9), borderColor: tint(accent, 0.7) }}
                      >
                        <IconSvg
                          icon={provider.logo}
                          color={provider.logo.kind === "brand" ? provider.logo.hex : accent}
                          size={16}
                        />
                      </span>
                      <span className="text-ink flex-1 text-[13px] font-semibold">
                        {provider.label}
                      </span>
                      <span className="text-ink/40 font-mono text-[10px]">{items.length}</span>
                      <motion.span
                        animate={{ rotate: open ? 90 : 0 }}
                        transition={ACCORDION_EASE}
                        className="text-ink/40 grid place-items-center"
                      >
                        <ChevronRight className="size-3.5" />
                      </motion.span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          key="items"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={ACCORDION_EASE}
                          // Clip while the height animates; the padding is inside so it
                          // collapses too.
                          className="overflow-hidden"
                        >
                          <div className="grid grid-cols-3 gap-1 px-0.5 pt-1 pb-2">
                            {items.map((item) => (
                              <Tile
                                key={item.id}
                                provider={provider}
                                item={item}
                                onInsert={() =>
                                  insertAtCentre({ provider: provider.id, item: item.id })
                                }
                              />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </section>
                );
              })}
            </div>
          </motion.aside>
        ) : (
          <motion.button
            key="launcher"
            type="button"
            onClick={() => update((s) => ({ ...s, open: true }))}
            title="Components"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={PANEL_SPRING}
            className="text-ink focus-visible:ring-primary/40 absolute top-14 right-3 flex h-9 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-semibold shadow-sm outline-none hover:bg-[#f8f8f9] focus-visible:ring-3"
          >
            <Shapes className="size-4" />
            Components
          </motion.button>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

function Tile({
  provider,
  item,
  onInsert,
}: {
  provider: ComponentProvider;
  item: ComponentItem;
  onInsert: () => void;
}) {
  const accent = readable(itemColor(provider, item));
  const iconColor = item.icon.kind === "brand" ? item.icon.hex : accent;
  return (
    <button
      type="button"
      title={`${item.label} (${provider.label}). Click to add, or drag onto the board`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          COMPONENT_DRAG_TYPE,
          JSON.stringify({ provider: provider.id, item: item.id } satisfies ComponentRef),
        );
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onInsert}
      className="focus-visible:ring-primary/40 group flex flex-col items-center gap-1 rounded-xl px-1 pt-2 pb-1.5 outline-none hover:bg-[#f6f6f7] focus-visible:ring-3"
    >
      <span
        className="grid size-9 place-items-center rounded-[10px] border bg-white transition-colors"
        style={{ borderColor: tint(accent, 0.65) }}
      >
        <IconSvg icon={item.icon} color={iconColor} size={20} />
      </span>
      <span className="text-ink/80 line-clamp-2 text-center text-[10.5px] leading-tight font-medium">
        {item.label}
      </span>
    </button>
  );
}

/* ── This board ─────────────────────────────────────────────────────────── */

/**
 * Components made on this board: cards (made with "New component") and saved selections (from
 * "Save as component" on the right-click menu). Shared with everyone on the board.
 */
function BoardSection({
  editor,
  entries,
  open,
  onToggle,
}: {
  editor: Editor;
  entries: LibraryEntry[];
  open: boolean;
  onToggle: () => void;
}) {
  const newCard = () => editor.ui.setLibraryDialog({ kind: "card", id: null });
  return (
    <section className="mb-0.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="focus-visible:ring-primary/40 flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-left outline-none hover:bg-[#f6f6f7] focus-visible:ring-3"
        >
          <span className="bg-primary/10 border-primary/25 text-primary grid size-7 shrink-0 place-items-center rounded-lg border">
            <Shapes className="size-4" />
          </span>
          <span className="text-ink flex-1 text-[13px] font-semibold">This board</span>
          <span className="text-ink/40 font-mono text-[10px]">{entries.length}</span>
          <motion.span
            animate={{ rotate: open ? 90 : 0 }}
            transition={ACCORDION_EASE}
            className="text-ink/40 grid place-items-center"
          >
            <ChevronRight className="size-3.5" />
          </motion.span>
        </button>
        <button
          type="button"
          title="New component"
          aria-label="New component"
          onClick={newCard}
          className="text-ink/60 hover:text-ink focus-visible:ring-primary/40 grid size-7 shrink-0 place-items-center rounded-lg outline-none hover:bg-[#f1f1f3] focus-visible:ring-3"
        >
          <Plus className="size-4" />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="items"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={ACCORDION_EASE}
            className="overflow-hidden"
          >
            {entries.length === 0 ? (
              <div className="px-1.5 pt-1 pb-2">
                <button
                  type="button"
                  onClick={newCard}
                  className="text-ink/55 hover:border-ink/25 hover:text-ink/75 focus-visible:ring-primary/40 w-full rounded-xl border border-dashed px-3 py-3 text-left text-[11.5px] leading-snug outline-none focus-visible:ring-3"
                >
                  <span className="text-ink block font-semibold">Make your own</span>
                  Click to make a card with your own name, icon and colour. Or select shapes,
                  right-click, and choose Save as component.
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1 px-0.5 pt-1 pb-2">
                {entries.map((entry) => (
                  <OwnTile key={entry.id} editor={editor} entry={entry} />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** A preview of saved shapes, as an image so nothing in it can run or load. */
function ShapesPreview({ entry }: { entry: ShapesEntry }) {
  const src = useMemo(() => {
    const svg = shapesPreviewSvg(entry);
    return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null;
  }, [entry]);
  if (!src) return <Shapes className="text-ink/40 size-4" />;
  // eslint-disable-next-line @next/next/no-img-element -- a generated data URI
  return <img src={src} alt="" className="size-full object-contain p-0.5" draggable={false} />;
}

function OwnTile({ editor, entry }: { editor: Editor; entry: LibraryEntry }) {
  const insert = () => {
    const middle = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    insertEntry(editor, entry, screenToPage(middle, editor.ui.camera));
  };
  const accent = entry.kind === "card" ? readable(entry.color) : "#8a8a93";
  const icon = entry.kind === "card" ? resolveIcon(entry.icon, entry.label) : null;
  const action =
    "text-ink/55 hover:text-ink grid size-5 place-items-center rounded-md bg-white shadow-sm ring-1 ring-black/5";
  return (
    <div className="group relative">
      <button
        type="button"
        title={`${entry.label}${entry.kind === "shapes" ? ` (${entry.count} shape${entry.count === 1 ? "" : "s"})` : ""}. Click to add, or drag onto the board`}
        draggable
        onDragStart={(e) => {
          if (entry.kind === "card") {
            e.dataTransfer.setData(
              COMPONENT_DRAG_TYPE,
              JSON.stringify({ provider: BOARD_PROVIDER, item: entry.id } satisfies ComponentRef),
            );
          } else {
            e.dataTransfer.setData(LIBRARY_DRAG_TYPE, entry.id);
          }
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={insert}
        className="focus-visible:ring-primary/40 flex w-full flex-col items-center gap-1 rounded-xl px-1 pt-2 pb-1.5 outline-none hover:bg-[#f6f6f7] focus-visible:ring-3"
      >
        <span
          className="grid size-9 place-items-center overflow-hidden rounded-[10px] border bg-white transition-colors"
          style={{ borderColor: tint(accent, 0.65) }}
        >
          {icon ? (
            <IconSvg icon={icon} color={icon.kind === "brand" ? icon.hex : accent} size={20} />
          ) : (
            <ShapesPreview entry={entry as ShapesEntry} />
          )}
        </span>
        <span className="text-ink/80 line-clamp-2 text-center text-[10.5px] leading-tight font-medium">
          {entry.label}
        </span>
      </button>
      <div className="absolute top-0.5 right-0.5 hidden gap-0.5 group-focus-within:flex group-hover:flex">
        {entry.kind === "card" && (
          <button
            type="button"
            title={`Edit ${entry.label}`}
            aria-label={`Edit ${entry.label}`}
            onClick={() => editor.ui.setLibraryDialog({ kind: "card", id: entry.id })}
            className={action}
          >
            <Pencil className="size-3" />
          </button>
        )}
        <button
          type="button"
          title={`Delete ${entry.label}`}
          aria-label={`Delete ${entry.label}`}
          onClick={() => deleteEntry(editor, entry)}
          className={`${action} hover:text-destructive`}
        >
          <Trash2 className="size-3" />
        </button>
      </div>
    </div>
  );
}
