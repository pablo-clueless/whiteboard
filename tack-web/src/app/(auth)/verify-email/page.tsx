import type { Metadata } from "next";

import { VerifyEmail } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Check your inbox · Tack" };

export default async function Page({ searchParams }: PageProps<"/verify-email">) {
  const { token, email } = await searchParams;
  return (
    <VerifyEmail
      token={typeof token === "string" ? token : undefined}
      email={typeof email === "string" ? email : undefined}
    />
  );
}
