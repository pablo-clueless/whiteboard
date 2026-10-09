/**
 * Lays out a Mermaid sequence diagram: participants in a row along the top (and again along the
 * bottom), dashed lifelines down from them, messages as horizontal arrows between lifelines in
 * order, notes, and loop / alt / opt… blocks as boxes round their messages. Pure: it returns
 * what to draw, in diagram coordinates from (0, 0); `diagram.ts` turns it into shapes.
 */
import type { SequenceDiagram } from "./mermaid";

export type Measure = (text: string, size: number, weight: number) => { w: number; h: number };

export type SeqBox = { x: number; y: number; w: number; h: number };

export type SequenceLayout = {
  participants: { id: string; label: string; actor: boolean; top: SeqBox; bottom: SeqBox }[];
  lifelines: { x: number; y1: number; y2: number }[];
  /**
   * A path (flat x, y pairs) for each message; self-messages loop out to the right. `textAt` is
   * the middle of the message's text.
   */
  messages: {
    points: number[];
    text: string;
    textAt: { x: number; y: number };
    dashed: boolean;
    head: boolean;
    both: boolean;
  }[];
  notes: (SeqBox & { text: string })[];
  /** Outer blocks first, so inner ones draw on top. */
  blocks: (SeqBox & { title: string; dividers: { y: number; label: string }[] })[];
  /** Overall size. */
  w: number;
  h: number;
};

export const PARTICIPANT_H = 44;
export const PARTICIPANT_TEXT = 15;
export const MESSAGE_TEXT = 13;
export const NOTE_TEXT = 13;
const MIN_GAP = 60;
const MESSAGE_STEP = 46;
const SELF_W = 44;
const SELF_H = 26;
const BLOCK_TITLE = 30;
const BLOCK_PAD = 18;

export function layoutSequence(d: SequenceDiagram, measure: Measure): SequenceLayout {
  const n = d.participants.length;
  const index = new Map(d.participants.map((p, i) => [p.id, i]));
  const widths = d.participants.map((p) =>
    Math.max(110, measure(p.label, PARTICIPANT_TEXT, 600).w + 40),
  );
  let number = 0;
  const label = (text: string) => (d.autonumber ? `${++number}. ${text}`.trim() : text);
  // Messages' text, numbered in order, for spacing and drawing alike.
  const texts = d.events.map((e) => (e.kind === "message" ? label(e.text) : ""));

  // Space between neighbouring lifelines: enough for the boxes, and for every message's text.
  const gaps = Array.from({ length: Math.max(0, n - 1) }, (_, i) =>
    Math.max(160, (widths[i] + widths[i + 1]) / 2 + MIN_GAP),
  );
  let selfRoom = 0; // room a self-message on the last lifeline needs to its right
  const spans: { a: number; b: number; need: number }[] = [];
  d.events.forEach((e, k) => {
    if (e.kind !== "message") return;
    const w = measure(texts[k] || " ", MESSAGE_TEXT, 500).w;
    const [a, b] = [index.get(e.from)!, index.get(e.to)!];
    if (a === b) {
      if (a < n - 1) gaps[a] = Math.max(gaps[a], SELF_W + w + 30);
      else selfRoom = Math.max(selfRoom, SELF_W + w + 20);
    } else spans.push({ a: Math.min(a, b), b: Math.max(a, b), need: w + 40 });
  });
  // Narrow spans first, so wide ones only stretch what's still short.
  spans.sort((x, y) => x.b - x.a - (y.b - y.a));
  for (const s of spans) {
    const have = gaps.slice(s.a, s.b).reduce((t, g) => t + g, 0);
    if (have < s.need) gaps[s.b - 1] += s.need - have;
  }
  const centres: number[] = [];
  let x = widths[0] / 2;
  for (let i = 0; i < n; i++) {
    centres.push(x);
    if (i < n - 1) x += gaps[i];
  }

  const messages: SequenceLayout["messages"] = [];
  const notes: SequenceLayout["notes"] = [];
  const blocks: SequenceLayout["blocks"] = [];
  // Blocks being laid out: where they start, their dividers, and the lifelines they touch.
  type Open = { title: string; y: number; dividers: { y: number; label: string }[] };
  const stack: { block: Open; touched: Set<number>; right: number }[] = [];
  const touch = (...cols: number[]) => {
    for (const s of stack) cols.forEach((c) => s.touched.add(c));
  };
  const reach = (right: number) => {
    for (const s of stack) s.right = Math.max(s.right, right);
  };

  let y = PARTICIPANT_H + 36;
  d.events.forEach((e, k) => {
    switch (e.kind) {
      case "message": {
        const [a, b] = [index.get(e.from)!, index.get(e.to)!];
        const text = texts[k];
        const h = text ? measure(text, MESSAGE_TEXT, 500).h : 0;
        y += Math.max(0, h - 16);
        touch(a, b);
        if (a === b) {
          const cx = centres[a];
          const tw = text ? measure(text, MESSAGE_TEXT, 500).w : 0;
          messages.push({
            points: [cx, y, cx + SELF_W, y, cx + SELF_W, y + SELF_H, cx, y + SELF_H],
            text,
            textAt: { x: cx + SELF_W + 8 + tw / 2, y: y + SELF_H / 2 },
            dashed: e.dashed,
            head: e.head,
            both: e.both,
          });
          reach(cx + SELF_W + 8 + tw);
          y += SELF_H + MESSAGE_STEP - 10;
        } else {
          messages.push({
            points: [centres[a], y, centres[b], y],
            text,
            textAt: { x: (centres[a] + centres[b]) / 2, y: y - 12 },
            dashed: e.dashed,
            head: e.head,
            both: e.both,
          });
          y += MESSAGE_STEP;
        }
        return;
      }
      case "note": {
        const cols = e.at.map((id) => index.get(id)!).sort((p, q) => p - q);
        const t = measure(e.text || " ", NOTE_TEXT, 400);
        const h = t.h + 20;
        const w = Math.max(100, t.w + 24);
        let left: number;
        let width = w;
        if (e.side === "over") {
          const [l, r] = [centres[cols[0]], centres[cols.at(-1)!]];
          width = Math.max(w, r - l + 60);
          left = (l + r) / 2 - width / 2;
        } else if (e.side === "left") left = centres[cols[0]] - 16 - w;
        else left = centres[cols.at(-1)!] + 16;
        notes.push({ x: left, y: y - 14, w: width, h, text: e.text });
        touch(...cols);
        reach(left + width);
        y += h + 22;
        return;
      }
      case "start":
        stack.push({
          block: {
            title: [e.block, e.label ? `[${e.label}]` : ""].join(" ").trim(),
            y: y - 22,
            dividers: [],
          },
          touched: new Set(),
          right: -Infinity,
        });
        y += BLOCK_TITLE;
        return;
      case "else": {
        const top = stack.at(-1);
        if (!top) return;
        top.block.dividers.push({ y: y - 14, label: e.label ? `[${e.label}]` : "" });
        y += BLOCK_TITLE;
        return;
      }
      case "end": {
        const s = stack.pop();
        if (!s) return;
        const cols = s.touched.size ? [...s.touched] : d.participants.map((_, i) => i);
        // Inner blocks sit a little inside the ones round them.
        const pad = BLOCK_PAD + 10 * Math.max(0, 3 - stack.length);
        const left = Math.min(...cols.map((c) => centres[c])) - pad - 24;
        const right = Math.max(Math.max(...cols.map((c) => centres[c])) + pad + 24, s.right + 12);
        blocks.push({
          x: left,
          y: s.block.y,
          w: right - left,
          h: y - s.block.y - 10,
          title: s.block.title,
          dividers: s.block.dividers,
        });
        // The blocks round this one take in what it touched.
        touch(...cols);
        reach(right);
        y += 14;
        return;
      }
    }
  });

  const bottomY = y + 10;
  const participants = d.participants.map((p, i) => ({
    ...p,
    top: { x: centres[i] - widths[i] / 2, y: 0, w: widths[i], h: PARTICIPANT_H },
    bottom: { x: centres[i] - widths[i] / 2, y: bottomY, w: widths[i], h: PARTICIPANT_H },
  }));
  const lifelines = centres.map((cx) => ({ x: cx, y1: PARTICIPANT_H, y2: bottomY }));
  // Blocks were closed innermost first; draw outer ones first.
  blocks.sort((a, b) => b.w * b.h - a.w * a.h);

  // Everything to the right of 0: notes or blocks may reach left of the first lifeline.
  const minX = Math.min(
    0,
    ...notes.map((nb) => nb.x),
    ...blocks.map((b) => b.x),
    ...participants.map((p) => p.top.x),
  );
  const shift = (b: { x: number }) => (b.x -= minX);
  if (minX < 0) {
    participants.forEach((p) => (shift(p.top), shift(p.bottom)));
    lifelines.forEach(shift);
    notes.forEach(shift);
    blocks.forEach(shift);
    for (const m of messages) {
      m.points = m.points.map((v, i) => (i % 2 ? v : v - minX));
      m.textAt.x -= minX;
    }
  }
  const w = Math.max(
    ...participants.map((p) => p.top.x + p.top.w),
    ...notes.map((nb) => nb.x + nb.w),
    ...blocks.map((b) => b.x + b.w),
    (centres.at(-1) ?? 0) - minX + selfRoom,
  );
  return {
    participants,
    lifelines,
    messages,
    notes,
    blocks,
    w,
    h: bottomY + PARTICIPANT_H,
  };
}
