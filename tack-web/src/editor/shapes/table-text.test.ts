import { describe, expect, it } from "vitest";

import { fieldsToText, readFieldsText, remapRow, textToFields } from "./table-text";
import type { TableField } from "./table";

const FIELDS: TableField[] = [
  { name: "id", type: "uuid", pk: true },
  { name: "team", type: "uuid", fk: true, note: "owning team" },
  { name: "price", type: "decimal(10, 2)" },
];

describe("fields as text", () => {
  it("round-trips", () => {
    const text = fieldsToText(FIELDS);
    expect(text).toBe("id uuid pk\nteam uuid fk // owning team\nprice decimal(10, 2)");
    expect(textToFields(text)).toEqual([
      { name: "id", type: "uuid", pk: true, fk: undefined, note: undefined },
      { name: "team", type: "uuid", pk: undefined, fk: true, note: "owning team" },
      { name: "price", type: "decimal(10, 2)", pk: undefined, fk: undefined, note: undefined },
    ]);
  });

  it("accepts DBML settings, a missing type, and skips blank lines", () => {
    expect(textToFields("id int [pk]\n\nowner uuid [ref: > users.id]\nflag")).toMatchObject([
      { name: "id", type: "int", pk: true },
      { name: "owner", type: "uuid", fk: true },
      { name: "flag", type: "" },
    ]);
  });
});

describe("relationships typed on fields", () => {
  it("reads DBML refs and the short form, marking those fields fk", () => {
    const { fields, refs } = readFieldsText(
      [
        "id uuid pk",
        "team uuid [ref: > teams.id]",
        'owner uuid > "users"."id" // who made it',
        "tags int <> tags.id",
        "plain varchar(255)",
      ].join("\n"),
    );
    expect(fields.map((f) => [f.name, f.type, !!f.fk])).toEqual([
      ["id", "uuid", false],
      ["team", "uuid", true],
      ["owner", "uuid", true],
      ["tags", "int", true],
      ["plain", "varchar(255)", false],
    ]);
    expect(fields[2].note).toBe("who made it");
    expect(refs).toEqual([
      { row: 1, kind: ">", table: "teams", field: "id" },
      { row: 2, kind: ">", table: "users", field: "id" },
      { row: 3, kind: "<>", table: "tags", field: "id" },
    ]);
  });

  it("doesn't read a ref out of a note or an ordinary type", () => {
    expect(readFieldsText("price decimal(10, 2) // see > other.thing").refs).toEqual([]);
    expect(readFieldsText("created timestamp-tz").refs).toEqual([]);
  });
});

describe("remapRow", () => {
  const before: TableField[] = [
    { name: "id", type: "" },
    { name: "a", type: "" },
    { name: "b", type: "" },
  ];

  it("follows a field to its new position", () => {
    const after = [{ name: "new", type: "" }, ...before.slice().reverse()];
    expect(remapRow(before, after, 2)).toBe(1); // b moved from row 2 to row 1
    expect(remapRow(before, after, 0)).toBe(3); // id moved to the end
  });

  it("keeps the row slot when the field was removed or renamed", () => {
    expect(
      remapRow(
        before,
        [
          { name: "id", type: "" },
          { name: "renamed", type: "" },
          { name: "b", type: "" },
        ],
        1,
      ),
    ).toBe(1);
    expect(remapRow(before, [{ name: "id", type: "" }], 2)).toBe(0);
  });
});
