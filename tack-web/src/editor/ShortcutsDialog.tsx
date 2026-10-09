"use client";

import { Fragment, useEffect } from "react";

import { useEditorStore } from "@/stores/editor";
import { toolRegistry } from "./tools/registry";
import type { Editor } from "./editor-core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";
const ALT = isMac ? "⌥" : "Alt";

type Row = { label: string; keys: string[][] };

/** Each row's keys: alternatives (outer) of key combinations (inner). */
const EDIT: Row[] = [
  { label: "Undo", keys: [[MOD, "Z"]] },
  {
    label: "Redo",
    keys: [
      [MOD, "Shift", "Z"],
      [MOD, "Y"],
    ],
  },
  {
    label: "Copy · Cut · Paste",
    keys: [
      [MOD, "C"],
      [MOD, "X"],
      [MOD, "V"],
    ],
  },
  { label: "Duplicate", keys: [[MOD, "D"]] },
  {
    label: "Group · Ungroup",
    keys: [
      [MOD, "G"],
      [MOD, "Shift", "G"],
    ],
  },
  {
    label: "Bold · Italic · Underline",
    keys: [
      [MOD, "B"],
      [MOD, "I"],
      [MOD, "U"],
    ],
  },
  { label: "Strikethrough", keys: [[MOD, "Shift", "X"]] },
  {
    label: "Align left · centre · right",
    keys: [
      [ALT, "A"],
      [ALT, "H"],
      [ALT, "D"],
    ],
  },
  {
    label: "Align top · middle · bottom",
    keys: [
      [ALT, "W"],
      [ALT, "V"],
      [ALT, "S"],
    ],
  },
  { label: "Edit inside a group", keys: [["Double-click"]] },
  { label: "Select all", keys: [[MOD, "A"]] },
  { label: "Delete", keys: [["Delete"], ["Backspace"]] },
  { label: "Nudge (10 with Shift)", keys: [["←"], ["↑"], ["→"], ["↓"]] },
  { label: "Bring forward · Send backward", keys: [["]"], ["["]] },
  {
    label: "Bring to front · Send to back",
    keys: [
      [MOD, "]"],
      [MOD, "["],
    ],
  },
  { label: "Deselect, or leave a group", keys: [["Esc"]] },
];

const VIEW: Row[] = [
  { label: "Pan", keys: [["Space", "drag"], ["Middle-drag"], ["Scroll"]] },
  { label: "Zoom", keys: [[MOD, "scroll"], ["Pinch"]] },
];

const WHILE: Row[] = [
  { label: "Move without snapping", keys: [[ALT, "drag"]] },
  { label: "Keep a shape square", keys: [["Shift", "draw"]] },
  { label: "Snap a line's angle", keys: [["Shift", "draw"]] },
  { label: "Finish editing text", keys: [["Esc"], [MOD, "Enter"]] },
];

function Keys({ keys }: { keys: string[][] }) {
  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      {keys.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-ink/30 text-[10px]">or</span>}
          <span className="flex items-center gap-0.5">
            {combo.map((k) => (
              <kbd
                key={k}
                className="text-ink min-w-6 rounded-md border border-b-2 bg-[#f8f8f9] px-1.5 py-0.5 text-center font-sans text-[11px] leading-none font-semibold"
              >
                {k}
              </kbd>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section>
      <h3 className="text-ink/50 mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
        {title}
      </h3>
      <dl className="divide-y divide-[#f1f1f3]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-3 py-1.5">
            <dt className="text-ink/80 text-xs">{r.label}</dt>
            <dd>
              <Keys keys={r.keys} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

/**
 * Every keyboard shortcut, opened with `?` or the keyboard button. Tool keys come from the tool
 * registry, so plugin tools appear here as soon as they register.
 */
export function ShortcutsDialog({ editor }: { editor: Editor }) {
  const open = useEditorStore((s) => s.shortcutsOpen);
  const setOpen = useEditorStore((s) => s.setShortcutsOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.metaKey || e.ctrlKey || isTyping(e.target)) return;
      e.preventDefault();
      setOpen(!useEditorStore.getState().shortcutsOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  const tools: Row[] = toolRegistry
    .all()
    .filter((t) => t.shortcut && editor.canUseTool(t.id))
    .map((t) => ({ label: t.label, keys: [[t.shortcut!.toUpperCase()]] }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Press{" "}
            <kbd className="text-ink rounded-md border border-b-2 bg-[#f8f8f9] px-1.5 py-0.5 font-sans text-[11px] font-semibold">
              ?
            </kbd>{" "}
            any time to open this.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <div className="space-y-5">
            <Section title="Tools" rows={tools} />
            <Section title="View" rows={VIEW} />
          </div>
          <div className="space-y-5">
            {!editor.readOnly && <Section title="Edit" rows={EDIT} />}
            {!editor.readOnly && <Section title="While drawing or dragging" rows={WHILE} />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
