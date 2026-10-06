import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Choose a new password · Tack" };

export default function Page() {
  return <ResetPasswordForm />;
}
