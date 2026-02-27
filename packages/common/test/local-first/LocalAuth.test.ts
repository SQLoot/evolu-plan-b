import { expect, test } from "vitest";
import {
  createLocalAuth,
  type MutationResult,
  type SecureStorage,
  type SensitiveInfoItem,
} from "../../src/local-first/LocalAuth.js";
import { testCreateRun } from "../../src/Test.js";

const createInMemorySecureStorage = (): SecureStorage => {
  const stores = new Map<string, Map<string, SensitiveInfoItem>>();

  const getStore = (service?: string): Map<string, SensitiveInfoItem> => {
    const key = service ?? "default";
    let store = stores.get(key);
    if (!store) {
      store = new Map();
      stores.set(key, store);
    }
    return store;
  };

  const createMutationResult = (
    accessControl: SensitiveInfoItem["metadata"]["accessControl"] = "none",
  ): MutationResult => ({
    metadata: {
      accessControl,
      backend: "keychain",
      securityLevel: accessControl === "none" ? "software" : "biometry",
      timestamp: Date.now(),
    },
  });

  return {
    setItem: async (key, value, options) => {
      const service = options?.service ?? "default";
      const result = createMutationResult(options?.accessControl);
      getStore(service).set(key, {
        key,
        service,
        value,
        metadata: result.metadata,
      });
      return result;
    },
    getItem: async (key, options) => {
      const service = options?.service ?? "default";
      const item = getStore(service).get(key);
      if (!item) return null;
      return options?.includeValues === false
        ? { ...item, value: undefined }
        : item;
    },
    deleteItem: async (key, options) => {
      const service = options?.service ?? "default";
      return getStore(service).delete(key);
    },
    getAllItems: async (options) => {
      const service = options?.service ?? "default";
      return [...getStore(service).values()].map((item) =>
        options?.includeValues ? item : { ...item, value: undefined },
      );
    },
    clearService: async (options) => {
      const service = options?.service ?? "default";
      getStore(service).clear();
    },
  };
};

test("LocalAuth register/getProfiles/getOwner happy path", async () => {
  await using run = testCreateRun();
  const localAuth = createLocalAuth({
    randomBytes: run.deps.randomBytes,
    secureStorage: createInMemorySecureStorage(),
  });

  const registration = await localAuth.register("Alice");
  expect(registration).not.toBeNull();
  if (!registration?.owner) return;

  const profiles = await localAuth.getProfiles();
  expect(profiles).toEqual([
    { ownerId: registration.owner.id, username: "Alice" },
  ]);

  const owner = await localAuth.getOwner();
  expect(owner?.username).toBe("Alice");
  expect(owner?.owner?.id).toBe(registration.owner.id);
});

test("LocalAuth login returns username and keeps owner deferred", async () => {
  await using run = testCreateRun();
  const localAuth = createLocalAuth({
    randomBytes: run.deps.randomBytes,
    secureStorage: createInMemorySecureStorage(),
  });

  const registration = await localAuth.register("Alice");
  expect(registration?.owner).toBeDefined();
  if (!registration?.owner) return;

  const login = await localAuth.login(registration.owner.id);
  expect(login).toEqual({ owner: undefined, username: "Alice" });
});

test("LocalAuth unregister updates last owner fallback", async () => {
  await using run = testCreateRun();
  const localAuth = createLocalAuth({
    randomBytes: run.deps.randomBytes,
    secureStorage: createInMemorySecureStorage(),
  });

  const alice = await localAuth.register("Alice");
  const bob = await localAuth.register("Bob");
  expect(alice?.owner).toBeDefined();
  expect(bob?.owner).toBeDefined();
  if (!alice?.owner || !bob?.owner) return;

  await localAuth.unregister(bob.owner.id);
  const owner = await localAuth.getOwner();

  expect(owner?.owner?.id).toBe(alice.owner.id);
  expect(owner?.username).toBe("Alice");
});

test("LocalAuth clearAll clears owners and profiles", async () => {
  await using run = testCreateRun();
  const localAuth = createLocalAuth({
    randomBytes: run.deps.randomBytes,
    secureStorage: createInMemorySecureStorage(),
  });

  await localAuth.register("Alice");
  await localAuth.register("Bob");

  await localAuth.clearAll();

  const profiles = await localAuth.getProfiles();
  const owner = await localAuth.getOwner();

  expect(profiles).toEqual([]);
  expect(owner).toBeNull();
});
