// Polyfill WebSocket for Node.js tests
// The @evolu/common package accesses globalThis.WebSocket at import time
import { WebSocket } from "ws";

if (!globalThis.WebSocket) {
  // @ts-expect-error - ws WebSocket is compatible enough for our needs
  globalThis.WebSocket = WebSocket;
}

// Polyfill Promise.try for Node.js/Bun versions that don't support it (ES2024)
// The @evolu/common package uses Promise.try in Task.ts
if (!Promise.try) {
  // @ts-expect-error - Adding ES2024 Promise.try polyfill
  Promise.try = function <T, Args extends readonly unknown[]>(
    callback: (...args: Args) => T | PromiseLike<T>,
    ...args: Args
  ): Promise<T> {
    return Promise.resolve().then(() => callback(...args));
  };
}


