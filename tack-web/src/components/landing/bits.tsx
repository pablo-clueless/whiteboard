"use client";

import { ArrowUpRight } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "cn";

import { api } from "@/lib/api";
import { rememberLink } from "@/lib/board-links";

/** Honours the OS "reduce motion" setting for every animation on the page. */
export function MotionRoot({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** The push pin that gives Tack its name. */
export function Pin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn("size-4", className)}>
      <circle cx="12" cy="10" r="7" fill="var(--primary)" />
      <circle cx="9.5" cy="7.5" r="2.2" fill="white" opacity="0.55" />
      <path d="M12 17v6" stroke="var(--ink)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-ink relative inline-flex items-center gap-1 text-2xl font-black tracking-tight",
        className,
      )}
    >
      tack
      <Pin className="absolute top-1/2 -right-5 size-5 -translate-y-1/2" />
    </span>
  );
}

/** Creates a board, keeps its share links in this browser, and opens it. */
export function NewBoardButton({
  className,
  label = "New board",
  tone = "primary",
}: {
  className?: string;
  label?: string;
  tone?: "primary" | "light";
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "creating" | "failed">("idle");

  const create = async () => {
    setState("creating");
    try {
      const links = await api.createBoard();
      rememberLink(links.boardId, "edit", links.editToken);
      rememberLink(links.boardId, "view", links.viewToken);
      router.push(`/b/${links.boardId}`);
    } catch {
      setState("failed");
    }
  };

  return (
    <button
      type="button"
      onClick={create}
      disabled={state === "creating"}
      aria-live="polite"
      className={cn(
        "group inline-flex h-12 items-center gap-2 rounded-full pr-2 pl-6 text-[15px] font-semibold transition-colors disabled:opacity-80",
        "focus-visible:ring-primary/50 outline-none focus-visible:ring-4",
        tone === "primary"
          ? "bg-primary text-white hover:bg-[#e0600a]"
          : "text-ink bg-white hover:bg-white/90",
        className,
      )}
    >
      {state === "creating"
        ? "Creating board…"
        : state === "failed"
          ? "Couldn't create a board. Try again"
          : label}
      <span
        className={cn(
          "grid size-8 place-items-center rounded-full transition-transform group-hover:rotate-45",
          tone === "primary" ? "text-primary bg-white" : "bg-ink text-white",
        )}
      >
        <ArrowUpRight className="size-4" />
      </span>
    </button>
  );
}

/** A collaborator's cursor with a name tag, as drawn on a board. */
export function Cursor({
  name,
  color,
  className,
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <div className={cn("pointer-events-none flex items-start", className)} aria-hidden>
      <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-sm">
        <path
          d="M1 1l15 7.5-6.5 2L7 18z"
          fill={color}
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <span
        className="mt-3.5 -ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow-sm"
        style={{ background: color }}
      >
        {name}
      </span>
    </div>
  );
}
