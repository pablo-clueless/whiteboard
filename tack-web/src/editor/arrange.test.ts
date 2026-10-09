import { describe, expect, it } from "vitest";

import { arrange, type ArrangeEdge, type ArrangeMode, type ArrangeNode, stages } from "./arrange";

const box = (id: string, w = 120, h = 60): ArrangeNode => ({ id, w, h });
const edge = (from: string, to: string): ArrangeEdge => ({ from, to });

/** A small system: a client into an API that fans out, plus a loop and two loose notes. */
const NODES = ["client", "lb", "api", "db", "cache", "queue", "worker", "noteA", "noteB"].map(
  (id, i) => box(id, 100 + (i % 3) * 30, 50 + (i % 2) * 20),
);
const EDGES = [
  edge("client", "lb"),
  edge("lb", "api"),
  edge("api", "db"),
  edge("api", "cache"),
  edge("api", "queue"),
  edge("queue", "worker"),
  edge("worker", "db"),
  edge("worker", "api"), // a loop back
];

function overlaps(nodes: ArrangeNode[], pos: Map<string, { x: number; y: number }>) {
  const found: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const [a, b] = [nodes[i], nodes[j]];
      const [p, q] = [pos.get(a.id)!, pos.get(b.id)!];
      if (p.x < q.x + b.w && q.x < p.x + a.w && p.y < q.y + b.h && q.y < p.y + a.h)
        found.push(`${a.id}/${b.id}`);
    }
  }
  return found;
}

describe("arrange", () => {
  it.each<ArrangeMode>(["lr", "pipeline", "snowflake", "compact"])(
    "%s places everything, without overlaps, from (0, 0)",
    (mode) => {
      const pos = arrange(NODES, EDGES, mode);
      expect([...pos.keys()].sort()).toEqual(NODES.map((n) => n.id).sort());
      expect(overlaps(NODES, pos)).toEqual([]);
      expect(Math.min(...[...pos.values()].map((p) => p.x))).toBeCloseTo(0);
      expect(Math.min(...[...pos.values()].map((p) => p.y))).toBeCloseTo(0);
    },
  );

  it("left to right puts each step after what feeds it", () => {
    const pos = arrange(NODES, EDGES, "lr");
    expect(pos.get("lb")!.x).toBeGreaterThan(pos.get("client")!.x);
    expect(pos.get("api")!.x).toBeGreaterThan(pos.get("lb")!.x);
    expect(pos.get("worker")!.x).toBeGreaterThan(pos.get("queue")!.x);
  });

  it("pipeline lays stages out as top-aligned columns", () => {
    const pos = arrange(NODES, EDGES, "pipeline");
    // cache and queue are fed only by api: same column, stacked, the top one at the top.
    const xs = ["cache", "queue"].map((id) => pos.get(id)!.x);
    expect(new Set(xs).size).toBe(1);
    expect(Math.min(...["cache", "queue"].map((id) => pos.get(id)!.y))).toBe(0);
    expect(pos.get("worker")!.x).toBeGreaterThan(xs[0]);
    // db waits for worker, its latest input.
    expect(pos.get("db")!.x).toBeGreaterThan(pos.get("worker")!.x);
  });

  it("works out stages, ignoring the edge that closes a loop", () => {
    const s = stages(NODES, EDGES);
    expect(
      Object.fromEntries(
        ["client", "lb", "api", "queue", "worker", "db", "noteA"].map((id) => [id, s.get(id)]),
      ),
    ).toEqual({
      client: 0,
      lb: 1,
      api: 2,
      queue: 3,
      worker: 4,
      db: 5, // after worker, its latest input
      noteA: 0,
    });
  });

  it("snowflake puts the most connected item in the middle of its branches", () => {
    const pos = arrange(NODES, EDGES, "snowflake");
    const centre = (id: string) => {
      const n = NODES.find((x) => x.id === id)!;
      const p = pos.get(id)!;
      return { x: p.x + n.w / 2, y: p.y + n.h / 2 };
    };
    const connected = ["client", "lb", "api", "db", "cache", "queue", "worker"];
    const xs = connected.map((id) => centre(id).x);
    const ys = connected.map((id) => centre(id).y);
    const mid = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    // api has the most connections: it sits nearest the middle of its group.
    const dist = (id: string) => Math.hypot(centre(id).x - mid.x, centre(id).y - mid.y);
    expect(connected.every((id) => dist("api") <= dist(id))).toBe(true);
  });

  it("compact keeps reading order", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => box(id));
    const pos = arrange(nodes, [], "compact");
    expect(pos.get("a")).toEqual({ x: 0, y: 0 });
    expect(pos.get("b")!.x).toBeGreaterThan(0);
    expect(pos.get("b")!.y).toBe(0);
  });

  it("ignores connections to things not being arranged, and self-loops", () => {
    const pos = arrange(
      [box("a"), box("b")],
      [edge("a", "zzz"), edge("a", "a"), edge("a", "b")],
      "lr",
    );
    expect(pos.get("b")!.x).toBeGreaterThan(pos.get("a")!.x);
  });
});
