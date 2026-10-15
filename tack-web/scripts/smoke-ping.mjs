// Check the dev latency overlay's ping: the server echoes custom message 103 with its payload.
// Usage: node scripts/smoke-ping.mjs  (server must be running, :8080 by default)
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";

const URL = process.env.TACK_WS_URL ?? "ws://localhost:8080/ws/boards";
const ORIGIN = process.env.TACK_ORIGIN ?? "http://localhost:3000";
const API = process.env.TACK_API_URL ?? "http://localhost:8080";
const MESSAGE_PING = 103;
const PINGS = 5;

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

// Same encoding and decoding as `sendPing` and the handler in `board-doc.ts`.
const waiting = new Map();
provider.messageHandlers[MESSAGE_PING] = (_encoder, decoder) => {
  const { arr, pos } = decoder;
  if (arr[pos] !== 4) return;
  const seq = new DataView(arr.buffer, arr.byteOffset + pos + 1, 4).getUint32(0);
  waiting.get(seq)?.();
};
const ping = (seq) =>
  new Promise((resolve, reject) => {
    const start = performance.now();
    const timer = setTimeout(() => reject(new Error(`ping ${seq} timed out`)), 3000);
    waiting.set(seq, () => {
      clearTimeout(timer);
      resolve(performance.now() - start);
    });
    const msg = new Uint8Array([MESSAGE_PING, 4, 0, 0, 0, 0]);
    new DataView(msg.buffer).setUint32(2, seq);
    provider.ws.send(msg);
  });

await new Promise((resolve) => provider.once("sync", resolve));
try {
  const times = [];
  for (let seq = 1; seq <= PINGS; seq++) times.push(await ping(seq * 1000003));
  console.log(`ok  ${PINGS} pings echoed: ${times.map((t) => t.toFixed(1)).join(", ")} ms`);
  process.exit(0);
} catch (err) {
  console.error(`FAIL  ${err.message}`);
  process.exit(1);
} finally {
  provider.destroy();
}
