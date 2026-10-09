"use client";

import { type KeyboardEvent, useEffect, useRef } from "react";

import { stickyLayout, stickyShape } from "./shapes/sticky";
import { useEditorStore } from "@/stores/editor";
import { layoutMarkdown } from "./markdown";
import type { Editor } from "./editor-core";
import { useShape } from "./sync/useShapes";
import { toPage } from "./bindings";
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
  // Sticky notes edit their text too, laid out inside the note.
  if (editor.getShape(id)?.type === "sticky")
    return <StickyArea key={id} editor={editor} id={id} />;
  return <TextArea key={id} editor={editor} id={id} />;
}

/** The style a shortcut (Ctrl/⌘ B, I, U, Shift X) toggles, or null for any other key. */
function styleShortcut(e: KeyboardEvent): TextStyleKey | null {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey && key === "b") return "bold";
  if (!e.shiftKey && key === "i") return "italic";
  if (!e.shiftKey && key === "u") return "underline";
  if (e.shiftKey && key === "x") return "strike";
  return null;
}

const MARKS: Record<TextStyleKey, string | null> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  underline: null,
};

/**
 * Wraps the textarea's selection in markdown marks and returns the new text, with the selection
 * moved inside the marks. Null when nothing is selected or the style has no marks.
 */
function markSelection(
  el: HTMLTextAreaElement,
  style: TextStyleKey,
  reselect: (from: number, to: number) => void,
): string | null {
  const marks = MARKS[style];
  const [from, to] = [el.selectionStart, el.selectionEnd];
  if (!marks || from === to) return null;
  const text = el.value;
  requestAnimationFrame(() => reselect(from + marks.length, to + marks.length));
  return text.slice(0, from) + marks + text.slice(from, to) + marks + text.slice(to);
}

/**
 * A note's text, typed into a textarea over the note at the size the note fits it to. The note
 * itself stays drawn underneath; only its text is hidden. An emptied note is kept.
 */
function StickyArea({ editor, id }: { editor: Editor; id: string }) {
  const shape = useShape(editor, id);
  const camera = useEditorStore((s) => s.camera);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    editor.endGesture();
    editor.ui.setEditingText(null);
  };

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  useEffect(() => {
    if (!shape) finish();
  });

  if (!shape || shape.type !== "sticky") return null;
  const p = stickyShape.validate(shape.props);
  const write = (text: string) => editor.updateShapes({ [id]: { props: { ...p, text } } });
  // Fitted as typed (markdown symbols and all), so the caret never runs off the note.
  const fit = stickyLayout(p, { markdown: false });
  const z = camera.zoom;
  const origin = toPage(shape, { x: fit.x, y: fit.y });
  const size = fit.style.fontSize;

  return (
    <textarea
      ref={ref}
      aria-label="Note text"
      value={p.text}
      spellCheck={false}
      onChange={(e) => write(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          e.currentTarget.blur();
          return;
        }
        const style = styleShortcut(e);
        if (!style) return;
        e.preventDefault();
        const next = markSelection(e.currentTarget, style, (from, to) =>
          ref.current?.setSelectionRange(from, to),
        );
        if (next !== null) write(next);
      }}
      style={{
        position: "absolute",
        left: origin.x * z + camera.x,
        top: origin.y * z + camera.y,
        width: fit.layout.w * z,
        height: Math.max(fit.layout.h, size * fit.style.lineHeight) * z,
        transform: shape.rotation ? `rotate(${shape.rotation}deg)` : undefined,
        transformOrigin: "top left",
        font: cssFont(fit.style, size * z),
        lineHeight: fit.style.lineHeight,
        textAlign: fit.style.align,
        color: p.color,
        caretColor: p.color,
        background: "transparent",
        border: "none",
        outline: "none",
        padding: 0,
        margin: 0,
        resize: "none",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
      }}
    />
  );
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
        const style = styleShortcut(e);
        if (!style) return;
        e.preventDefault();
        // With markdown on and text selected, mark up just the selection; otherwise style it all.
        const next = p.markdown
          ? markSelection(e.currentTarget, style, (from, to) =>
              ref.current?.setSelectionRange(from, to),
            )
          : null;
        if (next !== null) {
          editor.updateShapes({ [id]: { props: { ...p, text: next } } });
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
