// @vitest-environment jsdom
// The editor core on a real Y.Doc, with no stage: everything here goes through Yjs, not Konva.
import { beforeEach, describe, expect, it } from "vitest";

// No canvas in jsdom: text measures at a fixed width per character (see `markdown.test.ts`).
HTMLCanvasElement.prototype.getContext = (() =>
  null) as typeof HTMLCanvasElement.prototype.getContext;

import "./builtins";
import { detectDiagram, diagramOf, insertDiagram, updateDiagram } from "./import/diagram";
import { setTableFields } from "./shapes/table-fields";
import { readFieldsText } from "./shapes/table-text";
import { createBoardDoc } from "./sync/board-doc";
import { Editor } from "./editor-core";

let editor: Editor;
beforeEach(() => {
  editor = new Editor(createBoardDoc());
});

const box = (x: number, y: number) =>
  editor.createShape({ type: "rect", x, y, props: { w: 100, h: 60 } });

/** An arrow from the middle of a's right side to the middle of b's left side. */
const arrowBetween = (a: string, b: string) => {
  const id = editor.createShape({ type: "arrow", x: 0, y: 0, props: { path: [0, 0, 0, 0] } });
  editor.setBinding(id, "start", { toId: a, anchor: { x: 1, y: 0.5 } });
  editor.setBinding(id, "end", { toId: b, anchor: { x: 0, y: 0.5 } });
  return id;
};

/** Where an arrow's last point is on the page. */
const arrowEnd = (id: string) => {
  const s = editor.getShape(id)!;
  const path = (s.props as { path: number[] }).path;
  return { x: s.x + path[path.length - 2], y: s.y + path[path.length - 1] };
};

describe("arrow bindings", () => {
  it("keeps an attached end on its shape when the shape moves, and undo puts it back", () => {
    const [a, b] = [box(0, 0), box(300, 0)];
    const arrow = arrowBetween(a, b);
    expect(arrowEnd(arrow)).toEqual({ x: 300, y: 30 });

    editor.markHistory();
    editor.updateShapes({ [b]: { x: 300, y: 200 } });
    editor.markHistory();
    expect(arrowEnd(arrow)).toEqual({ x: 300, y: 230 });

    editor.undo();
    expect(editor.getShape(b)).toMatchObject({ x: 300, y: 0 });
    expect(arrowEnd(arrow)).toEqual({ x: 300, y: 30 });
  });

  it("leaves an arrow where it was, unattached, when its shape is deleted", () => {
    const [a, b] = [box(0, 0), box(300, 0)];
    const arrow = arrowBetween(a, b);
    editor.deleteShapes([b]);
    expect(editor.getBinding(arrow, "end")).toBeNull();
    expect(editor.getBinding(arrow, "start")).toMatchObject({ toId: a });
    expect(arrowEnd(arrow)).toEqual({ x: 300, y: 30 });
  });
});

describe("clipboard", () => {
  it("round-trips shapes with new ids, offset, with arrows still attached to the copies", () => {
    const [a, b] = [box(0, 0), box(300, 0)];
    const arrow = arrowBetween(a, b);
    const text = editor.serialize([a, b, arrow])!;
    const pasted = editor.pasteSerialized(text, { x: 10, y: 20 })!;

    expect(pasted).toHaveLength(3);
    expect(pasted.some((id) => [a, b, arrow].includes(id))).toBe(false);
    const copy = (type: string, x: number) =>
      pasted.find((id) => editor.getShape(id)!.type === type && editor.getShape(id)!.x === x);
    const [a2, b2] = [copy("rect", 10)!, copy("rect", 310)!];
    const arrow2 = pasted.find((id) => editor.getShape(id)!.type === "arrow")!;
    expect(editor.getBinding(arrow2, "start")).toMatchObject({ toId: a2 });
    expect(editor.getBinding(arrow2, "end")).toMatchObject({ toId: b2 });
    // The original is untouched.
    expect(editor.getBinding(arrow, "end")).toMatchObject({ toId: b });
  });

  it("drops the binding to a shape that wasn't copied", () => {
    const [a, b] = [box(0, 0), box(300, 0)];
    const arrow = arrowBetween(a, b);
    const pasted = editor.pasteSerialized(editor.serialize([a, arrow])!, { x: 0, y: 100 })!;
    const arrow2 = pasted.find((id) => editor.getShape(id)!.type === "arrow")!;
    expect(editor.getBinding(arrow2, "start")).not.toBeNull();
    expect(editor.getBinding(arrow2, "end")).toBeNull();
  });

  it("isn't fooled by text that isn't Tack shapes", () => {
    expect(editor.pasteText("hello")).toBeNull();
    expect(editor.sortedIds()).toEqual([]);
  });
});

describe("groups", () => {
  it("groups, nests, selects whole groups, and ungroups one level at a time", () => {
    const [a, b, c] = [box(0, 0), box(200, 0), box(400, 0)];
    const inner = editor.group([a, b])!;
    expect(editor.expandToUnits([a])).toEqual([a, b]);
    expect(editor.unitCount([a, b, c])).toBe(2);

    const outer = editor.group([a, b, c])!;
    expect(editor.getShape(a)!.groups).toEqual([inner, outer]);
    expect(editor.expandToUnits([c]).sort()).toEqual([a, b, c].sort());

    expect(editor.ungroup([a, b, c])).toBe(true);
    expect(editor.getShape(a)!.groups).toEqual([inner]);
    expect(editor.getShape(c)!.groups).toEqual([]);
  });

  it("dissolves a group left with one shape", () => {
    const [a, b] = [box(0, 0), box(200, 0)];
    editor.group([a, b]);
    editor.deleteShapes([b]);
    expect(editor.getShape(a)!.groups ?? []).toEqual([]);
  });

  it("gives pasted copies their own groups", () => {
    const [a, b] = [box(0, 0), box(200, 0)];
    const g = editor.group([a, b])!;
    const pasted = editor.pasteSerialized(editor.serialize([a, b])!, { x: 0, y: 100 })!;
    const copied = editor.getShape(pasted[0])!.groups!;
    expect(copied).toHaveLength(1);
    expect(copied[0]).not.toBe(g);
    expect(editor.expandToUnits([pasted[0]]).sort()).toEqual([...pasted].sort());
  });
});

describe("diagrams drawn from code", () => {
  const FLOW = "flowchart LR\n  A[Start] --> B[Stop]";
  const FLOW2 = "flowchart LR\n  A[Start] --> B[Middle] --> C[Stop]";
  const labels = () =>
    editor
      .sortedIds()
      .map((id) => editor.getShape(id)!)
      .filter((s) => s.type === "text")
      .map((s) => (s.props as { text: string }).text)
      .sort();

  it("remembers the code, and finds the diagram from any of its shapes", () => {
    const ids = insertDiagram(editor, detectDiagram(FLOW)!, FLOW);
    expect(diagramOf(editor, [ids[0]])).toMatchObject({ source: FLOW });
    expect(diagramOf(editor, [box(-500, -500)])).toBeNull();
  });

  it("redraws in place from new code, in one undo step, leaving other shapes alone", () => {
    const ids = insertDiagram(editor, detectDiagram(FLOW)!, FLOW);
    const mine = box(-500, -500);
    const before = editor.getBounds(ids[0])!;
    const diagram = diagramOf(editor, ids)!;

    const next = updateDiagram(editor, diagram, detectDiagram(FLOW2)!, FLOW2);
    expect(labels()).toEqual(["Middle", "Start", "Stop"]);
    expect(ids.some((id) => editor.getShape(id))).toBe(false);
    expect(editor.getShape(mine)).not.toBeNull();
    // Same top-left as before.
    const after = next.map((id) => editor.getBounds(id)!);
    expect(Math.min(...after.map((b) => b.x))).toBeCloseTo(before.x, 0);
    expect(diagramOf(editor, next)).toMatchObject({ id: diagram.id, source: FLOW2 });

    editor.undo();
    expect(labels()).toEqual(["Start", "Stop"]);
    expect(ids.every((id) => editor.getShape(id))).toBe(true);
  });

  it("doesn't remember pasted-in text when no source is given", () => {
    insertDiagram(editor, detectDiagram(FLOW)!);
    expect(editor.board.diagrams.size).toBe(0);
  });
});

describe("relationships typed in a table's fields", () => {
  const table = (name: string, x: number, fields: string) =>
    editor.createShape({
      type: "db-table",
      x,
      y: 0,
      props: { name, fields: readFieldsText(fields).fields, w: 200, h: 100 },
    });
  const save = (id: string, text: string) => {
    const { fields, refs } = readFieldsText(text);
    return setTableFields(editor, id, fields, refs);
  };
  const arrows = () => editor.sortedIds().filter((id) => editor.getShape(id)!.type === "arrow");

  it("draws one from the field to the table it names, once, in one undo step", () => {
    const teams = table("teams", 400, "id uuid pk\nname text");
    const users = table("users", 0, "id uuid pk\nemail text");

    expect(save(users, "id uuid pk\nemail text\nteam uuid > teams.id")).toEqual([]);
    expect(arrows()).toHaveLength(1);
    const arrow = arrows()[0];
    expect(editor.getBinding(arrow, "start")).toMatchObject({ toId: users });
    expect(editor.getBinding(arrow, "end")).toMatchObject({ toId: teams });
    expect(editor.getShape(arrow)!.props).toMatchObject({ startLabel: "*", endLabel: "1" });
    const team = (editor.getShape(users)!.props as { fields: { name: string; fk?: boolean }[] })
      .fields[2];
    expect(team).toMatchObject({ name: "team", fk: true });

    // Saving the same text again doesn't draw it twice.
    save(users, "id uuid pk\nemail text\nteam uuid > teams.id // owning team");
    expect(arrows()).toHaveLength(1);

    editor.undo();
    editor.undo();
    expect(arrows()).toHaveLength(0);
    expect((editor.getShape(users)!.props as { fields: unknown[] }).fields).toHaveLength(2);
  });

  it("says which tables aren't on the board", () => {
    const users = table("users", 0, "id uuid pk");
    expect(save(users, "id uuid pk\nteam uuid > teams.id\norg uuid > orgs.id")).toEqual([
      "teams",
      "orgs",
    ]);
    expect(arrows()).toHaveLength(0);
  });
});
