// Polyfills for Node.js test environment
// The @evolu/common package uses ES2024+ features

// Polyfill Promise.try for Node.js/Bun versions that don't support it (ES2024)
// The @evolu/common package uses Promise.try in Task.ts
if (!(Promise as any).try) {
  (Promise as any).try = <T, Args extends readonly unknown[]>(
    callback: (...args: Args) => T | PromiseLike<T>,
    ...args: Args
  ): Promise<T> => new Promise((resolve) => resolve(callback(...args)));
}

// Polyfill WebSocket for Node.js tests
// IMPORTANT: Import WebSocket AFTER other polyfills to avoid circular dependency issues
import { WebSocket } from "ws";

if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}
