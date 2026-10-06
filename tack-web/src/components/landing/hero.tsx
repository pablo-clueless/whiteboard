"use client";

import { Circle, Hand, MousePointer2, MoveUpRight, Pencil, Plus, Square, Type } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useReducedMotion } from "motion/react";
import { cn } from "cn";

import { Cursor, NewBoardButton } from "./bits";

export function Hero() {
  const board = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion() ?? false;

  return (
    <section id="top" className="px-3 pt-2 sm:px-6">
      <div
        ref={board}
        className="bg-dots relative container mx-auto flex flex-col overflow-hidden rounded-[28px] border bg-white shadow-[0_1px_0_rgb(0_0_0/0.04),0_30px_60px_-40px_rgb(14_14_16/0.35)] md:min-h-175"
      >
        <YouCursor board={board} />

        <div className="relative z-10 flex flex-1 flex-col justify-center px-6 pt-14 pb-28 sm:px-12 md:max-w-[62%] md:pb-32">
          <h1 className="text-ink flex flex-col items-start text-[clamp(3.6rem,9.5vw,8.6rem)] leading-[0.88] font-black tracking-[-0.055em]">
            <Tile board={board}>Think</Tile>
            <Tile board={board} className="text-primary">
              out loud,
            </Tile>
            <Tile board={board} extra={<MarkerCircle reduced={reduced} />}>
              together.
            </Tile>
          </h1>
          <p className="text-marker-blue font-hand mt-3 ml-1 flex items-center gap-1 text-2xl leading-none font-bold">
            <span className="font-hand">psst — these words move. try it</span>
            <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden className="-translate-y-2">
              <path
                d="M2 20C10 18 22 14 30 4M30 4l-8 1M30 4l-1 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
            </svg>
          </p>
          <p className="text-ink/70 mt-8 max-w-md text-lg leading-relaxed">
            Tack is a whiteboard your whole team draws on at once. Open a board, share the link, and
            everyone&apos;s shapes and cursors show up as they move.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <NewBoardButton />
          </div>
        </div>
        <Scene board={board} reduced={reduced} />
        <Dock />
      </div>
    </section>
  );
}

/** A headline line that behaves like a shape on the board: hover selects it, drag moves it. */
function Tile({
  board,
  children,
  className,
  extra,
}: {
  board: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
  extra?: ReactNode;
}) {
  return (
    <motion.span
      drag
      dragConstraints={board}
      dragElastic={0.12}
      dragMomentum={false}
      whileDrag={{ scale: 1.03, rotate: -1.5, zIndex: 30 }}
      className={cn(
        "group relative block cursor-grab touch-none active:cursor-grabbing",
        className,
      )}
    >
      <span className="relative font-black">{children}</span>
      <Selection />
      {extra}
    </motion.span>
  );
}

/** Blue selection outline with corner handles, like the editor draws. */
function Selection() {
  return (
    <span
      aria-hidden
      className="border-marker-blue pointer-events-none absolute -inset-x-2 inset-y-0 border-[1.5px] opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100"
    >
      {["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-right-1 -bottom-1"].map(
        (pos) => (
          <span
            key={pos}
            className={cn("border-marker-blue absolute size-2 border-[1.5px] bg-white", pos)}
          />
        ),
      )}
    </span>
  );
}

/** Ada's marker circle around "together.", drawn on a loop in time with her cursor. */
function MarkerCircle({ reduced }: { reduced: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 140"
      preserveAspectRatio="none"
      className="text-marker-blue pointer-events-none absolute inset-x-[-10%] inset-y-[-20%] h-[140%] w-[120%]"
    >
      <motion.path
        d="M30 78C20 30 140 12 230 14s170 26 160 66-120 56-220 50S20 110 40 70c14-24 60-40 110-46"
        fill="none"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        initial={reduced ? { pathLength: 1 } : { pathLength: 0, opacity: 0 }}
        animate={
          reduced ? { pathLength: 1 } : { pathLength: [0, 0, 1, 1, 0], opacity: [1, 1, 1, 1, 0] }
        }
        transition={
          reduced
            ? undefined
            : {
                duration: 12,
                times: [0, 0.27, 0.275, 0.42, 0.9, 1],
                repeat: Infinity,
                ease: "easeInOut",
              }
        }
      />
    </svg>
  );
}

/** Right half of the hero: a sticky note dropped in by Kofi, presence card, and Ada's cursor. */
function Scene({ board, reduced }: { board: RefObject<HTMLDivElement | null>; reduced: boolean }) {
  const [kofiArrived, setKofiArrived] = useState(reduced);
  const [stickyTaken, setStickyTaken] = useState(false);

  return (
    <div className="pointer-events-none absolute inset-0 hidden md:block">
      {/* Presence card */}
      <motion.div
        initial={reduced ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6 }}
        className="pointer-events-auto absolute top-[58%] right-[5%] w-64 rounded-2xl border bg-white p-4 shadow-[0_20px_40px_-24px_rgb(14_14_16/0.4)]"
      >
        <div className="flex items-center justify-between">
          <div className="flex -space-x-2">
            {[
              ["A", "var(--marker-blue)"],
              ["K", "var(--marker-green)"],
              ["Y", "var(--marker-pink)"],
            ].map(([initial, color]) => (
              <span
                key={initial}
                className="grid size-8 place-items-center rounded-full border-2 border-white text-xs font-bold text-white"
                style={{ background: color }}
              >
                {initial}
              </span>
            ))}
          </div>
          <span className="text-marker-green flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wide uppercase">
            <span className="bg-marker-green size-1.5 animate-pulse rounded-full" />
            Live
          </span>
        </div>
        <p className="text-ink mt-3 text-[15px] font-semibold">3 people on this board</p>
        <p className="text-ink/55 mt-0.5 text-sm">Ada, Kofi and you</p>
      </motion.div>

      {/* A plain shape you can grab */}
      <motion.div
        drag
        dragConstraints={board}
        dragMomentum={false}
        initial={reduced ? false : { opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3, type: "spring", stiffness: 260, damping: 18 }}
        className="group border-ink pointer-events-auto absolute top-[47%] right-[33%] size-28 cursor-grab touch-none rounded-full border-[3px] bg-[#fff1e6] active:cursor-grabbing"
      >
        <Selection />
      </motion.div>

      {/* Kofi carries his sticky in from off the board. Once you grab it, he lets go. */}
      <motion.div
        drag={kofiArrived}
        dragConstraints={board}
        dragMomentum={false}
        onDragStart={() => setStickyTaken(true)}
        initial={reduced ? false : { x: 560, y: -90, rotate: 14 }}
        animate={{ x: 0, y: 0, rotate: -5 }}
        transition={{ delay: 1.4, duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={() => setKofiArrived(true)}
        whileDrag={{ rotate: 0, scale: 1.04 }}
        className="group bg-sticky pointer-events-auto absolute top-[13%] left-[64%] w-52 cursor-grab touch-none p-5 pb-6 shadow-[0_18px_30px_-18px_rgb(14_14_16/0.55)] active:cursor-grabbing"
      >
        <p className="text-ink font-hand text-[26px] leading-[1.05] font-bold">
          Map the onboarding flow before Friday
        </p>
        <p className="text-ink/60 font-hand mt-3 text-xl">— Kofi</p>
        <Selection />

        {!reduced && (
          <motion.div
            className="absolute top-[78%] left-[88%] z-20"
            animate={
              stickyTaken
                ? { x: 160, y: 120, opacity: 0 }
                : kofiArrived
                  ? { x: [0, 18, -10, 0], y: [0, -14, 6, 0] }
                  : { x: 0, y: 0 }
            }
            transition={
              stickyTaken
                ? { duration: 0.8 }
                : kofiArrived
                  ? { duration: 6, repeat: Infinity, ease: "easeInOut" }
                  : { duration: 0 }
            }
          >
            <Cursor name="Kofi" color="var(--marker-green)" />
          </motion.div>
        )}
      </motion.div>

      {!reduced && (
        <>
          {" "}
          {/* Ada circles "together." on the same 12s loop as the marker stroke */}
          <motion.div
            className="absolute z-20"
            initial={{ left: "52%", top: "18%" }}
            animate={{
              left: ["52%", "30%", "38%", "6%", "12%", "44%", "52%"],
              top: ["18%", "50%", "40%", "50%", "60%", "78%", "18%"],
            }}
            transition={{
              duration: 12,
              times: [0, 0.25, 0.31, 0.37, 0.42, 0.7, 1],
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <Cursor name="Ada" color="var(--marker-blue)" />
          </motion.div>
        </>
      )}
    </div>
  );
}

/** Shows a "You" tag next to your pointer while it's over the board. */
function YouCursor({ board }: { board: RefObject<HTMLDivElement | null> }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const root = board.current;
    if (!root) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = root.getBoundingClientRect();
      x.set(e.clientX - r.left + 14);
      y.set(e.clientY - r.top + 18);
      setVisible(true);
    };
    const leave = () => setVisible(false);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
    };
  }, [board, x, y]);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 hidden md:block">
      <motion.span
        aria-hidden
        style={{ x, y }}
        animate={{ opacity: visible ? 1 : 0 }}
        className="bg-marker-pink absolute top-0 left-0 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm"
      >
        You
      </motion.span>
    </div>
  );
}

/** The editor's toolbar, as a picture of what's inside. */
function Dock() {
  const tools = [MousePointer2, Hand, Square, Circle, MoveUpRight, Pencil, Type, Plus];
  return (
    <div
      aria-hidden
      className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-2xl border bg-white p-1.5 shadow-[0_12px_30px_-18px_rgb(14_14_16/0.45)]"
    >
      {tools.map((Icon, i) => (
        <span
          key={i}
          className={cn(
            "grid size-9 place-items-center rounded-xl",
            i === 0 ? "bg-primary text-white" : "text-ink/70",
            i === tools.length - 1 && "ml-1 border border-dashed",
          )}
        >
          <Icon className="size-4.5" strokeWidth={2} />
        </span>
      ))}
    </div>
  );
}
