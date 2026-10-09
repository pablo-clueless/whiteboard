// Checks that a client is told when a board is full, instead of its edits vanishing.
// Needs a server with a small limit, e.g.:
//   TACK_ADDR=127.0.0.1:8090 TACK_MAX_BOARD_BYTES=20000 cargo run
//   TACK_WS_URL=ws://localhost:8090/ws/boards TACK_API_URL=http://localhost:8090 node scripts/smoke-full.mjs
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const URL = process.env.TACK_WS_URL ?? "ws://localhost:8090/ws/boards";
const ORIGIN = process.env.TACK_ORIGIN ?? "http://localhost:3000";
const API = process.env.TACK_API_URL ?? "http://localhost:8090";
const MESSAGE_BOARD_FULL = 100;

const { boardId, editToken } = await fetch(`${API}/api/boards`, { method: "POST" }).then((r) =>
  r.json(),
);

class OriginWebSocket extends WebSocket {
  constructor(url, protocols) {
    super(url, { ...(protocols?.length ? { protocols } : {}), headers: { origin: ORIGIN } });
  }
}

function client() {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(URL, boardId, doc, {
    WebSocketPolyfill: OriginWebSocket,
    disableBc: true,
    params: { token: editToken },
  });
  let full = 0;
  provider.messageHandlers[MESSAGE_BOARD_FULL] = () => full++;
  return { doc, provider, full: () => full };
}

const until = async (label, fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  console.log(`ok  ${label}`);
};

const a = client();
await until("a synced", () => a.provider.synced);

// About 1 KB per edit, well past a small limit.
const shapes = a.doc.getMap("shapes");
for (let i = 0; i < 60; i++) {
  shapes.set(
    `s${i}`,
    new Y.Map(Object.entries({ type: "text", props: { text: "x".repeat(1000) } })),
  );
  await new Promise((r) => setTimeout(r, 5));
}
await until("a is told the board is full", () => a.full() > 0);
if (a.full() !== 1) throw new Error(`told ${a.full()} times; expected once per connection`);
console.log("ok  told exactly once");

// Someone joining a full board to edit hears about it straight away.
const b = client();
await until("b synced", () => b.provider.synced);
await until("b is told on join", () => b.full() > 0);

a.provider.destroy();
b.provider.destroy();
// Let the sockets finish closing; exiting mid-close trips an assertion in Node on Windows.
await new Promise((r) => setTimeout(r, 200));
console.log("all checks passed");
process.exit(0);
