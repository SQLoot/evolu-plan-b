import { localAuthDefaultOptions } from "@evolu/common";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { createExpoDeps } from "../src/createExpoDeps.js";

const mocks = vi.hoisted(() => ({
  createSharedEvoluDeps: vi.fn((deps) => deps),
  createSharedLocalAuth: vi.fn((secureStorage) => ({ secureStorage })),
  deleteItemAsync: vi.fn(async () => undefined),
  getItemAsync: vi.fn(async () => null as string | null),
  kvStore: {
    getAllKeysAsync: vi.fn(async () => [] as Array<string>),
    multiRemove: vi.fn(async () => undefined),
    removeItemAsync: vi.fn(async () => undefined),
    setItem: vi.fn(async () => undefined),
  },
  reloadAppAsync: vi.fn(async () => undefined),
  setItemAsync: vi.fn(async () => undefined),
}));

vi.mock("expo", () => ({
  reloadAppAsync: mocks.reloadAppAsync,
}));

vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: "AFTER_FIRST_UNLOCK",
  ALWAYS: "ALWAYS",
  deleteItemAsync: mocks.deleteItemAsync,
  getItemAsync: mocks.getItemAsync,
  setItemAsync: mocks.setItemAsync,
}));

vi.mock("expo-sqlite/kv-store", () => ({
  default: mocks.kvStore,
}));

vi.mock("../src/shared.js", () => ({
  createEvoluDeps: mocks.createSharedEvoluDeps,
  createSharedLocalAuth: mocks.createSharedLocalAuth,
}));

const createStorage = () => {
  const deps = createExpoDeps({
    createSqliteDriver: vi.fn() as any,
  });
  return {
    deps,
    secureStorage: (deps.localAuth as { secureStorage: any }).secureStorage,
  };
};

describe("createExpoDeps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.kvStore.getAllKeysAsync.mockResolvedValue([]);
    mocks.getItemAsync.mockResolvedValue(null);
  });

  test("wires shared deps and reload callback", () => {
    const createSqliteDriver = vi.fn() as any;
    const deps = createExpoDeps({ createSqliteDriver });

    expect(mocks.createSharedEvoluDeps).toHaveBeenCalledWith(
      expect.objectContaining({
        createSqliteDriver,
        reloadApp: expect.any(Function),
      }),
    );

    deps.evoluReactNativeDeps.reloadApp();
    expect(mocks.reloadAppAsync).toHaveBeenCalledTimes(1);
  });

  test("setItem stores metadata and supports all access controls", async () => {
    const { secureStorage } = createStorage();

    await secureStorage.setItem("token", "v1", {
      accessControl: "none",
      authenticationPrompt: { title: "Auth prompt" } as any,
      keychainGroup: "group.none",
      service: "svc",
    });

    const payload = JSON.parse(mocks.setItemAsync.mock.calls[0][1]);
    expect(mocks.kvStore.setItem).toHaveBeenCalledWith("svc-token", "1");
    expect(payload.metadata).toEqual(
      expect.objectContaining({
        accessControl: "biometryCurrentSet",
        securityLevel: "biometry",
        backend: "keychain",
        timestamp: expect.any(Number),
      }),
    );
    expect(mocks.setItemAsync.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        accessGroup: "group.none",
        keychainAccessible: "ALWAYS",
        keychainService: "svc",
        authenticationPrompt: "Auth prompt",
        requireAuthentication: false,
      }),
    );

    const secureAccessControls = [
      "biometryCurrentSet",
      "biometryAny",
      "devicePasscode",
      "secureEnclaveBiometry",
      "unknown-value",
    ] as const;

    for (const accessControl of secureAccessControls) {
      await secureStorage.setItem("token", "v2", {
        accessControl: accessControl as any,
        service: "svc",
      });
      const options = mocks.setItemAsync.mock.calls.at(-1)?.[2];
      expect(options).toEqual(
        expect.objectContaining({
          keychainAccessible: "AFTER_FIRST_UNLOCK",
          requireAuthentication: accessControl !== "none",
        }),
      );
    }
  });

  test("getItem handles missing, invalid, and valid payloads", async () => {
    const { secureStorage } = createStorage();

    mocks.getItemAsync.mockResolvedValueOnce(null);
    await expect(secureStorage.getItem("key")).resolves.toBeNull();

    mocks.getItemAsync.mockResolvedValueOnce("{invalid");
    await expect(secureStorage.getItem("key")).resolves.toBeNull();

    mocks.getItemAsync.mockResolvedValueOnce(
      JSON.stringify({
        value: "secret",
        metadata: { accessControl: "none", securityLevel: "software" },
      }),
    );
    await expect(
      secureStorage.getItem("key", { service: "svc" }),
    ).resolves.toEqual(
      expect.objectContaining({
        key: "key",
        service: "svc",
        value: "secret",
      }),
    );
  });

  test("deleteItem, getAllItems, and clearService use service-scoped keys", async () => {
    const { secureStorage } = createStorage();

    await expect(
      secureStorage.deleteItem("alpha", { service: "svc" }),
    ).resolves.toBe(true);

    expect(mocks.kvStore.removeItemAsync).toHaveBeenCalledWith("svc-alpha");
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith(
      "alpha",
      expect.objectContaining({
        keychainService: "svc",
      }),
    );

    mocks.kvStore.getAllKeysAsync.mockResolvedValueOnce([
      "svc-a",
      "other-b",
      "svc-c",
    ]);
    const items = await secureStorage.getAllItems({
      accessControl: "none",
      service: "svc",
    });
    expect(items).toEqual([
      expect.objectContaining({
        key: "a",
        service: "svc",
        metadata: expect.objectContaining({
          accessControl: "biometryCurrentSet",
          securityLevel: "biometry",
        }),
      }),
      expect.objectContaining({
        key: "c",
        service: "svc",
      }),
    ]);

    mocks.kvStore.getAllKeysAsync.mockResolvedValueOnce(["svc-a", "svc-c"]);
    await secureStorage.clearService({ service: "svc" });
    expect(mocks.kvStore.multiRemove).toHaveBeenCalledWith(["svc-a", "svc-c"]);
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({
        keychainService: "svc",
      }),
    );
    expect(mocks.deleteItemAsync).toHaveBeenCalledWith(
      "c",
      expect.objectContaining({
        keychainService: "svc",
      }),
    );
  });

  test("falls back to default service and option mapping when options are omitted", async () => {
    const { secureStorage } = createStorage();

    await secureStorage.setItem("beta", "value");
    expect(mocks.kvStore.setItem).toHaveBeenCalledWith("default-beta", "1");
    expect(mocks.setItemAsync.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({
        keychainService: expect.any(String),
      }),
    );

    await secureStorage.deleteItem("beta");
    expect(mocks.kvStore.removeItemAsync).toHaveBeenCalledWith("default-beta");

    const previousDefaults = {
      authenticationPrompt: localAuthDefaultOptions.authenticationPrompt,
      keychainGroup: localAuthDefaultOptions.keychainGroup,
      service: localAuthDefaultOptions.service,
    };
    (localAuthDefaultOptions as any).keychainGroup = undefined;
    (localAuthDefaultOptions as any).service = undefined;
    (localAuthDefaultOptions as any).authenticationPrompt = undefined;

    await secureStorage.setItem("gamma", "value");
    expect(mocks.setItemAsync.mock.calls.at(-1)?.[2]).toEqual(
      expect.objectContaining({
        accessGroup: "",
        keychainService: "",
        authenticationPrompt: "",
      }),
    );

    (localAuthDefaultOptions as any).keychainGroup =
      previousDefaults.keychainGroup;
    (localAuthDefaultOptions as any).service = previousDefaults.service;
    (localAuthDefaultOptions as any).authenticationPrompt =
      previousDefaults.authenticationPrompt;

    mocks.kvStore.getAllKeysAsync.mockResolvedValueOnce(["default-beta"]);
    await secureStorage.clearService();
    expect(mocks.kvStore.multiRemove).toHaveBeenCalledWith(["default-beta"]);
  });
});
