"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "cn";

const CODE = `export const dotVote: ShapeDef<DotVoteProps> = {
  type: "dot_vote",
  version: 1,
  defaultProps: { question: "", options: [] },
  validate: parseDotVoteProps,
  getBounds: (s) => ({ x: s.x, y: s.y, w: 280, h: 220 }),
  Component: DotVoteCard,
  migrations: [],
};

shapeRegistry.register(dotVote);`;

/** Just enough highlighting for the one snippet above. */
function highlight(line: string) {
  const parts = line.split(/("[^"]*"|\b(?:export|const)\b|\b\d+\b|\b[a-zA-Z]+(?=:)|\b[A-Z]\w*)/g);
  return parts.map((p, i) => {
    if (!p) return null;
    let cls = "";
    if (/^"/.test(p)) cls = "text-marker-green";
    else if (/^(export|const)$/.test(p)) cls = "text-marker-pink";
    else if (/^\d+$/.test(p)) cls = "text-primary";
    else if (/^[a-z][a-zA-Z]*$/.test(p) && line.includes(`${p}:`)) cls = "text-[#7aa2ff]";
    else if (/^[A-Z]/.test(p)) cls = "text-sticky";
    return (
      <span key={i} className={cn("font-mono", cls)}>
        {p}
      </span>
    );
  });
}

type Voter = "ada" | "kofi" | "you";
const VOTER_COLOR: Record<Voter, string> = {
  ada: "var(--marker-blue)",
  kofi: "var(--marker-green)",
  you: "var(--marker-pink)",
};
const YOUR_DOTS = 3;

const INITIAL: { label: string; dots: Voter[] }[] = [
  { label: "Onboarding flow", dots: ["ada", "kofi"] },
  { label: "Search results", dots: ["ada"] },
  { label: "Billing page", dots: ["kofi", "kofi"] },
];

export function CustomShapes() {
  const [options, setOptions] = useState(INITIAL);
  const used = options.reduce((n, o) => n + o.dots.filter((d) => d === "you").length, 0);
  const left = YOUR_DOTS - used;

  const vote = (i: number) => {
    if (left === 0) return;
    setOptions((opts) => opts.map((o, j) => (j === i ? { ...o, dots: [...o.dots, "you"] } : o)));
  };

  return (
    <section id="custom" className="scroll-mt-20 px-3 py-24 sm:px-6 md:py-32">
      <div className="container mx-auto grid items-center gap-12 px-3 lg:grid-cols-[1fr_1.1fr]">
        <div className="min-w-0">
          <h2 className="text-ink text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[0.95] font-black tracking-[-0.045em]">
            Draw something we didn&apos;t think of.
          </h2>
          <p className="text-ink/65 mt-5 max-w-md text-[17px] leading-relaxed">
            Every shape in Tack, the built-in ones included, is a short definition: how it looks,
            how big it is, how it resizes. Write one and it gets selection, live sync and undo like
            everything else.
          </p>

          <pre className="bg-ink mt-8 overflow-x-auto rounded-2xl p-5 text-[13px] leading-[1.7] text-white/85">
            <code className="font-mono">
              {CODE.split("\n").map((line, i) => (
                <span key={i} className="block font-mono">
                  {highlight(line)}
                  {line === "" && " "}
                </span>
              ))}
            </code>
          </pre>
        </div>
        <div className="bg-dots relative grid min-h-120 min-w-0 place-items-center rounded-[28px] border bg-white p-6">
          <span className="text-ink/50 absolute top-4 left-4 rounded-full border bg-white px-2.5 py-1 font-mono text-[11px]">
            dot_vote
          </span>
          <div className="relative w-full max-w-85">
            <span
              aria-hidden
              className="border-marker-pink pointer-events-none absolute -inset-3 rounded-[22px] border-[1.5px] border-dashed"
            />
            <div className="border-ink rounded-2xl border-[3px] bg-white p-5 shadow-[0_24px_40px_-28px_rgb(14_14_16/0.6)]">
              <p className="text-ink text-lg font-extrabold tracking-tight">
                What should we fix first?
              </p>
              <p className="text-ink/55 mt-0.5 text-sm" aria-live="polite">
                {left > 0
                  ? `Click an option to place a dot. ${left} left.`
                  : "You've placed all your dots."}
              </p>
              <ul className="mt-4 space-y-2">
                {options.map((o, i) => (
                  <li key={o.label}>
                    <button
                      type="button"
                      onClick={() => vote(i)}
                      disabled={left === 0}
                      className="group hover:border-ink/30 focus-visible:ring-primary/40 flex w-full items-center justify-between gap-3 rounded-xl border bg-[#f8f8f9] px-3.5 py-3 text-left transition-colors outline-none focus-visible:ring-4 disabled:cursor-default"
                    >
                      <span className="text-ink text-[15px] font-semibold">{o.label}</span>
                      <span className="flex min-h-4 flex-wrap justify-end gap-1">
                        <AnimatePresence initial={false}>
                          {o.dots.map((d, k) => (
                            <motion.span
                              key={k}
                              initial={{ scale: 0 }}
                              animate={{ scale: 1 }}
                              transition={{ type: "spring", stiffness: 500, damping: 15 }}
                              className="size-4 rounded-full"
                              style={{ background: VOTER_COLOR[d] }}
                            />
                          ))}
                        </AnimatePresence>
                        <span className="sr-only">{o.dots.length} dots</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {used > 0 && (
                <button
                  type="button"
                  onClick={() => setOptions(INITIAL)}
                  className="text-ink/55 hover:text-ink focus-visible:ring-primary/40 mt-3 rounded text-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-4"
                >
                  Take my dots back
                </button>
              )}
            </div>
          </div>
          <div className="text-ink/60 mt-6 flex gap-4 text-xs">
            {(Object.keys(VOTER_COLOR) as Voter[]).map((v) => (
              <span key={v} className="flex items-center gap-1.5 capitalize">
                <span className="size-2.5 rounded-full" style={{ background: VOTER_COLOR[v] }} />
                {v}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
