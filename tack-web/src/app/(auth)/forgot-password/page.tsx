import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Reset your password · Tack" };

export default function Page() {
  return <ForgotPasswordForm />;
}
