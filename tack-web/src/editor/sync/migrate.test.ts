import { beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { isNewer, MIGRATION_ORIGIN, migrateBoard } from "./migrate";
import { createBoardDoc, SCHEMA_VERSION } from "./board-doc";
import { shapeRegistry } from "../shapes/registry";
import type { ShapeDef } from "../types";

/** A test shape at version 3: v1 → v2 renames `size` to `w`, v2 → v3 adds `h`. */
const widget: ShapeDef<{ w: number; h: number }, "test-widget"> = {
  type: "test-widget",
  version: 3,
  defaultProps: { w: 1, h: 1 },
  validate: (p) => p as { w: number; h: number },
  getBounds: () => ({ x: 0, y: 0, w: 1, h: 1 }),
  Component: () => null as never,
  migrations: [
    (p) => {
      const { size, ...rest } = p as { size: number };
      return { ...rest, w: size };
    },
    (p) => ({ ...(p as object), h: (p as { w: number }).w / 2 }),
  ],
};

beforeAll(() => shapeRegistry.register(widget));

function boardWith(records: Record<string, Record<string, unknown>>, schemaVersion?: number) {
  const board = createBoardDoc(new Y.Doc());
  board.doc.transact(() => {
    for (const [id, r] of Object.entries(records))
      board.shapes.set(id, new Y.Map(Object.entries(r)));
    if (schemaVersion !== undefined) board.meta.set("schemaVersion", schemaVersion);
  });
  return board;
}

describe("migrateBoard", () => {
  it("runs every pending migration in order and stamps the board", () => {
    const board = boardWith({ a: { type: "test-widget", props: { size: 10 } } });
    const origins: unknown[] = [];
    board.doc.on("afterTransaction", (t) => origins.push(t.origin));

    expect(migrateBoard(board)).toEqual({ migrated: 1, newer: false });
    const a = board.shapes.get("a")!;
    expect(a.get("props")).toEqual({ w: 10, h: 5 });
    expect(a.get("v")).toBe(3);
    expect(board.meta.get("schemaVersion")).toBe(SCHEMA_VERSION);
    // One transaction, marked as a migration (so nobody's undo picks it up).
    expect(origins).toEqual([MIGRATION_ORIGIN]);
  });

  it("starts from the stored version", () => {
    const board = boardWith({ a: { type: "test-widget", v: 2, props: { w: 8 } } });
    migrateBoard(board);
    expect(board.shapes.get("a")!.get("props")).toEqual({ w: 8, h: 4 });
  });

  it("leaves current shapes and unknown types alone", () => {
    const board = boardWith(
      {
        a: { type: "test-widget", v: 3, props: { w: 1, h: 1 } },
        b: { type: "from-a-plugin-we-lack", props: { x: 1 } },
      },
      SCHEMA_VERSION,
    );
    expect(migrateBoard(board)).toEqual({ migrated: 0, newer: false });
    expect(board.shapes.get("b")!.get("props")).toEqual({ x: 1 });
  });

  it("changes nothing on a board saved by a newer version", () => {
    const newerBoard = boardWith(
      { a: { type: "test-widget", props: { size: 10 } } },
      SCHEMA_VERSION + 1,
    );
    expect(isNewer(newerBoard)).toBe(true);
    expect(migrateBoard(newerBoard)).toEqual({ migrated: 0, newer: true });
    expect(newerBoard.shapes.get("a")!.get("props")).toEqual({ size: 10 });

    const newerShape = boardWith({ a: { type: "test-widget", v: 9, props: {} } });
    expect(migrateBoard(newerShape).newer).toBe(true);
  });

  it("keeps a shape as it was when its migration throws", () => {
    const board = boardWith({ a: { type: "test-widget", props: null } });
    expect(migrateBoard(board).migrated).toBe(0);
    expect(board.shapes.get("a")!.get("v")).toBeUndefined();
  });
});
