// Regression check: someone alone on a board must stay connected. y-websocket drops a connection
// that hears nothing for 30 s, so the server has to echo the client's own awareness renewals.
// Usage: node scripts/smoke-solo.mjs  (takes ~40 s; server must be running, :8080 by default)
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const URL = process.env.TACK_WS_URL ?? "ws://localhost:8080/ws/boards";
const API = process.env.TACK_API_URL ?? "http://localhost:8080";
const ORIGIN = process.env.TACK_ORIGIN ?? "http://localhost:3000";
const SECONDS = Number(process.env.SECONDS ?? 40);

const { boardId, editToken } = await fetch(`${API}/api/boards`, { method: "POST" }).then((r) =>
  r.json(),
);

class OriginWebSocket extends WebSocket {
  constructor(url, protocols) {
    super(url, { ...(protocols?.length ? { protocols } : {}), headers: { origin: ORIGIN } });
  }
}

const provider = new WebsocketProvider(URL, boardId, new Y.Doc(), {
  WebSocketPolyfill: OriginWebSocket,
  disableBc: true,
  params: { token: editToken },
});
provider.awareness.setLocalStateField("user", { name: "solo" });

let drops = 0;
const onStatus = ({ status }) => {
  if (status === "disconnected") {
    drops++;
    console.log(`dropped after ${((Date.now() - start) / 1000).toFixed(1)} s`);
  }
};
provider.on("status", onStatus);
const start = Date.now();
await new Promise((r) => setTimeout(r, SECONDS * 1000));
provider.off("status", onStatus);
provider.destroy();

if (drops) {
  console.error(`FAIL  ${drops} disconnect(s) in ${SECONDS} s alone on a board`);
  process.exit(1);
}
console.log(`ok  stayed connected for ${SECONDS} s alone on a board`);
process.exit(0);
