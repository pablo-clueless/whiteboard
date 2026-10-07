"use client";

import dynamic from "next/dynamic";

// Konva needs `window`, and the share link lives in the URL fragment, so the board never renders
// on the server.
const BoardGate = dynamic(() => import("./BoardGate"), { ssr: false });

export function EditorLoader({ boardId }: { boardId: string }) {
  // Keyed so switching boards gets a fresh Y.Doc and provider.
  return <BoardGate key={boardId} boardId={boardId} />;
}
