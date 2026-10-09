"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "cn";
import {
  ArrowDown,
  Slash,
  Spline,
  RotateCcw,
  RotateCw,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Minus,
  Plus,
  Trash2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Lock,
  Group,
  Ungroup,
} from "lucide-react";

import type { Editor, ShapeKnobs, StyleProps, ZOrderMove } from "./editor-core";
import { MAX_POINTS, MAX_SIDES, MIN_POINTS, MIN_SIDES } from "./shapes/polygon";
import { HEADER_COLORS, setTableFields } from "./shapes/table-fields";
import { fieldsToText, textToFields } from "./shapes/table-text";
import type { TableField, TableProps } from "./shapes/table";
import { Slider as UiSlider } from "@/components/ui/slider";
import { ARROW_HEADS, type ArrowHead } from "./shapes/line";
import { ARRANGE_ICONS, runArrange } from "./ArrangeMenu";
import { dashArray, STROKE_STYLES } from "./stroke";
import { rememberStickyFill } from "./tools/sticky";
import { shapeRegistry } from "./shapes/registry";
import { useEditorStore } from "@/stores/editor";
import { MAX_STROKE_WIDTH } from "./shapes/box";
import { STICKY_COLORS } from "./shapes/sticky";
import { ALIGN_ACTIONS } from "./align-actions";
import { useShape } from "./sync/useShapes";
import { ARRANGE_MODES } from "./arrange";
import {
  MAX_FONT_SIZE,
  MAX_LETTER_SPACING,
  MAX_LINE_HEIGHT,
  MIN_FONT_SIZE,
  MIN_LETTER_SPACING,
  MIN_LINE_HEIGHT,
  hasTextStyle,
  textBox,
  type TextProps,
  toggleTextStyle,
} from "./shapes/text";
import {
  closestWeight,
  DEFAULT_WEIGHT,
  fontFamily,
  TEXT_FONTS,
  textFontById,
  WEIGHT_NAMES,
} from "./fonts";

const FILLS = [
  { value: "transparent", label: "No fill" },
  { value: "#ffffff", label: "White" },
  { value: "#f1f1f3", label: "Mist" },
  { value: "#c9c9cf", label: "Grey" },
  { value: "#fff1e6", label: "Peach" },
  { value: "#ffd5b0", label: "Apricot" },
  { value: "#ffd449", label: "Yellow" },
  { value: "#fff3b0", label: "Butter" },
  { value: "#d8f2e2", label: "Mint" },
  { value: "#a8e5c0", label: "Green" },
  { value: "#d9e4ff", label: "Sky" },
  { value: "#a9c1ff", label: "Blue" },
  { value: "#e9ddff", label: "Lavender" },
  { value: "#fde0ee", label: "Blush" },
  { value: "#ffb3c7", label: "Rose" },
  { value: "#0e0e10", label: "Ink" },
];

const STROKES = [
  { value: "#0e0e10", label: "Ink" },
  { value: "#4a4a52", label: "Slate" },
  { value: "#8a8a93", label: "Grey" },
  { value: "#ffffff", label: "White" },
  { value: "#f56e0f", label: "Orange" },
  { value: "#c2540a", label: "Rust" },
  { value: "#e5484d", label: "Red" },
  { value: "#e8489a", label: "Pink" },
  { value: "#8e4ec6", label: "Purple" },
  { value: "#3366ff", label: "Blue" },
  { value: "#0090ff", label: "Azure" },
  { value: "#12a594", label: "Teal" },
  { value: "#1fa463", label: "Green" },
  { value: "#7cb342", label: "Lime" },
  { value: "#ffc53d", label: "Amber" },
  { value: "#8d5a2b", label: "Brown" },
];

const WIDTHS = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Medium" },
  { value: 4, label: "Thick" },
];

const MAX_RADIUS = 200;

/** Smallest to largest. Medium (16) is the size new text starts at; any size can be typed. */
export const FONT_SIZES = [
  { value: 12, short: "XS", label: "Extra small" },
  { value: 14, short: "S", label: "Small" },
  { value: 16, short: "M", label: "Medium" },
  { value: 24, short: "L", label: "Large" },
  { value: 32, short: "XL", label: "Extra large" },
  { value: 48, short: "2XL", label: "Huge" },
] as const;

const LAYER_ACTIONS: { move: ZOrderMove; label: string; icon: typeof ArrowUp }[] = [
  { move: "front", label: "Bring to front (Ctrl/⌘ ])", icon: ArrowUpToLine },
  { move: "forward", label: "Bring forward (])", icon: ArrowUp },
  { move: "backward", label: "Send backward ([)", icon: ArrowDown },
  { move: "back", label: "Send to back (Ctrl/⌘ [)", icon: ArrowDownToLine },
];

type Editable = Partial<StyleProps & ShapeKnobs>;

const HEAD_LABELS: Record<ArrowHead | "none", string> = {
  none: "No head",
  arrow: "Arrow",
  triangle: "Hollow triangle (inherits)",
  diamond: "Hollow diamond (aggregation)",
  diamondFilled: "Filled diamond (composition)",
};

/** A short line ending in an arrowhead of each kind, pointing right (or left, flipped). */
function HeadIcon({ kind, flip }: { kind: ArrowHead | null; flip: boolean }) {
  const head =
    kind === "arrow" ? (
      <path d="M17 10 11 6.5v7z" fill="currentColor" />
    ) : kind === "triangle" ? (
      <path d="M18 10 11 6v8z" fill="#fff" stroke="currentColor" strokeWidth={1.4} />
    ) : kind === "diamond" || kind === "diamondFilled" ? (
      <path
        d="M18 10 14 7 10 10 14 13z"
        fill={kind === "diamond" ? "#fff" : "currentColor"}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    ) : null;
  const lineEnd = kind === "arrow" ? 12 : kind ? (kind === "triangle" ? 11 : 10) : 18;
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4"
      aria-hidden
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      <path d={`M2 10H${lineEnd}`} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      {head}
    </svg>
  );
}

/* ── Colour parsing ─────────────────────────────────────────────────────── */

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A hex code (with or without #) or any CSS colour name, normalised; null if it isn't a colour. */
export function parseColor(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (HEX.test(s)) return `#${s.replace(/^#/, "").toLowerCase()}`;
  return typeof CSS !== "undefined" && CSS.supports("color", s) ? s.toLowerCase() : null;
}

let probe: CanvasRenderingContext2D | null = null;

/** #rrggbb for the native colour picker, which only understands that form. */
function toPickerHex(color: string): string {
  probe ??= document.createElement("canvas").getContext("2d");
  if (!probe) return "#000000";
  probe.fillStyle = "#000000";
  probe.fillStyle = color;
  const out = probe.fillStyle; // "#rrggbb", or "rgba(…)" for colours with alpha
  return out.startsWith("#") ? out : "#000000";
}

/* ── Controls ───────────────────────────────────────────────────────────── */

function Swatch({
  color,
  label,
  selected,
  onClick,
}: {
  color: string;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "focus-visible:ring-primary/40 grid size-6 place-items-center rounded outline-none focus-visible:ring-3",
        selected ? "ring-ink ring-1" : "hover:ring-1 hover:ring-[#d4d4da]",
      )}
    >
      <ColorChip color={color} className="size-4.5" />
    </button>
  );
}

function ColorChip({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("rounded border border-black/10", className)}
      style={
        color === "transparent"
          ? {
              background:
                "linear-gradient(135deg, transparent 45%, #e5484d 45%, #e5484d 55%, transparent 55%), white",
            }
          : { background: color }
      }
    />
  );
}

/** Type a hex code or colour name, or pick one. Commits on Enter or when focus leaves. */
function ColorInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (c: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const errorId = useId();

  // The native picker fires `input` continuously while dragging; only commit when it closes.
  useEffect(() => {
    const el = picker.current;
    if (!el) return;
    const onChange = () => onCommit(el.value);
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [onCommit]);

  const commit = () => {
    if (draft.trim() === value) return setInvalid(false);
    const color = parseColor(draft);
    setInvalid(!color);
    if (color) onCommit(color);
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1.5">
        <label
          title={`Pick a ${label.toLowerCase()}`}
          className="focus-within:ring-primary/40 relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border focus-within:ring-3"
        >
          <ColorChip color={value} className="size-5" />
          <input
            ref={picker}
            type="color"
            aria-label={`Pick a ${label.toLowerCase()}`}
            defaultValue={toPickerHex(value)}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
        <input
          type="text"
          aria-label={`${label} as hex code or colour name`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          value={draft}
          spellCheck={false}
          placeholder="#ff8800 or tomato"
          onChange={(e) => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(value);
              setInvalid(false);
            }
          }}
          className={cn(
            "text-ink h-8 min-w-0 flex-1 rounded-lg border bg-white px-2 font-mono text-xs outline-none",
            "focus-visible:border-primary focus-visible:ring-primary/20 focus-visible:ring-3",
            invalid && "border-destructive focus-visible:border-destructive",
          )}
        />
      </div>
      {invalid && (
        <p id={errorId} className="text-destructive mt-1 text-[11px] leading-snug">
          Not a colour. Try a hex code like #ff8800 or a name like tomato.
        </p>
      )}
    </div>
  );
}

/** A number box that commits on Enter or blur, clamped to its range. */
function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === "" || !Number.isFinite(n)) return setDraft(String(value));
    const clamped = Math.min(max, Math.max(min, Math.round(n / step) * step));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };
  return (
    <label className="focus-within:border-primary focus-within:ring-primary/20 flex h-8 w-17 shrink-0 items-center rounded-lg border bg-white pr-2 focus-within:ring-3">
      <input
        type="number"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setDraft(String(value));
        }}
        className="text-ink w-full min-w-0 [appearance:textfield] bg-transparent pl-2 font-mono text-xs tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="text-ink/40 text-[11px]">{suffix}</span>}
    </label>
  );
}

/** A one-line text box that commits on Enter or blur; Escape puts the old text back. */
/**
 * A table's fields as editable text, one per line (`name type pk fk // note`). Saves on
 * Ctrl/⌘+Enter or when focus leaves; Escape puts it back.
 */
function FieldsEditor({
  editor,
  id,
  fields,
}: {
  editor: Editor;
  id: string;
  fields: TableField[];
}) {
  const original = fieldsToText(fields);
  const [draft, setDraft] = useState(original);
  const commit = () => {
    if (draft === original) return;
    const next = textToFields(draft);
    if (!next.length) return setDraft(original); // a table keeps at least one field
    setTableFields(editor, id, next);
  };
  return (
    <div>
      <textarea
        aria-label="Fields"
        value={draft}
        spellCheck={false}
        rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === "Escape") setDraft(original);
        }}
        className="text-ink focus-visible:border-primary focus-visible:ring-primary/20 w-full resize-y rounded-lg border bg-[#fafafa] px-2.5 py-2 font-mono text-[11px] leading-relaxed outline-none focus-visible:ring-3"
      />
      <p className="text-ink/45 mt-1 text-[10.5px] leading-snug">
        One per line: <code>name type pk fk // note</code>. Arrows stay on their fields.
      </p>
    </div>
  );
}

function TextField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (s: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (!next) return setDraft(value);
    if (next !== value) onCommit(next);
  };
  return (
    <input
      type="text"
      aria-label={label}
      value={draft}
      maxLength={200}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value);
      }}
      className="text-ink focus-visible:border-primary focus-visible:ring-primary/20 h-8 w-full rounded-lg border bg-white px-2.5 text-xs outline-none focus-visible:ring-3"
    />
  );
}

/** A slider whose whole drag undoes as one step. */
function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  editor,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  editor: Editor;
  onChange: (n: number) => void;
}) {
  return (
    <UiSlider
      thumbLabel={label}
      min={min}
      max={max}
      step={step}
      // An array, so the shadcn wrapper renders exactly one thumb.
      value={[Math.min(max, value)]}
      onPointerDown={() => {
        editor.startGesture();
        // The release can land outside the slider; listen on the window so the gesture always ends.
        const end = () => {
          editor.endGesture();
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
      }}
      onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      // Same height as the number box beside it, with the track centred in that height. The
      // default muted track nearly vanishes on the white panel.
      className="flex h-8 min-w-0 flex-1 items-center **:data-[slot=slider-track]:bg-[#e6e6ea]"
    />
  );
}

function Stepper({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
}) {
  const button =
    "text-ink/70 focus-visible:ring-primary/40 grid size-8 place-items-center rounded-lg outline-none hover:bg-white focus-visible:ring-3 disabled:opacity-35";
  return (
    <div className="flex items-center gap-1 rounded-xl bg-[#f3f3f5] p-0.5">
      <button
        type="button"
        aria-label={`Fewer ${label.toLowerCase()}`}
        disabled={value <= min}
        onClick={() => onCommit(value - 1)}
        className={button}
      >
        <Minus className="size-3.5" />
      </button>
      <span
        className="text-ink w-6 text-center font-mono text-xs tabular-nums"
        aria-live="polite"
        aria-label={`${value} ${label.toLowerCase()}`}
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={value >= max}
        onClick={() => onCommit(value + 1)}
        className={button}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={title}>
      <p className="text-ink/50 mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </p>
      {children}
    </div>
  );
}

/**
 * Point editing for one line, arrow or polygon: start and finish it, and make the picked edge
 * (or every edge) straight or curved.
 */
function PointsSection({
  editor,
  id,
  editing,
}: {
  editor: Editor;
  id: string;
  editing: { id: string; node: number | null; edge: number | null } | null;
}) {
  const on = editing?.id === id;
  const outline = editor.readNodes(id);
  if (!outline) return null;
  const edge = on ? editing.edge : null;
  const curved = edge !== null ? !!outline.curves[edge] : outline.curves.some(Boolean);
  const allCurved = outline.curves.length > 0 && outline.curves.every(Boolean);
  const pill =
    "focus-visible:ring-primary/40 text-ink h-7 rounded-lg text-xs font-semibold outline-none focus-visible:ring-3";
  return (
    <Section title={edge !== null ? "Points · picked edge" : "Points"}>
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={() => editor.ui.setEditingNodes(on ? null : { id, node: null, edge: null })}
          title={
            on ? "Finish editing points (Enter or Esc)" : "Move, add and remove points (Enter)"
          }
          className={cn(
            pill,
            "flex w-full items-center justify-center gap-1.5 border",
            on ? "bg-primary border-primary text-white" : "bg-white hover:bg-[#f8f8f9]",
          )}
        >
          <Spline className="size-3.5" />
          {on ? "Done editing points" : "Edit points"}
        </button>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f3f3f5] p-1">
          {(
            [
              [false, "Straight"],
              [true, "Curved"],
            ] as const
          ).map(([value, label]) => {
            const pressed = edge !== null ? curved === value : value ? allCurved : !curved;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={pressed}
                title={
                  edge !== null
                    ? `Make the picked edge ${label.toLowerCase()}`
                    : `Make every edge ${label.toLowerCase()}${value ? " (a smooth curve through the points)" : ""}`
                }
                onClick={() => editor.setEdgesCurved(id, value, edge !== null ? [edge] : undefined)}
                className={cn(
                  pill,
                  pressed ? "bg-white shadow-sm" : "text-ink/50 hover:bg-white/60",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        {on && (
          <p className="text-ink/50 text-[11px] leading-snug">
            {editing.node !== null
              ? "Drag to move the point; Delete removes it."
              : edge !== null
                ? "Straight or Curved applies to this edge. Drag its dot to add a point."
                : "Drag a point to move it, or an edge's dot to add one. Click a dot to pick that edge."}
          </p>
        )}
      </div>
    </Section>
  );
}

/* ── Panel ──────────────────────────────────────────────────────────────── */

/**
 * Style, shape and layer controls for the selection. Each section shows only when the (first)
 * selected shape has that prop, so custom shapes get controls just by using the same prop names.
 */
export function StylePanel({ editor }: { editor: Editor }) {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const editingNodes = useEditorStore((s) => s.editingNodes);
  const first = useShape(editor, selectedIds[0] ?? "");
  if (!selectedIds.length || !first) return null;

  // Locked shapes can't be styled; say so rather than show controls that do nothing.
  if (selectedIds.every((id) => editor.getShape(id)?.locked)) {
    return (
      <aside
        aria-label="Selection style"
        className="absolute top-3 left-3 flex w-59 items-center gap-2.5 rounded-2xl border bg-white p-3 shadow-[0_12px_30px_-18px_rgb(14_14_16/0.45)]"
      >
        <Lock className="text-ink/50 size-4 shrink-0" />
        <p className="text-ink/70 flex-1 text-xs">
          {selectedIds.length === 1 ? "This shape is locked." : "These shapes are locked."}
        </p>
        <button
          type="button"
          onClick={() => editor.setLocked(selectedIds, false)}
          className="text-ink focus-visible:ring-primary/40 h-7 rounded-lg border px-2.5 text-xs font-semibold outline-none hover:bg-[#f6f6f7] focus-visible:ring-3"
        >
          Unlock
        </button>
      </aside>
    );
  }

  // Validated, so shapes saved before a prop existed still show its control (at the default).
  const def = shapeRegistry.get(first.type);
  let props: Editable;
  try {
    props = ((def ? def.validate(first.props) : first.props) ?? {}) as Editable;
  } catch {
    props = (first.props ?? {}) as Editable;
  }
  const has = (key: keyof Editable) => key in props;
  const set = (patch: Editable) => editor.setStyle(patch);
  const setLive = (patch: Editable) => editor.setStyle(patch, { transient: true });
  const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
  const alignTo = editor.readOnly ? null : editor.alignTarget(selectedIds);
  const textsSelected = selectedIds
    .map((id) => editor.getValidShape(id))
    .filter((s) => s?.type === "text")
    .map((s) => s!.props as TextProps);

  /**
   * Turns wrapping on (each text keeps its current width, so nothing moves until you narrow it)
   * or off (boxes grow to fit again). Per shape, since each has its own width.
   */
  const setWrap = (wrap: boolean) => {
    const patches: Parameters<Editor["updateShapes"]>[0] = {};
    for (const id of selectedIds) {
      const s = editor.getValidShape(id);
      if (!s || s.locked || s.type !== "text") continue;
      const p = s.props as TextProps;
      if ((p.width != null) === wrap) continue;
      patches[id] = { props: { ...p, width: wrap ? Math.ceil(textBox(p).w) : null } };
    }
    if (!Object.keys(patches).length) return;
    editor.markHistory();
    editor.updateShapes(patches);
    editor.markHistory();
  };

  return (
    <aside
      aria-label="Selection style"
      // Keyed by shape so the text inputs reset when the selection changes.
      key={first.id}
      className="absolute top-3 left-3 max-h-[calc(100dvh-96px)] w-68 space-y-4 overflow-y-auto rounded-2xl border bg-white p-3.5 shadow-[0_12px_30px_-18px_rgb(14_14_16/0.45)]"
    >
      {first.type === "db-table" && (
        <Section title="Fields">
          <FieldsEditor
            // A fresh editor whenever the fields change from elsewhere (undo, someone else).
            key={fieldsToText((props as unknown as TableProps).fields)}
            editor={editor}
            id={first.id}
            fields={(props as unknown as TableProps).fields}
          />
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {HEADER_COLORS.map((c) => (
              <Swatch
                key={c.value}
                color={c.value}
                label={`${c.label} header`}
                selected={same((props as unknown as TableProps).headerColor, c.value)}
                onClick={() => {
                  editor.markHistory();
                  editor.updateShapes(
                    Object.fromEntries(
                      selectedIds
                        .map((id) => editor.getValidShape(id))
                        .filter((s) => s?.type === "db-table" && !s.locked)
                        .map((s) => [
                          s!.id,
                          { props: { ...(s!.props as object), headerColor: c.value } },
                        ]),
                    ),
                  );
                  editor.markHistory();
                }}
              />
            ))}
          </div>
        </Section>
      )}

      {def?.variants && has("variant") && (
        <Section title="Look">
          <div
            className="grid gap-1 rounded-xl bg-[#f3f3f5] p-1"
            style={{ gridTemplateColumns: `repeat(${def.variants.length}, minmax(0, 1fr))` }}
          >
            {def.variants.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={props.variant === v.id}
                onClick={() => set({ variant: v.id, ...(v.size ?? {}) })}
                className={cn(
                  "focus-visible:ring-primary/40 text-ink h-7 rounded-lg text-xs font-semibold outline-none focus-visible:ring-3",
                  props.variant === v.id ? "bg-white shadow-sm" : "text-ink/50 hover:bg-white/60",
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        </Section>
      )}
      {has("label") && (
        <Section title="Label">
          <TextField
            key={props.label}
            label="Label"
            value={props.label ?? ""}
            onCommit={(label) => set({ label })}
          />
        </Section>
      )}
      {first.type === "sticky" && (
        <Section title="Note colour">
          <div className="grid grid-cols-8 gap-1.5">
            {STICKY_COLORS.map((c) => (
              <Swatch
                key={c.value}
                color={c.value}
                label={c.label}
                selected={same(props.fill, c.value)}
                onClick={() => {
                  // The next note placed comes out in this colour too.
                  rememberStickyFill(c.value);
                  set({ fill: c.value });
                }}
              />
            ))}
          </div>
          <ColorInput
            key={props.fill}
            label="Note colour"
            value={props.fill!}
            onCommit={(fill) => set({ fill })}
          />
        </Section>
      )}
      {has("fill") && first.type !== "sticky" && (
        <Section title="Fill">
          <div className="grid grid-cols-8 gap-1.5">
            {FILLS.map((f) => (
              <Swatch
                key={f.value}
                color={f.value}
                label={f.label}
                selected={same(props.fill, f.value)}
                onClick={() => set({ fill: f.value })}
              />
            ))}
          </div>
          <ColorInput
            key={props.fill}
            label="Fill colour"
            value={props.fill!}
            onCommit={(fill) => set({ fill })}
          />
        </Section>
      )}
      {has("stroke") && (
        <Section title="Stroke">
          <div className="grid grid-cols-8 gap-1.5">
            {STROKES.map((s) => (
              <Swatch
                key={s.value}
                color={s.value}
                label={s.label}
                selected={same(props.stroke, s.value)}
                onClick={() => set({ stroke: s.value })}
              />
            ))}
          </div>
          <ColorInput
            key={props.stroke}
            label="Stroke colour"
            value={props.stroke!}
            onCommit={(stroke) => set({ stroke })}
          />
        </Section>
      )}
      {has("color") && (
        <Section title="Text colour">
          <div className="grid grid-cols-8 gap-1.5">
            {STROKES.map((s) => (
              <Swatch
                key={s.value}
                color={s.value}
                label={s.label}
                selected={same(props.color, s.value)}
                onClick={() => set({ color: s.value })}
              />
            ))}
          </div>
          <ColorInput
            key={props.color}
            label="Text colour"
            value={props.color!}
            onCommit={(color) => set({ color })}
          />
        </Section>
      )}
      {has("markdown") && (
        <Section title="Format">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f3f3f5] p-1">
            {(
              [
                [true, "Markdown"],
                [false, "Plain text"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={label}
                type="button"
                aria-pressed={props.markdown === value}
                title={
                  value
                    ? "# headings, **bold**, *italic*, `code`, - lists, - [ ] tasks, > quotes, [links](https://…)"
                    : "Show the text exactly as typed"
                }
                onClick={() => set({ markdown: value })}
                className={cn(
                  "focus-visible:ring-primary/40 text-ink h-7 rounded-lg text-xs font-semibold outline-none focus-visible:ring-3",
                  props.markdown === value ? "bg-white shadow-sm" : "text-ink/50 hover:bg-white/60",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>
      )}
      {has("clip") && (
        <Section title="Contents">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f3f3f5] p-1">
            {(
              [
                [true, "Clip", "Hide whatever spills over the frame's edges"],
                [false, "Show all", "Let what's inside spill over the edges"],
              ] as const
            ).map(([value, label, title]) => (
              <button
                key={label}
                type="button"
                aria-pressed={props.clip === value}
                title={title}
                onClick={() => set({ clip: value })}
                className={cn(
                  "focus-visible:ring-primary/40 text-ink h-7 rounded-lg text-xs font-semibold outline-none focus-visible:ring-3",
                  props.clip === value ? "bg-white shadow-sm" : "text-ink/50 hover:bg-white/60",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Section>
      )}
      {first.type === "text" && (
        <Section title="Style">
          <div className="grid grid-cols-4 gap-1 rounded-xl bg-[#f3f3f5] p-1">
            {(
              [
                ["bold", "Bold (Ctrl/⌘ B)", Bold],
                ["italic", "Italic (Ctrl/⌘ I)", Italic],
                ["underline", "Underline (Ctrl/⌘ U)", Underline],
                ["strike", "Strikethrough (Ctrl/⌘ Shift X)", Strikethrough],
              ] as const
            ).map(([key, label, Icon]) => {
              const on =
                textsSelected.length > 0 && textsSelected.every((p) => hasTextStyle(p, key));
              return (
                <button
                  key={key}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={on}
                  onClick={() => toggleTextStyle(editor, selectedIds, key)}
                  className={cn(
                    "focus-visible:ring-primary/40 grid h-7 place-items-center rounded-lg outline-none focus-visible:ring-3",
                    on ? "text-ink bg-white shadow-sm" : "text-ink/55 hover:bg-white/60",
                  )}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
          </div>
        </Section>
      )}

      {has("fontFamily") && (
        <Section title="Typeface">
          <div className="grid gap-1 rounded-xl bg-[#f3f3f5] p-1">
            {TEXT_FONTS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={props.fontFamily === f.id}
                onClick={() =>
                  set({
                    fontFamily: f.id,
                    // Keep the weight if the new face has it, otherwise the nearest one it does.
                    fontWeight: closestWeight(f.id, props.fontWeight ?? DEFAULT_WEIGHT),
                  })
                }
                className={cn(
                  "focus-visible:ring-primary/40 text-ink flex h-8 items-center justify-between rounded-lg px-2.5 outline-none focus-visible:ring-3",
                  props.fontFamily === f.id ? "bg-white shadow-sm" : "hover:bg-white/60",
                )}
              >
                {/* Each name is set in its own typeface, which also loads it for the canvas. */}
                <span className="text-sm" style={{ fontFamily: fontFamily(f.id) }}>
                  {f.label}
                </span>
                <span className="text-ink/40 font-mono text-[10px]">
                  {f.weights[0]}–{f.weights[f.weights.length - 1]}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
      {has("fontWeight") && (
        <Section title={`Weight · ${WEIGHT_NAMES[props.fontWeight ?? DEFAULT_WEIGHT] ?? ""}`}>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#f3f3f5] p-1">
            {textFontById(props.fontFamily ?? "").weights.map((w) => (
              <button
                key={w}
                type="button"
                title={`${WEIGHT_NAMES[w]} (${w})`}
                aria-label={`${WEIGHT_NAMES[w]} weight`}
                aria-pressed={props.fontWeight === w}
                onClick={() => set({ fontWeight: w })}
                style={{ fontFamily: fontFamily(props.fontFamily ?? ""), fontWeight: w }}
                className={cn(
                  "focus-visible:ring-primary/40 text-ink grid h-7 place-items-center rounded-lg text-sm outline-none focus-visible:ring-3",
                  props.fontWeight === w ? "bg-white shadow-sm" : "hover:bg-white/60",
                )}
              >
                {w}
              </button>
            ))}
          </div>
        </Section>
      )}
      {has("fontSize") && (
        <Section title="Font size">
          <div className="flex items-center gap-1.5">
            <div className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-[#f3f3f5] p-1">
              {FONT_SIZES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  title={`${f.label} (${f.value})`}
                  aria-label={`${f.label} text`}
                  aria-pressed={props.fontSize === f.value}
                  onClick={() => set({ fontSize: f.value })}
                  className={cn(
                    "focus-visible:ring-primary/40 text-ink grid h-7 place-items-center rounded-lg text-xs font-semibold outline-none focus-visible:ring-3",
                    props.fontSize === f.value ? "bg-white shadow-sm" : "hover:bg-white/60",
                  )}
                >
                  {f.short}
                </button>
              ))}
            </div>
            <NumberInput
              key={props.fontSize}
              label="Font size"
              value={props.fontSize!}
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              suffix="px"
              onCommit={(fontSize) => set({ fontSize })}
            />
          </div>
        </Section>
      )}
      {has("align") && has("lineHeight") && (
        <Section title="Paragraph">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <div className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-[#f3f3f5] p-1">
                {(
                  [
                    [false, "Auto", "The box grows to fit the longest line"],
                    [true, "Wrap", "Lines wrap at the box's width (or drag a side handle)"],
                  ] as const
                ).map(([wrap, label, title]) => (
                  <button
                    key={label}
                    type="button"
                    title={title}
                    aria-pressed={(props.width != null) === wrap}
                    onClick={() => setWrap(wrap)}
                    className={cn(
                      "focus-visible:ring-primary/40 text-ink h-7 rounded-lg text-xs font-semibold outline-none focus-visible:ring-3",
                      (props.width != null) === wrap
                        ? "bg-white shadow-sm"
                        : "text-ink/50 hover:bg-white/60",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-0.5 rounded-xl bg-[#f3f3f5] p-1">
                {(
                  [
                    ["left", "Align left", AlignLeft],
                    ["center", "Align centre", AlignCenter],
                    ["right", "Align right", AlignRight],
                  ] as const
                ).map(([align, label, Icon]) => (
                  <button
                    key={align}
                    type="button"
                    title={label}
                    aria-label={label}
                    aria-pressed={props.align === align}
                    onClick={() => set({ align })}
                    className={cn(
                      "focus-visible:ring-primary/40 grid size-7 place-items-center rounded-lg outline-none focus-visible:ring-3",
                      props.align === align
                        ? "text-ink bg-white shadow-sm"
                        : "text-ink/50 hover:bg-white/60",
                    )}
                  >
                    <Icon className="size-3.5" />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink/70 w-16 shrink-0 text-xs">Line height</span>
              <Slider
                label="Line height"
                editor={editor}
                value={props.lineHeight ?? 1.25}
                min={MIN_LINE_HEIGHT}
                max={MAX_LINE_HEIGHT}
                step={0.05}
                onChange={(lineHeight) => setLive({ lineHeight })}
              />
              <NumberInput
                key={props.lineHeight}
                label="Line height"
                value={props.lineHeight ?? 1.25}
                min={MIN_LINE_HEIGHT}
                max={MAX_LINE_HEIGHT}
                step={0.05}
                suffix="×"
                onCommit={(lineHeight) => set({ lineHeight })}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink/70 w-16 shrink-0 text-xs">Letters</span>
              <Slider
                label="Letter spacing"
                editor={editor}
                value={props.letterSpacing ?? 0}
                min={MIN_LETTER_SPACING}
                max={20}
                step={0.5}
                onChange={(letterSpacing) => setLive({ letterSpacing })}
              />
              <NumberInput
                key={props.letterSpacing}
                label="Letter spacing"
                value={props.letterSpacing ?? 0}
                min={MIN_LETTER_SPACING}
                max={MAX_LETTER_SPACING}
                step={0.5}
                suffix="px"
                onCommit={(letterSpacing) => set({ letterSpacing })}
              />
            </div>
          </div>
        </Section>
      )}
      {has("route") && (
        <Section title="Line style">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-[#f3f3f5] p-1">
            {(
              [
                ["elbow", "Curved", Spline],
                ["straight", "Straight", Slash],
              ] as const
            ).map(([route, label, Icon]) => (
              <button
                key={route}
                type="button"
                aria-pressed={props.route === route}
                onClick={() => set({ route })}
                className={cn(
                  "focus-visible:ring-primary/40 text-ink flex h-7 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold outline-none focus-visible:ring-3",
                  props.route === route ? "bg-white shadow-sm" : "text-ink/50 hover:bg-white/60",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
        </Section>
      )}
      {selectedIds.length === 1 && editor.canEditNodes(selectedIds[0]) && (
        <PointsSection editor={editor} id={selectedIds[0]} editing={editingNodes} />
      )}
      {has("arrowStart") && (
        <Section title="Arrowheads">
          <div className="space-y-1.5">
            {(
              [
                ["arrowStart", "startHead", "Start"],
                ["arrowEnd", "endHead", "End"],
              ] as const
            ).map(([on, kindKey, end]) => {
              const current = props[on] ? (props[kindKey] ?? "arrow") : null;
              return (
                <div key={on} className="flex items-center gap-2">
                  <span className="text-ink/55 w-8 text-[11px] font-semibold">{end}</span>
                  <div className="grid flex-1 grid-cols-5 gap-0.5 rounded-xl bg-[#f3f3f5] p-1">
                    {([null, ...ARROW_HEADS] as const).map((kind) => (
                      <button
                        key={kind ?? "none"}
                        type="button"
                        title={`${end}: ${HEAD_LABELS[kind ?? "none"]}`}
                        aria-label={`${end}: ${HEAD_LABELS[kind ?? "none"]}`}
                        aria-pressed={current === kind}
                        onClick={() =>
                          set(kind ? { [on]: true, [kindKey]: kind } : { [on]: false })
                        }
                        className={cn(
                          "focus-visible:ring-primary/40 grid h-7 place-items-center rounded-lg outline-none focus-visible:ring-3",
                          current === kind
                            ? "text-ink bg-white shadow-sm"
                            : "text-ink/50 hover:bg-white/60",
                        )}
                      >
                        <HeadIcon kind={kind} flip={on === "arrowStart"} />
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
      {has("strokeWidth") && (
        <Section title="Stroke width">
          <div className="flex items-center gap-1.5">
            <div className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-[#f3f3f5] p-1">
              {WIDTHS.map((w) => (
                <button
                  key={w.value}
                  type="button"
                  title={`${w.label} (${w.value})`}
                  aria-label={w.label}
                  aria-pressed={props.strokeWidth === w.value}
                  onClick={() => set({ strokeWidth: w.value })}
                  className={cn(
                    "focus-visible:ring-primary/40 grid h-7 place-items-center rounded-lg outline-none focus-visible:ring-3",
                    props.strokeWidth === w.value ? "bg-white shadow-sm" : "hover:bg-white/60",
                  )}
                >
                  <span className="bg-ink w-5 rounded-full" style={{ height: w.value + 1 }} />
                </button>
              ))}
            </div>
            <NumberInput
              key={props.strokeWidth}
              label="Stroke width"
              value={props.strokeWidth!}
              min={0}
              max={MAX_STROKE_WIDTH}
              step={0.5}
              suffix="px"
              onCommit={(strokeWidth) => set({ strokeWidth })}
            />
          </div>
        </Section>
      )}
      {has("strokeStyle") && (
        <Section title="Line style">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-[#f3f3f5] p-1">
            {STROKE_STYLES.map((s) => (
              <button
                key={s.value}
                type="button"
                title={s.label}
                aria-label={`${s.label} line`}
                aria-pressed={props.strokeStyle === s.value}
                onClick={() => set({ strokeStyle: s.value })}
                className={cn(
                  "focus-visible:ring-primary/40 text-ink grid h-7 place-items-center rounded-lg outline-none focus-visible:ring-3",
                  props.strokeStyle === s.value ? "bg-white shadow-sm" : "hover:bg-white/60",
                )}
              >
                <svg width="28" height="8" viewBox="0 0 28 8" aria-hidden>
                  <path
                    d="M2 4H26"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeDasharray={dashArray(s.value, 2)?.join(" ")}
                  />
                </svg>
              </button>
            ))}
          </div>
        </Section>
      )}
      {has("radius") && (
        <Section title="Corner radius">
          <div className="flex items-center gap-2">
            <Slider
              label="Corner radius"
              editor={editor}
              value={props.radius!}
              min={0}
              max={MAX_RADIUS}
              onChange={(radius) => setLive({ radius })}
            />
            <NumberInput
              key={props.radius}
              label="Corner radius"
              value={props.radius!}
              min={0}
              max={999}
              suffix="px"
              onCommit={(radius) => set({ radius })}
            />
          </div>
        </Section>
      )}
      {has("sides") && (
        <Section title="Sides">
          <Stepper
            label="Sides"
            value={props.sides!}
            min={MIN_SIDES}
            max={MAX_SIDES}
            onCommit={(sides) => set({ sides })}
          />
        </Section>
      )}
      {has("points") && (
        <Section title="Star">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-ink/70 text-xs">Points</span>
              <Stepper
                label="Points"
                value={props.points!}
                min={MIN_POINTS}
                max={MAX_POINTS}
                onCommit={(points) => set({ points })}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-ink/70 w-14 shrink-0 text-xs">Inner size</span>
              <Slider
                label="Inner size"
                editor={editor}
                value={Math.round((props.innerRatio ?? 0.45) * 100)}
                min={10}
                max={95}
                onChange={(pct) => setLive({ innerRatio: pct / 100 })}
              />
              <span className="text-ink/60 w-8 text-right font-mono text-xs tabular-nums">
                {Math.round((props.innerRatio ?? 0.45) * 100)}%
              </span>
            </div>
          </div>
        </Section>
      )}
      {alignTo && (
        <Section title={alignTo.under ? "Align to the shape underneath" : "Align"}>
          <div className="grid grid-cols-6 gap-0.5 rounded-xl bg-[#f3f3f5] p-1">
            {ALIGN_ACTIONS.map((a) => (
              <button
                key={a.edge}
                type="button"
                title={`${a.label} (Alt ${a.key})`}
                aria-label={a.label}
                onClick={() => editor.align(selectedIds, a.edge)}
                className="text-ink/70 focus-visible:ring-primary/40 grid h-7 place-items-center rounded-lg outline-none hover:bg-white focus-visible:ring-3"
              >
                <a.icon className="size-4" />
              </button>
            ))}
          </div>
        </Section>
      )}

      {!editor.readOnly && editor.arrangesSelection(selectedIds) && (
        <Section title="Arrange">
          <div className="grid grid-cols-4 gap-0.5 rounded-xl bg-[#f3f3f5] p-1">
            {ARRANGE_MODES.map(({ mode, label, description }) => {
              const Icon = ARRANGE_ICONS[mode];
              return (
                <button
                  key={mode}
                  type="button"
                  title={`${label}: ${description}`}
                  aria-label={label}
                  onClick={() => runArrange(editor, mode)}
                  className="text-ink/70 focus-visible:ring-primary/40 grid h-7 place-items-center rounded-lg outline-none hover:bg-white focus-visible:ring-3"
                >
                  <Icon className="size-4" />
                </button>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Opacity">
        <div className="flex items-center gap-2">
          <Slider
            label="Opacity"
            editor={editor}
            value={Math.round((first.opacity ?? 1) * 100)}
            min={0}
            max={100}
            onChange={(pct) => editor.setOpacity(selectedIds, pct / 100, { transient: true })}
          />
          <NumberInput
            key={first.opacity}
            label="Opacity in percent"
            value={Math.round((first.opacity ?? 1) * 100)}
            min={0}
            max={100}
            suffix="%"
            onCommit={(pct) => editor.setOpacity(selectedIds, pct / 100)}
          />
        </div>
      </Section>

      <Section title="Rotation">
        <div className="flex items-center gap-2">
          <Slider
            label="Rotation"
            editor={editor}
            value={first.rotation}
            min={-180}
            max={180}
            onChange={(deg) => editor.setRotation(deg, { transient: true })}
          />
          <NumberInput
            key={first.rotation}
            label="Rotation in degrees"
            value={first.rotation}
            min={-360}
            max={360}
            suffix="°"
            onCommit={(deg) => editor.setRotation(deg)}
          />
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          {(
            [
              ["Rotate 90° left", -90, RotateCcw],
              ["Rotate 90° right", 90, RotateCw],
            ] as const
          ).map(([label, step, Icon]) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              // Read the live angle so rapid clicks each add a full step.
              onClick={() => editor.setRotation((editor.getShape(first.id)?.rotation ?? 0) + step)}
              className="text-ink/70 focus-visible:ring-primary/40 grid size-8 place-items-center rounded-lg outline-none hover:bg-[#f1f1f3] focus-visible:ring-3"
            >
              <Icon className="size-4" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => editor.setRotation(0)}
            disabled={first.rotation === 0}
            className="text-ink/70 focus-visible:ring-primary/40 h-8 rounded-lg px-2.5 text-xs font-semibold outline-none hover:bg-[#f1f1f3] focus-visible:ring-3 disabled:opacity-35"
          >
            Reset to 0°
          </button>
        </div>
      </Section>
      <Section title="Layer">
        <div className="flex items-center justify-around gap-1">
          {LAYER_ACTIONS.map(({ move, label, icon: Icon }) => (
            <button
              key={move}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => editor.reorder(selectedIds, move)}
              className="text-ink/70 focus-visible:ring-primary/40 grid size-8 place-items-center rounded-lg outline-none hover:bg-[#f1f1f3] focus-visible:ring-3"
            >
              <Icon className="size-4" />
            </button>
          ))}
          {editor.unitCount(selectedIds) > 1 && (
            <button
              type="button"
              title="Group (Ctrl/⌘ G)"
              aria-label="Group"
              onClick={() =>
                editor.group(selectedIds) && editor.select(editor.expandToUnits(selectedIds))
              }
              className="text-ink/70 focus-visible:ring-primary/40 grid size-8 place-items-center rounded-lg outline-none hover:bg-[#f1f1f3] focus-visible:ring-3"
            >
              <Group className="size-4" />
            </button>
          )}
          {editor.groupsIn(selectedIds).length > 0 && (
            <button
              type="button"
              title="Ungroup (Ctrl/⌘ Shift G)"
              aria-label="Ungroup"
              onClick={() =>
                editor.ungroup(selectedIds) && editor.select(editor.expandToUnits(selectedIds))
              }
              className="text-ink/70 focus-visible:ring-primary/40 grid size-8 place-items-center rounded-lg outline-none hover:bg-[#f1f1f3] focus-visible:ring-3"
            >
              <Ungroup className="size-4" />
            </button>
          )}
          <span className="mx-0.5 h-5 w-px bg-[#e6e6ea]" aria-hidden />
          <button
            type="button"
            title="Delete (Del)"
            aria-label="Delete"
            onClick={() => {
              editor.markHistory();
              editor.deleteShapes(editor.unlocked(selectedIds));
            }}
            className="text-destructive focus-visible:ring-primary/40 grid size-8 place-items-center rounded-lg outline-none hover:bg-red-50 focus-visible:ring-3"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </Section>
    </aside>
  );
}
