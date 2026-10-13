import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Log in · Tack" };

export default async function Page({ searchParams }: PageProps<"/signin">) {
  const { next } = await searchParams;
  return <SignInForm next={typeof next === "string" ? next : undefined} />;
}
