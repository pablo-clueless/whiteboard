/**
 * Readers for PlantUML (`@startuml … @enduml`): sequence, class, state, activity (the newer
 * `:step;` syntax) and IE entity diagrams. Each reads into the same shapes the Mermaid readers
 * produce, so they draw the same way. Styling (skinparam, colours, hide/show) is ignored; anything
 * unreadable is reported, not fatal.
 */

import type { RefKind, Schema, SchemaTable } from "./dbml";
import {
  type ClassDiagram,
  type ClassRelation,
  type FlowDirection,
  type Flowchart,
  type FlowEdge,
  type FlowNode,
  type FlowNodeShape,
  parseMember,
  parseStateDiagram,
  type Participant,
  type RelationHead,
  type SequenceDiagram,
  type SequenceEvent,
  type Subgraph,
  type UmlClass,
} from "./mermaid";

export type PlantUmlKind = "sequence" | "class" | "state" | "activity" | "er" | "other";

/** PlantUML text without fences, `@start`/`@end` lines, comments, styling or blank lines. */
function cleanLines(source: string): string[] {
  const lines = source
    .replace(/^\s*```(?:plantuml|puml|uml)?\s*$/gim, "")
    .replace(/\/'[\s\S]*?'\//g, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("'") && !/^@(start|end)\w*/i.test(l));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Multi-line styling and captions: skip to their end.
    const skip = line.match(/^(skinparam\b.*\{|style\b.*\{|<style>|legend\b|header\b$|footer\b$)/i);
    if (skip) {
      const end = line.startsWith("<style>")
        ? /^<\/style>$/i
        : /\{$/.test(line)
          ? /^\}$/
          : new RegExp(`^end\\s*${line.split(/\s/)[0]}$`, "i");
      while (i + 1 < lines.length && !end.test(lines[++i]));
      continue;
    }
    if (
      /^(skinparam|title|header|footer|caption|scale|hide|show|!|autoactivate|newpage|allowmixing|mainframe)\b/i.test(
        line,
      ) ||
      line.startsWith("!")
    )
      continue;
    out.push(line);
  }
  return out;
}

/** Whether the text is PlantUML, and which kind of diagram. */
export function plantumlKind(source: string): PlantUmlKind | null {
  const start = source.match(/^\s*(?:```\w*\s*)?@start(\w+)/i);
  if (!start) return null;
  if (start[1].toLowerCase() !== "uml") return "other";
  const lines = cleanLines(source);
  const any = (test: RegExp | ((l: string) => boolean)) =>
    lines.some(typeof test === "function" ? test : (l) => test.test(l));

  if (any(/^(start|stop)$/i) || any(/^:/) || any(/^if\s*\(/i)) return "activity";
  if (any(/\(\*\)/)) return "other"; // the legacy activity syntax
  const classDecl =
    /^(abstract\s+class|abstract|class|interface|enum|annotation|struct|record|exception|protocol)\s/i;
  const classLink = /(<\||\|>|\*--|--\*|(^|\s)o--|--o(\s|$))/;
  if (any(/^entity\s/i) && any(/\{$/) && !any(classDecl) && !any(classLink)) return "er";
  if (any(classDecl) || any(classLink)) return "class";
  if (any(/^state\s/i) || any(/\[\*\]/)) return "state";
  // Use case, component and deployment diagrams.
  if (
    any(
      /^(usecase|component|node|artifact|cloud|frame|folder|rectangle|card|storage|agent|map|json|object)\s/i,
    ) ||
    any(/^\(.+\)/) ||
    any(/^\[.+\]/) ||
    any(/[-.]>?\s*\(/)
  )
    return "other";
  if (
    any(/^(participant|actor|boundary|control|entity|database|collections|queue)\s/i) ||
    any((l) => MESSAGE.test(l.replace(/-\[[^\]]*\]/g, "-")))
  )
    return "sequence";
  return "other";
}

/** Strips quotes and turns `\n` into line breaks. */
const unquote = (s: string) =>
  s
    .trim()
    .replace(/^"([\s\S]*)"$/, "$1")
    .replace(/\\n/g, "\n")
    .trim();

/** Drops `#colour`, `<<stereotype>>` and `order N` from the end of a declaration. */
const undecorate = (s: string) =>
  s
    .replace(/\s+order\s+-?\d+/i, "")
    .replace(/\s*#[\w#]+(?:[;:][\w#:;]+)*/g, "")
    .trim();

/* ── Sequence diagrams ──────────────────────────────────────────────────── */

const SEQ_ID = String.raw`"[^"]+"|[\w.@À-￿]+`;
/** `->`, `-->`, `->>`, `<-`, `<->`, `-\\`, `->x`, with any `[#colour]` already stripped. */
const SEQ_ARROW = String.raw`(<<?|\\\\?|\/\/?|x|o)?(-{1,2})(>>?|\\\\?|\/\/?|x(?=\s)|o(?=\s))?`;
const MESSAGE = new RegExp(
  String.raw`^(${SEQ_ID})\s*${SEQ_ARROW}\s*(${SEQ_ID})\s*(?:\+\+|--|\*\*|!!)*\s*(?::\s*(.*))?$`,
);
const PARTICIPANT =
  /^(participant|actor|boundary|control|entity|database|collections|queue)\s+(.+)$/i;
const GROUP = /^(alt|opt|loop|par|break|critical|group)\b\s*(.*)$/i;

export function parsePlantSequence(source: string): SequenceDiagram {
  const lines = cleanLines(source);
  const participants = new Map<string, Participant>();
  const events: SequenceEvent[] = [];
  const warnings: string[] = [];
  let autonumber = false;
  let open = 0;

  const who = (raw: string, label?: string, actor = false) => {
    const id = unquote(raw);
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const decl = line.match(PARTICIPANT);
    if (decl) {
      // `participant "Long name" as L`, `participant L as "Long name"`, `participant Alice as A`.
      const body = undecorate(decl[2].replace(/<<.*?>>/g, ""));
      const as = body.match(new RegExp(String.raw`^(${SEQ_ID})(?:\s+as\s+(${SEQ_ID}))?$`, "i"));
      if (!as) {
        warnings.push(`Skipped "${line}"`);
        continue;
      }
      const actor = /^actor$/i.test(decl[1]);
      if (!as[2]) who(as[1], undefined, actor);
      else if (as[2].startsWith('"')) who(as[1], unquote(as[2]), actor);
      else who(as[2], unquote(as[1]), actor);
      continue;
    }
    if (/^autonumber\b/i.test(line)) {
      autonumber = true;
      continue;
    }
    if (/^(activate|deactivate|destroy|create|return|delay|\.\.\.|\|\|\||==)/i.test(line)) continue;
    if (/^box\b/i.test(line) || /^end\s*box$/i.test(line)) continue;

    const note = line.match(
      /^[hr]?note\s+(left of|right of|over|left|right)\s*([^:]*?)\s*(?::\s*(.*))?$/i,
    );
    const ref = line.match(/^ref\s+over\s+([^:]+?)\s*(?::\s*(.*))?$/i);
    if (note || ref) {
      let text = (note ? note[3] : ref![2]) ?? "";
      if ((note ? note[3] : ref![2]) === undefined) {
        // Multi-line: everything up to `end note` / `end ref`.
        const body: string[] = [];
        while (i + 1 < lines.length && !/^end\s*(note|ref|hnote|rnote)$/i.test(lines[++i]))
          body.push(lines[i]);
        text = body.join("\n");
      }
      const where = note ? note[1].toLowerCase() : "over";
      let at = (note ? note[2] : ref![1])
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!at.length) {
        // `note left : text` belongs to the message before it.
        const last = events.findLast((e) => e.kind === "message");
        if (!last || last.kind !== "message") {
          warnings.push(`Skipped a note with nothing to attach to`);
          continue;
        }
        at = [where.startsWith("left") ? last.from : last.to];
      }
      events.push({
        kind: "note",
        at: at.map((s) => who(s)),
        side: where.startsWith("left") ? "left" : where.startsWith("right") ? "right" : "over",
        text: unquote(text),
      });
      continue;
    }
    const group = line.match(GROUP);
    if (group) {
      open++;
      events.push({ kind: "start", block: group[1].toLowerCase(), label: unquote(group[2]) });
      continue;
    }
    const branch = line.match(/^else\b\s*(.*)$/i);
    if (branch) {
      events.push({ kind: "else", label: unquote(branch[1]) });
      continue;
    }
    if (/^end$/i.test(line)) {
      if (!open) warnings.push(`An "end" with nothing to close`);
      else {
        open--;
        events.push({ kind: "end" });
      }
      continue;
    }
    const msg = line.replace(/-\[[^\]]*\]/g, "-").match(MESSAGE);
    if (msg) {
      const [, a, left, dashes, right, b, text] = msg;
      // `B <- A` is A sending to B.
      const reversed = !!left && !right;
      events.push({
        kind: "message",
        from: who(reversed ? b : a),
        to: who(reversed ? a : b),
        text: text ? unquote(text) : "",
        dashed: dashes === "--",
        head: true,
        both: !!left && !!right,
      });
      continue;
    }
    warnings.push(`Skipped "${line}"`);
  }
  for (; open > 0; open--) events.push({ kind: "end" });
  return {
    kind: "sequence",
    participants: [...participants.values()],
    events,
    autonumber,
    warnings,
  };
}

/* ── Class diagrams ─────────────────────────────────────────────────────── */

const CLASS_ID = String.raw`"[^"]+"|[\w.$À-￿]+`;
const CLASS_DECL = new RegExp(
  String.raw`^(abstract\s+class|abstract|class|interface|enum|annotation|entity|struct|record|exception|protocol)\s+(${CLASS_ID})(?:\s*<([^>]*)>)?(?:\s+as\s+(${CLASS_ID}))?(.*)$`,
  "i",
);
const KIND_ANNOTATION: Record<string, string | undefined> = {
  abstract: "abstract",
  "abstract class": "abstract",
  interface: "interface",
  enum: "enumeration",
  annotation: "annotation",
  struct: "struct",
  record: "record",
  exception: "exception",
  protocol: "protocol",
};
const HEADS: Record<string, RelationHead> = {
  "<|": "triangle",
  "|>": "triangle",
  "^": "triangle",
  "*": "diamondFilled",
  o: "diamond",
  "<": "arrow",
  ">": "arrow",
};
/** `A "1" *-- "many" B : label`, with directions and colours already stripped from the link. */
const CLASS_LINK = new RegExp(
  String.raw`^(${CLASS_ID})\s*(?:"([^"]*)"\s*)?(<\||\^|\*|o|<|\+|#)?([-.]+)(\|>|\^|\*|o|>|\+|#)?\s*(?:"([^"]*)"\s*)?(${CLASS_ID})\s*(?::\s*(.*))?$`,
);

export function parsePlantClass(source: string): ClassDiagram {
  const lines = cleanLines(source);
  let direction: FlowDirection = "TB";
  const classes = new Map<string, UmlClass>();
  const relations: ClassRelation[] = [];
  const namespaces: Subgraph[] = [];
  const warnings: string[] = [];
  // Open packages; `null` for `together` and other groups that aren't drawn.
  const stack: (Subgraph | null)[] = [];
  let notes = 0;

  const cls = (raw: string, label?: string) => {
    const id = unquote(raw);
    let c = classes.get(id);
    if (!c) {
      c = { id, label: label ?? id, members: [] };
      classes.set(id, c);
    } else if (label) c.label = label;
    const ns = stack.findLast((s) => s);
    if (ns && !namespaces.some((n) => n.nodes.includes(id))) ns.nodes.push(id);
    return c;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^left\s+to\s+right\s+direction$/i.test(line)) {
      direction = "LR";
      continue;
    }
    if (/^top\s+to\s+bottom\s+direction$/i.test(line)) continue;
    if (/^(remove|restore|set)\b/i.test(line)) continue;
    if (/^note\b/i.test(line)) {
      notes++;
      if (!line.includes(":") && !/".*"\s*$/.test(line))
        while (i + 1 < lines.length && !/^end\s*note$/i.test(lines[++i]));
      continue;
    }
    const pkg = line.match(/^(package|namespace|together)\b\s*(.*?)\s*\{$/i);
    if (pkg) {
      if (pkg[1].toLowerCase() === "together") stack.push(null);
      else {
        const name = unquote(undecorate(pkg[2].replace(/<<.*?>>/g, "")).replace(/\s+as\s+.*$/, ""));
        const ns: Subgraph = { id: name, label: name, nodes: [] };
        namespaces.push(ns);
        stack.push(ns);
      }
      continue;
    }
    if (line === "}") {
      stack.pop();
      continue;
    }
    const decl = line.match(CLASS_DECL);
    if (decl) {
      const kind = decl[1].toLowerCase().replace(/\s+/, " ");
      // `class "Long name" as L`, or `class L as "Long name"`.
      const [id, label] =
        decl[4] && decl[2].startsWith('"')
          ? [decl[4], unquote(decl[2])]
          : decl[4]
            ? [decl[2], unquote(decl[4])]
            : [decl[2], undefined];
      const c = cls(id, label);
      if (decl[3]) c.label = `${c.label}<${decl[3]}>`;
      let rest = decl[5];
      const stereo = rest.match(/<<\s*(.+?)\s*>>/);
      c.annotation = stereo?.[1] ?? KIND_ANNOTATION[kind] ?? c.annotation;
      rest = rest.replace(/<<.*?>>/g, "");
      // `extends A` / `implements B, C` become relationships.
      for (const [, word, names] of rest.matchAll(
        /\b(extends|implements)\s+([\w.$,\s]+?)(?=\s+(?:extends|implements)\b|\s*[{#]|$)/gi,
      ))
        for (const name of names
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean))
          relations.push({
            from: cls(name).id,
            to: c.id,
            fromHead: "triangle",
            toHead: null,
            dashed: word.toLowerCase() === "implements",
          });
      if (/\{\s*$/.test(rest)) {
        for (i++; i < lines.length && lines[i] !== "}"; i++) {
          const member = lines[i].replace(/\{(static|classifier|abstract|field|method)\}\s*/gi, "");
          // Separators: `--`, `..`, `==`, `__`, with or without a title.
          if (/^(--|\.\.|==|__)/.test(member)) continue;
          const m = parseMember(member);
          if (m) c.members.push(m);
        }
      }
      continue;
    }
    const link = line
      .replace(/([-.])(?:\[[^\]]*\]|up|down|left|right|le|ri|do|u|d|l|r)(?=[-.])/gi, "$1")
      .match(CLASS_LINK);
    if (link) {
      const from = cls(link[1]).id;
      const to = cls(link[7]).id;
      relations.push({
        from,
        to,
        fromHead: HEADS[link[3] ?? ""] ?? null,
        toHead: HEADS[link[5] ?? ""] ?? null,
        dashed: link[4].includes("."),
        // A trailing `>` or `<` only says which way to read the label.
        label: link[8]?.replace(/^[<>]\s*|\s*[<>]$/g, "").trim() || undefined,
        fromCard: link[2] || undefined,
        toCard: link[6] || undefined,
      });
      continue;
    }
    const member = line.match(new RegExp(String.raw`^(${CLASS_ID})\s*:\s*(.+)$`));
    if (member) {
      const m = parseMember(
        member[2].replace(/\{(static|classifier|abstract|field|method)\}\s*/gi, ""),
      );
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
    namespaces: namespaces.filter((n) => n.nodes.length),
    warnings,
  };
}

/* ── Entity (IE) diagrams ───────────────────────────────────────────────── */

const many = (marker: string) => marker.includes("{") || marker.includes("}");

export function parsePlantEntities(source: string): Schema {
  const lines = cleanLines(source);
  const tables = new Map<string, SchemaTable>();
  /** Alias → table name. */
  const names = new Map<string, string>();
  const refs: Schema["refs"] = [];
  const warnings: string[] = [];

  const table = (raw: string, label?: string) => {
    const alias = unquote(raw);
    const name = label ?? names.get(alias) ?? alias;
    names.set(alias, name);
    let t = tables.get(name);
    if (!t) {
      t = { name, fields: [], kind: "table" };
      tables.set(name, t);
    }
    return t;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(left|top)\s+to\s+.*direction$/i.test(line)) continue;
    if (/^note\b/i.test(line)) {
      if (!line.includes(":")) while (i + 1 < lines.length && !/^end\s*note$/i.test(lines[++i]));
      warnings.push("Notes are left out");
      continue;
    }
    const decl = line.match(
      new RegExp(
        String.raw`^entity\s+(${CLASS_ID})(?:\s+as\s+(${CLASS_ID}))?(.*?)(\{)?\s*(\})?$`,
        "i",
      ),
    );
    if (decl) {
      const t = decl[2]
        ? decl[1].startsWith('"')
          ? table(decl[2], unquote(decl[1]))
          : table(decl[1], unquote(decl[2]))
        : table(decl[1]);
      if (!decl[4] || decl[5]) continue;
      // Fields above a `--` line are the key; without one, only `<<PK>>` marks it.
      let key = true;
      const above: boolean[] = [];
      for (i++; i < lines.length && lines[i] !== "}"; i++) {
        const raw = lines[i];
        if (/^(--|\.\.|==|__)/.test(raw)) {
          key = false;
          continue;
        }
        const f = raw.match(/^(\*)?\s*([\w$À-￿]+)\s*(?::\s*([^<]*?))?\s*(<<.*>>)?$/);
        if (!f) {
          warnings.push(`Couldn't read "${raw}" in ${t.name}`);
          continue;
        }
        const tags = (f[4] ?? "").toUpperCase();
        above.push(key);
        t.fields.push({
          name: f[2],
          type: f[3]?.trim() ?? "",
          pk: tags.includes("PK"),
          fk: tags.includes("FK"),
          unique: tags.includes("UNIQUE"),
          notNull: !!f[1],
        });
      }
      if (!key) t.fields.forEach((f, n) => (f.pk ||= above[n] && !f.fk));
      continue;
    }
    const rel = line
      .replace(/([-.])(?:\[[^\]]*\]|up|down|left|right|u|d|l|r)(?=[-.])/gi, "$1")
      .match(
        new RegExp(
          String.raw`^(${CLASS_ID})\s+([|}o][|o]|[|}][o|])([-.]+)([|o][|{o]|[o|][|{])\s+(${CLASS_ID})\s*(?::\s*(.+))?$`,
        ),
      );
    if (rel) {
      const from = table(rel[1]).name;
      const to = table(rel[5]).name;
      const [l, r] = [many(rel[2]), many(rel[4])];
      const kind: RefKind = l && r ? "<>" : l ? ">" : r ? "<" : "-";
      refs.push({
        from: { table: from, field: "" },
        to: { table: to, field: "" },
        kind,
        label: rel[6] ? unquote(rel[6]) : undefined,
      });
      continue;
    }
    warnings.push(`Skipped "${line}"`);
  }
  return { tables: [...tables.values()], refs, warnings: [...new Set(warnings)] };
}

/* ── State diagrams ─────────────────────────────────────────────────────── */

/**
 * PlantUML's state syntax is close to Mermaid's: this rewrites the differences (arrow styles and
 * directions, `state X : text`, colours, `[H]` history) and reads it as a Mermaid state diagram.
 */
export function parsePlantState(source: string): Flowchart {
  let direction = "";
  const body = cleanLines(source)
    .filter((l) => {
      if (/^left\s+to\s+right\s+direction$/i.test(l)) direction = "direction LR";
      return !/^(top|left)\s+to\s+.*direction$/i.test(l) && !/^(--|\|\|)$/.test(l);
    })
    .map((l) =>
      l
        .replace(/\[H\*?\]/g, "History")
        // `-down->`, `-[#red]->`, `->`, `-->`, `..>` are all transitions.
        .replace(/\s*[-.]+(?:\[[^\]]*\]|up|down|left|right|u|d|l|r)?[-.]*>\s*/i, " --> ")
        .replace(/^state\s+([\w\-.À-￿]+)\s*:\s*/i, "$1 : ")
        .replace(/\s*#[\w#]+(?:;[\w#:;]+)*(?=\s*(\{|$|:|<<))/g, "")
        .replace(
          /<<(start|end|entryPoint|exitPoint|inputPin|outputPin|expansionInput|expansionOutput|sdlreceive)>>/gi,
          "",
        )
        .replace(/<<(fork|join|choice)>>/gi, (m) => m.toLowerCase())
        .replace(/\\n/g, "<br>"),
    );
  const chart = parseStateDiagram(["stateDiagram-v2", direction, ...body].join("\n"));
  return chart;
}

/* ── Activity diagrams ──────────────────────────────────────────────────── */

type Tail = { id: string; label?: string };
type Frame =
  | { type: "if"; last: string; ends: Tail[]; hasElse: boolean }
  | { type: "while"; diamond: string }
  | { type: "repeat"; start: string | null }
  /** `from`: where each branch starts (the fork bar, or what came before a split). */
  | { type: "fork"; from: Tail[]; ends: Tail[]; bars: boolean };

/**
 * Reads the activity syntax (`start`, `:step;`, `if … then … else … endif`, `while`, `repeat`,
 * `fork`, `split`, `partition`) as a flowchart. Swimlanes and notes are left out with a warning.
 */
export function parsePlantActivity(source: string): Flowchart {
  const lines = cleanLines(source);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const subgraphs: Subgraph[] = [];
  const groups: (Subgraph | null)[] = [];
  const frames: Frame[] = [];
  const warnings: string[] = [];
  let tails: Tail[] = [];
  let pending: string | undefined; // a `-> label;` for the next link

  const link = (from: Tail, to: string, label?: string) =>
    edges.push({
      from: from.id,
      to,
      label: label ?? from.label,
      dashed: false,
      thick: false,
      arrowStart: false,
      arrowEnd: true,
    });
  const node = (label: string, shape: FlowNodeShape) => {
    const id = `n${nodes.length}`;
    nodes.push({ id, label, shape });
    const sg = groups.findLast((g) => g);
    if (sg) sg.nodes.push(id);
    for (const t of tails) link(t, id, pending ?? t.label);
    pending = undefined;
    tails = [{ id }];
    // The first thing in a `repeat` is where it loops back to.
    for (const f of frames) if (f.type === "repeat" && f.start === null) f.start = id;
    return id;
  };
  const top = <T extends Frame["type"]>(type: T) => {
    const f = frames.at(-1);
    if (f?.type === type) return f as Extract<Frame, { type: T }>;
    warnings.push(`A "${type}" closed without being opened`);
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (/^(start)$/i.test(line)) {
      node("", "start");
      continue;
    }
    if (/^(stop|end)$/i.test(line)) {
      node("", "end");
      tails = [];
      continue;
    }
    if (/^(kill|detach)$/i.test(line)) {
      tails = [];
      continue;
    }
    if (line.startsWith(":")) {
      // A step may run over several lines, up to the `;` (or another ending) that closes it.
      while (!/[;|<>\/\]}]$/.test(line) && i + 1 < lines.length) line += `\n${lines[++i]}`;
      const text = line
        .slice(1, -1)
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\\n/g, "\n")
        .trim();
      node(text, "rect");
      continue;
    }
    const arrow = line.match(/^-+(?:\[[^\]]*\]-*)?>\s*(.*?);?$/);
    if (arrow) {
      pending = arrow[1] || undefined;
      continue;
    }
    const iff = line.match(/^if\s*\((.*)\)\s*(?:is\s*\((.*?)\)\s*)?then\s*(?:\((.*?)\))?$/i);
    if (iff) {
      const d = node(iff[1], "diamond");
      frames.push({ type: "if", last: d, ends: [], hasElse: false });
      tails = [{ id: d, label: iff[2] || iff[3] || undefined }];
      continue;
    }
    const elif = line.match(
      /^else\s*if\s*\((.*)\)\s*(?:is\s*\((.*?)\)\s*)?then\s*(?:\((.*?)\))?$/i,
    );
    if (elif) {
      const f = top("if");
      if (!f) continue;
      f.ends.push(...tails);
      tails = [{ id: f.last }];
      f.last = node(elif[1], "diamond");
      tails = [{ id: f.last, label: elif[2] || elif[3] || undefined }];
      continue;
    }
    const els = line.match(/^else\s*(?:\((.*?)\))?$/i);
    if (els) {
      const f = top("if");
      if (!f) continue;
      f.ends.push(...tails);
      f.hasElse = true;
      tails = [{ id: f.last, label: els[1] || undefined }];
      continue;
    }
    if (/^end\s*if$/i.test(line)) {
      const f = top("if");
      if (!f) continue;
      frames.pop();
      tails = [...f.ends, ...tails, ...(f.hasElse ? [] : [{ id: f.last }])];
      continue;
    }
    const whl = line.match(/^while\s*\((.*?)\)\s*(?:is\s*\((.*?)\))?$/i);
    if (whl) {
      const d = node(whl[1], "diamond");
      frames.push({ type: "while", diamond: d });
      tails = [{ id: d, label: whl[2] || undefined }];
      continue;
    }
    const endw = line.match(/^end\s*while\s*(?:\((.*?)\))?$/i);
    if (endw) {
      const f = top("while");
      if (!f) continue;
      frames.pop();
      for (const t of tails) link(t, f.diamond, pending);
      pending = undefined;
      tails = [{ id: f.diamond, label: endw[1] || undefined }];
      continue;
    }
    const rpt = line.match(/^repeat\s*(:.*)?$/i);
    if (rpt && !/^repeat\s+while\b/i.test(line)) {
      frames.push({ type: "repeat", start: null });
      if (rpt[1]) lines.splice(i + 1, 0, rpt[1]);
      continue;
    }
    const rptw = line.match(
      /^repeat\s*while\s*\((.*?)\)\s*(?:is\s*\((.*?)\))?\s*(?:not\s*\((.*?)\))?$/i,
    );
    if (rptw) {
      const f = top("repeat");
      if (!f) continue;
      frames.pop();
      const d = node(rptw[1], "diamond");
      if (f.start) link({ id: d }, f.start, rptw[2] || undefined);
      tails = [{ id: d, label: rptw[3] || undefined }];
      continue;
    }
    const fork = line.match(/^(fork|split)$/i);
    if (fork) {
      const bars = fork[1].toLowerCase() === "fork";
      if (bars) node("", "bar");
      frames.push({ type: "fork", from: tails, ends: [], bars });
      continue;
    }
    if (/^(fork|split)\s+again$/i.test(line)) {
      const f = top("fork");
      if (!f) continue;
      f.ends.push(...tails);
      tails = f.from;
      continue;
    }
    if (/^end\s*(fork|merge|split)\b/i.test(line)) {
      const f = top("fork");
      if (!f) continue;
      frames.pop();
      tails = [...f.ends, ...tails];
      if (f.bars) node("", "bar");
      continue;
    }
    const part = line.match(/^(partition|group|package|rectangle|card)\s+(.*?)\s*\{?$/i);
    if (part) {
      const name = unquote(undecorate(part[2]));
      const sg: Subgraph = { id: `g${subgraphs.length}`, label: name, nodes: [] };
      subgraphs.push(sg);
      groups.push(sg);
      continue;
    }
    if (line === "}" || /^end\s*(group|partition)$/i.test(line)) {
      groups.pop();
      continue;
    }
    if (/^\|.*\|/.test(line)) {
      warnings.push("Swimlanes are left out");
      continue;
    }
    if (/^(floating\s+)?note\b/i.test(line)) {
      if (!line.includes(":")) while (i + 1 < lines.length && !/^end\s*note$/i.test(lines[++i]));
      warnings.push("Notes are left out");
      continue;
    }
    warnings.push(`Skipped "${line}"`);
  }
  return {
    kind: "flowchart",
    direction: "TB",
    nodes,
    edges,
    subgraphs: subgraphs.filter((s) => s.nodes.length),
    warnings: [...new Set(warnings)],
  };
}
