export const env = {
  /** Base URL of the board WebSocket endpoint; the board id is appended as a path segment. */
  wsUrl: process.env.NEXT_PUBLIC_TACK_WS_URL ?? "ws://localhost:8080/ws/boards",
  apiUrl: process.env.NEXT_PUBLIC_TACK_API_URL ?? "http://localhost:8080",
};
