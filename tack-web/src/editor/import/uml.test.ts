import { describe, expect, it } from "vitest";

import { parseClassDiagram, parseMember, parseSequenceDiagram } from "./mermaid";
import { layoutSequence, type Measure } from "./sequence";

const CLASSES = `classDiagram
    direction LR
    %% a comment
    Animal <|-- Duck
    Animal <|-- Fish
    Animal : +int age
    Animal : +String gender
    Animal: +isMammal() bool
    Animal: +mate()
    class Duck{
        +String beakColor
        +swim()
        +quack() void
    }
    class Shape~T~ {
        <<interface>>
        +area()$ double
    }
    Square~Shape~ ..|> Shape
    Library "1" *-- "many" Book : contains
    Car o-- Wheel
    Driver --> Car : drives
    Doc .. Note
    note for Duck "can fly"
    classDef hot fill:#f00
    namespace Zoo {
        class Keeper
    }
`;

describe("parseClassDiagram", () => {
  const d = parseClassDiagram(CLASSES);
  const cls = (id: string) => d.classes.find((c) => c.id === id)!;

  it("reads classes, members (inline and in blocks) and annotations", () => {
    expect(d.direction).toBe("LR");
    expect(cls("Animal").members).toEqual([
      { name: "+age", type: "int", method: false },
      { name: "+gender", type: "String", method: false },
      { name: "+isMammal()", type: "bool", method: true },
      { name: "+mate()", type: "", method: true },
    ]);
    expect(cls("Duck").members.map((m) => m.name)).toEqual(["+beakColor", "+swim()", "+quack()"]);
    expect(cls("Shape")).toMatchObject({ label: "Shape<T>", annotation: "interface" });
    expect(cls("Shape").members[0]).toEqual({ name: "+area()$", type: "double", method: true });
    expect(cls("Square").label).toBe("Square<Shape>");
  });

  it("reads each kind of relationship, with cardinality and labels", () => {
    const rel = (from: string, to: string) =>
      d.relations.find((r) => r.from === from && r.to === to)!;
    expect(rel("Animal", "Duck")).toMatchObject({
      fromHead: "triangle",
      toHead: null,
      dashed: false,
    });
    expect(rel("Square", "Shape")).toMatchObject({
      fromHead: null,
      toHead: "triangle",
      dashed: true,
    });
    expect(rel("Library", "Book")).toMatchObject({
      fromHead: "diamondFilled",
      fromCard: "1",
      toCard: "many",
      label: "contains",
    });
    expect(rel("Car", "Wheel").fromHead).toBe("diamond");
    expect(rel("Driver", "Car")).toMatchObject({ toHead: "arrow", label: "drives" });
    expect(rel("Doc", "Note")).toMatchObject({ fromHead: null, toHead: null, dashed: true });
  });

  it("keeps namespaces and reports notes it leaves out", () => {
    expect(d.namespaces).toEqual([{ id: "Zoo", label: "Zoo", nodes: ["Keeper"] }]);
    expect(d.warnings).toEqual(["1 note was left out"]);
  });

  it("reads members in either order", () => {
    expect(parseMember("-List~int~ position")).toEqual({
      name: "-position",
      type: "List<int>",
      method: false,
    });
    expect(parseMember("name: string")).toEqual({ name: "name", type: "string", method: false });
    expect(parseMember("#draw(ctx: Ctx) : void")).toEqual({
      name: "#draw(ctx: Ctx)",
      type: "void",
      method: true,
    });
  });
});

const SEQUENCE = `sequenceDiagram
    autonumber
    actor U as User
    participant W as Web app
    participant API
    U->>W: Open dashboard
    W->>+API: GET /me
    loop Every 30s
        W-)API: poll
        API-->>W: updates
    end
    alt signed in
        API-->>-W: 200 profile
    else expired
        API--xW: 401
        W->>W: refresh token
    end
    Note over W,API: JSON over HTTPS
    Note right of API: rate limited
    activate W
    box Grey Backend
    end
`;

describe("parseSequenceDiagram", () => {
  const d = parseSequenceDiagram(SEQUENCE);

  it("reads participants, aliases and actors in order of appearance", () => {
    expect(d.participants).toEqual([
      { id: "U", label: "User", actor: true },
      { id: "W", label: "Web app", actor: false },
      { id: "API", label: "API", actor: false },
    ]);
    expect(d.autonumber).toBe(true);
  });

  it("reads messages, notes and blocks", () => {
    const kinds = d.events.map((e) => e.kind);
    expect(kinds).toEqual([
      "message",
      "message",
      "start",
      "message",
      "message",
      "end",
      "start",
      "message",
      "else",
      "message",
      "message",
      "end",
      "note",
      "note",
    ]);
    expect(d.events[1]).toMatchObject({ from: "W", to: "API", text: "GET /me", dashed: false });
    expect(d.events[4]).toMatchObject({ from: "API", to: "W", dashed: true, head: true });
    expect(d.events[2]).toEqual({ kind: "start", block: "loop", label: "Every 30s" });
    expect(d.events[12]).toEqual({
      kind: "note",
      at: ["W", "API"],
      side: "over",
      text: "JSON over HTTPS",
    });
    expect(d.warnings).toEqual([]);
  });
});

describe("layoutSequence", () => {
  // About 7 px a character, 1.3 lines of height.
  const measure: Measure = (text, size) => ({
    w: text.length * size * 0.55,
    h: size * 1.3 * text.split("\n").length,
  });
  const d = parseSequenceDiagram(SEQUENCE);
  const l = layoutSequence(d, measure);

  it("puts participants left to right with room for each message's text", () => {
    const xs = l.lifelines.map((line) => line.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    const messages = l.messages.filter((m) => m.points.length === 4);
    for (const m of messages) {
      const width = Math.abs(m.points[2] - m.points[0]);
      expect(width).toBeGreaterThanOrEqual(measure(m.text, 13, 500).w);
    }
  });

  it("numbers messages in order and stacks them downwards", () => {
    expect(l.messages.map((m) => m.text.split(".")[0])).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
    ]);
    const ys = l.messages.map((m) => m.points[1]);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it("draws self-messages as a loop to the right", () => {
    const self = l.messages.find((m) => m.text.includes("refresh"))!;
    expect(self.points).toHaveLength(8);
    expect(self.points[2]).toBeGreaterThan(self.points[0]);
  });

  it("boxes blocks round their messages, outer ones first", () => {
    expect(l.blocks.map((b) => b.title)).toEqual(
      expect.arrayContaining(["loop [Every 30s]", "alt [signed in]"]),
    );
    const alt = l.blocks.find((b) => b.title.startsWith("alt"))!;
    expect(alt.dividers).toEqual([{ y: expect.any(Number), label: "[expired]" }]);
    const inAlt = l.messages.filter((m) => m.text.includes("401") || m.text.includes("200"));
    for (const m of inAlt) {
      expect(m.points[1]).toBeGreaterThan(alt.y);
      expect(m.points[1]).toBeLessThan(alt.y + alt.h);
    }
  });

  it("keeps everything at or right of 0", () => {
    expect(
      Math.min(...l.notes.map((n) => n.x), ...l.blocks.map((b) => b.x)),
    ).toBeGreaterThanOrEqual(0);
    expect(l.w).toBeGreaterThan(0);
  });
});
