import { describe, expect, it } from "vitest";

import { parseEvent, readEvents, type StreamEvent } from "./event-stream";

/** A body that arrives in the given chunks, like a slow network would deliver it. */
function body(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
      controller.close();
    },
  });
}

async function collect(chunks: string[]) {
  const events: StreamEvent[] = [];
  for await (const e of readEvents(body(chunks))) events.push(e);
  return events;
}

describe("parseEvent", () => {
  it("reads the event name and joins data lines", () => {
    expect(parseEvent("event: live\ndata: a\ndata: b")).toEqual({ event: "live", data: "a\nb" });
  });

  it("skips comments and blocks without data", () => {
    expect(parseEvent(":keep-alive")).toBeNull();
    expect(parseEvent("event: live")).toBeNull();
  });

  it("defaults the name to message and keeps colons in the value", () => {
    expect(parseEvent('data:{"a":1}')).toEqual({ event: "message", data: '{"a":1}' });
  });
});

describe("readEvents", () => {
  it("puts events split across chunks back together", async () => {
    const events = await collect(['event: live\ndata: {"n"', ":1}\n\n:\n\nevent: live\r\ndata: 2\r\n\r\n"]);
    expect(events).toEqual([
      { event: "live", data: '{"n":1}' },
      { event: "live", data: "2" },
    ]);
  });

  it("drops a half event at the end", async () => {
    expect(await collect(["data: 1\n\ndata: 2"])).toEqual([{ event: "message", data: "1" }]);
  });
});
