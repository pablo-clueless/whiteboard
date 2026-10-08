"use client";

import { type ReactNode, useEffect, useState } from "react";
import { motion } from "motion/react";

// Tack's palette, as flat geometric tiles.
const INK = "#0e0e10";
const ORANGE = "#f56e0f";
const DEEP = "#c2540a";
const LIGHT = "#ffb27a";
const PAPER = "#fff1e6";
const YELLOW = "#ffd449";
const BLUE = "#3366ff";
const WHITE = "#ffffff";

type Tile = { id: string; bg: string; span?: string; art: ReactNode };

/** Each tile is drawn in a 100×100 box and cropped to its cell. */
const TILES: Tile[] = [
  {
    id: "leaf",
    bg: DEEP,
    art: (
      <>
        <path d="M0 0h50v50A50 50 0 0 1 0 0z" fill={ORANGE} />
        <path d="M50 50A50 50 0 0 1 100 0v50z" fill={LIGHT} />
        <path d="M0 100V50a50 50 0 0 1 50 50z" fill={LIGHT} />
        <circle cx="75" cy="75" r="25" fill={ORANGE} />
      </>
    ),
  },
  {
    id: "pins",
    bg: INK,
    art: (
      <>
        <path d="M18 24l10-10 10 10-10 10z" fill={ORANGE} />
        <path d="M38 24l10-10 10 10-10 10z" fill={YELLOW} />
        <rect x="18" y="48" width="64" height="4" fill={BLUE} />
        {Array.from({ length: 16 }, (_, i) => (
          <rect key={i} x={18 + i * 4} y="58" width="2" height="12" fill={WHITE} />
        ))}
        <rect x="18" y="78" width="40" height="4" fill={BLUE} opacity="0.6" />
        {[0, 1, 2].map((r) =>
          [0, 1].map((c) => (
            <circle
              key={`${r}${c}`}
              cx={78 + c * 8}
              cy={18 + r * 8}
              r="1.4"
              fill={WHITE}
              opacity="0.4"
            />
          )),
        )}
      </>
    ),
  },
  {
    id: "arcs",
    bg: ORANGE,
    art: (
      <>
        {[18, 32, 46, 60, 74, 88].map((r) => (
          <circle key={r} cx="0" cy="100" r={r} fill="none" stroke={INK} strokeWidth="3.5" />
        ))}
      </>
    ),
  },
  {
    id: "checker",
    bg: BLUE,
    art: (
      <>
        <path d="M0 0l50 50L0 100z" fill={INK} opacity="0.35" />
        <path d="M100 0L50 50l50 50z" fill={WHITE} opacity="0.18" />
        <path d="M50 50L0 0h100z" fill={INK} opacity="0.18" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <path
            key={i}
            d={`M${60 + i * 6} 70l6-6 6 6`}
            fill="none"
            stroke={WHITE}
            strokeWidth="1.6"
          />
        ))}
      </>
    ),
  },
  {
    id: "sunrise",
    bg: PAPER,
    span: "col-span-2",
    art: (
      <>
        <circle cx="70" cy="100" r="58" fill={ORANGE} />
        {[62, 72, 82, 92].map((y, i) => (
          <rect key={y} x={8 + i * 6} y={y} width={180} height="4" fill={PAPER} />
        ))}
        <circle cx="160" cy="34" r="12" fill={INK} />
      </>
    ),
  },
  {
    id: "arrow-up",
    bg: INK,
    art: (
      <>
        <path d="M50 18l26 26H24z" fill={LIGHT} />
        <path d="M50 46l26 26H24z" fill={ORANGE} />
        <rect x="46" y="72" width="8" height="18" fill={ORANGE} />
      </>
    ),
  },
  {
    id: "sticky",
    bg: BLUE,
    art: (
      <>
        <g transform="rotate(-8 50 52)">
          <rect
            x="22"
            y="24"
            width="56"
            height="56"
            fill="rgb(0 0 0 / 0.2)"
            transform="translate(3 4)"
          />
          <rect x="22" y="24" width="56" height="56" fill={YELLOW} />
          <rect x="30" y="38" width="36" height="3" rx="1.5" fill={INK} opacity="0.7" />
          <rect x="30" y="47" width="28" height="3" rx="1.5" fill={INK} opacity="0.7" />
          <rect x="30" y="56" width="32" height="3" rx="1.5" fill={INK} opacity="0.7" />
        </g>
        <circle cx="50" cy="22" r="5" fill={ORANGE} />
      </>
    ),
  },
  {
    id: "burst",
    bg: DEEP,
    art: <path d={starPath(50, 50, 34, 15, 12)} fill={YELLOW} />,
  },
  {
    id: "dots",
    bg: ORANGE,
    art: (
      <>
        {Array.from({ length: 5 }, (_, r) =>
          Array.from({ length: 5 }, (_, c) => (
            <circle
              key={`${r}${c}`}
              cx={18 + c * 16}
              cy={18 + r * 16}
              r="3"
              fill={WHITE}
              opacity={(r + c) % 2 ? 0.45 : 0.9}
            />
          )),
        )}
      </>
    ),
  },
  {
    id: "pinned",
    bg: INK,
    span: "col-span-2 row-span-2",
    art: (
      <>
        <path d="M0 100A100 100 0 0 1 100 0v100z" fill={ORANGE} />
        <path d="M100 0a100 100 0 0 1 100 100H100z" fill={BLUE} opacity="0.9" />
        <path d="M100 100h100v100H100z" fill={PAPER} />
        <path d="M100 100a60 60 0 0 1 60 60v40h-60z" fill={YELLOW} />
        <path d="M0 160h100M0 172h100M0 184h100" stroke={DEEP} strokeWidth="3" />
        <circle cx="100" cy="100" r="9" fill={WHITE} />
        <circle cx="100" cy="100" r="4" fill={INK} />
      </>
    ),
  },
  {
    id: "waves",
    bg: INK,
    art: (
      <>
        {[38, 50, 62].map((y) => (
          <path
            key={y}
            d={`M0 ${y}q12.5-10 25 0t25 0 25 0 25 0`}
            fill="none"
            stroke={y === 50 ? ORANGE : LIGHT}
            strokeWidth="3"
          />
        ))}
      </>
    ),
  },
  {
    id: "cursor",
    bg: YELLOW,
    art: (
      <path
        d="M30 22l44 22-19 6-8 21z"
        fill={INK}
        stroke={WHITE}
        strokeWidth="3"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: "half",
    bg: INK,
    art: (
      <>
        <path d="M0 100a50 50 0 0 1 100 0z" fill={ORANGE} />
        <path d="M14 100a36 36 0 0 1 72 0" fill="none" stroke={INK} strokeWidth="3" />
        <path d="M28 100a22 22 0 0 1 44 0" fill="none" stroke={INK} strokeWidth="3" />
      </>
    ),
  },
  {
    id: "scribble",
    bg: PAPER,
    art: (
      <path
        d="M14 64c10-30 30-40 40-24s-14 34-4 36 24-40 36-30-6 30 2 32"
        fill="none"
        stroke={BLUE}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: "triangles",
    bg: LIGHT,
    art: (
      <>
        <path d="M0 100L50 0l50 100z" fill={DEEP} />
        <path d="M25 100L50 50l25 50z" fill={INK} />
      </>
    ),
  },
  {
    id: "rings",
    bg: BLUE,
    art: (
      <>
        <circle cx="50" cy="50" r="30" fill="none" stroke={WHITE} strokeWidth="3" />
        <circle cx="50" cy="50" r="18" fill={ORANGE} />
        <circle cx="80" cy="20" r="6" fill={YELLOW} />
      </>
    ),
  },
];

function starPath(cx: number, cy: number, outer: number, inner: number, points: number) {
  const step = Math.PI / points;
  return (
    Array.from({ length: points * 2 }, (_, i) => {
      const r = i % 2 ? inner : outer;
      const a = i * step - Math.PI / 2;
      return `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join("") + "Z"
  );
}

/** A wall of geometric tiles. Hover one to rotate it; now and then one turns on its own. */
export function Mosaic() {
  const [turns, setTurns] = useState<Record<string, number>>({});

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      const tile = TILES[Math.floor(Math.random() * TILES.length)];
      setTurns((t) => ({ ...t, [tile.id]: (t[tile.id] ?? 0) + 1 }));
    }, 2600);
    return () => clearInterval(id);
  }, []);

  const turn = (id: string) => setTurns((t) => ({ ...t, [id]: (t[id] ?? 0) + 1 }));

  return (
    <div className="grid h-full w-full grid-cols-4 grid-rows-5" aria-hidden>
      {TILES.map((tile, i) => {
        const wide = tile.span?.includes("col-span-2");
        const tall = tile.span?.includes("row-span-2");
        const [w, h] = [wide ? 200 : 100, tall ? 200 : 100];
        const n = turns[tile.id] ?? 0;
        return (
          <motion.div
            key={tile.id}
            className={`relative overflow-hidden ${tile.span ?? ""}`}
            style={{ background: tile.bg }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.04 * i, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            onPointerEnter={() => turn(tile.id)}
          >
            <motion.svg
              viewBox={`0 0 ${w} ${h}`}
              preserveAspectRatio="xMidYMid slice"
              className="absolute inset-0 h-full w-full"
              // Square tiles turn a quarter; wide or tall ones flip so they still fill the cell.
              animate={wide !== tall ? { scaleX: n % 2 ? -1 : 1 } : { rotate: n * 90 }}
              transition={{ type: "spring", stiffness: 140, damping: 18 }}
            >
              {tile.art}
            </motion.svg>
          </motion.div>
        );
      })}
    </div>
  );
}
