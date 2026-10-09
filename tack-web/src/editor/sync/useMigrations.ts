"use client";

import type { WebsocketProvider } from "y-websocket";
import { useEffect } from "react";
import * as Y from "yjs";

import { MIGRATION_ORIGIN, migrateBoard, isNewer, shapeVersion } from "./migrate";
import { type BoardDoc, SCHEMA_VERSION } from "./board-doc";
import { type Editor, LOCAL_ORIGIN } from "../editor-core";
import { shapeRegistry } from "../shapes/registry";

/**
 * Upgrades the board once it has synced (and again after each reconnect), and switches the editor
 * to read-only if the board turns out to be newer than this client, now or later on.
 *
 * Viewers never write, so they only check.
 */
export function useMigrations(
  editor: Editor,
  board: BoardDoc,
  provider: WebsocketProvider,
  { viewOnly }: { viewOnly: boolean },
) {
  useEffect(() => {
    // The flag lives in a store shared by every board this tab opens.
    editor.ui.setOutdated(false);

    const run = () => {
      if (!provider.synced) return;
      const newer = viewOnly ? isNewer(board) : migrateBoard(board).newer;
      if (newer) editor.ui.setOutdated(true);
    };
    run();
    provider.on("sync", run);

    // Someone on a newer Tack can change the board while it's open here. Check only what changed.
    const onMeta = (_e: Y.YMapEvent<unknown>, txn: Y.Transaction) => {
      if (txn.origin === LOCAL_ORIGIN || txn.origin === MIGRATION_ORIGIN) return;
      const v = board.meta.get("schemaVersion");
      if (typeof v === "number" && v > SCHEMA_VERSION) editor.ui.setOutdated(true);
    };
    const onShapes = (events: Y.YEvent<Y.AbstractType<unknown>>[], txn: Y.Transaction) => {
      if (txn.origin === LOCAL_ORIGIN || txn.origin === MIGRATION_ORIGIN) return;
      const ids = new Set<string>();
      for (const e of events) {
        if (e.target === board.shapes) e.changes.keys.forEach((_, id) => ids.add(id));
        else if (typeof e.path[0] === "string") ids.add(e.path[0]);
      }
      for (const id of ids) {
        const m = board.shapes.get(id);
        const def = m && shapeRegistry.get(m.get("type") as string);
        if (m && def && shapeVersion(m) > def.version) return editor.ui.setOutdated(true);
      }
    };
    board.meta.observe(onMeta);
    board.shapes.observeDeep(onShapes);
    return () => {
      provider.off("sync", run);
      board.meta.unobserve(onMeta);
      board.shapes.unobserveDeep(onShapes);
    };
  }, [editor, board, provider, viewOnly]);
}
