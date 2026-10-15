"use client";

import { useParams } from "next/navigation";

import { UserDetailView } from "@/components/admin";

const Page = () => {
  const id = useParams<{ id: string }>().id;
  return <UserDetailView key={id} userId={id} />;
};

export default Page;
