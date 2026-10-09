import { describe, expect, it } from "vitest";

import { nearestValue, snapBox, snapPoint } from "./snapping";

describe("snapBox", () => {
  const big = { x: 600, y: 100, w: 200, h: 120 };

  it("centres a box on another when it's close", () => {
    // Centre at (698, 163); the big box's centre is (700, 160).
    const { dx, dy, guides } = snapBox({ x: 668, y: 143, w: 60, h: 40 }, [big], 6);
    expect([dx, dy]).toEqual([2, -3]);
    expect(
      guides
        .filter((g) => g.kind === "line")
        .map((g) => `${g.axis}@${g.at}`)
        .sort(),
    ).toEqual(["x@700", "y@160"]);
  });

  it("leaves a box alone when nothing is close", () => {
    const { dx, dy, guides } = snapBox({ x: 0, y: 0, w: 60, h: 40 }, [big], 6);
    expect([dx, dy, guides.length]).toEqual([0, 0, 0]);
  });

  it("spaces a box evenly between two others", () => {
    const left = { x: 100, y: 200, w: 100, h: 80 };
    const right = { x: 500, y: 200, w: 100, h: 80 };
    // Centred would be x = 300; this is 4 off.
    const { dx, guides } = snapBox({ x: 304, y: 200, w: 100, h: 80 }, [left, right], 6);
    expect(dx).toBe(-4);
    const gaps = guides.filter((g) => g.kind === "gap");
    expect(gaps.map((g) => g.to - g.from)).toEqual([100, 100]);
  });

  it("continues a row's spacing", () => {
    const a = { x: 100, y: 200, w: 100, h: 80 };
    const b = { x: 300, y: 200, w: 100, h: 80 };
    const { dx } = snapBox({ x: 497, y: 200, w: 100, h: 80 }, [a, b], 6);
    expect(dx).toBe(3);
  });
});

describe("snapPoint", () => {
  it("snaps only the axes it's allowed to", () => {
    const target = { x: 200, y: 200, w: 100, h: 100 };
    expect(snapPoint({ x: 203, y: 302 }, [target], 6).point).toEqual({ x: 200, y: 300 });
    expect(snapPoint({ x: 203, y: 302 }, [target], 6, { x: true, y: false }).point).toEqual({
      x: 200,
      y: 302,
    });
  });
});

describe("nearestValue", () => {
  it("picks the closest within the threshold", () => {
    expect(nearestValue(10, [0, 12, 30], 5)).toBe(12);
    expect(nearestValue(10, [0, 30], 5)).toBeNull();
  });
});
