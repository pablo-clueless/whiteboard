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
  /** entryId → a component people made on this board (plain JSON; see `library.ts`). */
  library: Y.Map<unknown>;
};

export function createBoardDoc(doc = new Y.Doc()): BoardDoc {
  return {
    doc,
    meta: doc.getMap("meta"),
    shapes: doc.getMap("shapes"),
    bindings: doc.getMap("bindings"),
    library: doc.getMap("library"),
  };
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

/** Custom y-websocket message type: the board is full. Matches `MSG_BOARD_FULL` in the server. */
export const MESSAGE_BOARD_FULL = 100;
/** Provider event emitted when that message arrives. */
export const BOARD_FULL_EVENT = "board-full";

/** The provider's event emitter, typed for the board-full event it doesn't know about. */
export type BoardFullEvents = {
  on(event: typeof BOARD_FULL_EVENT, fn: () => void): void;
  off(event: typeof BOARD_FULL_EVENT, fn: () => void): void;
  emit(event: typeof BOARD_FULL_EVENT, args: []): void;
};

export function connectBoard(
  boardId: string,
  board: BoardDoc,
  { token, connect = true }: { token: string; connect?: boolean },
) {
  const provider = new WebsocketProvider(env.wsUrl, boardId, board.doc, {
    connect,
    // Tabs must sync through the server, not BroadcastChannel, or we'd never exercise the wire.
    disableBc: true,
    params: { token },
  });
  // The message carries nothing beyond its type, so the handler reads nothing from it.
  provider.messageHandlers[MESSAGE_BOARD_FULL] = () =>
    (provider as unknown as BoardFullEvents).emit(BOARD_FULL_EVENT, []);
  return provider;
}

/** Points the provider at a new token; it takes effect on the next (re)connect. */
export function setProviderToken(provider: WebsocketProvider, token: string) {
  provider.params = { token };
}
