"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { WebsocketProvider } from "y-websocket";
import type Konva from "konva";

import { PONG_EVENT, type PongEvents, sendPing } from "./sync/board-doc";
import type { Editor } from "./editor-core";

const PING_EVERY_MS = 2000;
/** Samples kept for the median. */
const WINDOW = 20;
/** A remote update that hasn't drawn by then changed nothing on screen; stop waiting for it. */
const RENDER_TIMEOUT_MS = 1000;

/**
 * Shown in dev builds, or anywhere with `?latency` in the URL. HANDOFF's latency check: the round
 * trip of a ping through the board's room, and the time from a remote update arriving to the
 * shapes layer drawing it.
 */
export function useShowLatency() {
  return useSyncExternalStore(
    noSubscribe,
    () =>
      process.env.NODE_ENV !== "production" ||
      new URLSearchParams(window.location.search).has("latency"),
    // The URL isn't known while rendering on the server.
    () => false,
  );
}

const noSubscribe = () => () => {};

type Stat = { last: number | null; median: number | null };
const EMPTY: Stat = { last: null, median: null };

function push(samples: number[], value: number): Stat {
  samples.push(value);
  if (samples.length > WINDOW) samples.shift();
  const sorted = [...samples].sort((a, b) => a - b);
  return { last: value, median: sorted[Math.floor(sorted.length / 2)] };
}

export function LatencyOverlay({
  editor,
  provider,
}: {
  editor: Editor;
  provider: WebsocketProvider;
}) {
  const [ping, setPing] = useState<Stat>(EMPTY);
  const [render, setRender] = useState<Stat>(EMPTY);

  // Ping round trip.
  useEffect(() => {
    const samples: number[] = [];
    const sent = new Map<number, number>();
    let seq = 0;
    const onPong = (n: number) => {
      const at = sent.get(n);
      if (at === undefined) return;
      sent.delete(n);
      setPing(push(samples, performance.now() - at));
    };
    const tick = () => {
      seq = (seq + 1) >>> 0;
      // Pings lost to a reconnect never come back; don't let them pile up.
      if (sent.size > WINDOW) sent.clear();
      if (sendPing(provider, seq)) sent.set(seq, performance.now());
    };
    const events = provider as unknown as PongEvents;
    events.on(PONG_EVENT, onPong);
    tick();
    const timer = window.setInterval(tick, PING_EVERY_MS);
    return () => {
      clearInterval(timer);
      events.off(PONG_EVENT, onPong);
    };
  }, [provider]);

  // Remote update → drawn. Timed from the first update since the last draw.
  useEffect(() => {
    const samples: number[] = [];
    let since: number | null = null;
    let layer: Konva.Layer | null = null;
    const onUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== provider || since !== null) return;
      since = performance.now();
    };
    const onDraw = () => {
      if (since === null) return;
      const took = performance.now() - since;
      since = null;
      if (took <= RENDER_TIMEOUT_MS) setRender(push(samples, took));
    };
    // The stage mounts after the editor; find the shapes layer once it's there.
    const attach = window.setInterval(() => {
      const found = editor.stage?.findOne<Konva.Layer>(".shapes");
      if (!found) return;
      clearInterval(attach);
      layer = found;
      layer.on("draw.latency", onDraw);
    }, 250);
    const expire = window.setInterval(() => {
      if (since !== null && performance.now() - since > RENDER_TIMEOUT_MS) since = null;
    }, RENDER_TIMEOUT_MS);
    provider.doc.on("update", onUpdate);
    return () => {
      clearInterval(attach);
      clearInterval(expire);
      layer?.off("draw.latency");
      provider.doc.off("update", onUpdate);
    };
  }, [editor, provider]);

  const ms = (v: number | null) => (v === null ? "–" : `${Math.round(v)} ms`);
  return (
    <div
      aria-hidden
      className="text-ink/70 pointer-events-none absolute bottom-20 left-4 rounded-lg border bg-white/90 px-2.5 py-1.5 font-mono text-[11px] leading-4 shadow-sm"
    >
      <div>
        ping {ms(ping.last)} <span className="text-ink/40">p50 {ms(ping.median)}</span>
      </div>
      <div>
        render {ms(render.last)} <span className="text-ink/40">p50 {ms(render.median)}</span>
      </div>
    </div>
  );
}
