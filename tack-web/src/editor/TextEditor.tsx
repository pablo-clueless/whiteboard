"use client";

import { useEffect, useRef } from "react";

import { useEditorStore } from "@/stores/editor";
import { layoutMarkdown } from "./markdown";
import type { Editor } from "./editor-core";
import { useShape } from "./sync/useShapes";
import {
  cssFont,
  type TextProps,
  type TextStyleKey,
  textShape,
  toggleTextStyle,
} from "./shapes/text";

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
  // Sized like the shape, but for the raw source (markdown symbols and all) being typed.
  const { w, h } = layoutMarkdown(p.text || " ", { ...p, markdown: false });
  const z = camera.zoom;

  return (
    <textarea
      ref={ref}
      aria-label="Text"
      value={p.text}
      spellCheck={false}
      wrap={p.width ? "soft" : "off"}
      onChange={(e) => editor.updateShapes({ [id]: { props: { ...p, text: e.target.value } } })}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          e.currentTarget.blur();
          return;
        }
        const mod = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();
        const style: TextStyleKey | null =
          mod && !e.shiftKey && key === "b"
            ? "bold"
            : mod && !e.shiftKey && key === "i"
              ? "italic"
              : mod && !e.shiftKey && key === "u"
                ? "underline"
                : mod && e.shiftKey && key === "x"
                  ? "strike"
                  : null;
        if (!style) return;
        e.preventDefault();
        // With markdown on and text selected, mark up just the selection; otherwise style it all.
        const el = e.currentTarget;
        const [from, to] = [el.selectionStart, el.selectionEnd];
        const marks = { bold: "**", italic: "*", strike: "~~", underline: null }[style];
        if (p.markdown && marks && from !== to) {
          const text = el.value;
          const next = text.slice(0, from) + marks + text.slice(from, to) + marks + text.slice(to);
          editor.updateShapes({ [id]: { props: { ...p, text: next } } });
          requestAnimationFrame(() =>
            ref.current?.setSelectionRange(from + marks.length, to + marks.length),
          );
        } else {
          toggleTextStyle(editor, [id], style);
        }
      }}
      style={{
        position: "absolute",
        left: shape.x * z + camera.x,
        top: shape.y * z + camera.y,
        // Fixed width: wrap like the shape. Auto: a little extra so the next character never
        // wraps or scrolls before it's measured.
        width: (p.width ?? w + p.fontSize) * z,
        height: h * z,
        transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
        transformOrigin: "top left",
        font: cssFont(p, p.fontSize * z),
        lineHeight: p.lineHeight,
        letterSpacing: p.letterSpacing * z,
        textAlign: p.align,
        fontStyle: p.italic ? "italic" : "normal",
        textDecoration:
          [p.underline && "underline", p.strike && "line-through"].filter(Boolean).join(" ") ||
          "none",
        color: p.color,
        caretColor: p.color,
        background: "transparent",
        border: "none",
        outline: "none",
        padding: 0,
        margin: 0,
        resize: "none",
        overflow: "hidden",
        whiteSpace: p.width ? "pre-wrap" : "pre",
        overflowWrap: "break-word",
      }}
    />
  );
}
