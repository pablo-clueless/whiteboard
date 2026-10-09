import { describe, expect, it } from "vitest";

import { orthogonalRoute } from "./routing";
import type { Box, Vec } from "./types";

const pts = (flat: number[]): Vec[] =>
  Array.from({ length: flat.length / 2 }, (_, i) => ({ x: flat[i * 2], y: flat[i * 2 + 1] }));

/** Whether an axis-aligned segment passes through a box's inside. */
const crosses = (a: Vec, b: Vec, o: Box) =>
  Math.max(a.x, b.x) > o.x + 1 &&
  Math.min(a.x, b.x) < o.x + o.w - 1 &&
  Math.max(a.y, b.y) > o.y + 1 &&
  Math.min(a.y, b.y) < o.y + o.h - 1;

const segments = (route: number[]) => {
  const p = pts(route);
  return p.slice(1).map((q, i) => [p[i], q] as const);
};

const RIGHT = { x: 1, y: 0 };
const LEFT = { x: -1, y: 0 };

describe("orthogonalRoute", () => {
  const A: Box = { x: 0, y: 0, w: 100, h: 60 };

  it("is a straight line when the points face each other", () => {
    const B: Box = { x: 300, y: 0, w: 100, h: 60 };
    const route = orthogonalRoute(
      { point: { x: 100, y: 30 }, dir: RIGHT },
      { point: { x: 300, y: 30 }, dir: LEFT },
      [A, B],
      24,
    );
    expect(route).toEqual([100, 30, 300, 30]);
  });

  it("only turns at right angles and starts and ends on the given points", () => {
    const B: Box = { x: 300, y: 200, w: 100, h: 60 };
    const route = orthogonalRoute(
      { point: { x: 100, y: 30 }, dir: RIGHT },
      { point: { x: 300, y: 230 }, dir: LEFT },
      [A, B],
      24,
    );
    expect(route.slice(0, 2)).toEqual([100, 30]);
    expect(route.slice(-2)).toEqual([300, 230]);
    for (const [a, b] of segments(route)) expect(a.x === b.x || a.y === b.y).toBe(true);
  });

  it("goes round the connected shapes when the target is behind the source", () => {
    const B: Box = { x: -400, y: 200, w: 100, h: 60 };
    const route = orthogonalRoute(
      { point: { x: 100, y: 30 }, dir: RIGHT },
      { point: { x: -400, y: 230 }, dir: LEFT },
      [A, B],
      24,
    );
    for (const [a, b] of segments(route)) {
      expect(crosses(a, b, A)).toBe(false);
      expect(crosses(a, b, B)).toBe(false);
    }
    // Leaves rightwards and arrives moving rightwards into B's left side.
    const p = pts(route);
    expect(p[1].x).toBeGreaterThan(p[0].x);
    expect(p[p.length - 1].x).toBeGreaterThan(p[p.length - 2].x);
  });

  it("steers round another shape in the way", () => {
    const B: Box = { x: 500, y: 0, w: 100, h: 60 };
    const wall: Box = { x: 250, y: -100, w: 40, h: 260 };
    const route = orthogonalRoute(
      { point: { x: 100, y: 30 }, dir: RIGHT },
      { point: { x: 500, y: 30 }, dir: LEFT },
      [A, B, wall],
      24,
    );
    for (const [a, b] of segments(route)) expect(crosses(a, b, wall)).toBe(false);
  });

  describe("self-loops (both ends on one shape)", () => {
    const UP = { x: 0, y: -1 };
    /** A loop's route: right angles only, never through the shape, leaving and arriving right. */
    const expectLoop = (route: number[], from: Vec, fromDir: Vec, to: Vec, toDir: Vec) => {
      expect(route.slice(0, 2)).toEqual([from.x, from.y]);
      expect(route.slice(-2)).toEqual([to.x, to.y]);
      for (const [a, b] of segments(route)) {
        expect(a.x === b.x || a.y === b.y).toBe(true);
        expect(crosses(a, b, A)).toBe(false);
      }
      const p = pts(route);
      const out = { x: p[1].x - p[0].x, y: p[1].y - p[0].y };
      const last = p.length - 1;
      const into = { x: p[last].x - p[last - 1].x, y: p[last].y - p[last - 1].y };
      expect(out.x * fromDir.x + out.y * fromDir.y).toBeGreaterThan(0);
      expect(into.x * toDir.x + into.y * toDir.y).toBeLessThan(0);
    };

    it("loops round the corner between two neighbouring sides", () => {
      const [right, top] = [
        { x: 100, y: 30 },
        { x: 50, y: 0 },
      ];
      const route = orthogonalRoute(
        { point: right, dir: RIGHT },
        { point: top, dir: UP },
        [A, A],
        24,
      );
      expectLoop(route, right, RIGHT, top, UP);
      // Out, up, across and down: three bends, staying close to the corner.
      expect(pts(route)).toHaveLength(5);
    });

    it("goes over or under the shape between opposite sides", () => {
      const [left, right] = [
        { x: 0, y: 30 },
        { x: 100, y: 30 },
      ];
      const route = orthogonalRoute(
        { point: left, dir: LEFT },
        { point: right, dir: RIGHT },
        [A, A],
        24,
      );
      expectLoop(route, left, LEFT, right, RIGHT);
    });
  });
});
