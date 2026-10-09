import { type TableField, tableHeight, tableWidth } from "./shapes/table";
import { portsOf, toAnchor } from "./bindings";
import type { Editor } from "./editor-core";
import { unionBox } from "./geometry";
import type { Vec } from "./types";

/**
 * Starting points for a new board. Each builds ordinary shapes through the editor (so they're
 * fully editable, synced and undoable), in its own coordinates from (0, 0); the picker moves
 * them to the middle of the screen.
 */
export type Template = {
  id: string;
  name: string;
  description: string;
  /** Builds the template with its top-left at `origin` (page space). */
  build: (b: Builder) => void;
};

/** Which side of a shape an arrow leaves or arrives at: its default connection points. */
type Side = "top" | "right" | "bottom" | "left";
const PORT: Record<Side, number> = { top: 0, right: 1, bottom: 2, left: 3 };

const STICKY = { fill: "#fff3b0", stroke: "#f0dc7a", strokeWidth: 1, radius: 8 };

/** Small helpers templates build with. Coordinates are relative to the template's origin. */
export class Builder {
  constructor(
    private readonly editor: Editor,
    private readonly origin: Vec,
  ) {}

  private at(x: number, y: number) {
    return { x: this.origin.x + x, y: this.origin.y + y };
  }

  shape(
    type: string,
    x: number,
    y: number,
    props: Record<string, unknown> = {},
    groups?: string[],
  ) {
    return this.editor.createShape({
      type,
      ...this.at(x, y),
      props,
      ...(groups ? { groups } : {}),
    });
  }

  /** A line of text centred on (cx, cy). */
  text(
    text: string,
    cx: number,
    cy: number,
    props: { fontSize?: number; fontWeight?: number; color?: string } = {},
    groups?: string[],
  ) {
    const id = this.shape("text", 0, 0, { text, fontSize: 16, ...props }, groups);
    const b = this.editor.getBounds(id);
    const p = this.at(cx, cy);
    if (b) this.editor.updateShapes({ [id]: { x: p.x - b.w / 2, y: p.y - b.h / 2 } });
    return id;
  }

  /** A box with a centred label, grouped so they move together. Returns the box's id. */
  labelled(
    type: string,
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    props: Record<string, unknown> = {},
    text: { fontSize?: number; fontWeight?: number; color?: string } = {},
  ) {
    const group = [crypto.randomUUID()];
    const id = this.shape(type, x, y, { w, h, ...props }, group);
    this.text(label, x + w / 2, y + h / 2, text, group);
    return id;
  }

  sticky(x: number, y: number, label: string, fill = STICKY.fill) {
    // Yellow notes get a matching edge; other colours a neutral one.
    const stroke = fill === STICKY.fill ? STICKY.stroke : "#d4d4da";
    return this.labelled(
      "rect",
      x,
      y,
      240,
      72,
      label,
      { ...STICKY, fill, stroke },
      { fontSize: 15 },
    );
  }

  component(provider: string, item: string, label: string, x: number, y: number) {
    return this.shape("component", x, y, { provider, item, label });
  }

  frame(name: string, x: number, y: number, w: number, h: number, fill = "#ffffff") {
    return this.shape("frame", x, y, { name, w, h, fill });
  }

  /** A database table card, sized to fit its fields. */
  table(name: string, fields: TableField[], x: number, y: number, color?: string) {
    return this.shape("db-table", x, y, {
      name,
      fields,
      w: tableWidth(name, fields),
      h: tableHeight(fields.length),
      ...(color ? { headerColor: color } : {}),
    });
  }

  /** An arrow between two specific connection points (by index), attached at both ends. */
  connectPorts(
    from: string,
    fromPort: number,
    to: string,
    toPort: number,
    props: Record<string, unknown> = {},
  ) {
    const id = this.shape("arrow", 0, 0, { path: [0, 0, 0, 0], ...props });
    for (const [terminal, shapeId, index] of [
      ["start", from, fromPort],
      ["end", to, toPort],
    ] as const) {
      const shape = this.editor.getValidShape(shapeId);
      const port = shape && portsOf(shape)[index];
      const anchor = shape && port && toAnchor(shape, port);
      if (anchor) this.editor.setBinding(id, terminal, { toId: shapeId, anchor });
    }
    return id;
  }

  /** An arrow from one shape's side to another's, attached at both ends. */
  connect(
    from: string,
    fromSide: Side,
    to: string,
    toSide: Side,
    props: Record<string, unknown> = {},
  ) {
    const id = this.shape("arrow", 0, 0, { path: [0, 0, 0, 0], ...props });
    for (const [terminal, shapeId, side] of [
      ["start", from, fromSide],
      ["end", to, toSide],
    ] as const) {
      const shape = this.editor.getValidShape(shapeId);
      const port = shape && portsOf(shape)[PORT[side]];
      const anchor = shape && port && toAnchor(shape, port);
      if (anchor) this.editor.setBinding(id, terminal, { toId: shapeId, anchor });
    }
    return id;
  }
}

export const TEMPLATES: Template[] = [
  {
    id: "blank",
    name: "Blank board",
    description: "Start from nothing.",
    build: () => {},
  },
  {
    id: "architecture",
    name: "System architecture",
    description: "Client, load balancer, services, data stores and a queue, already connected.",
    build: (b) => {
      // Laid out so every connection has a clear path (routes avoid only the shapes they join).
      const client = b.component("generic", "client", "Web client", 0, 140);
      b.frame("Production", 260, 20, 880, 420);
      const lb = b.component("generic", "load-balancer", "Load balancer", 300, 140);
      const api = b.component("backend", "api", "API service", 580, 140);
      const db = b.component("database", "postgres", "orders-db", 880, 60);
      const cache = b.component("database", "redis", "cache", 880, 200);
      const events = b.component("messaging", "kafka", "events", 580, 340);
      const worker = b.component("backend", "worker", "Worker", 880, 340);
      b.connect(client, "right", lb, "left");
      b.connect(lb, "right", api, "left");
      b.connect(api, "right", db, "left");
      b.connect(api, "right", cache, "left");
      b.connect(api, "bottom", events, "top");
      b.connect(events, "right", worker, "left");
      b.connect(worker, "right", db, "right");
    },
  },
  {
    id: "flowchart",
    name: "Flowchart",
    description: "Start, steps, a decision with yes and no paths, and an end.",
    build: (b) => {
      const ink = { fill: "#ffffff", stroke: "#0e0e10", strokeWidth: 1.5 };
      const start = b.labelled("ellipse", 210, 0, 180, 64, "Start", { ...ink, fill: "#d8f2e2" });
      const input = b.labelled("rect", 200, 130, 200, 72, "Collect input", { ...ink, radius: 8 });
      const valid = b.labelled("polygon", 200, 270, 200, 120, "Valid?", {
        ...ink,
        sides: 4,
        fill: "#fff3b0",
      });
      const process = b.labelled("rect", 200, 460, 200, 72, "Process request", {
        ...ink,
        radius: 8,
      });
      const error = b.labelled("rect", 500, 294, 200, 72, "Show error", {
        ...ink,
        radius: 8,
        fill: "#fde0ee",
      });
      const end = b.labelled("ellipse", 210, 600, 180, 64, "End", { ...ink, fill: "#d8f2e2" });
      b.connect(start, "bottom", input, "top");
      b.connect(input, "bottom", valid, "top");
      b.connect(valid, "bottom", process, "top");
      b.connect(valid, "right", error, "left");
      b.connect(error, "top", input, "right");
      b.connect(process, "bottom", end, "top");
      b.text("Yes", 330, 428, { fontSize: 14, color: "#4a4a52" });
      b.text("No", 450, 314, { fontSize: 14, color: "#4a4a52" });
    },
  },
  {
    id: "kanban",
    name: "Kanban",
    description: "To do, in progress and done columns with cards to move along.",
    build: (b) => {
      const columns: [string, string[]][] = [
        ["To do", ["Write the spec", "Design the login flow", "Set up CI"]],
        ["In progress", ["Build the API", "Review designs"]],
        ["Done", ["Kick-off meeting"]],
      ];
      columns.forEach(([name, cards], i) => {
        const x = i * 320;
        b.frame(name, x, 0, 280, 520, "#f6f6f7");
        cards.forEach((label, j) => b.sticky(x + 20, 20 + j * 92, label));
      });
    },
  },
  {
    id: "retro",
    name: "Retrospective",
    description: "What went well, what to improve, and action items.",
    build: (b) => {
      const columns: [string, string, string[]][] = [
        ["Went well", "#d8f2e2", ["Shipped on time", "Great pairing"]],
        ["To improve", "#fde0ee", ["Too many meetings", "Flaky tests"]],
        ["Action items", "#d9e4ff", ["Fix the flaky tests"]],
      ];
      columns.forEach(([name, tint, cards], i) => {
        const x = i * 320;
        b.frame(name, x, 0, 280, 440, tint);
        cards.forEach((label, j) => b.sticky(x + 20, 20 + j * 92, label, "#ffffff"));
      });
    },
  },
  {
    id: "mindmap",
    name: "Mind map",
    description: "A central idea with branches to grow from.",
    build: (b) => {
      const centre = b.labelled(
        "ellipse",
        330,
        200,
        240,
        100,
        "Main idea",
        { fill: "#ffe0c7", stroke: "#f56e0f", strokeWidth: 2 },
        { fontSize: 22, fontWeight: 700 },
      );
      const pill = { fill: "#ffffff", stroke: "#4a4a52", strokeWidth: 1.5, radius: 30 };
      const branch = { route: "straight", arrowEnd: false, stroke: "#8a8a93", strokeWidth: 2 };
      const branches: [string, number, number, Side, Side][] = [
        ["Goals", 0, 40, "left", "right"],
        ["Research", 0, 230, "left", "right"],
        ["Risks", 0, 420, "left", "right"],
        ["Timeline", 720, 40, "right", "left"],
        ["Team", 720, 230, "right", "left"],
        ["Questions", 720, 420, "right", "left"],
      ];
      for (const [label, x, y, fromSide, toSide] of branches) {
        const node = b.labelled("rect", x, y, 180, 60, label, pill, {
          fontSize: 16,
          fontWeight: 600,
        });
        b.connect(centre, fromSide, node, toSide, branch);
      }
    },
  },
];

/**
 * Builds shapes with `build` (in its own coordinates), moves them so their middle sits in the
 * middle of the screen, routes their arrows round everything now on the board, and zooms to fit
 * them. All one undo step. Returns the new shapes' ids, selected.
 */
export function placeBuilt(editor: Editor, build: (b: Builder) => void): string[] {
  if (editor.readOnly) return [];
  const { camera } = editor.ui;
  const centre = {
    x: (window.innerWidth / 2 - camera.x) / camera.zoom,
    y: (window.innerHeight / 2 - camera.y) / camera.zoom,
  };
  const before = new Set(editor.sortedIds());
  let made: string[] = [];
  editor.markHistory();
  editor.transact(() => {
    build(new Builder(editor, { x: 0, y: 0 }));
    made = editor.sortedIds().filter((id) => !before.has(id));
    const box = unionBox(made.map((id) => editor.getBounds(id)));
    if (!box) return;
    const dx = centre.x - (box.x + box.w / 2);
    const dy = centre.y - (box.y + box.h / 2);
    editor.updateShapes(
      Object.fromEntries(
        made.map((id) => {
          const s = editor.getShape(id)!;
          return [id, { x: s.x + dx, y: s.y + dy }];
        }),
      ),
    );
  });
  // The spatial index has caught up now, so routes can steer round every new shape.
  editor.rerouteArrows(made);
  editor.markHistory();
  const box = unionBox(made.map((id) => editor.getBounds(id)));
  if (box) editor.zoomToFit({ maxZoom: 1, box });
  editor.select(made.filter((id) => editor.getShape(id)?.type !== "arrow"));
  return made;
}

/** Builds a template in the middle of the screen. Blank does nothing. */
export function applyTemplate(editor: Editor, template: Template) {
  if (template.id === "blank") return;
  placeBuilt(editor, template.build);
  editor.select([]);
}
