import Link from "next/link";
import React from "react";

import { Mosaic } from "@/components/auth/mosaic";
import { Logo, MotionRoot } from "@/components/landing/bits";

interface Props {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: Props) {
  return (
    <MotionRoot>
      <div className="bg-card grid min-h-dvh w-full grid-cols-1 lg:h-dvh lg:grid-cols-2 lg:overflow-hidden">
        <div aria-hidden className="bg-ink relative hidden h-full overflow-hidden lg:block">
          <Mosaic />
        </div>
        <div className="flex min-h-dvh flex-col px-6 py-10 lg:min-h-0 lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-sm">
            <Link
              href="/"
              aria-label="Tack home"
              className="focus-visible:ring-primary/40 inline-block rounded-md outline-none focus-visible:ring-4"
            >
              <Logo />
            </Link>
          </div>
          <main className="flex flex-1 items-center justify-center py-10">
            <div className="w-full max-w-sm">{children}</div>
          </main>
          <p className="text-muted-foreground mx-auto max-w-md text-center text-xs leading-relaxed">
            &copy;{new Date().getFullYear()} Tack. All rights reserved.
          </p>
        </div>
      </div>
    </MotionRoot>
  );
}
