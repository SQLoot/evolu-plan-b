import { afterEach, describe, expect, test, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  reload: vi.fn(),
  sensitiveInfo: { kind: "sensitive-info" },
}));

vi.mock("react-native", () => ({
  DevSettings: { reload: nativeMocks.reload },
}));

vi.mock("react-native-sensitive-info", () => ({
  SensitiveInfo: nativeMocks.sensitiveInfo,
}));

const reset = () => {
  vi.clearAllMocks();
  vi.resetModules();
};

afterEach(() => {
  process.env.NODE_ENV = "test";
  reset();
});

describe("react-native export entrypoints", () => {
  test("expo-sqlite entrypoint wires createEvoluDeps and createExpoDeps", async () => {
    const reloadAppAsync = vi.fn(async () => undefined);
    const createSharedEvoluDeps = vi.fn((deps) => deps);
    const createExpoDeps = vi.fn(() => ({
      evoluReactNativeDeps: { kind: "expo-react-native-deps" },
      localAuth: { kind: "expo-local-auth" },
    }));
    const createExpoSqliteDriver = vi.fn();

    vi.doMock("expo", () => ({ reloadAppAsync }));
    vi.doMock("../src/shared.js", () => ({
      createEvoluDeps: createSharedEvoluDeps,
    }));
    vi.doMock("../src/createExpoDeps.js", () => ({
      createExpoDeps,
    }));
    vi.doMock("../src/sqlite-drivers/createExpoSqliteDriver.js", () => ({
      createExpoSqliteDriver,
    }));

    const mod = await import("../src/exports/expo-sqlite.js");

    expect(createExpoDeps).toHaveBeenCalledWith({
      createSqliteDriver: createExpoSqliteDriver,
    });
    expect(mod.evoluReactNativeDeps).toEqual({
      kind: "expo-react-native-deps",
    });
    expect(mod.localAuth).toEqual({ kind: "expo-local-auth" });

    const deps = mod.createEvoluDeps();
    deps.reloadApp();

    expect(createSharedEvoluDeps).toHaveBeenCalledWith({
      createSqliteDriver: createExpoSqliteDriver,
      reloadApp: expect.any(Function),
    });
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
  });

  test("expo-op-sqlite entrypoint delegates to createExpoDeps", async () => {
    const createExpoDeps = vi.fn(() => ({
      evoluReactNativeDeps: { kind: "expo-op-deps" },
      localAuth: { kind: "expo-op-auth" },
    }));
    const createOpSqliteDriver = vi.fn();

    vi.doMock("../src/createExpoDeps.js", () => ({
      createExpoDeps,
    }));
    vi.doMock("../src/sqlite-drivers/createOpSqliteDriver.js", () => ({
      createOpSqliteDriver,
    }));

    const mod = await import("../src/exports/expo-op-sqlite.js");

    expect(createExpoDeps).toHaveBeenCalledWith({
      createSqliteDriver: createOpSqliteDriver,
    });
    expect(mod.evoluReactNativeDeps).toEqual({ kind: "expo-op-deps" });
    expect(mod.localAuth).toEqual({ kind: "expo-op-auth" });
  });

  test("bare-op-sqlite entrypoint reloads only in development", async () => {
    nativeMocks.reload.mockClear();
    const createEvoluDeps = vi.fn((deps) => deps);
    const createSharedLocalAuth = vi.fn(() => ({ kind: "bare-auth" }));
    const createOpSqliteDriver = vi.fn();

    vi.doMock("../src/shared.js", () => ({
      createEvoluDeps,
      createSharedLocalAuth,
    }));
    vi.doMock("../src/sqlite-drivers/createOpSqliteDriver.js", () => ({
      createOpSqliteDriver,
    }));

    process.env.NODE_ENV = "development";
    const devModule = await import("../src/exports/bare-op-sqlite.js");
    devModule.evoluReactNativeDeps.reloadApp();
    expect(nativeMocks.reload).toHaveBeenCalledTimes(1);
    expect(createEvoluDeps).toHaveBeenCalledWith({
      createSqliteDriver: createOpSqliteDriver,
      reloadApp: expect.any(Function),
    });
    expect(createSharedLocalAuth).toHaveBeenCalledWith({
      kind: "sensitive-info",
    });
    expect(devModule.localAuth).toEqual({ kind: "bare-auth" });

    const previousReloadCalls = nativeMocks.reload.mock.calls.length;
    vi.resetModules();
    vi.doMock("../src/shared.js", () => ({
      createEvoluDeps: vi.fn((deps) => deps),
      createSharedLocalAuth: vi.fn(() => ({ kind: "bare-auth" })),
    }));
    vi.doMock("../src/sqlite-drivers/createOpSqliteDriver.js", () => ({
      createOpSqliteDriver,
    }));

    process.env.NODE_ENV = "production";
    const prodModule = await import("../src/exports/bare-op-sqlite.js");
    prodModule.evoluReactNativeDeps.reloadApp();
    expect(nativeMocks.reload).toHaveBeenCalledTimes(previousReloadCalls);
  });
});
