import type { Metadata } from "next";

import { SignInForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Log in · Tack" };

export default function Page() {
  return <SignInForm />;
}
