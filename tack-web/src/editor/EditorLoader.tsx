"use client";

import dynamic from "next/dynamic";

// Konva needs `window`, so the editor never renders on the server.
const Editor = dynamic(() => import("./Editor"), { ssr: false });

export function EditorLoader({ boardId }: { boardId: string }) {
  // Keyed so switching boards gets a fresh Y.Doc and provider.
  return <Editor key={boardId} boardId={boardId} />;
}
