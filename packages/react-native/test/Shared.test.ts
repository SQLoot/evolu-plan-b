import { describe, expect, test, vi } from "vitest";
import { createEvoluDeps, createSharedLocalAuth } from "../src/shared.js";

const mocks = vi.hoisted(() => {
  const workerRun = vi.fn();
  return {
    createCommonEvoluDeps: vi.fn((deps) => deps),
    createConsoleStoreOutput: vi.fn(() => ({ entry: "console-entry" })),
    createInMemoryLeaderLock: vi.fn(() => "leader-lock"),
    createLocalAuth: vi.fn((deps) => ({ kind: "local-auth", deps })),
    createMessageChannel: vi.fn(() => "message-channel"),
    createMessagePort: vi.fn(() => "message-port"),
    createRandomBytes: vi.fn(() => "random-bytes"),
    createRun: vi.fn(() => workerRun),
    createSharedWorker: vi.fn((init) => {
      init({ kind: "shared-self" } as any);
      return { kind: "shared-worker" };
    }),
    createWorker: vi.fn((init) => {
      init({ kind: "db-self" } as any);
      return { kind: "db-worker" };
    }),
    initDbWorker: vi.fn((self) => ({ kind: "db-task", self })),
    initSharedWorker: vi.fn((self) => ({ kind: "shared-task", self })),
    workerRun,
  };
});

vi.mock("@evolu/common", () => ({
  createConsoleStoreOutput: mocks.createConsoleStoreOutput,
  createInMemoryLeaderLock: mocks.createInMemoryLeaderLock,
  createLocalAuth: mocks.createLocalAuth,
  createRandomBytes: mocks.createRandomBytes,
  createRun: mocks.createRun,
}));

vi.mock("@evolu/common/local-first", () => ({
  createEvoluDeps: mocks.createCommonEvoluDeps,
  initDbWorker: mocks.initDbWorker,
  initSharedWorker: mocks.initSharedWorker,
}));

vi.mock("../src/Worker.js", () => ({
  createMessageChannel: mocks.createMessageChannel,
  createMessagePort: mocks.createMessagePort,
  createSharedWorker: mocks.createSharedWorker,
  createWorker: mocks.createWorker,
}));

describe("shared react-native deps", () => {
  test("createEvoluDeps wires worker bootstrap through common deps", () => {
    const reloadApp = vi.fn();
    const createSqliteDriver = vi.fn() as any;

    const deps = createEvoluDeps({ createSqliteDriver, reloadApp } as any);
    const dbWorker = (deps as any).createDbWorker();

    expect(dbWorker).toEqual({ kind: "db-worker" });
    expect(mocks.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        consoleStoreOutputEntry: "console-entry",
        createMessagePort: mocks.createMessagePort,
        createSqliteDriver,
        leaderLock: "leader-lock",
      }),
    );
    expect(mocks.initSharedWorker).toHaveBeenCalledWith({
      kind: "shared-self",
    });
    expect(mocks.initDbWorker).toHaveBeenCalledWith({ kind: "db-self" });
    expect(mocks.workerRun).toHaveBeenCalledWith({
      kind: "shared-task",
      self: { kind: "shared-self" },
    });
    expect(mocks.workerRun).toHaveBeenCalledWith({
      kind: "db-task",
      self: { kind: "db-self" },
    });
    expect(mocks.createCommonEvoluDeps).toHaveBeenCalledWith(
      expect.objectContaining({
        createDbWorker: expect.any(Function),
        createMessageChannel: mocks.createMessageChannel,
        reloadApp,
        sharedWorker: { kind: "shared-worker" },
      }),
    );
  });

  test("createSharedLocalAuth passes random bytes and secure storage", () => {
    const secureStorage = { getItem: vi.fn() } as any;
    const localAuth = createSharedLocalAuth(secureStorage);

    expect(localAuth).toEqual({
      kind: "local-auth",
      deps: {
        randomBytes: "random-bytes",
        secureStorage,
      },
    });
  });
});
