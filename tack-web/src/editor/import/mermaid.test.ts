import { describe, expect, it } from "vitest";

import { mermaidKind, parseErDiagram, parseFlowchart } from "./mermaid";

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
    expect(mermaidKind("stateDiagram-v2\n [*] --> A")).toBe("other");
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
