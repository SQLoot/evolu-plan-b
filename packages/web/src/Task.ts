/**
 * Web platform-specific Task utilities.
 *
 * @module
 */

import {
  createInMemoryLeaderLock,
  createRun as createCommonRun,
  createUnknownError,
  ok,
  type CreateRun,
  type LeaderLock,
  type Run,
  type RunDeps,
  unabortable,
} from "@evolu/common";

const inMemoryLeaderLock = createInMemoryLeaderLock();

const createLeaseRelease = () => {
  const release = Promise.withResolvers<void>();
  let isResolved = false;
  return {
    promise: release.promise,
    resolve: () => {
      if (isResolved) return;
      isResolved = true;
      release.resolve();
    },
  };
};

/**
 * Creates a {@link LeaderLock} backed by the Web Locks API.
 *
 * Waiting for the web platform lock is intentionally unabortable. If a caller starts
 * waiting and its {@link Run} or fiber is later aborted, the underlying Web
 * Locks request keeps waiting until the browser grants the lock. Only the
 * returned lease releases it.
 */
export const createLeaderLock = (): LeaderLock => ({
  lock: (name) => async (run) => {
    const locks = globalThis.navigator?.locks;
    if (!locks) return run(unabortable(inMemoryLeaderLock.lock(name)));

    const acquired = Promise.withResolvers<void>();
    const requestFailed = Promise.withResolvers<void>();
    const release = createLeaseRelease();

    let request: Promise<unknown>;
    try {
      request = locks.request(`evolu-leaderlock-${name}`, { mode: "exclusive" }, async () => {
        acquired.resolve();
        await release.promise;
      });
    } catch {
      return run(unabortable(inMemoryLeaderLock.lock(name)));
    }

    void request.catch(() => {
      requestFailed.resolve();
    });

    const state = await Promise.race([
      acquired.promise.then(() => "acquired" as const),
      requestFailed.promise.then(() => "failed" as const),
    ]);

    if (state === "failed") {
      release.resolve();
      return run(unabortable(inMemoryLeaderLock.lock(name)));
    }


    return ok({
      [Symbol.asyncDispose]: async () => {
        release.resolve();
        return Promise.resolve();
      },
    });
  },
});

/**
 * Creates {@link Run} for the web platform with global error handling.
 *
 * Registers `error` and `unhandledrejection` handlers that log errors to the
 * console. Handlers are removed when the Run is disposed.
 *
 * ### Example
 *
 * ```ts
 * const console = createConsole({
 *   formatter: createConsoleFormatter()({
 *     timestampFormat: "relative",
 *   }),
 * });
 *
 * await using run = createRun({ console });
 * await using stack = new AsyncDisposableStack();
 *
 * stack.use(await run.orThrow(startApp()));
 * ```
 */
export const createRun: CreateRun<RunDeps> = <D>(
  deps?: D,
): Run<RunDeps & D> => {
  const run = createCommonRun(deps);
  const console = run.deps.console.child("global");

  globalThis.addEventListener(
    "error",
    (event) => {
      console.error("error", createUnknownError(event.error));
    },
    { signal: run.signal },
  );

  globalThis.addEventListener(
    "unhandledrejection",
    (event) => {
      console.error("unhandledrejection", createUnknownError(event.reason));
    },
    { signal: run.signal },
  );

  return run;
};

/**
 * @deprecated Use {@link createRun}. Kept for fork compatibility.
 */
export const createRunner: typeof createRun = createRun;
