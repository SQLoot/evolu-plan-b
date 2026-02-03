// Polyfills for Node.js test environment
// The @evolu/common package uses ES2024+ features that aren't available in Node.js

// IMPORTANT: Install polyfills FIRST before any other imports
// This provides AsyncDisposableStack, DisposableStack, Symbol.dispose, etc.
import { installPolyfills } from "../src/Polyfills.js";
installPolyfills();

// Polyfill WebSocket for Node.js tests (after polyfills are installed)
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

// Polyfill Set.prototype.difference for Node.js/Bun (ES2025)
if (!Set.prototype.difference) {
  // @ts-ignore - Adding ES2025 Set.prototype.difference polyfill
  Set.prototype.difference = function <T>(this: Set<T>, other: Set<T>): Set<T> {
    const result = new Set(this);
    for (const elem of other) {
      result.delete(elem);
    }
    return result;
  };
}

