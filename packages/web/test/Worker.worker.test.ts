import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initEvoluWorker: vi.fn(),
  createSharedWorkerScope: vi.fn(),
  createWorkerRun: vi.fn(),
  runWebDbWorkerPort: vi.fn(),
}));

vi.mock("@evolu/common/local-first", () => ({
  initEvoluWorker: mocks.initEvoluWorker,
}));

vi.mock("../src/Worker.js", () => ({
  createSharedWorkerScope: mocks.createSharedWorkerScope,
  createWorkerRun: mocks.createWorkerRun,
}));

vi.mock("../src/local-first/DbWorker.js", () => ({
  runWebDbWorkerPort: mocks.runWebDbWorkerPort,
}));

const importWorkerModule = async (id: "a" | "b") => {
  if (id === "a") {
    return import("../src/local-first/Worker.worker.ts?worker-worker-test-a");
  }
  return import("../src/local-first/Worker.worker.ts?worker-worker-test-b");
};

describe("Worker.worker bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.initEvoluWorker.mockReset();
    mocks.createSharedWorkerScope.mockReset();
    mocks.createWorkerRun.mockReset();
    mocks.runWebDbWorkerPort.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("creates run with db worker dep and initializes shared worker scope", async () => {
    const disposeSymbol =
      (Symbol as typeof Symbol & { dispose?: symbol }).dispose ??
      Symbol.for("Symbol.dispose");
    const asyncDisposeSymbol =
      (Symbol as typeof Symbol & { asyncDispose?: symbol }).asyncDispose ??
      Symbol.for("Symbol.asyncDispose");

    const fakeSelf = { kind: "shared-worker-self" };
    vi.stubGlobal("self", fakeSelf as unknown as typeof globalThis.self);

    const scope = { kind: "scope" };
    const initTask = { kind: "init-task" };
    const run = vi.fn(async () => undefined);
    const disposeRun = vi.fn(async () => undefined);
    const disposeBaseRun = vi.fn(async () => undefined);
    const addDeps = vi.fn(() => {
      Object.assign(run, {
        [disposeSymbol]: disposeRun,
        [asyncDisposeSymbol]: disposeRun,
      });
      return run;
    });
    const baseRun = {
      addDeps,
      [disposeSymbol]: disposeBaseRun,
      [asyncDisposeSymbol]: disposeBaseRun,
    };

    mocks.createWorkerRun.mockReturnValue(baseRun);
    mocks.createSharedWorkerScope.mockReturnValue(scope);
    mocks.initEvoluWorker.mockReturnValue(initTask);

    await importWorkerModule("a");

    expect(mocks.createWorkerRun).toHaveBeenCalledTimes(1);
    expect(addDeps).toHaveBeenCalledWith({
      runDbWorkerPort: mocks.runWebDbWorkerPort,
    });
    expect(mocks.createSharedWorkerScope).toHaveBeenCalledWith(fakeSelf);
    expect(mocks.initEvoluWorker).toHaveBeenCalledWith(scope);
    expect(run).toHaveBeenCalledWith(initTask);
    expect(disposeBaseRun).toHaveBeenCalledTimes(1);
    expect(disposeRun).not.toHaveBeenCalled();
  });

  test("disposes base run even when worker init task rejects", async () => {
    const disposeSymbol =
      (Symbol as typeof Symbol & { dispose?: symbol }).dispose ??
      Symbol.for("Symbol.dispose");
    const asyncDisposeSymbol =
      (Symbol as typeof Symbol & { asyncDispose?: symbol }).asyncDispose ??
      Symbol.for("Symbol.asyncDispose");

    const fakeSelf = { kind: "shared-worker-self" };
    vi.stubGlobal("self", fakeSelf as unknown as typeof globalThis.self);

    const scope = { kind: "scope" };
    const initTask = { kind: "init-task" };
    const run = vi.fn(async () => {
      throw new Error("worker init failed");
    });
    const disposeBaseRun = vi.fn(async () => undefined);
    const baseRun = {
      addDeps: vi.fn(() => run),
      [disposeSymbol]: disposeBaseRun,
      [asyncDisposeSymbol]: disposeBaseRun,
    };

    mocks.createWorkerRun.mockReturnValue(baseRun);
    mocks.createSharedWorkerScope.mockReturnValue(scope);
    mocks.initEvoluWorker.mockReturnValue(initTask);

    await expect(importWorkerModule("b")).rejects.toThrow("worker init failed");
    expect(disposeBaseRun).toHaveBeenCalledTimes(1);
  });
});
