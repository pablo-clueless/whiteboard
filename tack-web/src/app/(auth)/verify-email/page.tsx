import type { Metadata } from "next";

import { VerifyEmail } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Check your inbox · Tack" };

export default function Page() {
  return <VerifyEmail />;
}
