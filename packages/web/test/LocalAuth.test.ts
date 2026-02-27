import { beforeEach, expect, test, vi } from "vitest";
import { createWebAuthnStore } from "../src/local-first/LocalAuth.js";

const stores = new Map<string, Map<string, unknown>>();

vi.mock("idb-keyval", () => {
  const getStore = (store: unknown): Map<string, unknown> => {
    const key = String(store);
    let map = stores.get(key);
    if (!map) {
      map = new Map();
      stores.set(key, map);
    }
    return map;
  };

  return {
    createStore: (name: string, table: string) => `${name}:${table}`,
    set: async (key: string, value: unknown, store: unknown) => {
      getStore(store).set(key, value);
    },
    get: async (key: string, store: unknown) => {
      return getStore(store).get(key);
    },
    del: async (key: string, store: unknown) => {
      getStore(store).delete(key);
    },
    keys: async (store: unknown) => {
      return [...getStore(store).keys()];
    },
    clear: async (store: unknown) => {
      getStore(store).clear();
    },
  };
});

let lastSeed: Uint8Array | null = null;

const installCredentialMocks = () => {
  Object.defineProperty(globalThis.navigator, "credentials", {
    configurable: true,
    value: {
      create: vi.fn(async (options: CredentialCreationOptions) => {
        const seed = new Uint8Array(
          options.publicKey?.user.id as ArrayBufferLike,
        );
        lastSeed = new Uint8Array(seed);
        return {
          rawId: new Uint8Array([1, 2, 3]).buffer,
        } as PublicKeyCredential;
      }),
      get: vi.fn(async () => {
        return {
          response: {
            userHandle: lastSeed?.buffer ?? new Uint8Array([9, 9, 9]).buffer,
          },
        } as PublicKeyCredential;
      }),
    } as CredentialContainer,
  });
};

const createDeps = () => ({
  randomBytes: {
    create: (length: number) =>
      new Uint8Array(Array.from({ length }, (_, i) => i % 251)),
  },
});

beforeEach(() => {
  stores.clear();
  lastSeed = null;
  installCredentialMocks();
});

test("createWebAuthnStore supports metadata-only path (accessControl:none)", async () => {
  const store = createWebAuthnStore(createDeps());
  const service = "none-service";

  const setResult = await store.setItem("k1", "value-1", {
    service,
    accessControl: "none",
  });
  expect(setResult.metadata.accessControl).toBe("none");

  const item = await store.getItem("k1", {
    service,
    accessControl: "none",
  });
  expect(item?.value).toBe("value-1");

  const all = await store.getAllItems({ service, includeValues: true });
  expect(all).toHaveLength(1);
  expect(all[0]?.value).toBe("value-1");

  const deleted = await store.deleteItem("k1", {
    service,
    accessControl: "none",
  });
  expect(deleted).toBe(true);
  expect(
    await store.getItem("k1", { service, accessControl: "none" }),
  ).toBeNull();
});

test("createWebAuthnStore secure path encrypts and decrypts auth payload", async () => {
  const store = createWebAuthnStore(createDeps());
  const service = "secure-service";
  const payload = JSON.stringify({ owner: undefined, username: "Alice" });

  await store.setItem("owner-1", payload, {
    service,
    webAuthnUsername: "Alice",
    relyingPartyName: "SQLoot",
  });

  const item = await store.getItem("owner-1", { service });
  expect(item?.value).toBe(payload);
  expect(item?.metadata.accessControl).toBe("biometryCurrentSet");
});

test("createWebAuthnStore returns null when secure credential cannot decrypt", async () => {
  const store = createWebAuthnStore(createDeps());
  const service = "decrypt-fail-service";
  const payload = JSON.stringify({ owner: undefined, username: "Alice" });

  await store.setItem("owner-1", payload, { service });

  Object.defineProperty(globalThis.navigator, "credentials", {
    configurable: true,
    value: {
      create: vi.fn(),
      get: vi.fn(async () => {
        return {
          response: {
            userHandle: new Uint8Array(32).buffer,
          },
        } as PublicKeyCredential;
      }),
    } as CredentialContainer,
  });

  const item = await store.getItem("owner-1", { service });
  expect(item).toBeNull();
});

test("createWebAuthnStore clearService removes all entries", async () => {
  const store = createWebAuthnStore(createDeps());
  const service = "clear-service";

  await store.setItem("a", "1", { service, accessControl: "none" });
  await store.setItem("b", "2", { service, accessControl: "none" });
  expect(await store.getAllItems({ service })).toHaveLength(2);

  await store.clearService({ service, accessControl: "none" });
  expect(await store.getAllItems({ service })).toHaveLength(0);
});
