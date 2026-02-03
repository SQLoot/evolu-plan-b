// Polyfills for Node.js test environment
// The @evolu/common package uses ES2024+ features

// Polyfill Promise.try for Node.js/Bun versions that don't support it (ES2024)
// The @evolu/common package uses Promise.try in Task.ts
if (!Promise.try) {
  // @ts-ignore - Adding ES2024 Promise.try polyfill
  Promise.try = function <T, Args extends readonly unknown[]>(
    callback: (...args: Args) => T | PromiseLike<T>,
    ...args: Args
  ): Promise<T> {
    return Promise.resolve().then(() => callback(...args));
  };
}

// Polyfill WebSocket for Node.js tests
// IMPORTANT: Import WebSocket AFTER other polyfills to avoid circular dependency issues
import { WebSocket } from "ws";

if (!globalThis.WebSocket) {
  // @ts-expect-error - ws WebSocket is compatible enough for our needs
  globalThis.WebSocket = WebSocket;
}

