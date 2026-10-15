/** Pure helpers for editing a table's fields as text. No canvas code, so they're easy to test. */

import type { TableField } from "./table";

/**
 * A table's fields as text, one per line, in DBML's field syntax:
 * `name type [pk] [fk] // note`. Easy to type, and to paste from a schema.
 */
export function fieldsToText(fields: TableField[]): string {
  return fields
    .map(
      (f) =>
        [f.name, f.type, f.pk && "pk", f.fk && "fk"].filter(Boolean).join(" ") +
        (f.note ? ` // ${f.note}` : ""),
    )
    .join("\n");
}

/** `>` many-to-one, `<` one-to-many, `-` one-to-one, `<>` many-to-many, as in DBML. */
export type FieldRefKind = ">" | "<" | "-" | "<>";

/** A relationship typed on a field's line, for drawing: from that field to `table.field`. */
export type FieldRef = { row: number; kind: FieldRefKind; table: string; field: string };

/** `> teams.id`, `<> tags.id` or `- users.id` (table and field may be quoted). */
const REF = /(<>|<|>|-)\s*"?([^\s".]+)"?\."?([^\s"\]]+)"?/;

/**
 * Reads fields back from that text. Forgiving: a line is a name, then optionally a type, flags
 * (`pk`, `fk`, also DBML's `[pk]` and `[ref: …]`) and a `//` note. Blank lines are skipped.
 */
export function textToFields(text: string): TableField[] {
  return readFieldsText(text).fields;
}

/**
 * Like `textToFields`, and also returns the relationships typed on fields: DBML's
 * `[ref: > teams.id]`, or just `> teams.id` after the type. Those fields count as `fk`.
 */
export function readFieldsText(text: string): { fields: TableField[]; refs: FieldRef[] } {
  const fields: TableField[] = [];
  const refs: FieldRef[] = [];
  for (const raw of text.split("\n")) {
    const [body, ...noteParts] = raw.split("//");
    const note = noteParts.join("//").trim() || undefined;
    // `[pk, ref: > users.id]` style settings count as flags too.
    const rawSettings = body.match(/\[(.*)\]/)?.[1] ?? "";
    const settings = rawSettings.toLowerCase();
    let outside = body.replace(/\[.*\]/, "");
    const inline = outside.match(REF);
    if (inline) outside = outside.replace(inline[0], " ");
    const words = outside.trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    const [name, ...rest] = words;
    const flags = rest.filter((w) => /^(pk|fk)$/i.test(w)).map((w) => w.toLowerCase());
    const type = rest.filter((w) => !/^(pk|fk)$/i.test(w)).join(" ");
    const ref = rawSettings.match(new RegExp(String.raw`\bref\s*:\s*` + REF.source, "i")) ?? inline;
    if (ref) {
      const [, kind, table, field] = ref;
      refs.push({ row: fields.length, kind: kind as FieldRefKind, table, field });
    }
    fields.push({
      name,
      type,
      pk: flags.includes("pk") || /\bpk\b|primary key/.test(settings) || undefined,
      fk: flags.includes("fk") || /\bref\b/.test(settings) || !!ref || undefined,
      note,
    });
  }
  return { fields, refs };
}

/**
 * Where an arrow attached to row `oldRow` of `before` should attach after the fields become
 * `after`: the same field by name, or failing that the same row (clamped to the new count).
 */
export function remapRow(before: TableField[], after: TableField[], oldRow: number): number {
  const name = before[oldRow]?.name;
  const same = name === undefined ? -1 : after.findIndex((f) => f.name === name);
  if (same >= 0) return same;
  return Math.min(oldRow, Math.max(1, after.length) - 1);
}
