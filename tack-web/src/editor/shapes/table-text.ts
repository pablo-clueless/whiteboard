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

/**
 * Reads fields back from that text. Forgiving: a line is a name, then optionally a type, flags
 * (`pk`, `fk`, also DBML's `[pk]` and `[ref: …]`) and a `//` note. Blank lines are skipped.
 */
export function textToFields(text: string): TableField[] {
  const fields: TableField[] = [];
  for (const raw of text.split("\n")) {
    const [body, ...noteParts] = raw.split("//");
    const note = noteParts.join("//").trim() || undefined;
    // `[pk, ref: > users.id]` style settings count as flags too.
    const settings = body.match(/\[(.*)\]/)?.[1]?.toLowerCase() ?? "";
    const words = body
      .replace(/\[.*\]/, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) continue;
    const [name, ...rest] = words;
    const flags = rest.filter((w) => /^(pk|fk)$/i.test(w)).map((w) => w.toLowerCase());
    const type = rest.filter((w) => !/^(pk|fk)$/i.test(w)).join(" ");
    fields.push({
      name,
      type,
      pk: flags.includes("pk") || /\bpk\b|primary key/.test(settings) || undefined,
      fk: flags.includes("fk") || /\bref\b/.test(settings) || undefined,
      note,
    });
  }
  return fields;
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
