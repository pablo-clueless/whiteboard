import { notFound } from "next/navigation";

import { EditorLoader } from "@/editor/EditorLoader";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BoardPage({ params }: PageProps<"/b/[boardId]">) {
  const { boardId } = await params;
  if (!UUID.test(boardId)) notFound();
  return <EditorLoader boardId={boardId} />;
}
