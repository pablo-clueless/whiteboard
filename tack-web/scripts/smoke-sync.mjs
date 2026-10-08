// Wire-compat smoke test: real yjs + y-websocket clients against the Rust server.
// Usage: node scripts/smoke-sync.mjs  (server must be running on :8080)
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const URL = process.env.TACK_WS_URL ?? "ws://localhost:8080/ws/boards";
const API = process.env.TACK_API_URL ?? "http://localhost:8080";
const ORIGIN = process.env.TACK_ORIGIN ?? "http://localhost:3000";
const { boardId: board, editToken } = await fetch(`${API}/api/boards`, { method: "POST" }).then(
  (r) => r.json(),
);

// Node's WebSocket doesn't send Origin like a browser does; add it.
class OriginWebSocket extends WebSocket {
  constructor(url, protocols) {
    // Passing `protocols: undefined` makes Node's WebSocket misreport server close codes as 1006.
    super(url, { ...(protocols?.length ? { protocols } : {}), headers: { origin: ORIGIN } });
  }
}

function client() {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(URL, board, doc, {
    WebSocketPolyfill: OriginWebSocket,
    disableBc: true,
    params: { token: editToken },
  });
  return { doc, provider, shapes: doc.getMap("shapes") };
}

const synced = (c) => new Promise((r) => (c.provider.synced ? r() : c.provider.once("sync", r)));
const until = async (label, fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
  console.log(`ok  ${label}`);
};

const a = client();
const b = client();
await Promise.all([synced(a), synced(b)]);
console.log("ok  both clients synced");

const rect = new Y.Map([
  ["type", "rect"],
  ["x", 10],
  ["y", 20],
]);
a.shapes.set("s1", rect);
await until("b sees a's insert", () => b.shapes.get("s1")?.get("x") === 10);

b.shapes.get("s1").set("x", 99);
await until("a sees b's edit", () => a.shapes.get("s1").get("x") === 99);

const t0 = performance.now();
a.shapes.get("s1").set("y", 1);
await until("relay round trip", () => b.shapes.get("s1").get("y") === 1);
console.log(`    relay latency ${(performance.now() - t0).toFixed(1)} ms`);

a.provider.awareness.setLocalStateField("user", { name: "a" });
await until("b sees a's awareness", () => b.provider.awareness.getStates().has(a.doc.clientID));

const c = client();
await synced(c);
await until("late joiner gets full state", () => c.shapes.get("s1")?.get("x") === 99);

a.provider.destroy();
await until(
  "a's awareness removed on leave",
  () => !b.provider.awareness.getStates().has(a.doc.clientID),
);

for (const x of [b, c]) x.provider.destroy();
console.log("all checks passed");
process.exit(0);
