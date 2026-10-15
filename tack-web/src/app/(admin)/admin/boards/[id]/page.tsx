"use client";

import { useParams } from "next/navigation";

import { BoardDetailView } from "@/components/admin";

const Page = () => {
  const id = useParams<{ id: string }>().id;
  return <BoardDetailView boardId={id} key={id} />;
};

export default Page;
