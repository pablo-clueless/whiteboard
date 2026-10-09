"use client";

import { ImageUp, LayoutTemplate, Search, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "cn";

import { componentCatalog, itemColor } from "./component-catalog";
import { IconSvg, type IconSpec, readable, tint } from "./icons";
import { screenToPage, useEditorStore } from "@/stores/editor";
import type { Editor } from "./editor-core";
import { toast } from "sonner";
import {
  BOARD_PROVIDER,
  type CardEntry,
  DEFAULT_CARD_COLOR,
  getEntry,
  insertEntry,
  type LibraryEntry,
  type LibraryIcon,
  removeEntry,
  resolveIcon,
  restoreEntry,
  saveCard,
  saveSelection,
  usesOf,
} from "./library";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const CARD_COLORS = [
  "#3366ff",
  "#0090ff",
  "#12a594",
  "#1fa463",
  "#7cb342",
  "#ffc53d",
  "#f56e0f",
  "#e5484d",
  "#e8489a",
  "#8e4ec6",
  "#8d5a2b",
  "#4a4a52",
];

/** How many icons the picker shows at once; searching narrows it down. */
const ICON_LIMIT = 72;

const field =
  "text-ink placeholder:text-ink/35 focus-visible:border-primary focus-visible:ring-primary/20 h-9 w-full rounded-lg border bg-white px-3 text-sm outline-none focus-visible:ring-3";
const label = "text-ink/60 mb-1.5 block text-xs font-semibold";
const primary =
  "bg-primary focus-visible:ring-primary/40 h-9 rounded-full px-5 text-sm font-semibold text-white outline-none hover:brightness-105 focus-visible:ring-3 disabled:opacity-40";
const quiet =
  "text-ink focus-visible:ring-primary/40 h-9 rounded-full px-4 text-sm font-semibold outline-none hover:bg-[#f1f1f3] focus-visible:ring-3";

/** Up to two initials from a name: "Billing API" → "BA". */
const initials = (name: string) =>
  name
    .split(/[\s\-_.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** Deletes an entry for everyone, with an Undo on the notice. */
export function deleteEntry(editor: Editor, entry: LibraryEntry) {
  const used = entry.kind === "card" ? usesOf(editor, entry.id) : 0;
  const stored = removeEntry(editor, entry.id);
  const plain = used
    ? ` ${used} card${used === 1 ? "" : "s"} on the board now show${used === 1 ? "s" : ""} a plain look.`
    : "";
  toast(`Deleted “${entry.label}”.${plain}`, {
    action: { label: "Undo", onClick: () => restoreEntry(editor, entry.id, stored) },
  });
}

const middleOfScreen = (editor: Editor) =>
  screenToPage({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, editor.ui.camera);

/** The open dialog for this board's components, if any. */
export function LibraryDialogs({ editor }: { editor: Editor }) {
  const dialog = useEditorStore((s) => s.libraryDialog);
  const close = () => editor.ui.setLibraryDialog(null);
  if (!dialog || editor.readOnly) return null;
  if (dialog.kind === "save")
    return <SaveDialog editor={editor} ids={dialog.ids} onClose={close} />;
  const entry = dialog.id ? getEntry(editor, dialog.id) : null;
  return (
    <CardDialog
      key={dialog.id ?? "new"}
      editor={editor}
      card={entry?.kind === "card" ? entry : null}
      onClose={close}
    />
  );
}

/* ── Card ───────────────────────────────────────────────────────────────── */

type IconTab = "icons" | "letters" | "image";

/**
 * Makes a card for this board (name, caption, icon, colour), or edits one. Cards appear under
 * "This board" in the components panel for everyone on the board.
 */
function CardDialog({
  editor,
  card,
  onClose,
}: {
  editor: Editor;
  card: CardEntry | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(card?.label ?? "");
  const [caption, setCaption] = useState(card?.caption ?? "");
  const [color, setColor] = useState(card?.color ?? DEFAULT_CARD_COLOR);
  // Picking a brand logo suggests its colour, until a colour is picked by hand.
  const [colorTouched, setColorTouched] = useState(!!card);
  // Letters left empty follow the name's initials.
  const [icon, setIcon] = useState<LibraryIcon>(card?.icon ?? { kind: "monogram", text: "" });
  const [tab, setTab] = useState<IconTab>(
    card?.icon.kind === "image" ? "image" : card?.icon.kind === "monogram" ? "letters" : "icons",
  );
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const finalIcon: LibraryIcon =
    icon.kind === "monogram" && !icon.text.trim()
      ? { kind: "monogram", text: initials(name) }
      : icon;
  const ok = !!name.trim() && !uploading;

  const save = () => {
    if (!ok) return;
    const id = saveCard(editor, { label: name, caption, icon: finalIcon, color }, card?.id);
    if (!id) return;
    onClose();
    if (!card) {
      // A new card goes straight onto the board too, so you see what you made.
      const entry = getEntry(editor, id);
      if (entry) insertEntry(editor, entry, middleOfScreen(editor));
    }
  };

  const remove = () => {
    if (!card) return;
    onClose();
    deleteEntry(editor, card);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    const assetId = await editor.uploadImage(file);
    setUploading(false);
    if (assetId) setIcon({ kind: "image", assetId });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-5 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <LayoutTemplate className="size-5" />
            {card ? "Edit component" : "New component"}
          </DialogTitle>
          <DialogDescription>
            Make a card for something the built-in set doesn&apos;t have, like an internal service.
            Everyone on this board can use it from the Components panel.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-5 sm:grid-cols-[1fr_200px]"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor="card-name">
                  Name
                </label>
                <input
                  id="card-name"
                  autoFocus
                  value={name}
                  maxLength={80}
                  placeholder="Billing API"
                  onChange={(e) => setName(e.target.value)}
                  className={field}
                />
              </div>
              <div>
                <label className={label} htmlFor="card-caption">
                  Caption
                </label>
                <input
                  id="card-caption"
                  value={caption}
                  maxLength={80}
                  placeholder="This board"
                  onChange={(e) => setCaption(e.target.value)}
                  className={field}
                />
              </div>
            </div>

            <div>
              <span className={label}>Icon</span>
              <div className="mb-2 grid grid-cols-3 gap-1 rounded-xl bg-[#f3f3f5] p-1">
                {(
                  [
                    ["icons", "Icons"],
                    ["letters", "Letters"],
                    ["image", "Image"],
                  ] as const
                ).map(([value, text]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={tab === value}
                    onClick={() => setTab(value)}
                    className={cn(
                      "focus-visible:ring-primary/40 text-ink h-7 rounded-lg text-xs font-semibold outline-none focus-visible:ring-3",
                      tab === value ? "bg-white shadow-sm" : "text-ink/50 hover:bg-white/60",
                    )}
                  >
                    {text}
                  </button>
                ))}
              </div>
              {tab === "icons" && (
                <IconPicker
                  query={query}
                  onQuery={setQuery}
                  selected={icon.kind === "ref" ? icon : null}
                  accent={readable(color)}
                  onPick={(ref, suggested) => {
                    setIcon({ kind: "ref", provider: ref.provider, item: ref.item });
                    if (!colorTouched && suggested) setColor(suggested);
                  }}
                />
              )}
              {tab === "letters" && (
                <div>
                  <input
                    aria-label="Letters"
                    value={icon.kind === "monogram" ? icon.text : ""}
                    maxLength={3}
                    placeholder={initials(name)}
                    onChange={(e) => setIcon({ kind: "monogram", text: e.target.value })}
                    className={cn(field, "font-semibold uppercase")}
                  />
                  <p className="text-ink/45 mt-1.5 text-[11px]">
                    Up to three letters. Left empty, the name&apos;s initials are used.
                  </p>
                </div>
              )}
              {tab === "image" && (
                <div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      void upload(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="text-ink/70 hover:border-ink/30 focus-visible:ring-primary/40 flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed bg-[#fafafa] text-xs font-medium outline-none focus-visible:ring-3 disabled:opacity-50"
                  >
                    <ImageUp className="size-5 opacity-60" />
                    {uploading
                      ? "Uploading…"
                      : icon.kind === "image"
                        ? "Replace the image"
                        : "Upload a logo (PNG, JPEG, WebP or GIF, up to 5 MB)"}
                  </button>
                </div>
              )}
            </div>

            <div>
              <span className={label}>Colour</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {CARD_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    title={c}
                    aria-label={`Colour ${c}`}
                    aria-pressed={c.toLowerCase() === color.toLowerCase()}
                    onClick={() => {
                      setColor(c);
                      setColorTouched(true);
                    }}
                    className={cn(
                      "focus-visible:ring-primary/40 size-6 rounded-full border outline-none focus-visible:ring-3",
                      c.toLowerCase() === color.toLowerCase() && "ring-ink ring-2 ring-offset-2",
                    )}
                    style={{ background: c }}
                  />
                ))}
                <input
                  type="color"
                  aria-label="Custom colour"
                  value={/^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_CARD_COLOR}
                  onChange={(e) => {
                    setColor(e.target.value);
                    setColorTouched(true);
                  }}
                  className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <span className={label}>Preview</span>
            <CardPreview
              name={name || "Component"}
              caption={caption.trim() || "This board"}
              icon={resolveIcon(finalIcon, name)}
              color={color}
            />
          </div>

          <div className="flex items-center gap-2 sm:col-span-2">
            {card && (
              <button
                type="button"
                onClick={remove}
                className="text-destructive focus-visible:ring-primary/40 mr-auto flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-semibold outline-none hover:bg-red-50 focus-visible:ring-3"
              >
                <Trash2 className="size-4" /> Delete
              </button>
            )}
            <span className="ml-auto" />
            <button type="button" onClick={onClose} className={quiet}>
              Cancel
            </button>
            <button type="submit" disabled={!ok} className={primary}>
              {card ? "Save" : "Create and add"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The card as it'll look on the board (its "Card" look), in the DOM. */
function CardPreview({
  name,
  caption,
  icon,
  color,
}: {
  name: string;
  caption: string;
  icon: IconSpec;
  color: string;
}) {
  const accent = readable(color);
  return (
    <div className="bg-dots grid h-40 place-items-center rounded-xl border bg-[#fafafa] p-3">
      <div
        className="flex h-15 w-full max-w-50 items-center gap-2.5 rounded-[10px] border-[1.5px] px-2.5"
        style={{ background: tint(accent, 0.93), borderColor: accent }}
      >
        <span
          className="grid size-10 shrink-0 place-items-center rounded-lg border bg-white"
          style={{ borderColor: tint(accent, 0.7) }}
        >
          <IconSvg icon={icon} color={icon.kind === "brand" ? icon.hex : accent} size={24} />
        </span>
        <span className="min-w-0">
          <span className="text-ink block truncate text-sm font-semibold">{name}</span>
          <span className="block truncate text-[11px] text-[#6b6b75]">{caption}</span>
        </span>
      </div>
    </div>
  );
}

/** Every icon in the built-in catalog, searchable by name, provider or keyword. */
function IconPicker({
  query,
  onQuery,
  selected,
  accent,
  onPick,
}: {
  query: string;
  onQuery: (q: string) => void;
  selected: { provider: string; item: string } | null;
  accent: string;
  /** `suggested` is the item's own colour, for brand logos. */
  onPick: (ref: { provider: string; item: string }, suggested: string | null) => void;
}) {
  const providers = useSyncExternalStore(
    componentCatalog.subscribe,
    componentCatalog.all,
    componentCatalog.all,
  );
  const q = query.trim().toLowerCase();
  const icons = useMemo(() => {
    const out: { provider: string; item: string; label: string; icon: IconSpec; color: string }[] =
      [];
    for (const p of providers) {
      if (p.id === BOARD_PROVIDER) continue;
      for (const i of p.items) {
        const words = `${i.label} ${i.keywords ?? ""} ${p.label}`.toLowerCase();
        if (q && !words.includes(q)) continue;
        out.push({
          provider: p.id,
          item: i.id,
          label: i.label,
          icon: i.icon,
          color: itemColor(p, i),
        });
      }
    }
    return out;
  }, [providers, q]);

  return (
    <div>
      <label className="focus-within:border-primary focus-within:ring-primary/20 mb-2 flex h-8 items-center gap-2 rounded-lg border bg-white px-2.5 focus-within:ring-3">
        <Search className="text-ink/40 size-3.5 shrink-0" />
        <input
          type="search"
          aria-label="Search icons"
          placeholder="Search icons: server, lock, Stripe…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          className="text-ink placeholder:text-ink/35 min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
      </label>
      <div className="grid h-40 auto-rows-min grid-cols-8 gap-1 overflow-y-auto rounded-xl border bg-[#fafafa] p-1.5">
        {icons.slice(0, ICON_LIMIT).map((i) => {
          const on = selected?.provider === i.provider && selected.item === i.item;
          return (
            <button
              key={`${i.provider}/${i.item}`}
              type="button"
              title={i.label}
              aria-label={i.label}
              aria-pressed={on}
              onClick={() => onPick(i, i.icon.kind === "brand" ? i.color : null)}
              className={cn(
                "focus-visible:ring-primary/40 grid aspect-square place-items-center rounded-lg outline-none hover:bg-white focus-visible:ring-3",
                on && "ring-primary bg-white ring-2",
              )}
            >
              <IconSvg
                icon={i.icon}
                color={i.icon.kind === "brand" ? i.icon.hex : accent}
                size={18}
              />
            </button>
          );
        })}
        {icons.length === 0 && (
          <p className="text-ink/50 col-span-8 py-4 text-center text-xs">
            No icons match “{query.trim()}”.
          </p>
        )}
      </div>
      {icons.length > ICON_LIMIT && (
        <p className="text-ink/45 mt-1.5 text-[11px]">
          Showing {ICON_LIMIT} of {icons.length}. Search to find more.
        </p>
      )}
    </div>
  );
}

/* ── Save selection ─────────────────────────────────────────────────────── */

/** Names the selected shapes and saves them under "This board" in the components panel. */
function SaveDialog({
  editor,
  ids,
  onClose,
}: {
  editor: Editor;
  ids: string[];
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const count = editor.withChildren(ids).length;

  const save = () => {
    const label = name.trim();
    if (!label) return;
    if (saveSelection(editor, ids, label)) {
      onClose();
      editor.notify(`Saved “${label}” to this board's components.`, "info");
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-4 p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <LayoutTemplate className="size-5" /> Save as component
          </DialogTitle>
          <DialogDescription>
            {count === 1 ? "This shape" : `These ${count} shapes`} will appear under This board in
            the Components panel. Everyone on the board can add copies of{" "}
            {count === 1 ? "it" : "them"}, and arrows between them stay attached.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div>
            <label className={label} htmlFor="save-name">
              Name
            </label>
            <input
              id="save-name"
              autoFocus
              value={name}
              maxLength={80}
              placeholder="Login flow"
              onChange={(e) => setName(e.target.value)}
              className={field}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={quiet}>
              Cancel
            </button>
            <button type="submit" disabled={!name.trim()} className={primary}>
              Save
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
