/**
 * Readers for the Mermaid diagrams Tack can draw: flowcharts (`flowchart` / `graph`) and entity
 * relationship diagrams (`erDiagram`, as a Schema like DBML's). Styling lines (classDef, style,
 * linkStyle, click) are ignored; anything unreadable is reported, not fatal.
 */

import type { RefKind, Schema, SchemaField, SchemaTable } from "./dbml";

export type FlowDirection = "TB" | "BT" | "LR" | "RL";

export type FlowNodeShape =
  "rect" | "round" | "stadium" | "circle" | "diamond" | "hexagon" | "database" | "subroutine";

export type FlowNode = { id: string; label: string; shape: FlowNodeShape };

export type FlowEdge = {
  from: string;
  to: string;
  label?: string;
  dashed: boolean;
  thick: boolean;
  arrowStart: boolean;
  arrowEnd: boolean;
};

export type Subgraph = { id: string; label: string; nodes: string[] };

export type Flowchart = {
  kind: "flowchart";
  direction: FlowDirection;
  nodes: FlowNode[];
  edges: FlowEdge[];
  subgraphs: Subgraph[];
  warnings: string[];
};

/** Mermaid text without code fences, `%%` comments or blank lines. */
function cleanLines(source: string): string[] {
  return source
    .replace(/^\s*```(?:mermaid)?\s*$/gim, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/%%.*$/, "").trim())
    .filter(Boolean);
}

/** The diagram type on the first line, if it's one Tack can draw. */
export function mermaidKind(source: string): "flowchart" | "er" | "other" | null {
  const first = cleanLines(source)[0] ?? "";
  if (/^(flowchart|graph)\b/i.test(first)) return "flowchart";
  if (/^erDiagram\b/i.test(first)) return "er";
  if (
    /^(sequenceDiagram|classDiagram|stateDiagram(-v2)?|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4\w*|sankey(-beta)?|xychart(-beta)?|block(-beta)?)\b/i.test(
      first,
    )
  )
    return "other";
  return null;
}

/* ── Flowcharts ─────────────────────────────────────────────────────────── */

const decode = (s: string) =>
  s
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/#quot;/g, '"')
    .trim();

/** Node shapes, longest delimiters first so `([…])` isn't read as `(…)`. */
const SHAPES: [RegExp, FlowNodeShape][] = [
  [/^\(\[(.*?)\]\)/, "stadium"],
  [/^\[\[(.*?)\]\]/, "subroutine"],
  [/^\[\((.*?)\)\]/, "database"],
  [/^\(\(\((.*?)\)\)\)/, "circle"],
  [/^\(\((.*?)\)\)/, "circle"],
  [/^\{\{(.*?)\}\}/, "hexagon"],
  [/^\[\/(.*?)[\/\\]\]/, "rect"],
  [/^\[\\(.*?)[\/\\]\]/, "rect"],
  [/^\[(.*?)\]/, "rect"],
  [/^\((.*?)\)/, "round"],
  [/^\{(.*?)\}/, "diamond"],
  [/^>(.*?)\]/, "rect"],
];

const NODE_ID = /^([A-Za-z0-9_À-￿][\wÀ-￿.\-]*)/;
const LINK =
  /^(<)?(-\.+->|-\.+-|={2,}>|={3,}|-{2,}>|-{3,}|--[ox]|==[ox]|-\.+[ox])\s*(?:\|([^|]*)\|)?/;

export function parseFlowchart(source: string): Flowchart {
  const lines = cleanLines(source);
  const header = lines.shift() ?? "";
  const dir = header.match(/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)/i)?.[1]?.toUpperCase() ?? "TB";
  const direction = (dir === "TD" ? "TB" : dir) as FlowDirection;

  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const subgraphs: Subgraph[] = [];
  const stack: Subgraph[] = [];
  const warnings: string[] = [];

  const touch = (id: string, label?: string, shape?: FlowNodeShape) => {
    const existing = nodes.get(id);
    if (existing) {
      if (label !== undefined) existing.label = label;
      if (shape) existing.shape = shape;
    } else nodes.set(id, { id, label: label ?? id, shape: shape ?? "rect" });
    const sg = stack.at(-1);
    if (sg && !sg.nodes.includes(id)) sg.nodes.push(id);
  };

  /** Reads `A`, `A[label]`, or `A & B` at the start of `s`; returns ids and the rest. */
  const readNodes = (s: string): { ids: string[]; rest: string } | null => {
    const ids: string[] = [];
    let rest = s;
    for (;;) {
      rest = rest.trimStart();
      const m = rest.match(NODE_ID);
      if (!m) return ids.length ? { ids, rest } : null;
      const id = m[1];
      rest = rest.slice(m[0].length);
      let label: string | undefined;
      let shape: FlowNodeShape | undefined;
      for (const [re, kind] of SHAPES) {
        const sm = rest.match(re);
        if (sm) {
          label = decode(sm[1]);
          shape = kind;
          rest = rest.slice(sm[0].length);
          break;
        }
      }
      rest = rest.replace(/^:::[\w-]+/, "");
      touch(id, label, shape);
      ids.push(id);
      const amp = rest.match(/^\s*&/);
      if (!amp) return { ids, rest };
      rest = rest.slice(amp[0].length);
    }
  };

  for (const raw of lines.flatMap((l) => l.split(/;\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/))) {
    const line = raw.trim();
    if (!line) continue;
    if (/^(classDef|class|style|linkStyle|click|direction)\b/i.test(line)) continue;

    const sub = line.match(/^subgraph\s+(.+)$/i);
    if (sub) {
      const body = sub[1].trim();
      const titled = body.match(/^([\w-]+)\s*\[(.*)\]$/);
      const sg: Subgraph = {
        id: titled ? titled[1] : body,
        label: decode(titled ? titled[2] : body),
        nodes: [],
      };
      subgraphs.push(sg);
      stack.push(sg);
      continue;
    }
    if (/^end$/i.test(line)) {
      stack.pop();
      continue;
    }

    // `A -- text --> B` and friends become `A -->|text| B`.
    const normalised = line
      .replace(/--\s+([^-|>][^|]*?)\s+-->/g, "-->|$1|")
      .replace(/-\.\s+([^.|>][^|]*?)\s+\.->/g, "-.->|$1|")
      .replace(/==\s+([^=|>][^|]*?)\s+==>/g, "==>|$1|")
      .replace(/--\s+([^-|>][^|]*?)\s+---/g, "---|$1|");

    let left = readNodes(normalised);
    if (!left) {
      warnings.push(`Skipped "${line}"`);
      continue;
    }
    let rest = left.rest.trim();
    while (rest) {
      const link = rest.match(LINK);
      if (!link) {
        warnings.push(`Couldn't read "${rest}" in "${line}"`);
        break;
      }
      const right = readNodes(rest.slice(link[0].length));
      if (!right) {
        warnings.push(`Missing the node after a link in "${line}"`);
        break;
      }
      const op = link[2];
      for (const from of left.ids) {
        for (const to of right.ids) {
          edges.push({
            from,
            to,
            label: link[3] ? decode(link[3]) : undefined,
            dashed: op.includes("."),
            thick: op.startsWith("="),
            arrowStart: !!link[1],
            arrowEnd: /[>ox]$/.test(op),
          });
        }
      }
      left = right;
      rest = right.rest.trim();
    }
  }

  return { kind: "flowchart", direction, nodes: [...nodes.values()], edges, subgraphs, warnings };
}

/* ── Entity relationship diagrams ───────────────────────────────────────── */

/** Cardinality markers: `|o` / `o|` zero or one, `||` exactly one, `}o` / `o{` zero or more, `}|` / `|{` one or more. */
const many = (marker: string) => marker.includes("{") || marker.includes("}");

export function parseErDiagram(source: string): Schema {
  const lines = cleanLines(source);
  lines.shift(); // erDiagram
  const tables = new Map<string, SchemaTable>();
  const refs: Schema["refs"] = [];
  const warnings: string[] = [];

  const table = (name: string) => {
    let t = tables.get(name);
    if (!t) {
      t = { name, fields: [], kind: "table" };
      tables.set(name, t);
    }
    return t;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(direction|classDef|class|style)\b/i.test(line)) continue;
    const block = line.match(/^("[^"]+"|[\w-]+)(?:\s*\[[^\]]*\])?\s*\{\s*(\})?$/);
    if (block) {
      const t = table(block[1].replace(/"/g, ""));
      if (block[2]) continue;
      for (i++; i < lines.length && lines[i] !== "}"; i++) {
        // `type name PK, FK "comment"`
        const a = lines[i].match(
          /^([\w\-[\]()]+)\s+([\w-]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$/i,
        );
        if (!a) {
          warnings.push(`Couldn't read "${lines[i]}" in ${t.name}`);
          continue;
        }
        const keys = (a[3] ?? "").toUpperCase();
        const field: SchemaField = {
          name: a[2],
          type: a[1],
          pk: keys.includes("PK"),
          fk: keys.includes("FK"),
          unique: keys.includes("UK"),
          notNull: false,
          note: a[4],
        };
        t.fields.push(field);
      }
      continue;
    }
    const rel = line.match(
      /^("[^"]+"|[\w-]+)\s+([|}o][|o]|[|}][o|])(--|\.\.)([|o][|{o]|[o|][|{])\s+("[^"]+"|[\w-]+)\s*(?::\s*(.+))?$/,
    );
    if (rel) {
      const [from, to] = [rel[1].replace(/"/g, ""), rel[5].replace(/"/g, "")];
      table(from);
      table(to);
      const [l, r] = [many(rel[2]), many(rel[4])];
      const kind: RefKind = l && r ? "<>" : l ? ">" : r ? "<" : "-";
      // Entity-level: the reader attaches each end to a key field where there is one.
      refs.push({
        from: { table: from, field: "" },
        to: { table: to, field: "" },
        kind,
        label: rel[6] ? rel[6].replace(/^"(.*)"$/, "$1").trim() : undefined,
      });
      continue;
    }
    warnings.push(`Skipped "${line}"`);
  }
  return { tables: [...tables.values()], refs, warnings };
}
