"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export default function Home() {
  const router = useRouter();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Tack</h1>
        <p className="text-muted-foreground">
          A real-time whiteboard. Open a board and share the link.
        </p>
      </div>
      {/* TODO(M2): POST /api/boards and redirect with the edit token. */}
      <Button size="lg" onClick={() => router.push(`/b/${crypto.randomUUID()}`)}>
        New board
      </Button>
    </main>
  );
}
