import type { Metadata } from "next";

import { SignUpForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Create an account · Tack" };

export default function Page() {
  return <SignUpForm />;
}
