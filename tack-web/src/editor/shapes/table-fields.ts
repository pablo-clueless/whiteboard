import { type FieldRef, type FieldRefKind, remapRow } from "./table-text";
import type { Editor } from "../editor-core";
import type { Shape, Vec } from "../types";
import type { Binding } from "../bindings";
import { Builder } from "../templates";
import {
  fieldPort,
  rowMiddle,
  TABLE_HEADER,
  TABLE_ROW,
  type TableField,
  type TableProps,
  tableHeight,
  tableWidth,
} from "./table";

/** The row an anchor on a table of `rows` rows points at. */
function rowAt(anchor: Vec, rows: number): number {
  const y = anchor.y * tableHeight(rows);
  return Math.max(0, Math.min(Math.max(1, rows) - 1, Math.floor((y - TABLE_HEADER) / TABLE_ROW)));
}

/** The anchor for a row, keeping the side (x) it was on. */
const anchorFor = (row: number, rows: number, x: number): Vec => ({
  x,
  y: rowMiddle(row) / tableHeight(rows),
});

/** "1" and "*" for each end of a relationship (this field → the one it refers to). */
const CARDINALITY: Record<FieldRefKind, [string, string]> = {
  ">": ["*", "1"],
  "<": ["1", "*"],
  "-": ["1", "1"],
  "<>": ["*", "*"],
};

/** The table on the board called `name` (any case) nearest to `from`, other than itself. */
function tableNamed(editor: Editor, name: string, from: Shape): Shape | null {
  let best: Shape | null = null;
  let bestDistance = Infinity;
  for (const id of editor.sortedIds()) {
    const s = editor.getValidShape(id);
    if (!s || s.type !== "db-table") continue;
    if ((s.props as TableProps).name.toLowerCase() !== name.toLowerCase()) continue;
    const d = Math.hypot(s.x - from.x, s.y - from.y);
    if (d < bestDistance) [best, bestDistance] = [s, d];
  }
  return best;
}

/**
 * Draws the relationships typed in a table's fields (see `readFieldsText`), like imported ones:
 * from the field's row to the referenced field's row (or the primary key), labelled 1 and *.
 * One already drawn between those rows isn't drawn again. Call inside a transaction, after the
 * fields are saved. Returns the names of tables that aren't on the board.
 */
function drawRefs(editor: Editor, id: string, refs: FieldRef[]): string[] {
  const missing: string[] = [];
  const shape = editor.getValidShape(id);
  if (!shape) return missing;
  const rows = (shape.props as TableProps).fields.length;
  const b = new Builder(editor, { x: 0, y: 0 });
  for (const ref of refs) {
    // A table can refer to itself (a parent id); it then loops round its right side.
    const self = (shape.props as TableProps).name.toLowerCase() === ref.table.toLowerCase();
    const target = self ? shape : tableNamed(editor, ref.table, shape);
    if (!target) {
      missing.push(ref.table);
      continue;
    }
    const targetFields = (target.props as TableProps).fields;
    let toRow = targetFields.findIndex((f) => f.name.toLowerCase() === ref.field.toLowerCase());
    if (toRow < 0)
      toRow = Math.max(
        0,
        targetFields.findIndex((f) => f.pk),
      );

    // Already drawn: an arrow with one end on this row and the other on the target's row.
    const ends = new Map<string, { toId: string; row: number }[]>();
    editor.board.bindings.forEach((value) => {
      const binding = value as Binding;
      const on = editor.getValidShape(binding.toId);
      if (!on || on.type !== "db-table") return;
      const row = rowAt(binding.anchor, (on.props as TableProps).fields.length);
      ends.set(binding.arrowId, [...(ends.get(binding.arrowId) ?? []), { toId: on.id, row }]);
    });
    const drawn = [...ends.values()].some(
      (pair) =>
        pair.length === 2 &&
        pair.some((e) => e.toId === id && e.row === ref.row) &&
        pair.some((e) => e.toId === target.id && e.row === toRow),
    );
    if (drawn || ref.row >= rows) continue;

    const [fromSide, toSide] =
      self || Math.abs(target.x - shape.x) < 1
        ? (["right", "right"] as const)
        : target.x > shape.x
          ? (["right", "left"] as const)
          : (["left", "right"] as const);
    const [startLabel, endLabel] = CARDINALITY[ref.kind];
    b.connectPorts(id, fieldPort(ref.row, fromSide), target.id, fieldPort(toRow, toSide), {
      arrowStart: false,
      arrowEnd: false,
      stroke: "#8a8a93",
      strokeWidth: 1.5,
      startLabel,
      endLabel,
    });
  }
  return [...new Set(missing)];
}

/**
 * Replaces a table's fields, as one undo step. Relationships stay on their fields: anchors are
 * fractions of the table's height, so without this, adding or reordering fields would shift
 * every attached arrow onto the wrong row. The card widens if the new fields need it.
 * Relationships typed on fields (`refs`) are drawn in the same step; returns the names of tables
 * they refer to that aren't on the board.
 */
export function setTableFields(
  editor: Editor,
  id: string,
  fields: TableField[],
  refs: FieldRef[] = [],
): string[] {
  const shape = editor.getValidShape(id);
  if (!shape || shape.type !== "db-table" || shape.locked) return [];
  const p = shape.props as TableProps;
  const moves: { arrowId: string; terminal: Binding["terminal"]; anchor: Vec }[] = [];
  editor.board.bindings.forEach((b) => {
    const binding = b as Binding;
    if (binding.toId !== id) return;
    const row = remapRow(p.fields, fields, rowAt(binding.anchor, p.fields.length));
    moves.push({
      arrowId: binding.arrowId,
      terminal: binding.terminal,
      anchor: anchorFor(row, fields.length, binding.anchor.x),
    });
  });
  let missing: string[] = [];
  editor.markHistory();
  editor.transact(() => {
    editor.updateShapes({
      [id]: {
        props: {
          ...p,
          fields,
          h: tableHeight(fields.length),
          w: Math.max(p.w, tableWidth(p.name, fields)),
        },
      },
    });
    for (const m of moves) editor.setBinding(m.arrowId, m.terminal, { toId: id, anchor: m.anchor });
    missing = drawRefs(editor, id, refs);
  });
  editor.markHistory();
  return missing;
}

/** Header colours offered in the style panel. */
export const HEADER_COLORS = [
  { value: "#2f6694", label: "Blue" },
  { value: "#1f7a5c", label: "Green" },
  { value: "#7a4fb5", label: "Purple" },
  { value: "#b5532a", label: "Rust" },
  { value: "#9b2c4b", label: "Wine" },
  { value: "#3d3d45", label: "Graphite" },
];
