import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { deflate, imagePdf, MAX_PAGE_PT, pageSize, rgbaToRgb } from "./pdf";

const latin1 = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString("latin1");

describe("pdf", () => {
  it("drops alpha from canvas pixels", () => {
    expect([...rgbaToRgb(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 128]))]).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("compresses as zlib, which FlateDecode reads", async () => {
    const data = new Uint8Array(3000).map((_, i) => i % 7);
    expect([...inflateSync(await deflate(data))]).toEqual([...data]);
  });

  it("sizes the page in points, within what readers accept", () => {
    expect(pageSize(800, 600)).toEqual({ w: 600, h: 450 });
    const huge = pageSize(40000, 10000);
    expect(huge.w).toBeCloseTo(MAX_PAGE_PT);
    expect(huge.h).toBeCloseTo(MAX_PAGE_PT / 4);
  });

  it("writes a well-formed one-page PDF with the image", async () => {
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const pdf = imagePdf({
      width: 2,
      height: 2,
      pixels: await deflate(rgb),
      pageWidth: 150,
      pageHeight: 75.5,
      title: "Café board ✓",
      date: new Date(Date.UTC(2026, 9, 9, 12, 30, 5)),
    });
    expect(pdf.type).toBe("application/pdf");
    const text = await latin1(pdf);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/MediaBox [0 0 150 75.5]");
    expect(text).toContain("/Width 2 /Height 2 /ColorSpace /DeviceRGB");
    expect(text).toContain("/CreationDate (D:20261009123005Z)");
    // The title survives non-ASCII characters (UTF-16BE hex).
    expect(text).toContain("/Title <FEFF00430061006600E9");

    // Every cross-reference offset points at its object, and startxref at the table.
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets).toHaveLength(6);
    offsets.forEach((off, i) => expect(text.slice(off, off + 8)).toBe(`${i + 1} 0 obj\n`));

    // The image stream decompresses back to the pixels.
    const length = Number(text.match(/\/FlateDecode \/Length (\d+)/)![1]);
    const start = text.indexOf("stream\n", text.indexOf("4 0 obj")) + "stream\n".length;
    const bytes = Buffer.from(await pdf.arrayBuffer()).subarray(start, start + length);
    expect([...inflateSync(bytes)]).toEqual([...rgb]);
  });
});
