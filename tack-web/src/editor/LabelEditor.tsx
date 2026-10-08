"use client";

import { useEffect, useRef } from "react";

import { useEditorStore } from "@/stores/editor";

import { toPage } from "./bindings";
import type { Editor } from "./editor-core";
import { shapeRegistry } from "./shapes/registry";
import { textFont } from "./shapes/text";
import { useShape } from "./sync/useShapes";

/**
 * Edits a shape's name (its ShapeDef `label`) in a one-line input laid over where the shape
 * draws it, matching size, zoom and rotation. Every keystroke syncs, so others see the rename
 * as it's typed. Enter or clicking away keeps it, Escape puts the old name back, and an empty
 * name isn't kept. The whole edit is one undo step: whoever starts it calls `startGesture()`.
 */
export function LabelEditor({ editor }: { editor: Editor }) {
  const id = useEditorStore((s) => s.editingLabelId);
  if (!id) return null;
  return <LabelInput key={id} editor={editor} id={id} />;
}

function LabelInput({ editor, id }: { editor: Editor; id: string }) {
  const shape = useShape(editor, id);
  const camera = useEditorStore((s) => s.camera);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const def = shape && shapeRegistry.get(shape.type);
  const prop = def?.label?.prop;
  // The name before editing, to restore on Escape or when left empty.
  const original = useRef<string | null>(null);

  const write = (value: string) => {
    const current = editor.getShape(id);
    if (!current || !prop) return;
    editor.updateShapes({ [id]: { props: { ...(current.props as object), [prop]: value } } });
  };

  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const value = ref.current?.value.trim() ?? "";
    if (!keep || !value) write(original.current ?? "");
    else if (value !== ref.current?.value) write(value);
    editor.endGesture();
    editor.ui.setEditingLabel(null);
  };

  // Focus only; finishing happens on blur, never on unmount (Strict Mode remounts).
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Someone else deleted the shape mid-edit.
  useEffect(() => {
    if (!shape) finish(false);
  });

  if (!shape || !def?.label || !prop) return null;
  let props: Record<string, unknown>;
  try {
    props = def.validate(shape.props) as Record<string, unknown>;
  } catch {
    return null;
  }
  const value = String(props[prop] ?? "");
  original.current ??= value;
  const z = camera.zoom;
  const box = def.label.box({ ...shape, props }, z);
  const origin = toPage(shape, { x: box.x, y: box.y });

  return (
    <input
      ref={ref}
      type="text"
      aria-label="Name"
      value={value}
      maxLength={200}
      spellCheck={false}
      onChange={(e) => write(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
      style={{
        position: "absolute",
        left: origin.x * z + camera.x,
        top: origin.y * z + camera.y,
        width: box.w * z,
        height: box.h * z,
        transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
        transformOrigin: "top left",
        font: `${box.fontWeight ?? 400} ${box.fontSize * z}px ${textFont()}`,
        lineHeight: 1.2,
        textAlign: box.align ?? "left",
        color: "#0e0e10",
        background: "rgb(255 255 255 / 0.9)",
        border: "none",
        borderRadius: 4,
        outline: "1.5px solid #3366ff",
        padding: 0,
        margin: 0,
      }}
    />
  );
}
