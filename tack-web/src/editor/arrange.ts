/**
 * Auto-arrange layouts. Pure: boxes and the connections between them in, top-left positions
 * out, with (0, 0) the layout's top-left corner. The editor maps them back onto shapes.
 */
import dagre from "@dagrejs/dagre";

export type ArrangeMode = "lr" | "pipeline" | "snowflake" | "compact";

export type ArrangeNode = { id: string; w: number; h: number };
/** A connection, from → to (an arrow's start and end). */
export type ArrangeEdge = { from: string; to: string };
export type Positions = Map<string, { x: number; y: number }>;

export const ARRANGE_MODES: { mode: ArrangeMode; label: string; description: string }[] = [
  {
    mode: "lr",
    label: "Left to right",
    description: "A layered flow along the connections, crossings kept down",
  },
  {
    mode: "pipeline",
    label: "Pipeline",
    description: "Stages as columns; each step after everything that feeds it",
  },
  {
    mode: "snowflake",
    label: "Snowflake",
    description: "The most connected item in the middle, branches around it",
  },
  {
    mode: "compact",
    label: "Compact",
    description: "A tidy grid in reading order, ignoring connections",
  },
];

const GAP = 40;

export function arrange(nodes: ArrangeNode[], edges: ArrangeEdge[], mode: ArrangeMode): Positions {
  const ids = new Set(nodes.map((n) => n.id));
  // Only connections between the things being arranged, without self-loops or repeats.
  const seen = new Set<string>();
  const links = edges.filter((e) => {
    const key = `${e.from}>${e.to}`;
    if (e.from === e.to || !ids.has(e.from) || !ids.has(e.to) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const out =
    mode === "lr"
      ? leftToRight(nodes, links)
      : mode === "pipeline"
        ? pipeline(nodes, links)
        : mode === "snowflake"
          ? snowflake(nodes, links)
          : compact(nodes);
  return normalise(out, nodes);
}

/** Shifts positions so the layout's top-left is (0, 0). */
function normalise(pos: Positions, nodes: ArrangeNode[]): Positions {
  let [minX, minY] = [Infinity, Infinity];
  for (const n of nodes) {
    const p = pos.get(n.id);
    if (p) [minX, minY] = [Math.min(minX, p.x), Math.min(minY, p.y)];
  }
  if (minX === Infinity) return pos;
  for (const p of pos.values()) {
    p.x -= minX;
    p.y -= minY;
  }
  return pos;
}

/* ── Left to right ──────────────────────────────────────────────────────── */

function leftToRight(nodes: ArrangeNode[], links: ArrangeEdge[]): Positions {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: "LR", nodesep: GAP, ranksep: GAP * 2.5, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.w, height: n.h });
  links.forEach((e, i) => g.setEdge(e.from, e.to, {}, `e${i}`));
  dagre.layout(g);
  const pos: Positions = new Map();
  for (const n of nodes) {
    const { x, y } = g.node(n.id);
    pos.set(n.id, { x: x - n.w / 2, y: y - n.h / 2 });
  }
  return pos;
}

/* ── Pipeline ───────────────────────────────────────────────────────────── */

/**
 * Each node's stage: one more than the latest stage among the nodes that feed it (sources and
 * loose items are stage 0). Connections that close a loop are ignored, so cycles don't stall it.
 */
export function stages(nodes: ArrangeNode[], links: ArrangeEdge[]): Map<string, number> {
  const outgoing = new Map<string, ArrangeEdge[]>(nodes.map((n) => [n.id, []]));
  const fed = new Set<string>();
  for (const e of links) {
    outgoing.get(e.from)!.push(e);
    fed.add(e.to);
  }
  // Find the connections that close a loop: walking forward from the sources (then whatever is
  // left, for loops nothing feeds), an edge back to a node still on the path goes backwards.
  const back = new Set<ArrangeEdge>();
  const state = new Map<string, "open" | "done">();
  const walk = (id: string) => {
    state.set(id, "open");
    for (const e of outgoing.get(id)!) {
      const s = state.get(e.to);
      if (s === "open") back.add(e);
      else if (!s) walk(e.to);
    }
    state.set(id, "done");
  };
  for (const n of nodes) if (!fed.has(n.id) && !state.has(n.id)) walk(n.id);
  for (const n of nodes) if (!state.has(n.id)) walk(n.id);

  // Longest path over what's left, which no longer has loops.
  const incoming = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of links) if (!back.has(e)) incoming.get(e.to)!.push(e.from);
  const stage = new Map<string, number>();
  const visit = (id: string): number => {
    const known = stage.get(id);
    if (known !== undefined) return known;
    let s = 0;
    for (const from of incoming.get(id)!) s = Math.max(s, visit(from) + 1);
    stage.set(id, s);
    return s;
  };
  for (const n of nodes) visit(n.id);
  return stage;
}

function pipeline(nodes: ArrangeNode[], links: ArrangeEdge[]): Positions {
  const stage = stages(nodes, links);
  const columns: ArrangeNode[][] = [];
  // Nodes keep their given order (the editor passes them top to bottom) unless their inputs say
  // otherwise: within a column, order by the average row of what feeds them.
  for (const n of nodes) (columns[stage.get(n.id)!] ??= []).push(n);
  const row = new Map<string, number>();
  const pos: Positions = new Map();
  let x = 0;
  for (const column of columns) {
    if (!column) continue;
    const feeds = (n: ArrangeNode) => {
      const rows = links
        .filter((e) => e.to === n.id && row.has(e.from))
        .map((e) => row.get(e.from)!);
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : Infinity;
    };
    const ordered = column
      .map((n, i) => ({ n, key: feeds(n), i }))
      .sort((a, b) => (a.key === b.key ? a.i - b.i : a.key - b.key))
      .map((o) => o.n);
    let y = 0;
    ordered.forEach((n, i) => {
      row.set(n.id, i);
      pos.set(n.id, { x, y });
      y += n.h + GAP * 0.75;
    });
    x += Math.max(...ordered.map((n) => n.w)) + GAP * 2;
  }
  return pos;
}

/* ── Snowflake ──────────────────────────────────────────────────────────── */

/** Connected groups of nodes (ignoring direction). */
function components(nodes: ArrangeNode[], links: ArrangeEdge[]): ArrangeNode[][] {
  const adjacent = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of links) {
    adjacent.get(e.from)!.push(e.to);
    adjacent.get(e.to)!.push(e.from);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const done = new Set<string>();
  const out: ArrangeNode[][] = [];
  for (const n of nodes) {
    if (done.has(n.id)) continue;
    const group: ArrangeNode[] = [];
    const queue = [n.id];
    done.add(n.id);
    while (queue.length) {
      const id = queue.shift()!;
      group.push(byId.get(id)!);
      for (const next of adjacent.get(id)!) {
        if (!done.has(next)) {
          done.add(next);
          queue.push(next);
        }
      }
    }
    out.push(group);
  }
  return out;
}

/** One connected group laid out radially round its most connected node. Centre at (0, 0). */
function radial(group: ArrangeNode[], links: ArrangeEdge[]): Positions {
  const ids = new Set(group.map((n) => n.id));
  const adjacent = new Map<string, string[]>(group.map((n) => [n.id, []]));
  for (const e of links) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    adjacent.get(e.from)!.push(e.to);
    adjacent.get(e.to)!.push(e.from);
  }
  const byId = new Map(group.map((n) => [n.id, n]));
  const root = group.reduce((best, n) =>
    adjacent.get(n.id)!.length > adjacent.get(best.id)!.length ? n : best,
  );

  // A breadth-first tree from the root: each node's children and depth.
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift()!;
    children.set(id, []);
    for (const next of adjacent.get(id)!) {
      if (depth.has(next)) continue;
      depth.set(next, depth.get(id)! + 1);
      children.get(id)!.push(next);
      queue.push(next);
    }
  }

  // Leaves under each node decide how wide a slice of the circle its branch gets.
  const leaves = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const kids = children.get(id)!;
    const n = kids.length ? kids.reduce((s, k) => s + countLeaves(k), 0) : 1;
    leaves.set(id, n);
    return n;
  };
  countLeaves(root.id);

  // Ring radii: far enough out to clear the previous ring, and long enough round to fit the ring.
  const maxDepth = Math.max(...depth.values());
  const diag = (id: string) => Math.hypot(byId.get(id)!.w, byId.get(id)!.h);
  const radius: number[] = [0];
  for (let d = 1; d <= maxDepth; d++) {
    const ring = [...depth].filter(([, dd]) => dd === d).map(([id]) => id);
    const widest = Math.max(...ring.map(diag));
    const inner = Math.max(...[...depth].filter(([, dd]) => dd === d - 1).map(([id]) => diag(id)));
    const clear = radius[d - 1] + (inner + widest) / 2 + GAP;
    const around = ring.reduce((s, id) => s + diag(id) + GAP / 2, 0) / (2 * Math.PI);
    radius.push(Math.max(clear, around));
  }

  const pos: Positions = new Map();
  const place = (id: string, from: number, span: number) => {
    const d = depth.get(id)!;
    const angle = from + span / 2;
    const n = byId.get(id)!;
    const r = radius[d];
    pos.set(id, { x: Math.cos(angle) * r - n.w / 2, y: Math.sin(angle) * r - n.h / 2 });
    let start = from;
    for (const k of children.get(id)!) {
      const share = (span * leaves.get(k)!) / leaves.get(id)!;
      place(k, start, share);
      start += share;
    }
  };
  // Branches start at the top and go clockwise.
  place(root.id, -Math.PI / 2, Math.PI * 2);
  return pos;
}

/** Bounding box of positioned nodes. */
function extent(group: ArrangeNode[], pos: Positions) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const n of group) {
    const p = pos.get(n.id)!;
    [minX, minY] = [Math.min(minX, p.x), Math.min(minY, p.y)];
    [maxX, maxY] = [Math.max(maxX, p.x + n.w), Math.max(maxY, p.y + n.h)];
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function snowflake(nodes: ArrangeNode[], links: ArrangeEdge[]): Positions {
  // Each connected group becomes its own snowflake; the snowflakes (and loose items) are then
  // packed side by side, biggest first.
  const laid = components(nodes, links)
    .map((group) => {
      const pos = radial(group, links);
      return { group, pos, box: extent(group, pos) };
    })
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  const out: Positions = new Map();
  const slots = shelfPack(
    laid.map((l) => l.box),
    GAP * 1.5,
  );
  laid.forEach((l, i) => {
    const slot = slots[i];
    for (const n of l.group) {
      const p = l.pos.get(n.id)!;
      out.set(n.id, { x: p.x - l.box.x + slot.x, y: p.y - l.box.y + slot.y });
    }
  });
  return out;
}

/* ── Compact ────────────────────────────────────────────────────────────── */

/**
 * Packs boxes into rows (shelves) aiming for a roughly square overall shape, in the order given.
 * Returns each box's top-left.
 */
export function shelfPack(
  boxes: { w: number; h: number }[],
  gap: number,
): { x: number; y: number }[] {
  if (!boxes.length) return [];
  const area = boxes.reduce((s, b) => s + (b.w + gap) * (b.h + gap), 0);
  const widest = Math.max(...boxes.map((b) => b.w));
  // A little wider than square reads better on a screen.
  const rowWidth = Math.max(widest, Math.sqrt(area) * 1.3);
  const out: { x: number; y: number }[] = [];
  let [x, y, rowH] = [0, 0, 0];
  for (const b of boxes) {
    if (x > 0 && x + b.w > rowWidth) {
      y += rowH + gap;
      [x, rowH] = [0, 0];
    }
    out.push({ x, y });
    x += b.w + gap;
    rowH = Math.max(rowH, b.h);
  }
  return out;
}

function compact(nodes: ArrangeNode[]): Positions {
  const slots = shelfPack(nodes, GAP * 0.75);
  return new Map(nodes.map((n, i) => [n.id, { ...slots[i] }]));
}
