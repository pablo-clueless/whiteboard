"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { forgetLink, rememberLink, rememberedLink, takeTokenFromUrl } from "@/lib/board-links";
import { NewBoardButton, Logo } from "@/components/landing/bits";
import { ApiError, api, type Role } from "@/lib/api";

import Editor from "./Editor";

type Problem = "no-link" | "invalid" | "not-found" | "offline";

type Access =
  | { status: "checking"; token: string }
  | { status: "ready"; token: string; role: Role }
  | { status: "problem"; problem: Problem; token?: string };

/** The link this browser should try: one in the address bar, else the best one it remembers. */
function initialAccess(boardId: string): Access {
  const token =
    takeTokenFromUrl() ?? rememberedLink(boardId, "edit") ?? rememberedLink(boardId, "view");
  return token ? { status: "checking", token } : { status: "problem", problem: "no-link" };
}

/** Checks the share link with the server before opening the editor, and explains when it can't. */
export default function BoardGate({ boardId }: { boardId: string }) {
  const [access, setAccess] = useState<Access>(() => initialAccess(boardId));

  const check = useCallback(
    (token: string) => {
      api
        .getBoard(boardId, token)
        .then((info) => {
          rememberLink(boardId, info.role, token);
          setAccess({ status: "ready", token, role: info.role });
        })
        .catch((err: unknown) => {
          const status = err instanceof ApiError ? err.status : 0;
          if (status === 403) {
            // A stale link from storage shouldn't keep failing on every visit.
            for (const role of ["edit", "view"] as const) {
              if (rememberedLink(boardId, role) === token) forgetLink(boardId, role);
            }
          }
          const problem: Problem =
            status === 403 ? "invalid" : status === 404 ? "not-found" : "offline";
          setAccess({ status: "problem", problem, token });
        });
    },
    [boardId],
  );

  const checkingToken = access.status === "checking" ? access.token : null;
  useEffect(() => {
    if (checkingToken) check(checkingToken);
  }, [check, checkingToken]);

  if (access.status === "ready") {
    return (
      <Editor
        boardId={boardId}
        token={access.token}
        role={access.role}
        onTokenChange={(token) => setAccess({ ...access, token })}
        onRevoked={() => setAccess({ status: "problem", problem: "invalid", token: access.token })}
      />
    );
  }
  if (access.status === "checking") return <Screen title="Opening board…" />;

  const retry = access.token
    ? () => setAccess({ status: "checking", token: access.token! })
    : undefined;
  return <ProblemScreen problem={access.problem} onRetry={retry} />;
}

const PROBLEMS: Record<Problem, { title: string; body: string }> = {
  "no-link": {
    title: "You need a link to open this board",
    body: "Boards are shared by link. Ask the person who shared it to send you one.",
  },
  invalid: {
    title: "This link doesn't work anymore",
    body: "The board's links may have been reset. Ask someone with access for a new link.",
  },
  "not-found": {
    title: "There's no board here",
    body: "Check that the link is complete, or start a new board.",
  },
  offline: {
    title: "Can't reach the Tack server",
    body: "Check your connection and try again.",
  },
};

function ProblemScreen({ problem, onRetry }: { problem: Problem; onRetry?: () => void }) {
  const { title, body } = PROBLEMS[problem];
  return (
    <Screen title={title} body={body}>
      {problem === "offline" && onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="bg-primary focus-visible:ring-primary/40 h-12 rounded-full px-6 text-[15px] font-semibold text-white outline-none hover:bg-[#e0600a] focus-visible:ring-4"
        >
          Try again
        </button>
      ) : (
        <NewBoardButton label="Start a new board" />
      )}
    </Screen>
  );
}

function Screen({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="bg-dots flex min-h-dvh flex-col items-center justify-center gap-6 bg-[#f6f6f7] p-6 text-center">
      <Link
        href="/"
        aria-label="Tack home"
        className="focus-visible:ring-primary/40 rounded-md outline-none focus-visible:ring-4"
      >
        <Logo />
      </Link>
      <div className="max-w-md space-y-2" aria-live="polite">
        <h1 className="text-ink text-2xl font-black tracking-[-0.03em]">{title}</h1>
        {body && <p className="text-ink/60 text-[15px] leading-relaxed">{body}</p>}
      </div>
      {children}
    </main>
  );
}
