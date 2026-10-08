"use client";

import { ContextMenu } from "@base-ui/react/context-menu";
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  Group,
  Ungroup,
  Keyboard,
  Layers,
  Lock,
  type LucideIcon,
  MousePointer2,
  Scissors,
  Trash2,
  Unlock,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { useEditorStore } from "@/stores/editor";

import type { Editor, ZOrderMove } from "./editor-core";
import { exportToFile } from "./ExportMenu";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";

const popup =
  "min-w-56 origin-[var(--transform-origin)] rounded-2xl border bg-white p-1.5 text-ink shadow-[0_12px_30px_-12px_rgb(14_14_16/0.35)] outline-none transition-[scale,opacity] duration-100 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0";
const item =
  "flex h-8 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none select-none data-disabled:opacity-40 data-highlighted:bg-[#f1f1f3]";
const separator = "mx-1.5 my-1 h-px bg-[#ececef]";

function Item({
  icon: Icon,
  label,
  keys,
  danger,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <ContextMenu.Item
      className={`${item} ${danger ? "text-destructive data-highlighted:bg-red-50" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="size-4 opacity-70" />
      <span className="flex-1">{label}</span>
      {keys && <span className="text-ink/40 font-mono text-[11px]">{keys}</span>}
    </ContextMenu.Item>
  );
}

function Submenu({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <ContextMenu.SubmenuRoot>
      <ContextMenu.SubmenuTrigger className={item}>
        <Icon className="size-4 opacity-70" />
        <span className="flex-1">{label}</span>
        <ChevronRight className="size-3.5 opacity-50" />
      </ContextMenu.SubmenuTrigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner sideOffset={6} alignOffset={-6} className="z-50 outline-none">
          <ContextMenu.Popup className={popup}>{children}</ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.SubmenuRoot>
  );
}

const ORDER: { move: ZOrderMove; label: string; icon: LucideIcon; keys: string }[] = [
  { move: "front", label: "Bring to front", icon: ArrowUpToLine, keys: `${MOD}]` },
  { move: "forward", label: "Bring forward", icon: ArrowUp, keys: "]" },
  { move: "backward", label: "Send backward", icon: ArrowDown, keys: "[" },
  { move: "back", label: "Send to back", icon: ArrowDownToLine, keys: `${MOD}[` },
];

/** What the menu offers: for the selection, or for the board when nothing is selected. */
function MenuItems({ editor }: { editor: Editor }) {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const readOnly = editor.readOnly;
  const has = selectedIds.length > 0;
  const shapes = selectedIds.map((id) => editor.getShape(id)).filter((s) => !!s);
  const allLocked = has && shapes.every((s) => s.locked);
  const editable = editor.unlocked(selectedIds);

  const exportItems = (selection: boolean) => (
    <Submenu icon={Download} label={selection ? "Export selection" : "Export board"}>
      <Item
        icon={Download}
        label="As PNG"
        onClick={() => void exportToFile(editor, selection, "png")}
      />
      <Item
        icon={Download}
        label="As SVG"
        onClick={() => void exportToFile(editor, selection, "svg")}
      />
    </Submenu>
  );

  if (!has) {
    return (
      <>
        {!readOnly && (
          <Item
            icon={ClipboardPaste}
            label="Paste"
            keys={`${MOD}V`}
            onClick={() => void editor.paste()}
          />
        )}
        <Item
          icon={MousePointer2}
          label="Select all"
          keys={`${MOD}A`}
          onClick={() => editor.select(editor.sortedIds())}
        />
        <ContextMenu.Separator className={separator} />
        {exportItems(false)}
        <ContextMenu.Separator className={separator} />
        <Item
          icon={Keyboard}
          label="Keyboard shortcuts"
          keys="?"
          onClick={() => editor.ui.setShortcutsOpen(true)}
        />
      </>
    );
  }

  return (
    <>
      {!readOnly && (
        <Item
          icon={Scissors}
          label="Cut"
          keys={`${MOD}X`}
          disabled={!editable.length}
          onClick={() => void editor.copy(selectedIds, { cut: true })}
        />
      )}
      <Item
        icon={Copy}
        label="Copy"
        keys={`${MOD}C`}
        onClick={() => void editor.copy(selectedIds)}
      />
      {!readOnly && (
        <>
          <Item
            icon={ClipboardPaste}
            label="Paste"
            keys={`${MOD}V`}
            onClick={() => void editor.paste()}
          />
          <Item
            icon={CopyPlus}
            label="Duplicate"
            keys={`${MOD}D`}
            onClick={() => editor.duplicate(selectedIds)}
          />
          <ContextMenu.Separator className={separator} />
          {editor.unitCount(selectedIds) > 1 && (
            <Item
              icon={Group}
              label="Group"
              keys={`${MOD}G`}
              onClick={() =>
                editor.group(selectedIds) && editor.select(editor.expandToUnits(selectedIds))
              }
            />
          )}
          {editor.groupsIn(selectedIds).length > 0 && (
            <Item
              icon={Ungroup}
              label="Ungroup"
              keys={`${MOD}Shift+G`}
              onClick={() =>
                editor.ungroup(selectedIds) && editor.select(editor.expandToUnits(selectedIds))
              }
            />
          )}
          <Submenu icon={Layers} label="Order">
            {ORDER.map((o) => (
              <Item
                key={o.move}
                icon={o.icon}
                label={o.label}
                keys={o.keys}
                onClick={() => editor.reorder(selectedIds, o.move)}
              />
            ))}
          </Submenu>
          <Item
            icon={allLocked ? Unlock : Lock}
            label={allLocked ? "Unlock" : "Lock"}
            onClick={() => editor.setLocked(selectedIds, !allLocked)}
          />
        </>
      )}
      <ContextMenu.Separator className={separator} />
      {exportItems(true)}
      {!readOnly && (
        <>
          <ContextMenu.Separator className={separator} />
          <Item
            icon={Trash2}
            label={allLocked ? "Delete (locked)" : "Delete"}
            keys="Del"
            danger
            disabled={!editable.length}
            onClick={() => {
              editor.markHistory();
              editor.deleteShapes(editable);
            }}
          />
        </>
      )}
    </>
  );
}

/**
 * Right-click (or long-press) menu for the canvas. The canvas selects what was clicked first, so
 * the menu acts on the selection, or on the board when nothing is selected.
 */
export function CanvasMenu({ editor, children }: { editor: Editor; children: ReactNode }) {
  // Rebuilt on every open, so it reflects the board now (a shape locked since, say), not when
  // the menu last rendered.
  const [opened, setOpened] = useState(0);
  return (
    <ContextMenu.Root onOpenChange={(open) => open && setOpened((n) => n + 1)}>
      <ContextMenu.Trigger className="absolute inset-0">{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50 outline-none">
          <ContextMenu.Popup className={popup}>
            <MenuItems key={opened} editor={editor} />
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
