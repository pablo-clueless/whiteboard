"use client";

import { motion, type Variants } from "motion/react";
import { useRef } from "react";

const LETTERS = "tack".split("");
const TILTS = [-8, 6, -4, 10];

const varinats: Variants = {
  hidden: (i: number) => ({ y: "-160%", rotate: TILTS[i] * 2, opacity: 0 }),
  visible: (i: number) => ({
    y: 0,
    rotate: 0,
    opacity: 1,
    transition: {
      delay: i * 0.12,
      y: { type: "spring", stiffness: 260, damping: 14, mass: 1.2 },
      rotate: { type: "spring", stiffness: 180, damping: 10 },
      opacity: { duration: 0.15 },
    },
  }),
};

export function Footer() {
  const ref = useRef<HTMLElement>(null);

  return (
    <footer className="bg-primary mt-8 overflow-hidden px-3 sm:px-6" ref={ref}>
      <div className="container mx-auto">
        <motion.div
          aria-hidden
          className="my-16 flex items-center select-none"
          initial="hidden"
          viewport={{ once: true, amount: 0.3 }}
          whileInView="visible"
        >
          {LETTERS.map((letter, i) => (
            <motion.p
              className="text-ink cursor-grab text-[clamp(9rem,36vw,70rem)] leading-[0.72] font-black tracking-[-0.075em] active:cursor-grabbing"
              custom={i}
              drag
              dragConstraints={ref}
              dragElastic={0.2}
              dragTransition={{ bounceStiffness: 300, bounceDamping: 18 }}
              key={letter}
              variants={varinats}
              whileDrag={{ scale: 1.06, rotate: TILTS[i], zIndex: 10 }}
            >
              {letter}
            </motion.p>
          ))}
        </motion.div>
        <div className="flex flex-col items-center justify-between py-2 text-sm sm:flex-row sm:items-center sm:text-center">
          <p>&copy;{new Date().getFullYear()} Tack. All rights reserved.</p>
          <p>Tack is a free, open-source whiteboard tool.</p>
        </div>
      </div>
    </footer>
  );
}
