"use client";

import { motion, useMotionValue, useMotionValueEvent, useSpring } from "motion/react";
import { useRef, useState, useSyncExternalStore } from "react";
import { cn } from "cn";

import { Cursor } from "./bits";

/** Simulated one-way trip for the demo, long enough to see the packet travel. */
const TRIP_MS = 160;
/** At most one update per frame, as the editor does during a drag. */
const FRAME_MS = 16;

const STEPS = [
  {
    title: "You drag a shape",
    body: "Tack sends the change at most once per frame, so a fast drag doesn't flood the connection.",
  },
  {
    title: "The server passes it on",
    body: "Everyone on the board gets the same update. One slow connection never holds up the rest.",
  },
  {
    title: "Their screen redraws one shape",
    body: "Only the shape that moved is redrawn, so a board with thousands of shapes stays smooth.",
  },
  {
    title: "Late arrivals catch up",
    body: "Open the link mid-meeting and you get the whole board first, then every change after it.",
  },
];

export function SyncDemo() {
  return (
    <section id="sync" className="scroll-mt-20 px-3 sm:px-6">
      <div className="container mx-auto overflow-hidden rounded-4xl bg-[#0c0c0e] px-6 py-20 text-white sm:px-12 md:py-28">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <h2 className="max-w-2xl text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[0.95] font-black tracking-[-0.045em]">
            Every move shows up on every screen.
          </h2>
          <p className="max-w-sm text-[15px] leading-relaxed text-white/60">
            Try it: drag the square on your screen and watch it arrive on Ada&apos;s.
          </p>
        </div>
        <Mirror />
        <ol className="mt-16 grid gap-8 border-t border-white/10 pt-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="text-primary font-mono text-xs">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="mt-2 text-lg font-bold tracking-tight">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/55">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Mirror() {
  const pane = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const remoteX = useSpring(0, { stiffness: 900, damping: 60 });
  const remoteY = useSpring(0, { stiffness: 900, damping: 60 });
  const [packets, setPackets] = useState<number[]>([]);
  const [sent, setSent] = useState(0);
  const lastSent = useRef(0);
  const nextId = useRef(0);
  const desktop = useMediaQuery("(min-width: 768px)");

  const send = (force = false) => {
    const now = performance.now();
    if (!force && now - lastSent.current < FRAME_MS) return;
    lastSent.current = now;
    const [px, py] = [x.get(), y.get()];
    const id = nextId.current++;
    setSent((n) => n + 1);
    // Only draw every few packets; dozens of dots on the wire is noise.
    if (id % 3 === 0) setPackets((p) => [...p, id]);
    setTimeout(() => {
      remoteX.set(px);
      remoteY.set(py);
    }, TRIP_MS);
  };

  useMotionValueEvent(x, "change", () => send());
  useMotionValueEvent(y, "change", () => send());

  return (
    <div className="mt-14 grid gap-4 md:grid-cols-[1fr_96px_1fr] md:gap-0">
      <Pane label="Your screen">
        <div ref={pane} className="absolute inset-x-6 top-14 bottom-10 grid place-items-center">
          <motion.div
            drag
            dragConstraints={pane}
            dragMomentum={false}
            dragElastic={0}
            onDragEnd={() => send(true)}
            style={{ x, y }}
            whileDrag={{ scale: 1.05 }}
            className="bg-primary border-ink relative size-20 cursor-grab touch-none rounded-2xl border-[3px] active:cursor-grabbing"
          >
            <span className="text-ink font-hand absolute top-full left-1/2 mt-2 -translate-x-1/2 text-xl font-bold whitespace-nowrap">
              drag me
            </span>
          </motion.div>
        </div>
      </Pane>
      <div
        className={cn("relative mx-auto", desktop ? "h-full w-full" : "h-14 w-full max-w-24")}
        aria-hidden
      >
        <div
          className={cn(
            "absolute bg-white/15",
            desktop ? "inset-x-2 top-1/2 h-px" : "inset-y-0 left-1/2 w-px",
          )}
        />
        {packets.map((id) => (
          <motion.span
            key={id}
            className="bg-primary absolute size-2 -translate-1/2 rounded-full shadow-[0_0_12px_var(--primary)]"
            initial={desktop ? { left: "8%", top: "50%" } : { top: "0%", left: "50%" }}
            animate={desktop ? { left: "92%" } : { top: "100%" }}
            transition={{ duration: TRIP_MS / 1000, ease: "linear" }}
            onAnimationComplete={() => setPackets((p) => p.filter((q) => q !== id))}
          />
        ))}
        <span
          className={cn(
            "absolute font-mono text-[10px] whitespace-nowrap text-white/40 tabular-nums",
            desktop
              ? "top-[calc(50%+10px)] left-1/2 -translate-x-1/2"
              : "top-1/2 left-[calc(50%+10px)] -translate-y-1/2",
          )}
        >
          {sent} sent
        </span>
      </div>
      <Pane label="Ada's screen">
        <div className="absolute inset-x-6 top-14 bottom-10 grid place-items-center">
          <motion.div
            style={{ x: remoteX, y: remoteY }}
            className="bg-primary border-ink relative size-20 rounded-2xl border-[3px]"
          >
            <Cursor
              name="Ada"
              color="var(--marker-blue)"
              className="absolute top-[70%] left-[85%]"
            />
          </motion.div>
        </div>
      </Pane>
    </div>
  );
}

function Pane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-dots relative aspect-4/3 overflow-hidden rounded-2xl bg-white">
      <span className="text-ink/60 absolute top-3 left-3 z-10 rounded-full border bg-white px-2.5 py-1 font-mono text-[11px]">
        {label}
      </span>
      {children}
    </div>
  );
}

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}
