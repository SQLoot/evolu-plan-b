/**
 * Browser-specific Task utilities.
 *
 * @module
 */

import {
  type CreateRunner,
  createRun as createCommonRun,
  createInMemoryLeaderLock,
  createUnknownError,
  type LeaderLock,
  ok,
  type Run,
  type RunDeps,
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

/** Creates a {@link LeaderLock} backed by the Web Locks API. */
export const createLeaderLock = (): LeaderLock => ({
  acquire: (name) => async (run) => {
    const locks = globalThis.navigator?.locks;
    if (!locks) return run(inMemoryLeaderLock.acquire(name));

    const acquired = Promise.withResolvers<void>();
    const requestFailed = Promise.withResolvers<void>();
    const release = createLeaseRelease();

    run.onAbort(release.resolve);

    let request: Promise<unknown>;
    try {
      request = locks.request(
        `evolu-leaderlock-${name}`,
        { mode: "exclusive", signal: run.signal },
        async () => {
          acquired.resolve();
          await release.promise;
        },
      );
    } catch {
      return run(inMemoryLeaderLock.acquire(name));
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
      return run(inMemoryLeaderLock.acquire(name));
    }

    return ok({
      [Symbol.dispose]: release.resolve,
    });
  },
});

/**
 * Creates {@link Run} for the browser with global error handling.
 *
 * Registers `error` and `unhandledrejection` handlers that log errors to the
 * console. Handlers are removed when the run is disposed.
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
 * await using stack = run.stack();
 *
 * await stack.use(startApp());
 * ```
 *
 * @group Browser Runner
 */
export const createRun: CreateRunner<RunDeps> = <D>(
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
 * @deprecated Use {@link createRun}.
 */
export const createRunner = createRun;
