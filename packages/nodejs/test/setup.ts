// Polyfill WebSocket for Node.js tests
// The @evolu/common package accesses globalThis.WebSocket at import time
import { WebSocket } from "ws";

if (!globalThis.WebSocket) {
  // @ts-expect-error - ws WebSocket is compatible enough for our needs
  globalThis.WebSocket = WebSocket;
}
