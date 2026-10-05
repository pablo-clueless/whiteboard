"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { WebsocketProvider } from "y-websocket";

import { type ConnectionStatus, connectBoard, createBoardDoc } from "./board-doc";

/**
 * Owns the board's Y.Doc and provider for the lifetime of the editor. The caller must remount
 * (key by board id) to switch boards.
 */
export function useBoard(boardId: string) {
  const [conn] = useState(() => {
    const board = createBoardDoc();
    const provider = connectBoard(boardId, board, { connect: false });
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
