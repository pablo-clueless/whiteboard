import { describe, expect, it } from "vitest";

import { mermaidKind, parseErDiagram, parseFlowchart, parseStateDiagram } from "./mermaid";

const FLOW = `\`\`\`mermaid
flowchart LR
  %% a comment
  A[Christmas] -->|Get money| B(Go shopping)
  B --> C{Let me think}
  C -- Two --> E[iPhone]
  C -.-> F[(Database)]
  D[Laptop] & E ==> G((Done)); G --- H([Stadium])
  subgraph cloud [Cloud services]
    F
    I{{Hex}} <--> F
  end
  classDef red fill:#f00
\`\`\``;

describe("mermaidKind", () => {
  it("tells drawable diagrams from others", () => {
    expect(mermaidKind(FLOW)).toBe("flowchart");
    expect(mermaidKind("graph TD\nA-->B")).toBe("flowchart");
    expect(mermaidKind("erDiagram\n A ||--o{ B : x")).toBe("er");
    expect(mermaidKind("sequenceDiagram\n A->>B: hi")).toBe("sequence");
    expect(mermaidKind("classDiagram\n A <|-- B")).toBe("class");
    expect(mermaidKind("stateDiagram-v2\n [*] --> A")).toBe("state");
    expect(mermaidKind("gantt\n title Plan")).toBe("other");
    expect(mermaidKind("just some notes")).toBeNull();
  });
});

describe("parseFlowchart", () => {
  const f = parseFlowchart(FLOW);

  it("reads direction, nodes and shapes", () => {
    expect(f.direction).toBe("LR");
    expect(f.warnings).toEqual([]);
    expect(Object.fromEntries(f.nodes.map((n) => [n.id, `${n.shape}:${n.label}`]))).toMatchObject({
      A: "rect:Christmas",
      B: "round:Go shopping",
      C: "diamond:Let me think",
      F: "database:Database",
      G: "circle:Done",
      H: "stadium:Stadium",
      I: "hexagon:Hex",
    });
  });

  it("reads links: labels, both label styles, dashed, thick, two-way, & and chains", () => {
    const edges = f.edges.map(
      (e) =>
        `${e.from}>${e.to}${e.label ? `[${e.label}]` : ""}${e.dashed ? " dashed" : ""}${e.thick ? " thick" : ""}${e.arrowStart ? " <" : ""}${e.arrowEnd ? " >" : ""}`,
    );
    expect(edges).toEqual([
      "A>B[Get money] >",
      "B>C >",
      "C>E[Two] >",
      "C>F dashed >",
      "D>G thick >",
      "E>G thick >",
      "G>H",
      "I>F < >",
    ]);
  });

  it("reads subgraphs", () => {
    expect(f.subgraphs).toEqual([{ id: "cloud", label: "Cloud services", nodes: ["F", "I"] }]);
  });
});

describe("parseErDiagram", () => {
  it("reads entities, keys and relationship cardinality", () => {
    const s = parseErDiagram(`erDiagram
  CUSTOMER ||--o{ ORDER : places
  CUSTOMER }|..|{ ADDRESS : uses
  ORDER ||--|| INVOICE : "billed by"
  CUSTOMER {
    string id PK
    string name "full name"
  }
  ORDER {
    int id PK
    string customer_id FK
  }`);
    expect(s.warnings).toEqual([]);
    const customer = s.tables.find((t) => t.name === "CUSTOMER")!;
    expect(customer.fields).toMatchObject([
      { name: "id", type: "string", pk: true },
      { name: "name", note: "full name" },
    ]);
    expect(s.tables.find((t) => t.name === "ORDER")!.fields[1].fk).toBe(true);
    expect(s.refs.map((r) => `${r.from.table} ${r.kind} ${r.to.table} (${r.label})`)).toEqual([
      "CUSTOMER < ORDER (places)",
      "CUSTOMER <> ADDRESS (uses)",
      "ORDER - INVOICE (billed by)",
    ]);
  });
});

describe("parseStateDiagram", () => {
  const s = parseStateDiagram(`stateDiagram-v2
    direction LR
    [*] --> Still
    Still --> Moving : push
    Moving --> Still
    Moving --> Crash
    Crash --> [*]
    state "Waiting for payment" as Pay
    Pay : card or transfer
    Still --> Pay
    state Pick <<choice>>
    Pay --> Pick
    Pick --> Done : paid
    state Fork <<fork>>
    state Active {
      [*] --> Idle
      Idle --> Busy : job
      Busy --> [*]
      state Inner {
        Deep
      }
    }
    Done --> Active
    Active --> Fork
    note right of Crash : boom
    note left of Pay
      several lines
    end note
    classDef bad fill:#f00
    Crash:::bad`);
  const node = (id: string) => s.nodes.find((n) => n.id === id);
  const links = s.edges.map((e) => `${e.from}>${e.to}${e.label ? `:${e.label}` : ""}`);

  it("reads states, labels, descriptions and special states", () => {
    expect(s.direction).toBe("LR");
    expect(node("Still")).toMatchObject({ shape: "round", label: "Still" });
    expect(node("Pay")?.label).toBe("Waiting for payment\ncard or transfer");
    expect(node("Pick")?.shape).toBe("diamond");
    expect(node("Fork")?.shape).toBe("bar");
    expect(node("[*]start")?.shape).toBe("start");
    expect(node("[*]end")?.shape).toBe("end");
  });

  it("reads transitions with labels, scoping [*] to each composite state", () => {
    expect(links).toEqual(
      expect.arrayContaining([
        "[*]start>Still",
        "Still>Moving:push",
        "Crash>[*]end",
        "Pick>Done:paid",
        "Active[*]start>Idle",
        "Busy>Active[*]end",
      ]),
    );
  });

  it("draws composite states as nested subgraphs, entered and left through their own [*]", () => {
    expect(node("Active")).toBeUndefined();
    expect(links).toContain("Done>Active[*]start");
    expect(links).toContain("Active[*]end>Fork");
    const active = s.subgraphs.find((g) => g.id === "Active")!;
    expect(active.nodes).toEqual(expect.arrayContaining(["Active[*]start", "Idle", "Busy"]));
    expect(s.subgraphs.find((g) => g.id === "Inner")).toMatchObject({
      parent: "Active",
      nodes: ["Deep"],
    });
  });

  it("leaves notes out with one warning and ignores styling", () => {
    expect(s.warnings).toEqual(["Notes in state diagrams are left out"]);
  });

  it("enters a composite with no [*] at its first state", () => {
    const t = parseStateDiagram(`stateDiagram
      A --> Group
      state Group {
        First --> Second
      }
      Group --> B`);
    expect(t.edges.map((e) => `${e.from}>${e.to}`)).toEqual([
      "A>First",
      "First>Second",
      "Second>B",
    ]);
  });
});
