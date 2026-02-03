<<<<<<< HEAD
import { type MainTask, ok, testCreateConsole } from "@evolu/common";
=======
import { testCreateConsole } from "@evolu/common";
>>>>>>> upstream/common-v8
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRunner } from "../src/Task.js";

<<<<<<< HEAD
/**
 * Helper function to create a deferred promise (similar to Promise.withResolvers).
 * This is needed for compatibility with environments that don't support Promise.withResolvers.
 */
const withResolvers = <T>(): {
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

describe("runMain", () => {
=======
describe("createRunner", () => {
>>>>>>> upstream/common-v8
  beforeEach(() => {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGHUP");
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("SIGHUP");
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    process.exitCode = undefined;
  });

<<<<<<< HEAD
  test("executes main task", async () => {
    let called = false;
    const executed = withResolvers<void>();

    runMain({})(() => {
      called = true;
      executed.resolve();
      return ok(undefined);
    });
=======
  test("provides shutdown in deps", async () => {
    await using run = createRunner();

    expect(run.deps.shutdown).toBeInstanceOf(Promise);
  });

  test("shutdown resolves on SIGINT", async () => {
    await using run = createRunner();

    const shutdownResolved = Promise.withResolvers<boolean>();
    void run.deps.shutdown.then(() => shutdownResolved.resolve(true));
>>>>>>> upstream/common-v8

    process.emit("SIGINT");

    expect(await shutdownResolved.promise).toBe(true);
  });

<<<<<<< HEAD
  test("passes custom deps", async () => {
    const depsValue = withResolvers<number>();
    const customDep = { myValue: 42 };
=======
  test("shutdown resolves on SIGTERM", async () => {
    await using run = createRunner();
>>>>>>> upstream/common-v8

    const shutdownResolved = Promise.withResolvers<boolean>();
    void run.deps.shutdown.then(() => shutdownResolved.resolve(true));

<<<<<<< HEAD
    const main: MainTask<MyDep> = (run) => {
      const { myValue } = run.deps;
      depsValue.resolve(myValue);
      return ok(undefined);
    };

    runMain(customDep)(main);

    expect(await depsValue.promise).toBe(42);
    process.emit("SIGINT");
  });

  test("handles aborted runner", async () => {
    let taskRan = false;
    const taskCompleted = withResolvers<void>();

    runMain({})(async (run) => {
      taskRan = true;
      // Dispose the runner, which triggers abort
      await run[Symbol.asyncDispose]();
      taskCompleted.resolve();
      return ok(undefined);
    });

    await taskCompleted.promise;
    expect(taskRan).toBe(true);
    // No need to emit signal - the runMain should still complete
    // because it waits for the callback which gets aborted
  });

  test("disposes returned Disposable after signal", async () => {
    let disposed = false;
    const taskStarted = withResolvers<void>();
    const disposeCalled = withResolvers<void>();

    runMain({})(() => {
      taskStarted.resolve();
      return ok({
        [Symbol.dispose]: () => {
          disposed = true;
          disposeCalled.resolve();
        },
      });
    });

    await taskStarted.promise;
    await new Promise((r) => setTimeout(r, 10));
    process.emit("SIGINT");
    await disposeCalled.promise;
    expect(disposed).toBe(true);
  });

  test("disposes returned AsyncDisposable after signal", async () => {
    let disposed = false;
    const taskStarted = withResolvers<void>();
    const disposeCalled = withResolvers<void>();

    runMain({})(() => {
      taskStarted.resolve();
      return ok({
        // eslint-disable-next-line @typescript-eslint/require-await
        [Symbol.asyncDispose]: async () => {
          disposed = true;
          disposeCalled.resolve();
        },
      });
    });

    await taskStarted.promise;
    await new Promise((r) => setTimeout(r, 10));
    process.emit("SIGINT");
    await disposeCalled.promise;
    expect(disposed).toBe(true);
  });

  test("handles void return without disposal", async () => {
    let called = false;
    const taskStarted = withResolvers<void>();

    runMain({})(() => {
      called = true;
      taskStarted.resolve();
      return ok(undefined);
    });

    await taskStarted.promise;
    expect(called).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    process.emit("SIGINT");
  });

  test("responds to SIGTERM", async () => {
    let disposed = false;
    const taskStarted = withResolvers<void>();
    const disposeCalled = withResolvers<void>();

    runMain({})(() => {
      taskStarted.resolve();
      return ok({
        [Symbol.dispose]: () => {
          disposed = true;
          disposeCalled.resolve();
        },
      });
    });

    await taskStarted.promise;
    await new Promise((r) => setTimeout(r, 10));
=======
>>>>>>> upstream/common-v8
    process.emit("SIGTERM");

    expect(await shutdownResolved.promise).toBe(true);
  });

<<<<<<< HEAD
  test("responds to SIGHUP", async () => {
    let disposed = false;
    const taskStarted = withResolvers<void>();
    const disposeCalled = withResolvers<void>();
=======
  test("shutdown resolves on SIGHUP", async () => {
    await using run = createRunner();
>>>>>>> upstream/common-v8

    const shutdownResolved = Promise.withResolvers<boolean>();
    void run.deps.shutdown.then(() => shutdownResolved.resolve(true));

    process.emit("SIGHUP");

    expect(await shutdownResolved.promise).toBe(true);
  });

<<<<<<< HEAD
  test("cleans up signal listeners after signal", async () => {
    const taskCompleted = withResolvers<void>();
    const initialSigintCount = process.listenerCount("SIGINT");

    runMain({})(() =>
      ok({
        [Symbol.asyncDispose]: async () => {
          await Promise.resolve();
          taskCompleted.resolve();
        },
      }),
    );

    await new Promise((r) => setTimeout(r, 10));

    expect(process.listenerCount("SIGINT")).toBeGreaterThan(initialSigintCount);

    process.emit("SIGINT");
    await taskCompleted.promise;

    await new Promise((r) => setTimeout(r, 10));

    expect(process.listenerCount("SIGINT")).toBe(initialSigintCount);
  });

  test("sets exitCode to 1 on uncaughtException", async () => {
    const disposed = withResolvers<void>();
    const taskStarted = withResolvers<void>();
=======
  test("logs error and resolves shutdown on uncaughtException", async () => {
>>>>>>> upstream/common-v8
    const console = testCreateConsole();
    const run = createRunner({ console });

    // In real code, an uncaught throw triggers this event.
    // We emit directly because test frameworks catch throws.
    process.emit("uncaughtException", new Error("test uncaught"));

    expect(process.exitCode).toBe(1);
    const entries = console.getEntriesSnapshot();
    expect(entries.length).toBe(1);
    expect(entries[0].method).toBe("error");
    expect(entries[0].args[0]).toBe("uncaughtException");
    expect(entries[0].args[1]).toEqual({
      type: "UnknownError",
      error: expect.objectContaining({ message: "test uncaught" }),
    });

    // Shutdown is resolved so await run.deps.shutdown unblocks
    await run.deps.shutdown;

    // Clean up
    await run[Symbol.asyncDispose]();
  });

<<<<<<< HEAD
  test("sets exitCode to 1 on unhandledRejection", async () => {
    const disposed = withResolvers<void>();
    const taskStarted = withResolvers<void>();
=======
  test("logs error and resolves shutdown on unhandledRejection", async () => {
>>>>>>> upstream/common-v8
    const console = testCreateConsole();
    const run = createRunner({ console });

    process.emit(
      "unhandledRejection",
      new Error("test rejection"),
      Promise.resolve(),
    );

    expect(process.exitCode).toBe(1);
    const entries = console.getEntriesSnapshot();
    expect(entries.length).toBe(1);
    expect(entries[0].method).toBe("error");
    expect(entries[0].args[0]).toBe("unhandledRejection");
    expect(entries[0].args[1]).toEqual({
      type: "UnknownError",
      error: expect.objectContaining({ message: "test rejection" }),
    });

    // Shutdown is resolved so await run.deps.shutdown unblocks
    await run.deps.shutdown;

    // Clean up
    await run[Symbol.asyncDispose]();
  });

  test("cleans up listeners on dispose", async () => {
    const initialListeners = {
      SIGINT: process.listenerCount("SIGINT"),
      SIGTERM: process.listenerCount("SIGTERM"),
      SIGHUP: process.listenerCount("SIGHUP"),
      uncaughtException: process.listenerCount("uncaughtException"),
      unhandledRejection: process.listenerCount("unhandledRejection"),
    };

    {
      await using _run = createRunner();

      expect(process.listenerCount("SIGINT")).toBe(initialListeners.SIGINT + 1);
      expect(process.listenerCount("SIGTERM")).toBe(
        initialListeners.SIGTERM + 1,
      );
      expect(process.listenerCount("SIGHUP")).toBe(initialListeners.SIGHUP + 1);
      expect(process.listenerCount("uncaughtException")).toBe(
        initialListeners.uncaughtException + 1,
      );
      expect(process.listenerCount("unhandledRejection")).toBe(
        initialListeners.unhandledRejection + 1,
      );
    }

    expect(process.listenerCount("SIGINT")).toBe(initialListeners.SIGINT);
    expect(process.listenerCount("SIGTERM")).toBe(initialListeners.SIGTERM);
    expect(process.listenerCount("SIGHUP")).toBe(initialListeners.SIGHUP);
    expect(process.listenerCount("uncaughtException")).toBe(
      initialListeners.uncaughtException,
    );
    expect(process.listenerCount("unhandledRejection")).toBe(
      initialListeners.unhandledRejection,
    );
  });

  test("merges custom deps", async () => {
    interface CustomDep {
      readonly customValue: number;
    }

    await using run = createRunner<CustomDep>({ customValue: 42 });

    expect(run.deps.customValue).toBe(42);
    expect(run.deps.shutdown).toBeInstanceOf(Promise);
  });
});
