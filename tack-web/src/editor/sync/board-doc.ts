import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { env } from "@/lib/env";

/** Bumped when a migration changes the stored shape of the document. */
export const SCHEMA_VERSION = 1;

/** Typed access to the board's top-level Yjs structures. */
export type BoardDoc = {
  doc: Y.Doc;
  meta: Y.Map<unknown>;
  /** shapeId → shape record (a nested Y.Map per shape). */
  shapes: Y.Map<Y.Map<unknown>>;
  /** bindingId → binding (plain JSON). */
  bindings: Y.Map<unknown>;
};

export function createBoardDoc(doc = new Y.Doc()): BoardDoc {
  return {
    doc,
    meta: doc.getMap("meta"),
    shapes: doc.getMap("shapes"),
    bindings: doc.getMap("bindings"),
  };
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export function connectBoard(
  boardId: string,
  board: BoardDoc,
  { token, connect = true }: { token: string; connect?: boolean },
) {
  return new WebsocketProvider(env.wsUrl, boardId, board.doc, {
    connect,
    // Tabs must sync through the server, not BroadcastChannel, or we'd never exercise the wire.
    disableBc: true,
    params: { token },
  });
}

/** Points the provider at a new token; it takes effect on the next (re)connect. */
export function setProviderToken(provider: WebsocketProvider, token: string) {
  provider.params = { token };
}
