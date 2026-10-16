import { describe, expect, it } from "vitest";

import { describe as describeDiagram, detectDiagram, drawable } from "./diagram";
import {
  parsePlantActivity,
  parsePlantClass,
  parsePlantEntities,
  parsePlantSequence,
  parsePlantState,
  plantumlKind,
} from "./plantuml";

const SEQUENCE = `@startuml
' a comment
skinparam monochrome true
autonumber
actor User
participant "Web app" as Web #lightblue
participant DB as "Database"
User -> Web : Sign in
Web -[#red]> DB ++ : Find account
DB <-- Web
alt found
  DB --> Web : Account
  note right of Web : cache it
else not found
  Web --> User : Try again
end
note over User, Web
  two lines
  of note
end note
== Done ==
Web -> Web : log
@enduml`;

describe("parsePlantSequence", () => {
  const d = parsePlantSequence(SEQUENCE);
  const messages = d.events.filter((e) => e.kind === "message");

  it("reads participants with their aliases and labels", () => {
    expect(d.participants).toEqual([
      { id: "User", label: "User", actor: true },
      { id: "Web", label: "Web app", actor: false },
      { id: "DB", label: "Database", actor: false },
    ]);
    expect(d.autonumber).toBe(true);
  });

  it("reads messages, colours, reversed arrows and self-messages", () => {
    expect(messages.map((m) => m.kind === "message" && [m.from, m.to, m.text, m.dashed])).toEqual([
      ["User", "Web", "Sign in", false],
      ["Web", "DB", "Find account", false],
      ["Web", "DB", "", true],
      ["DB", "Web", "Account", true],
      ["Web", "User", "Try again", true],
      ["Web", "Web", "log", false],
    ]);
  });

  it("reads groups and notes", () => {
    expect(d.events.filter((e) => e.kind !== "message").map((e) => e.kind)).toEqual([
      "start",
      "note",
      "else",
      "end",
      "note",
    ]);
    const note = d.events.findLast((e) => e.kind === "note");
    expect(note).toMatchObject({ at: ["User", "Web"], side: "over", text: "two lines\nof note" });
    expect(d.warnings).toEqual([]);
  });
});

const CLASSES = `@startuml
left to right direction
package Shapes {
  abstract class Shape {
    {abstract} +area() : double
    --
    -String name
  }
  class Circle extends Shape {
    +double r
  }
}
interface Drawable
enum Color {
  RED
  GREEN
}
class "Big Square" as Square
Square -up-|> Shape
Circle ..|> Drawable
Library "1" *-- "many" Book : contains >
Car o-- Wheel
Driver --> Car : drives
Shape : +id : int
note "floating" as N1
@enduml`;

describe("parsePlantClass", () => {
  const d = parsePlantClass(CLASSES);
  const cls = (id: string) => d.classes.find((c) => c.id === id)!;

  it("reads classes, kinds, members and packages", () => {
    expect(d.direction).toBe("LR");
    expect(cls("Shape").annotation).toBe("abstract");
    expect(cls("Shape").members.map((m) => m.name)).toEqual(["+area()", "-name", "+id"]);
    expect(cls("Drawable").annotation).toBe("interface");
    expect(cls("Color").annotation).toBe("enumeration");
    expect(cls("Color").members.map((m) => m.name)).toEqual(["RED", "GREEN"]);
    expect(cls("Square").label).toBe("Big Square");
    expect(d.namespaces).toEqual([{ id: "Shapes", label: "Shapes", nodes: ["Shape", "Circle"] }]);
  });

  it("reads relationships, including extends and directions", () => {
    const rel = (from: string, to: string) =>
      d.relations.find((r) => r.from === from && r.to === to);
    expect(rel("Shape", "Circle")).toMatchObject({ fromHead: "triangle", dashed: false });
    expect(rel("Square", "Shape")).toMatchObject({ toHead: "triangle", dashed: false });
    expect(rel("Circle", "Drawable")).toMatchObject({ toHead: "triangle", dashed: true });
    expect(rel("Library", "Book")).toMatchObject({
      fromHead: "diamondFilled",
      fromCard: "1",
      toCard: "many",
      label: "contains",
    });
    expect(rel("Car", "Wheel")).toMatchObject({ fromHead: "diamond" });
    expect(rel("Driver", "Car")).toMatchObject({ toHead: "arrow", label: "drives" });
    expect(d.warnings).toEqual(["1 note was left out"]);
  });
});

describe("parsePlantEntities", () => {
  const s = parsePlantEntities(`@startuml
entity "Customer" as c {
  * id : number <<generated>>
  --
  * name : text
}
entity Order {
  * id : number
  --
  * customer_id : number <<FK>>
}
c ||--o{ Order : places
@enduml`);

  it("reads entities, keys and relationships", () => {
    expect(s.tables.map((t) => t.name)).toEqual(["Customer", "Order"]);
    expect(s.tables[0].fields).toMatchObject([
      { name: "id", type: "number", pk: true, notNull: true },
      { name: "name", type: "text", pk: false },
    ]);
    expect(s.tables[1].fields[1]).toMatchObject({ name: "customer_id", fk: true, pk: false });
    expect(s.refs).toEqual([
      {
        from: { table: "Customer", field: "" },
        to: { table: "Order", field: "" },
        kind: "<",
        label: "places",
      },
    ]);
    expect(s.warnings).toEqual([]);
  });
});

describe("parsePlantState", () => {
  const c = parsePlantState(`@startuml
[*] --> Draft
state "In review" as Review
Draft -right-> Review : submit
state Review {
  [*] -> Checking
  Checking --> Approved
}
state fork1 <<fork>>
Approved --> fork1
Approved -[#green]-> [*]
state Draft : being written
@enduml`);

  it("reads states, composites and transitions", () => {
    const node = (id: string) => c.nodes.find((n) => n.id === id);
    expect(node("Draft")?.label).toBe("being written");
    expect(node("fork1")?.shape).toBe("bar");
    expect(c.subgraphs.map((s) => [s.id, s.label])).toEqual([["Review", "In review"]]);
    expect(c.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ["[*]start", "Draft", undefined],
      ["Draft", "Review[*]start", "submit"],
      ["Review[*]start", "Checking", undefined],
      ["Checking", "Approved", undefined],
      ["Approved", "fork1", undefined],
      ["Approved", "[*]end", undefined],
    ]);
    expect(c.warnings).toEqual([]);
  });
});

describe("parsePlantActivity", () => {
  const c = parsePlantActivity(`@startuml
start
:Sign up;
if (Verified?) then (yes)
  :Create
  workspace;
elseif (Expired?) then (yes)
  :Resend email;
else (no)
  :Wait;
endif
while (More invites?) is (yes)
  :Send invite;
endwhile (no)
fork
  :Email;
fork again
  :Slack;
end fork
-> done;
stop
@enduml`);
  const label = (id: string) => c.nodes.find((n) => n.id === id)?.label;
  const links = c.edges.map(
    (e) => `${label(e.from) || e.from}>${label(e.to) || e.to}${e.label ? `:${e.label}` : ""}`,
  );

  it("reads steps, branches, loops and forks", () => {
    expect(c.nodes.map((n) => n.shape)).toEqual([
      "start",
      "rect",
      "diamond",
      "rect",
      "diamond",
      "rect",
      "rect",
      "diamond",
      "rect",
      "bar",
      "rect",
      "rect",
      "bar",
      "end",
    ]);
    expect(label("n3")).toBe("Create\nworkspace");
    expect(links).toEqual([
      "n0>Sign up",
      "Sign up>Verified?",
      "Verified?>Create\nworkspace:yes",
      "Verified?>Expired?",
      "Expired?>Resend email:yes",
      "Expired?>Wait:no",
      "Create\nworkspace>More invites?",
      "Resend email>More invites?",
      "Wait>More invites?",
      "More invites?>Send invite:yes",
      "Send invite>More invites?",
      "More invites?>n9:no",
      "n9>Email",
      "n9>Slack",
      "Email>n12",
      "Slack>n12",
      "n12>n13:done",
    ]);
    expect(c.warnings).toEqual([]);
  });
});

describe("detectDiagram with PlantUML", () => {
  it("tells the kinds apart", () => {
    expect(plantumlKind(SEQUENCE)).toBe("sequence");
    expect(plantumlKind(CLASSES)).toBe("class");
    expect(plantumlKind("@startuml\nLeo --> Bob : hi\n@enduml")).toBe("sequence");
    expect(plantumlKind("@startuml\nactor User\nUser --> (Log in)\n@enduml")).toBe("other");
    expect(plantumlKind("@startmindmap\n* root\n@endmindmap")).toBe("other");
    expect(plantumlKind("flowchart TD\n A --> B")).toBeNull();
  });

  it("draws PlantUML and says so", () => {
    const d = detectDiagram("```plantuml\n" + SEQUENCE + "\n```")!;
    expect(drawable(d)).toBe(true);
    expect(describeDiagram(d)).toBe("PlantUML sequence diagram · 3 participants, 6 messages");
    expect(describeDiagram(detectDiagram("@startgantt\n@endgantt")!)).toBe(
      "PlantUML gantt isn't supported yet",
    );
  });
});
