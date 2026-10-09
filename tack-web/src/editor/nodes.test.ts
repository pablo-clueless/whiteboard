import { describe, expect, it } from "vitest";

import {
  edgeCount,
  edgeMiddle,
  insertNode,
  moveNode,
  outlineBox,
  pathData,
  removeNode,
  smoothCurve,
  validCurves,
  type Curves,
} from "./nodes";

const square = [0, 0, 100, 0, 100, 100, 0, 100];

describe("nodes", () => {
  it("counts edges for open and closed outlines", () => {
    expect(edgeCount(4, false)).toBe(3);
    expect(edgeCount(4, true)).toBe(4);
    expect(edgeCount(1, false)).toBe(0);
  });

  it("reads curves one per edge, dropping anything malformed", () => {
    expect(validCurves([[1, 2, 3, 4], "x", [1, 2]], 4)).toEqual([[1, 2, 3, 4], null, null, null]);
    expect(validCurves(undefined, 2)).toEqual([null, null]);
  });

  it("draws straight edges as lines and curved ones as Béziers, closing polygons", () => {
    const curves: Curves = [null, [110, 20, 110, 80], null, null];
    expect(pathData(square, curves, true)).toBe("M0 0L100 0C110 20 110 80 100 100L0 100L0 0Z");
    expect(pathData([0, 0, 50, 50], [null], false)).toBe("M0 0L50 50");
  });

  it("moves a point with the curve handles beside it", () => {
    const curves: Curves = [[30, -20, 70, -20], [120, 30, 120, 70], null, null];
    const r = moveNode(square, curves, 1, 10, 5, true);
    expect(r.pts.slice(2, 4)).toEqual([110, 5]);
    // The edge arriving at point 1 carries its second handle; the one leaving, its first.
    expect(r.curves[0]).toEqual([30, -20, 80, -15]);
    expect(r.curves[1]).toEqual([130, 35, 120, 70]);
    // The original is untouched.
    expect(curves[0]).toEqual([30, -20, 70, -20]);
  });

  it("adds a point mid-edge, splitting a curve without changing its shape", () => {
    const straight = insertNode(square, [null, null, null, null], 0);
    expect(straight.index).toBe(1);
    expect(straight.pts.slice(0, 6)).toEqual([0, 0, 50, 0, 100, 0]);
    expect(straight.curves).toHaveLength(5);

    const curves: Curves = [[30, -40, 70, -40], null, null, null];
    const mid = edgeMiddle(square, curves, 0);
    const split = insertNode(square, curves, 0);
    expect(split.pts[2]).toBeCloseTo(mid.x);
    expect(split.pts[3]).toBeCloseTo(mid.y);
    expect(split.curves[0]).not.toBeNull();
    expect(split.curves[1]).not.toBeNull();
  });

  it("removes a point, joining its edges, but not below the minimum", () => {
    const r = removeNode(square, [null, null, null, null], 1, true, 3)!;
    expect(r.pts).toEqual([0, 0, 100, 100, 0, 100]);
    expect(r.curves).toHaveLength(3);
    expect(removeNode([0, 0, 1, 1, 2, 2], [null, null, null], 0, true, 3)).toBeNull();
    // The first point of a closed outline: the last edge now runs to the old second point.
    const first = removeNode(square, [null, null, null, [5, 95, 0, 50]], 0, true, 3)!;
    expect(first.pts).toEqual([100, 0, 100, 100, 0, 100]);
    // Joining a curved edge to a straight one keeps the curve's handle and puts the other a
    // third of the way along the new edge, from (0, 100) to (100, 0).
    expect(first.curves.slice(0, 2)).toEqual([null, null]);
    const joined = first.curves[2]!;
    expect(joined.slice(0, 2)).toEqual([5, 95]);
    expect(joined[2]).toBeCloseTo(66.67, 1);
    expect(joined[3]).toBeCloseTo(33.33, 1);
    // An open line's end just loses its edge.
    const open = removeNode([0, 0, 50, 0, 100, 0], [[10, 10, 40, 10], null], 0, false, 2)!;
    expect(open.pts).toEqual([50, 0, 100, 0]);
    expect(open.curves).toEqual([null]);
  });

  it("curves a lone edge into an arc, and others smoothly through their neighbours", () => {
    const arc = smoothCurve([0, 0, 90, 0], 0, false)!;
    expect(arc[1]).toBeGreaterThan(0);
    expect(arc[3]).toBe(arc[1]);
    const smooth = smoothCurve([0, 0, 100, 0, 200, 100], 1, false)!;
    // Leaves point 1 heading the way the neighbours run (right and down).
    expect(smooth[0]).toBeGreaterThan(100);
    expect(smooth[1]).toBeGreaterThan(0);
  });

  it("boxes points and curve handles", () => {
    expect(outlineBox([0, 0, 100, 0], [[20, -30, 80, 40]])).toEqual({
      x: 0,
      y: -30,
      w: 100,
      h: 70,
    });
  });
});
