/**
 * A forgiving DBML reader (https://dbml.dbdiagram.io/docs): tables, fields, keys, inline and
 * standalone refs, and enums. It skips what it doesn't need (indexes, notes on tables, projects,
 * table groups) rather than failing, and reports lines it couldn't read.
 */

export type SchemaField = {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  notNull: boolean;
  /** Marked as a foreign key (Mermaid's FK); refs mark the rest when drawn. */
  fk?: boolean;
  note?: string;
};

export type SchemaTable = { name: string; fields: SchemaField[]; kind: "table" | "enum" };

/** `>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many (from → to). */
export type RefKind = ">" | "<" | "-" | "<>";

export type SchemaRef = {
  from: { table: string; field: string };
  to: { table: string; field: string };
  kind: RefKind;
  label?: string;
};

export type Schema = { tables: SchemaTable[]; refs: SchemaRef[]; warnings: string[] };

const NAME = String.raw`(?:"[^"]+"|[\w$]+(?:\.[\w$]+)?)`;
const unquote = (s: string) =>
  s
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1");

/** Splits `a, b, 'c, d'` on top-level commas. */
function splitSettings(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let depth = 0;
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `Table.field` or `schema.Table.field` or `Table.(a, b)` (first column). */
function parseEndpoint(s: string): { table: string; field: string } | null {
  const m = s.trim().match(/^(.+)\.\(?\s*("[^"]+"|[\w$]+)/);
  if (!m) return null;
  const tablePart = m[1].trim();
  // Drop a schema prefix: `public.users` → `users`.
  const table = unquote(tablePart.split(".").pop() ?? tablePart);
  return { table, field: unquote(m[2]) };
}

const REF_OP = /^\s*(<>|<|>|-)\s*(.+)$/;

/** `> users.id` inside a field's settings. */
function parseInlineRef(
  value: string,
): { kind: RefKind; to: { table: string; field: string } } | null {
  const m = value.match(REF_OP);
  const to = m && parseEndpoint(m[2]);
  return m && to ? { kind: m[1] as RefKind, to } : null;
}

/** `users.id < posts.user_id` (a standalone ref's body). */
function parseRefLine(line: string): SchemaRef | null {
  const m = line.match(/^\s*(.+?)\s*(<>|<|>|-)\s*(.+?)\s*(?:\[.*\])?\s*$/);
  if (!m) return null;
  const from = parseEndpoint(m[1]);
  const to = parseEndpoint(m[3]);
  return from && to ? { from, to, kind: m[2] as RefKind } : null;
}

/**
 * `name type [bare flags] [settings] // comment`. Bare flags (`id uuid pk`) aren't standard DBML
 * but some tools write them, so they're accepted too.
 */
const FIELD = new RegExp(
  String.raw`^(${NAME})\s+("[^"]+"|[A-Za-z_][\w.]*(?:\s*\([^)]*\))?(?:\[\])*)((?:\s+(?:pk|primary\s+key|unique|not\s+null|null|increment))*)\s*(\[.*?\])?\s*(?://(.*))?$`,
  "i",
);

export function parseDbml(source: string): Schema {
  const tables: SchemaTable[] = [];
  const refs: SchemaRef[] = [];
  const warnings: string[] = [];
  const aliases = new Map<string, string>();

  const lines = source.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/);
  let i = 0;

  /** Skips a `{ … }` block whose opening line is lines[i]. */
  const skipBlock = () => {
    let depth = 0;
    for (; i < lines.length; i++) {
      depth += (lines[i].match(/\{/g) ?? []).length - (lines[i].match(/\}/g) ?? []).length;
      if (depth <= 0) return;
    }
  };

  for (; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("//")) continue;

    const table = line.match(
      new RegExp(
        String.raw`^Table\s+(${NAME})(?:\s+as\s+(${NAME}))?\s*(?:\[[^\]]*\])?\s*\{\s*$`,
        "i",
      ),
    );
    if (table) {
      const name = unquote(table[1].split(".").pop()!);
      if (table[2]) aliases.set(unquote(table[2]), name);
      const fields: SchemaField[] = [];
      for (i++; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (raw === "}") break;
        if (!raw || raw.startsWith("//") || /^note\s*:/i.test(raw)) continue;
        // Nested blocks: indexes, multi-line notes.
        if (/\{\s*$/.test(raw)) {
          skipBlock();
          continue;
        }
        const f = raw.match(FIELD);
        if (!f) {
          warnings.push(`Couldn't read a field in ${name}: "${raw}"`);
          continue;
        }
        const field: SchemaField = {
          name: unquote(f[1]),
          type: unquote(f[2]).replace(/\s+/g, " "),
          pk: false,
          unique: false,
          notNull: false,
          note: f[5]?.trim() || undefined,
        };
        const bare = (f[3] ?? "").toLowerCase();
        if (/\bpk\b|primary\s+key/.test(bare)) field.pk = true;
        if (/\bunique\b/.test(bare)) field.unique = true;
        if (/not\s+null/.test(bare)) field.notNull = true;
        for (const setting of splitSettings(f[4]?.slice(1, -1) ?? "")) {
          const [key, ...rest] = setting.split(":");
          const k = key.trim().toLowerCase();
          const value = rest.join(":");
          if (k === "pk" || k === "primary key") field.pk = true;
          else if (k === "unique") field.unique = true;
          else if (k === "not null") field.notNull = true;
          else if (k === "note") field.note = unquote(value);
          else if (k === "ref") {
            const ref = parseInlineRef(value);
            if (ref)
              refs.push({ from: { table: name, field: field.name }, to: ref.to, kind: ref.kind });
            else warnings.push(`Couldn't read the ref on ${name}.${field.name}`);
          }
        }
        fields.push(field);
      }
      tables.push({ name, fields, kind: "table" });
      continue;
    }

    const en = line.match(new RegExp(String.raw`^Enum\s+(${NAME})\s*\{\s*$`, "i"));
    if (en) {
      const name = unquote(en[1].split(".").pop()!);
      const fields: SchemaField[] = [];
      for (i++; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (raw === "}") break;
        if (!raw || raw.startsWith("//")) continue;
        const value = raw.replace(/\s*\[.*\]\s*$/, "");
        fields.push({ name: unquote(value), type: "", pk: false, unique: false, notNull: false });
      }
      tables.push({ name, fields, kind: "enum" });
      continue;
    }

    // `Ref: a.b > c.d`, `Ref name: …`, or `Ref { … }` with one per line.
    const refOne = line.match(/^Ref(?:\s+[\w"]+)?\s*:\s*(.+)$/i);
    if (refOne) {
      const ref = parseRefLine(refOne[1]);
      if (ref) refs.push(ref);
      else warnings.push(`Couldn't read "${line}"`);
      continue;
    }
    if (/^Ref(?:\s+[\w"]+)?\s*\{\s*$/i.test(line)) {
      for (i++; i < lines.length; i++) {
        const raw = lines[i].trim();
        if (raw === "}") break;
        if (!raw || raw.startsWith("//")) continue;
        const ref = parseRefLine(raw);
        if (ref) refs.push(ref);
        else warnings.push(`Couldn't read "${raw}"`);
      }
      continue;
    }

    // Project, TableGroup, Note and anything else with a block: not drawn.
    if (/\{\s*$/.test(line)) {
      skipBlock();
      continue;
    }
    warnings.push(`Skipped "${line}"`);
  }

  // Resolve aliases (`Table users as U` → refs to `U.id`).
  for (const r of refs) {
    r.from.table = aliases.get(r.from.table) ?? r.from.table;
    r.to.table = aliases.get(r.to.table) ?? r.to.table;
  }
  return { tables, refs, warnings };
}

/** Whether text looks like DBML: a `Table x {`, `Enum x {` or `Ref:` at the start of a line. */
export const looksLikeDbml = (text: string) =>
  /^\s*(Table|Enum)\s+\S+.*\{\s*$/im.test(text) || /^\s*Ref\b[^:\n]*:/im.test(text);
