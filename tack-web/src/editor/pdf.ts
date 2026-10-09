/**
 * A minimal PDF writer: one page showing one image, no dependencies. The image is raw RGB
 * compressed with zlib (PDF's FlateDecode), which the browser's CompressionStream("deflate")
 * produces, so nothing is lost and the page matches the PNG export exactly.
 */

/** PDF points per CSS pixel (72 per inch over 96). */
export const PT_PER_PX = 0.75;
/** The largest page side PDF readers accept, in points (200 inches). */
export const MAX_PAGE_PT = 14400;

/** zlib-compresses bytes (deflate with a zlib header, as FlateDecode expects). */
export async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** RGBA pixels (from a canvas) as RGB, dropping alpha (the export has a white background). */
export function rgbaToRgb(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i];
    out[j + 1] = rgba[i + 1];
    out[j + 2] = rgba[i + 2];
  }
  return out;
}

/** A PDF text string that survives any characters: UTF-16BE in hex, with a byte-order mark. */
function pdfText(s: string): string {
  let hex = "FEFF";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    const units =
      code > 0xffff
        ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)]
        : [code];
    for (const u of units) hex += u.toString(16).padStart(4, "0").toUpperCase();
  }
  return `<${hex}>`;
}

const pdfDate = (d: Date) =>
  `D:${d.getUTCFullYear()}${[d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map((n) => String(n).padStart(2, "0")).join("")}Z`;

/**
 * Builds a one-page PDF. `pixels` is the image's RGB data, already zlib-compressed;
 * `pageWidth` × `pageHeight` is the page size in points, which the image fills.
 */
export function imagePdf({
  width,
  height,
  pixels,
  pageWidth,
  pageHeight,
  title,
  date = new Date(),
}: {
  width: number;
  height: number;
  pixels: Uint8Array;
  pageWidth: number;
  pageHeight: number;
  title: string;
  date?: Date;
}): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const write = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: string, stream?: Uint8Array) => {
    offsets[n] = length;
    write(`${n} 0 obj\n${body}\n`);
    if (stream) {
      write("stream\n");
      write(stream);
      write("\nendstream\n");
    }
    write("endobj\n");
  };
  const f = (v: number) => String(Math.round(v * 100) / 100);
  const [w, h] = [f(pageWidth), f(pageHeight)];
  const content = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);

  // A binary comment after the header tells tools the file holds binary data.
  write("%PDF-1.4\n%âãÏÓ\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
  );
  object(
    4,
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>`,
    pixels,
  );
  object(5, `<< /Length ${content.length} >>`, content);
  object(6, `<< /Title ${pdfText(title)} /Producer (Tack) /CreationDate (${pdfDate(date)}) >>`);

  const xref = length;
  write(`xref\n0 7\n0000000000 65535 f \n`);
  for (let n = 1; n <= 6; n++) write(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  write(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

/**
 * The page size for an image of the board: its size on screen, in points, scaled down to fit
 * the largest page readers accept.
 */
export function pageSize(cssWidth: number, cssHeight: number): { w: number; h: number } {
  const [w, h] = [cssWidth * PT_PER_PX, cssHeight * PT_PER_PX];
  const k = Math.min(1, MAX_PAGE_PT / Math.max(w, h));
  return { w: w * k, h: h * k };
}
