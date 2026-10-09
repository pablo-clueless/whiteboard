import { describe, expect, it } from "vitest";

import { CLIPBOARD_PREFIX } from "./editor-core";
import { readEntry } from "./library";

describe("readEntry", () => {
  it("reads a card, checking each field", () => {
    expect(
      readEntry("c1", {
        kind: "card",
        label: "  Billing API ",
        caption: "Internal",
        icon: { kind: "ref", provider: "aws", item: "lambda" },
        color: "#12a594",
        createdAt: 5,
      }),
    ).toEqual({
      kind: "card",
      id: "c1",
      label: "Billing API",
      caption: "Internal",
      icon: { kind: "ref", provider: "aws", item: "lambda" },
      color: "#12a594",
      createdAt: 5,
    });
  });

  it("falls back for a bad colour and icon", () => {
    const card = readEntry("c2", { kind: "card", label: "X", color: "red", icon: { kind: "?" } });
    expect(card).toMatchObject({ color: "#3366ff", icon: { kind: "monogram", text: "?" } });
  });

  it("reads saved shapes only with clipboard data and a box", () => {
    const shapes = {
      kind: "shapes",
      label: "Flow",
      clip: `${CLIPBOARD_PREFIX}{"shapes":[],"bindings":[]}`,
      box: { x: 0, y: 0, w: 10, h: 20 },
      count: 2,
    };
    expect(readEntry("s1", shapes)).toMatchObject({ kind: "shapes", count: 2 });
    expect(readEntry("s2", { ...shapes, clip: "not ours" })).toBeNull();
    expect(readEntry("s3", { ...shapes, box: { x: 0 } })).toBeNull();
  });

  it("drops entries without a name or with an unknown kind", () => {
    expect(readEntry("a", { kind: "card", label: "   " })).toBeNull();
    expect(readEntry("b", { kind: "widget", label: "Hi" })).toBeNull();
    expect(readEntry("c", null)).toBeNull();
  });
});
