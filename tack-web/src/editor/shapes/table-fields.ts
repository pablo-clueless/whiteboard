import type { Editor } from "../editor-core";
import type { Binding } from "../bindings";
import { remapRow } from "./table-text";
import type { Vec } from "../types";
import {
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

/**
 * Replaces a table's fields, as one undo step. Relationships stay on their fields: anchors are
 * fractions of the table's height, so without this, adding or reordering fields would shift
 * every attached arrow onto the wrong row. The card widens if the new fields need it.
 */
export function setTableFields(editor: Editor, id: string, fields: TableField[]) {
  const shape = editor.getValidShape(id);
  if (!shape || shape.type !== "db-table" || shape.locked) return;
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
  });
  editor.markHistory();
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
