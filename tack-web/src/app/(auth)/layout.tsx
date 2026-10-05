import React from "react";

interface Props {
  children: React.ReactNode;
}

export default function AuthLayout({ children }: Props) {
  return (
    <div className="bg-card grid min-h-dvh w-full grid-cols-1 lg:h-dvh lg:grid-cols-2 lg:overflow-hidden">
      <div
        aria-hidden
        className="bg-primary relative hidden h-full min-h-dvh place-items-center overflow-hidden py-10 lg:grid lg:border-l"
      ></div>
      <div className="flex min-h-dvh flex-col px-6 py-10 lg:min-h-0">
        <div className="flex items-center justify-center gap-2 text-lg font-semibold">
          <div className="relative aspect-[4.2/1] w-1/3"></div>
        </div>
        <main className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </main>
        <p className="text-muted-foreground mx-auto max-w-md text-center text-xs leading-relaxed">
          &copy;{new Date().getFullYear()}. All rights reserved.
        </p>
      </div>
    </div>
  );
}
