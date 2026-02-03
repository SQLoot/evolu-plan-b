// Polyfills for Node.js test environment
// The @evolu/common package uses ES2024+ features that aren't available in Node.js

// IMPORTANT: Install polyfills FIRST before any other imports
// This provides AsyncDisposableStack, DisposableStack, Symbol.dispose, etc.
import { installPolyfills } from "../src/Polyfills.js";

installPolyfills();

// Polyfill WebSocket for Node.js tests (after polyfills are installed)
import { WebSocket } from "ws";

if (!globalThis.WebSocket) {
  (globalThis as any).WebSocket = WebSocket;
}

// Polyfill Promise.try for Node.js/Bun versions that don't support it (ES2024)
if (!Promise.try) {
  (Promise as any).try = <T, Args extends readonly unknown[]>(
    callback: (...args: Args) => T | PromiseLike<T>,
    ...args: Args
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      try {
        resolve((callback as any)(...args));
      } catch (err) {
        reject(err);
      }
    });
}

// Polyfill Promise.withResolvers for Node.js/Bun versions that don't support it (ES2024)
if (!Promise.withResolvers) {
  (Promise as any).withResolvers = <T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } => {
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
if (!(Set.prototype as any).difference) {
  (Set.prototype as any).difference = function <T>(
    this: Set<T>,
    other: Set<T>,
  ): Set<T> {
    const result = new Set(this);
    for (const elem of other) {
      result.delete(elem);
    }
    return result;
  };
}
