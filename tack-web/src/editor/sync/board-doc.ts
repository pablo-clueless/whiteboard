import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

import { sessionToken } from "@/stores/user";
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
  /** diagramId → the code a diagram was drawn from, and its shapes (see `import/diagram.ts`). */
  diagrams: Y.Map<unknown>;
};

export function createBoardDoc(doc = new Y.Doc()): BoardDoc {
  return {
    doc,
    meta: doc.getMap("meta"),
    shapes: doc.getMap("shapes"),
    bindings: doc.getMap("bindings"),
    library: doc.getMap("library"),
    diagrams: doc.getMap("diagrams"),
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

/**
 * Custom messages: an editor locked the board read-only, or unlocked it. Match the server's
 * `MSG_BOARD_LOCKED` and `MSG_BOARD_UNLOCKED`. Locked also arrives on joining a locked board.
 */
export const MESSAGE_BOARD_LOCKED = 101;
export const MESSAGE_BOARD_UNLOCKED = 102;
/** Provider event emitted with whether the board is now locked. */
export const BOARD_LOCKED_EVENT = "board-locked";

export type BoardLockedEvents = {
  on(event: typeof BOARD_LOCKED_EVENT, fn: (locked: boolean) => void): void;
  off(event: typeof BOARD_LOCKED_EVENT, fn: (locked: boolean) => void): void;
  emit(event: typeof BOARD_LOCKED_EVENT, args: [boolean]): void;
};

/** Custom message: a ping the server echoes back. Matches `MSG_PING` in the server. */
export const MESSAGE_PING = 103;
/** Provider event emitted with the sequence number of each echoed ping. */
export const PONG_EVENT = "pong";

export type PongEvents = {
  on(event: typeof PONG_EVENT, fn: (seq: number) => void): void;
  off(event: typeof PONG_EVENT, fn: (seq: number) => void): void;
  emit(event: typeof PONG_EVENT, args: [number]): void;
};

/**
 * Sends a ping carrying `seq`. Returns false when not connected. Written by hand (tag, then a
 * 4-byte buffer) since lib0 isn't a direct dependency.
 */
export function sendPing(provider: WebsocketProvider, seq: number): boolean {
  const ws = provider.ws;
  if (!provider.wsconnected || !ws) return false;
  const msg = new Uint8Array([MESSAGE_PING, 4, 0, 0, 0, 0]);
  new DataView(msg.buffer).setUint32(2, seq);
  ws.send(msg);
  return true;
}

export function connectBoard(
  boardId: string,
  board: BoardDoc,
  { token, connect = true }: { token: string; connect?: boolean },
) {
  const provider = new WebsocketProvider(env.wsUrl, boardId, board.doc, {
    connect,
    // Tabs must sync through the server, not BroadcastChannel, or we'd never exercise the wire.
    disableBc: true,
    params: connectionParams(token),
  });
  // The message carries nothing beyond its type, so the handler reads nothing from it.
  provider.messageHandlers[MESSAGE_BOARD_FULL] = () =>
    (provider as unknown as BoardFullEvents).emit(BOARD_FULL_EVENT, []);
  const lockEvents = provider as unknown as BoardLockedEvents;
  provider.messageHandlers[MESSAGE_BOARD_LOCKED] = () => lockEvents.emit(BOARD_LOCKED_EVENT, [true]);
  provider.messageHandlers[MESSAGE_BOARD_UNLOCKED] = () => lockEvents.emit(BOARD_LOCKED_EVENT, [false]);
  // The decoder sits just past the type, at the payload's one-byte length.
  provider.messageHandlers[MESSAGE_PING] = (_encoder, decoder) => {
    const { arr, pos } = decoder as unknown as { arr: Uint8Array; pos: number };
    if (arr[pos] !== 4 || arr.length < pos + 5) return;
    const seq = new DataView(arr.buffer, arr.byteOffset + pos + 1, 4).getUint32(0);
    (provider as unknown as PongEvents).emit(PONG_EVENT, [seq]);
  };
  return provider;
}

/** Points the provider at a new token; it takes effect on the next (re)connect. */
export function setProviderToken(provider: WebsocketProvider, token: string) {
  provider.params = connectionParams(token);
}

/** The share token, plus the session when signed in so the server knows who's connected. */
function connectionParams(token: string): Record<string, string> {
  const session = sessionToken();
  return session ? { token, session } : { token };
}
