// Polyfills for Node.js test environment
// The @evolu/common package uses ES2024 features and WebSocket that aren't available in Node.js

// Polyfill WebSocket for Node.js tests
// Import WebSocket from 'ws' package
import { WebSocket } from "ws";

if (!globalThis.WebSocket) {
  // @ts-expect-error - ws WebSocket is compatible enough for our needs
  globalThis.WebSocket = WebSocket;
}

// Polyfill Promise.try for Node.js/Bun versions that don't support it (ES2024)
if (!Promise.try) {
  // @ts-ignore - Adding ES2024 Promise.try polyfill
  Promise.try = function <T, Args extends readonly unknown[]>(
    callback: (...args: Args) => T | PromiseLike<T>,
    ...args: Args
  ): Promise<T> {
    return Promise.resolve().then(() => callback(...args));
  };
}

// Polyfill Promise.withResolvers for Node.js/Bun versions that don't support it (ES2024)
if (!Promise.withResolvers) {
  // @ts-ignore - Adding ES2024 Promise.withResolvers polyfill
  Promise.withResolvers = function <T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
