"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { WebsocketProvider } from "y-websocket";

import type { PresenceState } from "../Presence";
import {
  BOARD_FULL_EVENT,
  BOARD_LOCKED_EVENT,
  type BoardFullEvents,
  type BoardLockedEvents,
  type ConnectionStatus,
  connectBoard,
  createBoardDoc,
} from "./board-doc";

/**
 * Owns the board's Y.Doc and provider for the lifetime of the editor. The caller must remount
 * (key by board id) to switch boards.
 */
export function useBoard(boardId: string, token: string) {
  const [conn] = useState(() => {
    const board = createBoardDoc();
    const provider = connectBoard(boardId, board, { token, connect: false });
    return { board, provider };
  });

  useEffect(() => {
    conn.provider.connect();
    return () => conn.provider.disconnect();
  }, [conn]);

  return conn;
}

export function useConnectionStatus(provider: WebsocketProvider): {
  status: ConnectionStatus;
  synced: boolean;
} {
  const status = useSyncExternalStore(
    (onChange) => {
      provider.on("status", onChange);
      return () => provider.off("status", onChange);
    },
    (): ConnectionStatus =>
      provider.wsconnected ? "connected" : provider.wsconnecting ? "connecting" : "disconnected",
  );
  const synced = useSyncExternalStore(
    (onChange) => {
      provider.on("sync", onChange);
      return () => provider.off("sync", onChange);
    },
    () => provider.synced,
  );
  return { status, synced };
}

/**
 * Calls onClosed when the server closes the connection for good (a 44xx code: the link was
 * reset, or the board is gone). y-websocket stops reconnecting in that case.
 */
export function useOnPermanentClose(provider: WebsocketProvider, onClosed: () => void) {
  const latest = useRef(onClosed);
  useEffect(() => {
    latest.current = onClosed;
  });
  useEffect(() => {
    const handler = () => latest.current();
    provider.on("closed", handler);
    return () => provider.off("closed", handler);
  }, [provider]);
}

/**
 * Calls onFull when the server says the board has reached its size limit and is dropping this
 * client's edits.
 */
export function useOnBoardFull(provider: WebsocketProvider, onFull: () => void) {
  const latest = useRef(onFull);
  useEffect(() => {
    latest.current = onFull;
  });
  useEffect(() => {
    const handler = () => latest.current();
    const events = provider as unknown as BoardFullEvents;
    events.on(BOARD_FULL_EVENT, handler);
    return () => events.off(BOARD_FULL_EVENT, handler);
  }, [provider]);
}

/**
 * Calls onChange with whether an editor has locked the board read-only. The server only says so
 * when it's locked, so each (re)connect starts unlocked: a board unlocked while this client was
 * away isn't stuck.
 */
export function useOnBoardLocked(provider: WebsocketProvider, onChange: (locked: boolean) => void) {
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  });
  useEffect(() => {
    const handler = (locked: boolean) => latest.current(locked);
    // "connected" fires on open, before the server's first messages are read.
    const onStatus = ({ status }: { status: ConnectionStatus }) => {
      if (status === "connected") latest.current(false);
    };
    const events = provider as unknown as BoardLockedEvents;
    events.on(BOARD_LOCKED_EVENT, handler);
    provider.on("status", onStatus);
    return () => {
      events.off(BOARD_LOCKED_EVENT, handler);
      provider.off("status", onStatus);
    };
  }, [provider]);
}

/** Number of clients on this board, including us. */
export function usePeerCount(provider: WebsocketProvider) {
  return useSyncExternalStore(
    (onChange) => {
      provider.awareness.on("change", onChange);
      return () => provider.awareness.off("change", onChange);
    },
    () => provider.awareness.getStates().size,
  );
}

/** All the peers on the board, their ids, names and connection status. */
export function usePeers(provider: WebsocketProvider) {
  return useSyncExternalStore(
    (onChange) => {
      provider.awareness.on("change", onChange);
      return () => provider.awareness.off("change", onChange);
    },
    () => provider.awareness.getStates() as Map<number, PresenceState>,
  );
}
