"use client";

import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { getStroke } from "perfect-freehand";
import { cn } from "cn";
import {
  Circle,
  type LucideIcon,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Plus,
  Type,
} from "lucide-react";

type ToolInfo = {
  id: string;
  label: string;
  Icon: LucideIcon;
  word: string;
  tint: string;
  title: string;
  body: string;
  Demo: () => React.JSX.Element;
};

const TOOLS: ToolInfo[] = [
  {
    id: "select",
    label: "Select",
    Icon: MousePointer2,
    word: "Select",
    tint: "#ececef",
    title: "Select, resize, rotate",
    body: "Click a shape or drag a box around several. Pull the handles to resize, or the top handle to rotate.",
    Demo: SelectDemo,
  },
  {
    id: "shapes",
    label: "Shapes",
    Icon: Circle,
    word: "Shapes",
    tint: "#fff1e6",
    title: "Rectangles and ellipses",
    body: "Drag to draw. Hold Shift for a perfect square or circle.",
    Demo: ShapesDemo,
  },
  {
    id: "arrow",
    label: "Arrow",
    Icon: MoveUpRight,
    word: "Arrows",
    tint: "#e8edff",
    title: "Arrows that stay attached",
    body: "Point an arrow at a shape and it follows that shape around, for everyone on the board.",
    Demo: ArrowDemo,
  },
  {
    id: "pen",
    label: "Pen",
    Icon: Pencil,
    word: "Pen",
    tint: "#fff6d6",
    title: "Freehand that feels like ink",
    body: "Strokes get thicker as you press harder with a pen, and stay smooth with a mouse.",
    Demo: PenDemo,
  },
  {
    id: "text",
    label: "Text",
    Icon: Type,
    word: "Text",
    tint: "#e9f6ef",
    title: "Type anywhere",
    body: "Click on the board and start typing. Text stays sharp at any zoom.",
    Demo: TextDemo,
  },
  {
    id: "yours",
    label: "Your own tool",
    Icon: Plus,
    word: "Yours",
    tint: "#fbe9f3",
    title: "Room for your own",
    body: "Add a shape or tool of your own and it sits in the toolbar next to these.",
    Demo: CustomDemo,
  },
];

export function ToolShowcase() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useReducedMotion() ?? false;
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  const tool = TOOLS[index];

  const select = (i: number, focus = false) => {
    const next = (i + TOOLS.length) % TOOLS.length;
    setIndex(next);
    if (focus) tabs.current[next]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") select(index + 1, true);
    else if (e.key === "ArrowLeft") select(index - 1, true);
    else return;
    e.preventDefault();
  };

  return (
    <section id="tools" className="scroll-mt-20 px-3 py-24 sm:px-6 md:py-32">
      <div className="container mx-auto">
        <div className="mb-10 flex flex-col justify-between gap-4 px-3 md:flex-row md:items-end">
          <h2 className="text-ink max-w-xl text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[0.95] font-black tracking-[-0.045em]">
            Everything you&apos;d reach for on a real whiteboard.
          </h2>
          <p className="text-ink/60 max-w-sm text-[15px] leading-relaxed">
            Plus the things a real whiteboard can&apos;t do, like arrows that follow the shapes they
            point at.
          </p>
        </div>
        <motion.div
          animate={{ backgroundColor: tool.tint }}
          transition={{ duration: 0.6 }}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocusCapture={() => setPaused(true)}
          onBlurCapture={() => setPaused(false)}
          className="relative flex min-h-140 flex-col overflow-hidden rounded-[28px] md:min-h-150"
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-8 flex justify-center md:top-10"
            aria-hidden
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={tool.word}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -30 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="relative px-4"
              >
                <span
                  className="block text-[clamp(4.5rem,17vw,15rem)] leading-[0.85] font-black tracking-[-0.06em] text-transparent uppercase"
                  style={{ WebkitTextStroke: "1.5px rgb(14 14 16 / 0.16)" }}
                >
                  {tool.word}
                </span>
                <span className="border-ink/20 absolute inset-0 border-[1.5px] border-dashed">
                  {[
                    "-top-1 -left-1",
                    "-top-1 -right-1",
                    "-bottom-1 -left-1",
                    "-right-1 -bottom-1",
                  ].map((pos) => (
                    <span
                      key={pos}
                      className={cn("border-ink/25 absolute size-2 border-[1.5px] bg-white", pos)}
                    />
                  ))}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>
          <div
            id={`${baseId}-panel`}
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${tool.id}`}
            className="relative flex flex-1 items-center justify-center px-6 pt-24 md:pt-28"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tool.id}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.3 }}
                className="w-full max-w-145"
              >
                <tool.Demo />
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-end md:justify-between md:p-8">
            <div className="min-h-24 max-w-sm" aria-live="polite">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={tool.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25 }}
                >
                  <h3 className="text-ink text-xl font-bold tracking-tight">{tool.title}</h3>
                  <p className="text-ink/65 mt-1.5 text-[15px] leading-relaxed">{tool.body}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div
              role="tablist"
              aria-label="Tools"
              onKeyDown={onKeyDown}
              className="flex items-center gap-1 self-start rounded-2xl border bg-white p-1.5 shadow-[0_12px_30px_-18px_rgb(14_14_16/0.45)] md:self-auto"
            >
              {TOOLS.map((t, i) => {
                const active = i === index;
                return (
                  <button
                    key={t.id}
                    ref={(el) => {
                      tabs.current[i] = el;
                    }}
                    id={`${baseId}-tab-${t.id}`}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    aria-controls={`${baseId}-panel`}
                    aria-label={t.label}
                    title={t.label}
                    tabIndex={active ? 0 : -1}
                    onClick={() => select(i)}
                    className={cn(
                      "focus-visible:ring-primary/40 relative grid size-11 place-items-center overflow-hidden rounded-xl transition-colors outline-none focus-visible:ring-4",
                      active ? "bg-ink text-white" : "text-ink/70 hover:bg-[#f3f3f5]",
                      t.id === "yours" && !active && "border border-dashed",
                    )}
                  >
                    <t.Icon className="size-5" strokeWidth={2} />
                    {active && !reduced && (
                      <span
                        key={index}
                        onAnimationEnd={() => select(index + 1)}
                        className="animate-progress bg-primary absolute inset-x-0 bottom-0 h-0.75 origin-left"
                        style={{ animationPlayState: paused ? "paused" : "running" }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ── Demos. Each is a 420×260 board snippet on a loop. ─────────────────────── */

const loop = (duration: number, times?: number[]) => ({
  duration,
  times,
  repeat: Infinity,
  ease: "easeInOut" as const,
});

function Board({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 420 260" className="h-auto w-full overflow-visible" aria-hidden>
      {children}
    </svg>
  );
}

function Handles({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const pts = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ];
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke="var(--marker-blue)"
        strokeWidth="1.5"
      />
      {pts.map(([px, py]) => (
        <rect
          key={`${px}-${py}`}
          x={px - 5}
          y={py - 5}
          width="10"
          height="10"
          fill="white"
          stroke="var(--marker-blue)"
          strokeWidth="1.5"
        />
      ))}
    </g>
  );
}

function SelectDemo() {
  return (
    <Board>
      <motion.g
        style={{ originX: "210px", originY: "130px" }}
        animate={{ rotate: [0, 0, -12, -12, 0], scale: [1, 1, 1.12, 1.12, 1] }}
        transition={loop(4.5, [0, 0.2, 0.45, 0.8, 1])}
      >
        <rect
          x="140"
          y="80"
          width="140"
          height="100"
          rx="10"
          fill="white"
          stroke="var(--ink)"
          strokeWidth="3"
        />
        <Handles x={130} y={70} w={160} h={120} />
        <line x1="210" y1="70" x2="210" y2="48" stroke="var(--marker-blue)" strokeWidth="1.5" />
        <circle cx="210" cy="44" r="6" fill="white" stroke="var(--marker-blue)" strokeWidth="1.5" />
      </motion.g>
      <motion.g
        animate={{ x: [60, 60, 95, 95, 60], y: [40, 40, 4, 4, 40] }}
        transition={loop(4.5, [0, 0.2, 0.45, 0.8, 1])}
      >
        <path
          d="M230 160l15 7.5-6.5 2L236 177z"
          fill="var(--ink)"
          stroke="white"
          strokeWidth="1.5"
        />
      </motion.g>
    </Board>
  );
}

function ShapesDemo() {
  const t = [0, 0.3, 0.55, 0.85, 1];
  return (
    <Board>
      <motion.rect
        x="40"
        y="60"
        width="160"
        height="130"
        rx="14"
        fill="white"
        stroke="var(--ink)"
        strokeWidth="3"
        animate={{ pathLength: [0, 1, 1, 1, 0], fillOpacity: [0, 1, 1, 1, 0] }}
        transition={loop(5, t)}
      />
      <motion.ellipse
        cx="300"
        cy="130"
        rx="80"
        ry="64"
        fill="var(--primary)"
        stroke="var(--ink)"
        strokeWidth="3"
        animate={{ pathLength: [0, 0, 1, 1, 0], fillOpacity: [0, 0, 1, 1, 0] }}
        transition={loop(5, t)}
      />
    </Board>
  );
}

function ArrowDemo() {
  const ys = [40, 150, 150, 40];
  const t = [0, 0.4, 0.6, 1];
  return (
    <Board>
      <rect
        x="20"
        y="95"
        width="120"
        height="70"
        rx="12"
        fill="white"
        stroke="var(--ink)"
        strokeWidth="3"
      />
      <motion.rect
        x="280"
        width="120"
        height="70"
        rx="12"
        fill="var(--sticky)"
        stroke="var(--ink)"
        strokeWidth="3"
        animate={{ y: ys }}
        transition={loop(4, t)}
      />
      <motion.line
        x1="146"
        y1="130"
        x2="272"
        stroke="var(--marker-blue)"
        strokeWidth="3.5"
        strokeLinecap="round"
        animate={{ y2: ys.map((y) => y + 35) }}
        transition={loop(4, t)}
      />
      <motion.circle
        cx="272"
        r="7"
        fill="var(--marker-blue)"
        animate={{ cy: ys.map((y) => y + 35) }}
        transition={loop(4, t)}
      />
      <circle cx="146" cy="130" r="5" fill="white" stroke="var(--marker-blue)" strokeWidth="2.5" />
    </Board>
  );
}

function PenDemo() {
  const d = useMemo(() => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const x = 30 + t * 360;
      const y = 130 + Math.sin(t * Math.PI * 3.2) * 55 * (1 - t * 0.4);
      const pressure = 0.25 + 0.75 * Math.sin(t * Math.PI);
      pts.push([x, y, pressure]);
    }
    const outline = getStroke(pts, {
      size: 22,
      thinning: 0.7,
      smoothing: 0.6,
      simulatePressure: false,
    });
    if (!outline.length) return "";
    return `M${outline.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
  }, []);
  const clip = useId();

  return (
    <Board>
      <defs>
        <clipPath id={clip}>
          <motion.rect
            x="0"
            y="0"
            height="260"
            animate={{ width: [0, 420, 420, 0] }}
            transition={loop(4.5, [0, 0.55, 0.85, 1])}
          />
        </clipPath>
      </defs>
      <path d={d} fill="var(--ink)" clipPath={`url(#${clip})`} />
    </Board>
  );
}

function TextDemo() {
  const text = "What went well this sprint?";
  return (
    <Board>
      <rect
        x="30"
        y="90"
        width="360"
        height="80"
        rx="4"
        fill="none"
        stroke="var(--marker-blue)"
        strokeWidth="1.5"
        strokeDasharray="5 5"
      />
      <text
        x="50"
        y="142"
        fontSize="28"
        fontWeight="700"
        fill="var(--ink)"
        style={{ fontFamily: "var(--font-dm-sans)" }}
      >
        {text.split("").map((ch, i) => (
          <motion.tspan
            key={i}
            animate={{ opacity: [0, 0, 1, 1, 0] }}
            transition={loop(6, [
              0,
              (i / text.length) * 0.55,
              (i / text.length) * 0.55 + 0.01,
              0.9,
              1,
            ])}
          >
            {ch}
          </motion.tspan>
        ))}
      </text>
    </Board>
  );
}

function CustomDemo() {
  const dots = [
    { cx: 150, cy: 150, color: "var(--marker-blue)" },
    { cx: 190, cy: 150, color: "var(--marker-green)" },
    { cx: 230, cy: 150, color: "var(--marker-pink)" },
    { cx: 270, cy: 150, color: "var(--primary)" },
  ];
  return (
    <Board>
      <rect
        x="110"
        y="60"
        width="200"
        height="140"
        rx="16"
        fill="white"
        stroke="var(--ink)"
        strokeWidth="3"
      />
      <text
        x="130"
        y="105"
        fontSize="20"
        fontWeight="800"
        fill="var(--ink)"
        style={{ fontFamily: "var(--font-dm-sans)" }}
      >
        Dot vote
      </text>
      {dots.map((d, i) => (
        <motion.circle
          key={i}
          cx={d.cx}
          cy={d.cy}
          r="13"
          fill={d.color}
          style={{ originX: `${d.cx}px`, originY: `${d.cy}px` }}
          animate={{ scale: [0, 0, 1.25, 1, 1, 0] }}
          transition={loop(5, [0, 0.1 + i * 0.12, 0.18 + i * 0.12, 0.24 + i * 0.12, 0.9, 1])}
        />
      ))}
      <rect
        x="98"
        y="48"
        width="224"
        height="164"
        rx="22"
        fill="none"
        stroke="var(--marker-pink)"
        strokeWidth="1.5"
        strokeDasharray="6 6"
      />
    </Board>
  );
}
