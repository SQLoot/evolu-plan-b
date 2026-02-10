/**
 * Browser-specific Task utilities.
 *
 * @module
 */

import {
  type CreateRunner,
  createRun as createCommonRun,
  createUnknownError,
  type Run,
  type RunDeps,
} from "@evolu/common";

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
