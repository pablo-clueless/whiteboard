import dagre from "@dagrejs/dagre";

import { fieldPort, type TableField, tableHeight, tableWidth } from "../shapes/table";
import { looksLikeDbml, parseDbml, type RefKind, type Schema } from "./dbml";
import { type Builder, placeBuilt } from "../templates";
import type { Editor } from "../editor-core";
import { measureText } from "../shapes/text";
import {
  type Flowchart,
  type FlowNodeShape,
  mermaidKind,
  parseErDiagram,
  parseFlowchart,
} from "./mermaid";

/** What some text turned out to be, ready to draw (or why it can't be). */
export type Detected =
  | { kind: "dbml" | "mermaid-er"; schema: Schema }
  | { kind: "flowchart"; chart: Flowchart }
  | { kind: "unsupported"; what: string };

/** Recognises DBML or Mermaid. Null when the text is neither. */
export function detectDiagram(text: string): Detected | null {
  const kind = mermaidKind(text);
  if (kind === "flowchart") return { kind: "flowchart", chart: parseFlowchart(text) };
  if (kind === "er") return { kind: "mermaid-er", schema: parseErDiagram(text) };
  if (kind === "other") {
    const what = text
      .trim()
      .replace(/^```\w*\s*/, "")
      .split(/\s/)[0];
    return { kind: "unsupported", what: `Mermaid ${what}` };
  }
  if (looksLikeDbml(text)) return { kind: "dbml", schema: parseDbml(text) };
  return null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line describing what would be drawn, e.g. "DBML · 17 tables, 31 relationships". */
export function describe(d: Detected): string {
  if (d.kind === "unsupported") return `${d.what} isn't supported yet`;
  if (d.kind === "flowchart") {
    const c = d.chart;
    return `Mermaid flowchart · ${plural(c.nodes.length, "node")}, ${plural(c.edges.length, "link")}`;
  }
  const s = d.schema;
  const label = d.kind === "dbml" ? "DBML" : "Mermaid ER diagram";
  return `${label} · ${plural(s.tables.length, "table")}, ${plural(s.refs.length, "relationship")}`;
}

export const warningsOf = (d: Detected): string[] =>
  d.kind === "unsupported" ? [] : d.kind === "flowchart" ? d.chart.warnings : d.schema.warnings;

/** Whether there's anything to draw. */
export const drawable = (d: Detected | null): d is Exclude<Detected, { kind: "unsupported" }> =>
  !!d &&
  d.kind !== "unsupported" &&
  (d.kind === "flowchart" ? d.chart.nodes.length > 0 : d.schema.tables.length > 0);

/** Draws a detected diagram in the middle of the screen. One undo step; returns the new ids. */
export function insertDiagram(editor: Editor, d: Detected): string[] {
  if (!drawable(d)) return [];
  const ids = placeBuilt(editor, (b) =>
    d.kind === "flowchart" ? buildFlowchart(b, d.chart) : buildSchema(b, d.schema),
  );
  editor.select([]);
  return ids;
}

/* ── Schemas ────────────────────────────────────────────────────────────── */

/** "1" and "*" for each end of a relationship (from → to). */
const CARDINALITY: Record<RefKind, [string, string]> = {
  ">": ["*", "1"],
  "<": ["1", "*"],
  "-": ["1", "1"],
  "<>": ["*", "*"],
};

function buildSchema(b: Builder, schema: Schema) {
  // Fields that point elsewhere get the foreign-key mark.
  const fkFields = new Set(schema.refs.map((r) => `${r.from.table}.${r.from.field}`));
  const cards = new Map<string, { fields: TableField[]; w: number; h: number; enum: boolean }>();
  for (const t of schema.tables) {
    const fields: TableField[] = t.fields.map((f) => ({
      name: f.name,
      type: f.type,
      pk: f.pk,
      fk: !!f.fk || fkFields.has(`${t.name}.${f.name}`),
      note: f.note,
    }));
    cards.set(t.name, {
      fields,
      w: tableWidth(t.name, fields),
      h: tableHeight(fields.length),
      enum: t.kind === "enum",
    });
  }

  // Referenced tables come before the ones that point at them. Lay out both left-to-right and
  // top-to-bottom: a hub table with many dependants can make one of them very tall or wide.
  const layout = (rankdir: "LR" | "TB") => {
    const g = new dagre.graphlib.Graph({ multigraph: true });
    g.setGraph({
      rankdir,
      nodesep: 48,
      ranksep: rankdir === "LR" ? 180 : 120,
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const [name, c] of cards) g.setNode(name, { width: c.w, height: c.h });
    schema.refs.forEach((r, i) => {
      if (r.from.table !== r.to.table && cards.has(r.from.table) && cards.has(r.to.table))
        g.setEdge(r.to.table, r.from.table, {}, `r${i}`);
    });
    dagre.layout(g);
    const { width = 1, height = 1 } = g.graph();
    return { g, fit: Math.min(window.innerWidth / width, window.innerHeight / height) };
  };
  const lr = layout("LR");
  const tb = layout("TB");
  // Relationships attach to the sides of rows, which reads best left to right; only go top to
  // bottom when that fits a lot better.
  const g = (tb.fit > lr.fit * 1.5 ? tb : lr).g;

  const ids = new Map<string, string>();
  const centres = new Map<string, { x: number; y: number }>();
  for (const [name, c] of cards) {
    const node = g.node(name);
    centres.set(name, { x: node.x, y: node.y });
    ids.set(
      name,
      b.table(name, c.fields, node.x - c.w / 2, node.y - c.h / 2, c.enum ? "#7a4fb5" : undefined),
    );
  }

  /** The row a relationship attaches to: the named field, else the primary key, else the first. */
  const row = (table: string, field: string) => {
    const fields = cards.get(table)!.fields;
    const i = fields.findIndex((f) => f.name === field);
    if (i >= 0) return i;
    const pk = fields.findIndex((f) => f.pk);
    return pk >= 0 ? pk : 0;
  };

  for (const r of schema.refs) {
    const from = ids.get(r.from.table);
    const to = ids.get(r.to.table);
    if (!from || !to) {
      schema.warnings.push(
        `A relationship refers to a table that isn't defined: ${!from ? r.from.table : r.to.table}`,
      );
      continue;
    }
    const [a, z] = [centres.get(r.from.table)!, centres.get(r.to.table)!];
    // Leave and arrive on the facing sides; a table pointing at itself loops round its right.
    const [fromSide, toSide] =
      from === to || Math.abs(a.x - z.x) < 1
        ? (["right", "right"] as const)
        : z.x > a.x
          ? (["right", "left"] as const)
          : (["left", "right"] as const);
    const [startLabel, endLabel] = CARDINALITY[r.kind];
    b.connectPorts(
      from,
      fieldPort(row(r.from.table, r.from.field), fromSide),
      to,
      fieldPort(row(r.to.table, r.to.field), toSide),
      {
        arrowStart: false,
        arrowEnd: false,
        stroke: "#8a8a93",
        strokeWidth: 1.5,
        startLabel,
        endLabel,
        label: r.label ?? "",
      },
    );
  }
}

/* ── Flowcharts ─────────────────────────────────────────────────────────── */

const NODE_TEXT = { fontSize: 15, fontFamily: "sans", fontWeight: 500 };
const INK = "#2a2a30";

/** The size a node needs for its label. */
function nodeSize(label: string, shape: FlowNodeShape): { w: number; h: number } {
  const t = measureText(label || " ", NODE_TEXT);
  switch (shape) {
    case "circle": {
      const d = Math.max(76, Math.max(t.w, t.h) + 36);
      return { w: d, h: d };
    }
    case "diamond":
      return { w: Math.max(140, t.w * 1.5 + 48), h: Math.max(84, t.h * 1.6 + 40) };
    case "hexagon":
      return { w: Math.max(140, t.w + 72), h: Math.max(64, t.h + 32) };
    case "database":
      return { w: 200, h: 60 };
    default:
      return { w: Math.max(120, t.w + 44), h: Math.max(52, t.h + 28) };
  }
}

function buildFlowchart(b: Builder, chart: Flowchart) {
  const g = new dagre.graphlib.Graph({ multigraph: true, compound: true });
  g.setGraph({ rankdir: chart.direction, nodesep: 56, ranksep: 72, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  const sizes = new Map(chart.nodes.map((n) => [n.id, nodeSize(n.label, n.shape)]));
  for (const n of chart.nodes)
    g.setNode(n.id, { width: sizes.get(n.id)!.w, height: sizes.get(n.id)!.h });
  // Subgraphs become clusters, so dagre keeps their nodes together and tells us their extent.
  for (const sg of chart.subgraphs) {
    const key = `subgraph:${sg.id}`;
    g.setNode(key, {
      label: sg.label,
      paddingTop: 36,
      paddingLeft: 24,
      paddingRight: 24,
      paddingBottom: 24,
    });
    for (const id of sg.nodes) if (g.hasNode(id)) g.setParent(id, key);
  }
  chart.edges.forEach((e, i) => {
    // Leave room for a label on the link.
    const t = e.label
      ? measureText(e.label, { fontSize: 12, fontFamily: "sans", fontWeight: 500 })
      : null;
    g.setEdge(e.from, e.to, t ? { width: t.w + 16, height: 22 } : {}, `e${i}`);
  });
  dagre.layout(g);

  for (const sg of chart.subgraphs) {
    const c = g.node(`subgraph:${sg.id}`);
    if (c && c.width && c.height)
      b.frame(sg.label, c.x - c.width / 2, c.y - c.height / 2, c.width, c.height);
  }

  const ink = { stroke: INK, strokeWidth: 1.5, fill: "#ffffff" };
  const text = { fontSize: NODE_TEXT.fontSize, fontWeight: NODE_TEXT.fontWeight };
  const ids = new Map<string, string>();
  const centres = new Map<string, { x: number; y: number }>();
  for (const n of chart.nodes) {
    const { x, y } = g.node(n.id);
    const { w, h } = sizes.get(n.id)!;
    const [left, top] = [x - w / 2, y - h / 2];
    centres.set(n.id, { x, y });
    let id: string;
    switch (n.shape) {
      case "circle":
        id = b.labelled("ellipse", left, top, w, h, n.label, { ...ink, fill: "#ffe0c7" }, text);
        break;
      case "diamond":
        id = b.labelled(
          "polygon",
          left,
          top,
          w,
          h,
          n.label,
          { ...ink, sides: 4, fill: "#fff3b0" },
          text,
        );
        break;
      case "hexagon":
        id = b.labelled("polygon", left, top, w, h, n.label, { ...ink, sides: 6 }, text);
        break;
      case "database":
        id = b.component("database", "database", n.label, left, top);
        break;
      case "stadium":
        id = b.labelled(
          "rect",
          left,
          top,
          w,
          h,
          n.label,
          { ...ink, radius: h / 2, fill: "#d8f2e2" },
          text,
        );
        break;
      case "round":
        id = b.labelled("rect", left, top, w, h, n.label, { ...ink, radius: 16 }, text);
        break;
      default:
        id = b.labelled("rect", left, top, w, h, n.label, { ...ink, radius: 6 }, text);
    }
    ids.set(n.id, id);
  }

  for (const e of chart.edges) {
    const from = ids.get(e.from);
    const to = ids.get(e.to);
    if (!from || !to) continue;
    const [a, z] = [centres.get(e.from)!, centres.get(e.to)!];
    const [dx, dy] = [z.x - a.x, z.y - a.y];
    // Along the main direction where the link mostly runs that way; sideways otherwise.
    const vertical = Math.abs(dy) >= Math.abs(dx);
    const [fromSide, toSide] = vertical
      ? dy >= 0
        ? (["bottom", "top"] as const)
        : (["top", "bottom"] as const)
      : dx >= 0
        ? (["right", "left"] as const)
        : (["left", "right"] as const);
    b.connect(from, fromSide, to, toSide, {
      label: e.label ?? "",
      dashed: e.dashed,
      strokeWidth: e.thick ? 3 : 1.5,
      stroke: INK,
      arrowStart: e.arrowStart,
      arrowEnd: e.arrowEnd,
    });
  }
}
