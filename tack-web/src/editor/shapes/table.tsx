import { Group, Rect, Text } from "react-konva";
import { KeyRound, Link2 } from "lucide";

import { glyph, iconSvg, KonvaIcon } from "../icons";
import { useEditorStore } from "@/stores/editor";
import { measureText, textFont } from "./text";
import type { ShapeDef, Vec } from "../types";
import { fontFamily } from "../fonts";
import { num, str } from "./box";
import { esc, n } from "../svg";

/**
 * A database table, as in an ER diagram: a coloured header with its name, and a row per field
 * with the field's type, marking primary and foreign keys. Each row has a connection point on
 * both sides, so relationships attach to the exact field they involve.
 */
export type TableField = {
  name: string;
  type: string;
  /** Primary key. */
  pk?: boolean;
  /** References another table (a foreign key). */
  fk?: boolean;
  /** Free text, e.g. the allowed values from a DBML comment. */
  note?: string;
};

export type TableProps = {
  name: string;
  fields: TableField[];
  /** Header colour. (Not `color`, which the style panel treats as text colour.) */
  headerColor: string;
  w: number;
  /** Derived from the number of fields; kept in props so arrows can attach to the box. */
  h: number;
};

export const TABLE_HEADER = 32;
export const TABLE_ROW = 24;
const PAD = 10;
const ICON = 11;
const NAME_SIZE = 13;
const FIELD_SIZE = 12;
const TYPE_SIZE = 11;
const DEFAULT_COLOR = "#2f6694";

const KEY = glyph(KeyRound);
const LINK = glyph(Link2);

export const tableHeight = (fields: number) => TABLE_HEADER + Math.max(1, fields) * TABLE_ROW;

/** The y of a field row's middle, in the table's own space. */
export const rowMiddle = (i: number) => TABLE_HEADER + TABLE_ROW * (i + 0.5);

/** The connection point for a field: left or right edge, level with its row. */
export const fieldPort = (i: number, side: "left" | "right") => i * 2 + (side === "right" ? 1 : 0);

const sans = (size: number, weight = 400) => ({
  fontSize: size,
  fontFamily: "sans",
  fontWeight: weight,
});
const mono = (size: number) => ({ fontSize: size, fontFamily: "mono", fontWeight: 400 });

/** A width that fits the name and every field with its type, with room to breathe. */
export function tableWidth(name: string, fields: TableField[]): number {
  let w = measureText(name, sans(NAME_SIZE, 700)).w + PAD * 2;
  for (const f of fields) {
    const icons = (f.pk ? ICON + 4 : 0) + (f.fk ? ICON + 4 : 0);
    const row =
      PAD +
      measureText(f.name, sans(FIELD_SIZE, f.pk ? 700 : 400)).w +
      4 +
      icons +
      24 +
      measureText(f.type, mono(TYPE_SIZE)).w +
      PAD;
    w = Math.max(w, row);
  }
  return Math.ceil(Math.max(160, w));
}

function validateFields(raw: unknown): TableField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      name: str(f.name, "field").slice(0, 120),
      type: str(f.type, "").slice(0, 60),
      pk: f.pk === true,
      fk: f.fk === true,
      note: typeof f.note === "string" ? f.note.slice(0, 300) : undefined,
    }))
    .slice(0, 300);
}

/** Positions of a field's name, icons and type within its row. */
function rowLayout(f: TableField, w: number) {
  const nameW = measureText(f.name, sans(FIELD_SIZE, f.pk ? 700 : 400)).w;
  let x = PAD + nameW + 4;
  const icons: { icon: typeof KEY; x: number }[] = [];
  if (f.pk) {
    icons.push({ icon: KEY, x });
    x += ICON + 4;
  }
  if (f.fk) icons.push({ icon: LINK, x });
  return { icons, typeRight: w - PAD };
}

export const tableShape: ShapeDef<TableProps, "db-table"> = {
  type: "db-table",
  version: 1,
  defaultProps: {
    name: "table",
    fields: [{ name: "id", type: "uuid", pk: true }],
    headerColor: DEFAULT_COLOR,
    w: 180,
    h: tableHeight(1),
  },
  validate: (raw) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const fields = validateFields(p.fields);
    return {
      name: str(p.name, "table").slice(0, 120),
      fields,
      headerColor: str(p.headerColor, DEFAULT_COLOR),
      w: Math.max(100, num(p.w, 180)),
      h: tableHeight(fields.length),
    };
  },
  getBounds: (s) => ({ x: s.x, y: s.y, w: s.props.w, h: s.props.h }),
  // Only the width changes; the height follows the fields.
  onResize: (shape, { scaleX, initial }) => ({
    props: {
      ...shape.props,
      w: Math.max(100, Math.abs((initial.props as TableProps).w * scaleX)),
    },
  }),
  // Both sides of every row, so relationships attach to the field itself.
  // A table with no fields yet has one empty row; its points sit there too.
  getAnchors: ({ props: p }) =>
    Array.from({ length: Math.max(1, p.fields.length) }, (_, i): Vec[] => [
      { x: 0, y: rowMiddle(i) },
      { x: p.w, y: rowMiddle(i) },
    ]).flat(),
  label: {
    prop: "name",
    box: (s) => ({
      x: PAD - 2,
      y: 4,
      w: s.props.w - PAD * 2 + 4,
      h: TABLE_HEADER - 8,
      fontSize: NAME_SIZE,
      fontWeight: 700,
    }),
  },
  toSvg: ({ props: p }) => {
    const rows = p.fields
      .map((f, i) => {
        const y = rowMiddle(i);
        const l = rowLayout(f, p.w);
        return (
          `<text x="${PAD}" y="${y}" dominant-baseline="central" font-family="${esc(textFont())}" font-size="${FIELD_SIZE}" font-weight="${f.pk ? 700 : 400}" fill="#2a2a30">${esc(f.name)}</text>` +
          l.icons.map((ic) => iconSvg(ic.icon, "#5e5f66", ic.x, y - ICON / 2, ICON)).join("") +
          `<text x="${l.typeRight}" y="${y}" text-anchor="end" dominant-baseline="central" font-family="${esc(fontFamily("mono"))}" font-size="${TYPE_SIZE}" fill="#8a8a93">${esc(f.type)}</text>`
        );
      })
      .join("");
    return (
      `<rect width="${n(p.w)}" height="${n(p.h)}" rx="6" fill="#f3f3f5" stroke="#d6d6dc"/>` +
      `<path d="M0 6a6 6 0 0 1 6-6h${n(p.w - 12)}a6 6 0 0 1 6 6v${TABLE_HEADER - 6}h-${n(p.w)}z" fill="${esc(p.headerColor)}"/>` +
      `<text x="${PAD}" y="${TABLE_HEADER / 2}" dominant-baseline="central" font-family="${esc(textFont())}" font-size="${NAME_SIZE}" font-weight="700" fill="#ffffff">${esc(p.name)}</text>` +
      rows
    );
  },
  Component: function DbTable({ shape, isSelected }) {
    const editing = useEditorStore((s) => s.editingLabelId === shape.id);
    const p = shape.props;
    return (
      <Group>
        <Rect
          width={p.w}
          height={p.h}
          cornerRadius={6}
          fill="#f3f3f5"
          stroke={isSelected ? "#3366ff" : "#d6d6dc"}
          strokeWidth={1}
          shadowColor="#0e0e10"
          shadowOpacity={0.12}
          shadowBlur={8}
          shadowOffsetY={2}
          perfectDrawEnabled={false}
        />
        <Rect
          width={p.w}
          height={TABLE_HEADER}
          cornerRadius={[6, 6, 0, 0]}
          fill={p.headerColor}
          listening={false}
        />
        {!editing && (
          <Text
            x={PAD}
            y={0}
            width={p.w - PAD * 2}
            height={TABLE_HEADER}
            verticalAlign="middle"
            text={p.name}
            fontSize={NAME_SIZE}
            fontFamily={textFont()}
            fontStyle="700"
            fill="#ffffff"
            wrap="none"
            ellipsis
            listening={false}
          />
        )}
        {p.fields.map((f, i) => {
          const y = TABLE_HEADER + i * TABLE_ROW;
          const l = rowLayout(f, p.w);
          return (
            <Group key={i} y={y} listening={false}>
              <Text
                x={PAD}
                height={TABLE_ROW}
                verticalAlign="middle"
                text={f.name}
                fontSize={FIELD_SIZE}
                fontFamily={textFont()}
                fontStyle={f.pk ? "700" : "400"}
                fill="#2a2a30"
              />
              {l.icons.map((ic, j) => (
                <KonvaIcon
                  key={j}
                  icon={ic.icon}
                  color="#5e5f66"
                  x={ic.x}
                  y={(TABLE_ROW - ICON) / 2}
                  size={ICON}
                />
              ))}
              <Text
                x={PAD}
                width={l.typeRight - PAD}
                height={TABLE_ROW}
                align="right"
                verticalAlign="middle"
                text={f.type}
                fontSize={TYPE_SIZE}
                fontFamily={fontFamily("mono")}
                fill="#8a8a93"
              />
            </Group>
          );
        })}
      </Group>
    );
  },
  migrations: [],
};
