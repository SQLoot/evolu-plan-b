import { testCreateConsole } from "@evolu/common";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createWorker: vi.fn(),
  createSharedWorker: vi.fn(),
  createMessageChannel: vi.fn(),
  reloadApp: vi.fn(),
  createCommonEvoluDeps: vi.fn(),
}));

vi.mock("../src/Worker.js", () => ({
  createWorker: mocks.createWorker,
  createSharedWorker: mocks.createSharedWorker,
  createMessageChannel: mocks.createMessageChannel,
}));

vi.mock("../src/Platform.js", () => ({
  reloadApp: mocks.reloadApp,
}));

vi.mock("@evolu/common/local-first", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@evolu/common/local-first")>();
  return {
    ...actual,
    createEvoluDeps: mocks.createCommonEvoluDeps,
  };
});

import { createEvoluDeps } from "../src/local-first/Evolu.js";

class MockWorker {
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {}
}

class MockSharedWorker {
  readonly port = {
    postMessage: vi.fn(),
    onMessage: null,
    native: null,
    [Symbol.dispose]: vi.fn(),
  };

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {}
}

describe("createEvoluDeps (web)", () => {
  beforeEach(() => {
    mocks.createWorker.mockReset();
    mocks.createSharedWorker.mockReset();
    mocks.createMessageChannel.mockReset();
    mocks.reloadApp.mockReset();
    mocks.createCommonEvoluDeps.mockReset();

    mocks.createCommonEvoluDeps.mockImplementation((deps) => deps);

    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
    vi.stubGlobal(
      "SharedWorker",
      MockSharedWorker as unknown as typeof SharedWorker,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("wires worker deps and shared worker into common createEvoluDeps", () => {
    const console = testCreateConsole();
    const wrappedSharedWorker = {
      port: {
        postMessage: vi.fn(),
        onMessage: null,
        native: null,
        [Symbol.dispose]: vi.fn(),
      },
      [Symbol.dispose]: vi.fn(),
    };
    const wrappedDbWorker = {
      postMessage: vi.fn(),
      onMessage: null,
      native: null,
      [Symbol.dispose]: vi.fn(),
    };
    mocks.createSharedWorker.mockReturnValue(wrappedSharedWorker);
    mocks.createWorker.mockReturnValue(wrappedDbWorker);

    const result = createEvoluDeps({ console });

    expect(mocks.createSharedWorker).toHaveBeenCalledTimes(1);
    const sharedWorkerNative = mocks.createSharedWorker.mock.calls[0]?.[0];
    expect(sharedWorkerNative).toBeInstanceOf(MockSharedWorker);
    expect(String((sharedWorkerNative as MockSharedWorker).url)).toContain(
      "Shared.worker.js",
    );
    expect((sharedWorkerNative as MockSharedWorker).options).toEqual({
      type: "module",
    });

    expect(mocks.createCommonEvoluDeps).toHaveBeenCalledTimes(1);
    const passed = mocks.createCommonEvoluDeps.mock.calls[0]?.[0] as {
      readonly console: unknown;
      readonly createDbWorker: () => unknown;
      readonly createMessageChannel: unknown;
      readonly reloadApp: unknown;
      readonly sharedWorker: unknown;
    };

    expect(passed.console).toBe(console);
    expect(passed.createMessageChannel).toBe(mocks.createMessageChannel);
    expect(passed.reloadApp).toBe(mocks.reloadApp);
    expect(passed.sharedWorker).toBe(wrappedSharedWorker);

    const dbWorker = passed.createDbWorker();
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    const dbWorkerNative = mocks.createWorker.mock.calls[0]?.[0];
    expect(dbWorkerNative).toBeInstanceOf(MockWorker);
    expect(String((dbWorkerNative as MockWorker).url)).toContain("Db.worker.js");
    expect((dbWorkerNative as MockWorker).options).toEqual({ type: "module" });
    expect(dbWorker).toBe(wrappedDbWorker);
    expect(result).toBe(passed);
  });

  test("supports default deps argument", () => {
    const result = createEvoluDeps();
    const passed = mocks.createCommonEvoluDeps.mock.calls[0]?.[0] as {
      readonly createDbWorker: () => unknown;
      readonly createMessageChannel: unknown;
      readonly reloadApp: unknown;
    };

    expect(typeof passed.createDbWorker).toBe("function");
    expect(passed.createMessageChannel).toBe(mocks.createMessageChannel);
    expect(passed.reloadApp).toBe(mocks.reloadApp);
    expect(result).toBe(passed);
  });
});
