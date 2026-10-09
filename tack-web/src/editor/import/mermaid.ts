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
export function mermaidKind(
  source: string,
): "flowchart" | "er" | "class" | "sequence" | "other" | null {
  const first = cleanLines(source)[0] ?? "";
  if (/^(flowchart|graph)\b/i.test(first)) return "flowchart";
  if (/^erDiagram\b/i.test(first)) return "er";
  if (/^classDiagram(-v2)?\b/i.test(first)) return "class";
  if (/^sequenceDiagram\b/i.test(first)) return "sequence";
  if (
    /^(stateDiagram(-v2)?|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4\w*|sankey(-beta)?|xychart(-beta)?|block(-beta)?)\b/i.test(
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

/* ── Class diagrams ─────────────────────────────────────────────────────── */

/** The mark at a relationship end, as arrows draw them (`ArrowHead` in shapes/line). */
export type RelationHead = "arrow" | "triangle" | "diamond" | "diamondFilled";

export type ClassMember = { name: string; type: string; method: boolean };

export type UmlClass = {
  id: string;
  label: string;
  /** `<<interface>>`, `<<abstract>>`, `<<enumeration>>`… without the brackets. */
  annotation?: string;
  members: ClassMember[];
};

export type ClassRelation = {
  from: string;
  to: string;
  fromHead: RelationHead | null;
  toHead: RelationHead | null;
  dashed: boolean;
  label?: string;
  fromCard?: string;
  toCard?: string;
};

export type ClassDiagram = {
  kind: "class";
  direction: FlowDirection;
  classes: UmlClass[];
  relations: ClassRelation[];
  /** Namespaces, drawn as frames. */
  namespaces: Subgraph[];
  warnings: string[];
};

/** Mermaid writes generics with tildes: `List~int~` is `List<int>`. */
const generics = (s: string) => s.replace(/~([^~]*)~/g, "<$1>");

/** A class name: plain (maybe generic, `Box~T~`) or in backticks. */
const CLASS_NAME = String.raw`(?:\x60[^\x60]+\x60|[\w.$-]+(?:~[^~]*~)?)`;

const RELATION = new RegExp(
  String.raw`^(${CLASS_NAME})\s*(?:"([^"]*)"\s*)?(<\||\*|o|<)?(--|\.\.)(\|>|\*|o|>)?\s*(?:"([^"]*)"\s*)?(${CLASS_NAME})\s*(?::\s*(.*))?$`,
);
const CLASS_DEF = new RegExp(
  String.raw`^class\s+(${CLASS_NAME})(?:\s*\["([^"]*)"\])?(?:\s*<<\s*(.+?)\s*>>)?(?:\s*:::[\w-]+)?\s*(\{\s*(\})?)?$`,
);
const ANNOTATION = new RegExp(String.raw`^<<\s*(.+?)\s*>>\s*(${CLASS_NAME})$`);
const MEMBER_LINE = new RegExp(String.raw`^(${CLASS_NAME})\s*:\s*(.+)$`);

const HEAD: Record<string, RelationHead> = {
  "<|": "triangle",
  "|>": "triangle",
  "*": "diamondFilled",
  o: "diamond",
  "<": "arrow",
  ">": "arrow",
};

/**
 * One member line: a method (`+eat(food) bool`, `+area()$ : double`) or an attribute, in
 * Mermaid's `+String name` order or as `name: String`.
 */
export function parseMember(raw: string): ClassMember | null {
  let s = raw.trim();
  if (!s) return null;
  const open = s.indexOf("(");
  if (open >= 0) {
    const close = s.lastIndexOf(")");
    if (close < open) return { name: generics(s), type: "", method: true };
    let name = s.slice(0, close + 1);
    let rest = s.slice(close + 1).trim();
    // `$` static, `*` abstract.
    const classifier = rest.match(/^[$*]/);
    if (classifier) {
      name += classifier[0];
      rest = rest.slice(1).trim();
    }
    return { name: generics(name), type: generics(rest.replace(/^:\s*/, "")), method: true };
  }
  const colon = s.match(/^([+\-#~]?[\w$]+[$*]?)\s*:\s*(.+)$/);
  if (colon) return { name: colon[1], type: generics(colon[2].trim()), method: false };
  // A leading + - # ~ is visibility (a generic's tilde never starts a member).
  const visibility = /^[+\-#~]/.test(s) ? s[0] : "";
  if (visibility) s = s.slice(1).trim();
  const parts = s.split(/\s+/);
  const name = parts.pop()!;
  return { name: visibility + name, type: generics(parts.join(" ")), method: false };
}

export function parseClassDiagram(source: string): ClassDiagram {
  const lines = cleanLines(source);
  lines.shift(); // classDiagram
  let direction: FlowDirection = "TB";
  const classes = new Map<string, UmlClass>();
  const relations: ClassRelation[] = [];
  const namespaces: Subgraph[] = [];
  const warnings: string[] = [];
  let namespace: Subgraph | null = null;
  let notes = 0;

  const cls = (raw: string) => {
    const name = raw.startsWith("`") ? raw.slice(1, -1) : raw;
    const id = name.replace(/~[^~]*~$/, "");
    let c = classes.get(id);
    if (!c) {
      c = { id, label: generics(name), members: [] };
      classes.set(id, c);
    } else if (name !== id) c.label = generics(name);
    if (namespace && !namespace.nodes.includes(id)) namespace.nodes.push(id);
    return c;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dir = line.match(/^direction\s+(TB|TD|BT|LR|RL)$/i);
    if (dir) {
      const d = dir[1].toUpperCase();
      direction = (d === "TD" ? "TB" : d) as FlowDirection;
      continue;
    }
    if (/^(classDef|cssClass|style|click|link|callback)\b/i.test(line)) continue;
    if (/^note\b/i.test(line)) {
      notes++;
      continue;
    }
    const ns = line.match(/^namespace\s+([\w.$-]+)\s*\{$/);
    if (ns) {
      namespace = { id: ns[1], label: ns[1], nodes: [] };
      namespaces.push(namespace);
      continue;
    }
    if (line === "}" && namespace) {
      namespace = null;
      continue;
    }
    const annotation = line.match(ANNOTATION);
    if (annotation) {
      cls(annotation[2]).annotation = annotation[1];
      continue;
    }
    const def = line.match(CLASS_DEF);
    if (def) {
      const c = cls(def[1]);
      if (def[2]) c.label = def[2];
      if (def[3]) c.annotation = def[3];
      if (def[4] && !def[5]) {
        for (i++; i < lines.length && lines[i] !== "}"; i++) {
          const a = lines[i].match(/^<<\s*(.+?)\s*>>$/);
          if (a) c.annotation = a[1];
          else {
            const m = parseMember(lines[i]);
            if (m) c.members.push(m);
          }
        }
      }
      continue;
    }
    const rel = line.match(RELATION);
    if (rel) {
      const from = cls(rel[1]).id;
      const to = cls(rel[7]).id;
      relations.push({
        from,
        to,
        fromHead: rel[3] ? HEAD[rel[3]] : null,
        toHead: rel[5] ? HEAD[rel[5]] : null,
        dashed: rel[4] === "..",
        label: rel[8]?.trim() || undefined,
        fromCard: rel[2] || undefined,
        toCard: rel[6] || undefined,
      });
      continue;
    }
    const member = line.match(MEMBER_LINE);
    if (member) {
      const m = parseMember(member[2]);
      if (m) cls(member[1]).members.push(m);
      continue;
    }
    warnings.push(`Skipped "${line}"`);
  }
  if (notes) warnings.push(`${notes} note${notes === 1 ? " was" : "s were"} left out`);
  return {
    kind: "class",
    direction,
    classes: [...classes.values()],
    relations,
    namespaces,
    warnings,
  };
}

/* ── Sequence diagrams ──────────────────────────────────────────────────── */

export type Participant = { id: string; label: string; actor: boolean };

export type SequenceEvent =
  | {
      kind: "message";
      from: string;
      to: string;
      text: string;
      dashed: boolean;
      /** An arrowhead at the receiving end (and, with `both`, at the sending end too). */
      head: boolean;
      both: boolean;
    }
  | { kind: "note"; at: string[]; side: "left" | "right" | "over"; text: string }
  | { kind: "start"; block: string; label: string }
  | { kind: "else"; label: string }
  | { kind: "end" };

export type SequenceDiagram = {
  kind: "sequence";
  participants: Participant[];
  events: SequenceEvent[];
  autonumber: boolean;
  warnings: string[];
};

/** Longest first, so `-->>` isn't read as `-->` followed by `>`. */
const SEQ_ARROW = String.raw`<<-->>|<<->>|-->>|->>|-->|->|--x|-x|--\)|-\)`;
const MESSAGE = new RegExp(
  String.raw`^([^\s:]+?)\s*(${SEQ_ARROW})\s*[+-]?\s*([^\s:]+?)\s*(?::\s*(.*))?$`,
);
const BLOCK = /^(loop|alt|opt|par|critical|break|rect|box)\b\s*(.*)$/i;

export function parseSequenceDiagram(source: string): SequenceDiagram {
  const lines = cleanLines(source);
  lines.shift(); // sequenceDiagram
  const participants = new Map<string, Participant>();
  const events: SequenceEvent[] = [];
  const warnings: string[] = [];
  let autonumber = false;
  // Open blocks. `box` only groups participants: it ends like the others but isn't drawn.
  const open: string[] = [];

  const who = (id: string, label?: string, actor = false) => {
    let p = participants.get(id);
    if (!p) {
      p = { id, label: label ?? id, actor };
      participants.set(id, p);
    } else {
      if (label) p.label = label;
      if (actor) p.actor = true;
    }
    return p.id;
  };

  for (const line of lines) {
    const decl = line.match(/^(participant|actor)\s+(.+?)(?:\s+as\s+(.+))?$/i);
    if (decl) {
      who(decl[2].trim(), decl[3] ? decode(decl[3]) : undefined, /^actor$/i.test(decl[1]));
      continue;
    }
    if (/^autonumber\b/i.test(line)) {
      autonumber = true;
      continue;
    }
    if (/^(activate|deactivate|title|links?|properties|details|create|destroy)\b/i.test(line))
      continue;
    const note = line.match(/^note\s+(left of|right of|over)\s+([^:]+?)\s*:\s*(.*)$/i);
    if (note) {
      const where = note[1].toLowerCase();
      events.push({
        kind: "note",
        at: note[2].split(",").map((s) => who(s.trim())),
        side: where.startsWith("left") ? "left" : where.startsWith("right") ? "right" : "over",
        text: decode(note[3]),
      });
      continue;
    }
    const block = line.match(BLOCK);
    if (block) {
      const kind = block[1].toLowerCase();
      open.push(kind);
      // A rect's "label" is its colour.
      if (kind !== "box")
        events.push({ kind: "start", block: kind, label: kind === "rect" ? "" : decode(block[2]) });
      continue;
    }
    const branch = line.match(/^(else|and|option)\b\s*(.*)$/i);
    if (branch) {
      events.push({ kind: "else", label: decode(branch[2]) });
      continue;
    }
    if (/^end$/i.test(line)) {
      if (!open.length) warnings.push(`An "end" with nothing to close`);
      else if (open.pop() !== "box") events.push({ kind: "end" });
      continue;
    }
    const msg = line.match(MESSAGE);
    if (msg) {
      const arrow = msg[2];
      events.push({
        kind: "message",
        from: who(msg[1]),
        to: who(msg[3]),
        text: msg[4] ? decode(msg[4]) : "",
        dashed: arrow.includes("--"),
        head: arrow.includes(">>") || arrow.endsWith("x") || arrow.endsWith(")"),
        both: arrow.startsWith("<<"),
      });
      continue;
    }
    warnings.push(`Skipped "${line}"`);
  }
  // Blocks left open close at the end.
  for (const kind of open) if (kind !== "box") events.push({ kind: "end" });
  return {
    kind: "sequence",
    participants: [...participants.values()],
    events,
    autonumber,
    warnings,
  };
}
