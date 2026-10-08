import * as Y from "yjs";

import { shapeRegistry } from "../shapes/registry";

import { type BoardDoc, SCHEMA_VERSION } from "./board-doc";

/**
 * Transaction origin for migrations. The undo manager tracks only local edits, so nobody can
 * undo a migration, and other clients receive it like any other update.
 */
export const MIGRATION_ORIGIN = "migration";

/** A shape record's props version. Records written before versions existed are version 1. */
export const shapeVersion = (m: Y.Map<unknown>) => {
  const v = m.get("v");
  return typeof v === "number" && v >= 1 ? v : 1;
};

export type MigrationResult = {
  /** Shapes upgraded to their ShapeDef's current version. */
  migrated: number;
  /**
   * The board, or a shape on it, was written by a newer Tack than this one. Nothing was changed,
   * and this client must not edit the board: it could write data newer clients don't expect.
   */
  newer: boolean;
};

/** Whether anything on the board is newer than this client understands. */
export function isNewer(board: BoardDoc): boolean {
  const stored = board.meta.get("schemaVersion");
  if (typeof stored === "number" && stored > SCHEMA_VERSION) return true;
  let newer = false;
  board.shapes.forEach((m) => {
    const def = shapeRegistry.get(m.get("type") as string);
    if (def && shapeVersion(m) > def.version) newer = true;
  });
  return newer;
}

/**
 * Brings the board up to date: every shape whose props are older than its ShapeDef runs the
 * remaining `migrations` in order, and the board is stamped with SCHEMA_VERSION. All in one
 * transaction. Clients that do this at the same time write the same values, so they agree.
 *
 * Shapes of a type this client doesn't know (a plugin it lacks) are left alone. A migration that
 * throws leaves its shape as it was; the shape's `validate` still copes with old props.
 */
export function migrateBoard(board: BoardDoc): MigrationResult {
  if (isNewer(board)) return { migrated: 0, newer: true };

  const upgrades: { m: Y.Map<unknown>; props: unknown; v: number }[] = [];
  board.shapes.forEach((m, id) => {
    const def = shapeRegistry.get(m.get("type") as string);
    const from = shapeVersion(m);
    if (!def || from >= def.version) return;
    try {
      let props = m.get("props");
      for (let v = from; v < def.version; v++) {
        const step = def.migrations[v - 1];
        if (!step) throw new Error(`${def.type} has no migration from version ${v}`);
        props = step(props);
      }
      upgrades.push({ m, props, v: def.version });
    } catch (err) {
      console.warn(`[tack] couldn't migrate shape ${id}`, err);
    }
  });

  const stamp = board.meta.get("schemaVersion") !== SCHEMA_VERSION;
  if (upgrades.length || stamp) {
    board.doc.transact(() => {
      for (const { m, props, v } of upgrades) {
        m.set("props", props);
        m.set("v", v);
      }
      if (stamp) board.meta.set("schemaVersion", SCHEMA_VERSION);
    }, MIGRATION_ORIGIN);
  }
  return { migrated: upgrades.length, newer: false };
}
