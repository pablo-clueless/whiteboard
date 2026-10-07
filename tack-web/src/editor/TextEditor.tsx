"use client";

import { useEffect, useRef } from "react";

import { measureText, TEXT_LINE_HEIGHT, type TextProps, textFont, textShape } from "./shapes/text";
import { useEditorStore } from "@/stores/editor";
import type { Editor } from "./editor-core";
import { useShape } from "./sync/useShapes";

/**
 * Text is typed into a real textarea laid exactly over the shape, scaled and rotated to match,
 * while the canvas copy is hidden. Every keystroke syncs, so others see the text as it's typed.
 *
 * The whole edit is one undo step. Whoever starts editing calls `editor.startGesture()` first
 * (so a freshly created text box is part of the same step); finishing calls `endGesture()`.
 */
export function TextEditor({ editor }: { editor: Editor }) {
  const id = useEditorStore((s) => s.editingTextId);
  if (!id) return null;
  return <TextArea key={id} editor={editor} id={id} />;
}

function TextArea({ editor, id }: { editor: Editor; id: string }) {
  const shape = useShape(editor, id);
  const camera = useEditorStore((s) => s.camera);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    const current = editor.getValidShape(id);
    // An empty text box isn't worth keeping.
    if (current && !(current.props as TextProps).text.trim()) editor.deleteShapes([id]);
    editor.endGesture();
    editor.ui.setEditingText(null);
  };

  // Focus only. Finishing happens on blur, never on unmount: Strict Mode mounts, unmounts and
  // remounts in development, and finishing then would delete a fresh, still-empty text box.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  // Someone else deleted the shape mid-edit.
  useEffect(() => {
    if (!shape) finish();
  });

  if (!shape || shape.type !== "text") return null;
  const p = textShape.validate(shape.props);
  const { w, h } = measureText(p.text || " ", p.fontSize);
  const z = camera.zoom;

  return (
    <textarea
      ref={ref}
      aria-label="Text"
      value={p.text}
      spellCheck={false}
      wrap="off"
      onChange={(e) => editor.updateShapes({ [id]: { props: { ...p, text: e.target.value } } })}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      style={{
        position: "absolute",
        left: shape.x * z + camera.x,
        top: shape.y * z + camera.y,
        // A little extra width so the next character never wraps or scrolls before it's measured.
        width: (w + p.fontSize) * z,
        height: h * z,
        transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
        transformOrigin: "top left",
        font: `${p.fontSize * z}px ${textFont()}`,
        lineHeight: TEXT_LINE_HEIGHT,
        color: p.color,
        caretColor: p.color,
        background: "transparent",
        border: "none",
        outline: "none",
        padding: 0,
        margin: 0,
        resize: "none",
        overflow: "hidden",
        whiteSpace: "pre",
      }}
    />
  );
}
