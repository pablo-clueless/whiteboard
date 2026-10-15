// Regression check: someone who joins late must see who's already on the board. The server used
// to send the current presence in the same frame as sync step 1, and y-websocket reads only the
// first message in a frame, so late joiners saw nobody until each person's next cursor move.
// Usage: node scripts/smoke-presence.mjs  (server must be running, :8080 by default)
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const URL = process.env.TACK_WS_URL ?? "ws://localhost:8080/ws/boards";
const ORIGIN = process.env.TACK_ORIGIN ?? "http://localhost:3000";
const API = process.env.TACK_API_URL ?? "http://localhost:8080";

const { boardId, editToken } = await fetch(`${API}/api/boards`, { method: "POST" }).then((r) =>
  r.json(),
);

class OriginWebSocket extends WebSocket {
  constructor(url, protocols) {
    super(url, { ...(protocols?.length ? { protocols } : {}), headers: { origin: ORIGIN } });
  }
}

const join = async (name) => {
  const provider = new WebsocketProvider(URL, boardId, new Y.Doc(), {
    WebSocketPolyfill: OriginWebSocket,
    disableBc: true,
    params: { token: editToken },
  });
  provider.awareness.setLocalStateField("user", { name });
  await new Promise((resolve) => provider.once("sync", resolve));
  return provider;
};
const names = (p) => [...p.awareness.getStates().values()].map((s) => s.user?.name).sort();

const first = await join("first");
const late = await join("late");
// Well under the 15 s awareness renewal, so only the join can have told `late` about `first`.
await new Promise((r) => setTimeout(r, 1000));
const seen = names(late);
first.destroy();
late.destroy();

if (!seen.includes("first")) {
  console.error(`FAIL  the late joiner sees ${JSON.stringify(seen)}, not the person already there`);
  process.exit(1);
}
console.log(`ok  the late joiner sees ${JSON.stringify(seen)}`);
process.exit(0);
