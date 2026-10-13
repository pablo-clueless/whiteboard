"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { sessionToken, useUserStore } from "@/stores/user";
import { readEvents } from "@/lib/event-stream";
import type { Live } from "@/types/admin";
import { env } from "@/lib/env";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "stopped";

/** Longest wait between reconnects. */
const MAX_BACKOFF_MS = 30_000;

class StreamError extends Error {
  constructor(readonly status: number) {
    super(`live stream answered ${status}`);
  }
}

/**
 * Keeps the query at `queryKey` up to date from `GET /api/admin/live/stream`, which sends the
 * live page whenever it changes. Reconnects with backoff; while it's down the page's own polling
 * carries on. Stops for good on 401 (signed out) and 403 (no access any more).
 */
export function useLiveStream(queryKey: readonly unknown[]) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const key = JSON.stringify(queryKey);

  useEffect(() => {
    const abort = new AbortController();
    const target = JSON.parse(key) as unknown[];
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      try {
        const res = await fetch(`${env.apiUrl}/api/admin/live/stream`, {
          headers: { Authorization: `Bearer ${sessionToken()}`, Accept: "text/event-stream" },
          signal: abort.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) throw new StreamError(res.status);
        for await (const event of readEvents(res.body)) {
          if (event.event !== "live") continue;
          attempt = 0;
          qc.setQueryData<Live>(target, JSON.parse(event.data));
          setStatus("live");
          setUpdatedAt(new Date());
        }
        // The server ends the stream when the session stops being an admin's.
        throw new StreamError(0);
      } catch (err) {
        if (abort.signal.aborted) return;
        if (err instanceof StreamError && err.status === 401) {
          useUserStore.getState().signout();
          return;
        }
        if (err instanceof StreamError && err.status === 403) {
          setStatus("stopped");
          return;
        }
        setStatus("reconnecting");
        timer = setTimeout(connect, Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt++));
      }
    };
    connect();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [qc, key]);

  return { status, updatedAt };
}
