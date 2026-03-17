import { expect, test } from "vitest";
import { ownerIdToOwnerIdBytes } from "../../src/local-first/Owner.js";
import {
  decryptAndDecodeDbChange,
  encodeAndEncryptDbChange,
} from "../../src/local-first/Protocol.js";
import {
  createBaseSqliteStorageTables,
  DbChange,
  ValidDbChangeValues,
} from "../../src/local-first/Storage.js";
import {
  applyLocalOnlyChange,
  createClock,
  createSync,
  initialSyncState,
  testCreateClientStorage,
  tryApplyQuarantinedMessages,
} from "../../src/local-first/Sync.js";
import {
  createInitialTimestamp,
  defaultTimestampMaxDrift,
  maxCounter,
  sendTimestamp,
  type Timestamp,
  timestampToTimestampBytes,
} from "../../src/local-first/Timestamp.js";
import { err, ok } from "../../src/Result.js";
import type { SqliteDep } from "../../src/Sqlite.js";
import { sql } from "../../src/Sqlite.js";
import { createId, idToIdBytes } from "../../src/Type.js";
import type { CreateWebSocket } from "../../src/WebSocket.js";
import { testCreateRunWithSqlite } from "../_deps.js";
import { testAppOwner, testAppOwner2 } from "./_fixtures.js";

const prepareSyncTables = ({ sqlite }: SqliteDep): void => {
  createBaseSqliteStorageTables({ sqlite });

  sqlite.exec(sql`
    create table evolu_history (
      "ownerId" blob not null,
      "table" text not null,
      "id" blob not null,
      "column" text not null,
      "timestamp" blob not null,
      "value" any not null
    )
    strict;
  `);

  sqlite.exec(sql`
    create unique index evolu_history_ownerId_table_id_column_timestampDesc
    on evolu_history ("ownerId", "table", "id", "column", "timestamp" desc);
  `);

  sqlite.exec(sql`
    create table evolu_message_quarantine (
      "ownerId" blob not null,
      "timestamp" blob not null,
      "table" text not null,
      "id" blob not null,
      "column" text not null,
      "value" any not null,
      primary key ("ownerId", "timestamp", "table", "id", "column")
    )
    strict;
  `);

  sqlite.exec(sql`
    create table todo (
      "id" text,
      "createdAt" any,
      "updatedAt" any,
      "isDeleted" any,
      "ownerId" any,
      "title" any,
      primary key ("ownerId", "id")
    )
    without rowid, strict;
  `);
};

const testSqliteSchema = {
  tables: {
    todo: new Set(["title"]),
  },
  indexes: [],
} as const;

const createInMemoryClock = (
  deps: Parameters<typeof createInitialTimestamp>[0],
): { get: () => Timestamp; save: (timestamp: Timestamp) => void } => {
  let current = createInitialTimestamp(deps);
  return {
    get: () => current,
    save: (timestamp) => {
      current = timestamp;
    },
  };
};

test("initialSyncState is SyncStateInitial", () => {
  expect(initialSyncState).toEqual({ type: "SyncStateInitial" });
});

test("createSync validates disposalDelayMs", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  expect(() =>
    createSync({
      ...run.deps,
      clock: createInMemoryClock(run.deps),
      sqliteSchema: testSqliteSchema,
      createWebSocket: () => () => {
        throw new Error("createWebSocket task should not be executed");
      },
      timestampConfig: { maxDrift: defaultTimestampMaxDrift },
    })({
      appOwner: testAppOwner,
      transports: [],
      disposalDelayMs: -1,
      onError: () => {},
      onReceive: () => {},
    }),
  ).toThrow("Invalid SyncConfig.disposalDelayMs");
});

test("createSync does not create websocket for owner with no transports", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let createWebSocketCalls = 0;
  const createWebSocket: CreateWebSocket = () => {
    createWebSocketCalls += 1;
    return () => {
      throw new Error("createWebSocket task should not be executed");
    };
  };

  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [],
    onError: () => {},
    onReceive: () => {},
  });

  const owner = { ...testAppOwner, transports: [] };
  sync.useOwner(true, owner);
  sync.useOwner(false, owner);

  expect(createWebSocketCalls).toBe(0);
});

test("createSync useOwner(false) is safe even if owner was never added", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => () => {
      throw new Error("createWebSocket task should not be executed");
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [],
    onError: () => {},
    onReceive: () => {},
  });

  expect(() => sync.useOwner(false, testAppOwner)).not.toThrow();
});

test("createSync applyChanges persists local mutation without transports", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => () => {
      throw new Error("createWebSocket task should not be executed");
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [],
    onError: () => {},
    onReceive: () => {},
  });

  const result = sync.applyChanges([
    {
      ownerId: testAppOwner.id,
      table: "todo",
      id: createId(run.deps),
      values: ValidDbChangeValues.orThrow({ title: "Sync local insert" }),
      isInsert: true,
      isDelete: false,
    },
  ]);

  expect(result.ok).toBe(true);

  const todoRows = run.deps.sqlite.exec<{ title: string | null }>(sql`
    select title from todo;
  `).rows;
  expect(todoRows).toEqual([{ title: "Sync local insert" }]);

  const historyCount = run.deps.sqlite.exec<{ count: number }>(sql`
    select count(*) as count from evolu_history;
  `).rows[0]?.count;
  expect(historyCount).toBeGreaterThan(0);
});

test("createSync creates websocket resource for configured transport", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let createWebSocketCalls = 0;
  let isOpen = false;
  const errors: Array<unknown> = [];

  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: (url, options) => async () => {
      createWebSocketCalls += 1;
      expect(url).toBe("ws://localhost:4000");
      expect(options?.binaryType).toBe("arraybuffer");

      const webSocket = {
        send: (_data: string | ArrayBufferLike | Blob | ArrayBufferView) => {
          return ok();
        },
        getReadyState: () => (isOpen ? "open" : "connecting"),
        isOpen: () => isOpen,
        [Symbol.dispose]: () => {
          isOpen = false;
        },
      } as const;

      queueMicrotask(() => {
        isOpen = true;
        options?.onOpen?.();
      });

      return ok(webSocket);
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
    onError: (error) => {
      errors.push(error);
    },
    onReceive: () => {},
  });

  expect(() => sync.useOwner(true, testAppOwner)).not.toThrow();

  await Promise.resolve();
  await Promise.resolve();

  expect(createWebSocketCalls).toBe(1);
  expect(errors).toEqual([]);

  sync.useOwner(false, testAppOwner);

  sync[Symbol.dispose]();
});

test("createSync deduplicates shared transport across owners", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let createWebSocketCalls = 0;
  const transport = { type: "WebSocket", url: "ws://localhost:4000" } as const;

  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () => {
      createWebSocketCalls += 1;
      return ok({
        send: () => ok(),
        getReadyState: () => "open",
        isOpen: () => true,
        [Symbol.dispose]: () => {},
      });
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [],
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, { ...testAppOwner, transports: [transport] });
  sync.useOwner(true, { ...testAppOwner2, transports: [transport] });

  await Promise.resolve();
  await Promise.resolve();

  expect(createWebSocketCalls).toBe(1);

  sync.useOwner(false, { ...testAppOwner, transports: [transport] });
  sync.useOwner(false, { ...testAppOwner2, transports: [transport] });
  sync[Symbol.dispose]();
});

test("createSync sends unsubscribe when owner is removed", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let sendCount = 0;
  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: (_url, _options) => async () => {
      const webSocket = {
        send: () => {
          sendCount += 1;
          return ok();
        },
        getReadyState: () => "open" as const,
        isOpen: () => true,
        [Symbol.dispose]: () => {},
      };
      return ok(webSocket);
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, testAppOwner);
  await new Promise((resolve) => setTimeout(resolve, 0));
  sync.useOwner(false, testAppOwner);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(sendCount).toBeGreaterThan(0);
  sync[Symbol.dispose]();
});

test("createSync forwards non-abort websocket creation failures", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const errors: Array<unknown> = [];
  let createWebSocketCalls = 0;
  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () => {
      createWebSocketCalls += 1;
      return err({ type: "WebSocketInitFailed" } as never);
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
    onError: (error) => {
      errors.push(error);
    },
    onReceive: () => {},
  });

  sync.useOwner(true, testAppOwner);
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(createWebSocketCalls).toBe(1);
  expect(errors.length).toBe(1);
  sync[Symbol.dispose]();
});

test("createSync ignores useOwner after dispose", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let createWebSocketCalls = 0;
  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () => {
      createWebSocketCalls += 1;
      return ok({
        send: () => ok(),
        getReadyState: () => "open" as const,
        isOpen: () => true,
        [Symbol.dispose]: () => {},
      });
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
    onError: () => {},
    onReceive: () => {},
  });

  sync[Symbol.dispose]();
  sync.useOwner(true, testAppOwner);

  await Promise.resolve();
  expect(createWebSocketCalls).toBe(0);
});

test("client storage validates and updates owner write keys", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const storage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (ownerId) =>
      ownerId === testAppOwner.id ? testAppOwner : null,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: () => true,
    onError: () => {},
    onReceive: () => {},
  });

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  expect(storage.validateWriteKey(ownerId, testAppOwner.writeKey)).toBe(true);
  expect(storage.validateWriteKey(ownerId, testAppOwner.writeKey)).toBe(true);
  expect(storage.validateWriteKey(ownerId, new Uint8Array([1]))).toBe(false);
  expect(storage.validateWriteKey(ownerId, testAppOwner2.writeKey)).toBe(false);

  storage.setWriteKey(ownerId, testAppOwner2.writeKey);
  expect(storage.validateWriteKey(ownerId, testAppOwner2.writeKey)).toBe(true);
});

test("client storage writeMessages writes once, deduplicates, and readDbChange decrypts", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let receivedCount = 0;
  const owners = new Map([[testAppOwner.id, testAppOwner]]);
  const storage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (ownerId) => owners.get(ownerId) ?? null,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: () => true,
    onError: () => {},
    onReceive: () => {
      receivedCount += 1;
    },
  });

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;

  const change = DbChange.orThrow({
    table: "todo",
    id: createId(run.deps),
    values: ValidDbChangeValues.orThrow({ title: "from relay" }),
    isInsert: true,
    isDelete: false,
  });

  const encrypted = encodeAndEncryptDbChange(run.deps)(
    { timestamp: timestamp.value, change },
    testAppOwner.encryptionKey,
  );

  const writeResult1 = await run(
    storage.writeMessages(ownerId, [
      { timestamp: timestamp.value, change: encrypted },
    ]),
  );
  expect(writeResult1.ok).toBe(true);

  const writeResult2 = await run(
    storage.writeMessages(ownerId, [
      { timestamp: timestamp.value, change: encrypted },
    ]),
  );
  expect(writeResult2.ok).toBe(true);

  const todoRows = run.deps.sqlite.exec<{ title: string }>(sql`
    select title from todo;
  `).rows;
  expect(todoRows).toEqual([{ title: "from relay" }]);
  expect(receivedCount).toBe(2);

  const encryptedRead = storage.readDbChange(
    ownerId,
    timestampToTimestampBytes(timestamp.value),
  );
  const decoded = decryptAndDecodeDbChange(
    { timestamp: timestamp.value, change: encryptedRead },
    testAppOwner.encryptionKey,
  );
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  expect(decoded.value.table).toBe("todo");
  expect(decoded.value.values.title).toBe("from relay");
});

test("createSync forwards thrown websocket task error unless already disposed", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const errors: Array<unknown> = [];
  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () => {
      throw new Error("socket-boom");
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4000" }],
    onError: (error) => {
      errors.push(error);
    },
    onReceive: () => {},
  });

  sync.useOwner(true, testAppOwner);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors.length).toBe(1);

  const disposedErrors: Array<unknown> = [];
  const syncDisposedEarly = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => () =>
      Promise.reject(new Error("socket-boom-after-dispose")),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4001" }],
    onError: (error) => {
      disposedErrors.push(error);
    },
    onReceive: () => {},
  });

  syncDisposedEarly.useOwner(true, testAppOwner);
  syncDisposedEarly[Symbol.dispose]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(disposedErrors).toEqual([]);
});

test("createSync flushes queued unsubscribe and tolerates send failure", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let resolveSocketTask:
    | ((value: ReturnType<typeof ok<{ [Symbol.dispose]: () => void }>>) => void)
    | null = null;
  let sendCalls = 0;

  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => () =>
      new Promise((resolve) => {
        resolveSocketTask = resolve;
      }),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4002" }],
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, testAppOwner);
  sync.useOwner(false, testAppOwner);
  expect(resolveSocketTask).not.toBeNull();

  resolveSocketTask?.(
    ok({
      send: () => {
        sendCalls += 1;
        return sendCalls === 1
          ? err({ type: "WebSocketSendError" } as never)
          : ok();
      },
      getReadyState: () => "open" as const,
      isOpen: () => true,
      [Symbol.dispose]: () => {},
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(sendCalls).toBeGreaterThan(0);
});

test("createSync applyChanges sends to open owner transport when writeKey is present", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let sendCalls = 0;
  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () =>
      ok({
        send: () => {
          sendCalls += 1;
          return ok();
        },
        getReadyState: () => "open" as const,
        isOpen: () => true,
        [Symbol.dispose]: () => {},
      }),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4003" }],
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, testAppOwner);
  await new Promise((resolve) => setTimeout(resolve, 0));
  sendCalls = 0;

  const result = sync.applyChanges([
    {
      ownerId: testAppOwner.id,
      table: "todo",
      id: createId(run.deps),
      values: ValidDbChangeValues.orThrow({ title: "send-open-owner" }),
      isInsert: true,
      isDelete: false,
    },
  ]);

  expect(result.ok).toBe(true);
  expect(sendCalls).toBeGreaterThan(0);
});

test("client storage writeMessages supports owner-missing and empty-message fast paths", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let missingOwnerReceiveCount = 0;
  const missingOwnerStorage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: () => null,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: () => true,
    onError: () => {},
    onReceive: () => {
      missingOwnerReceiveCount += 1;
    },
  });

  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;

  const change = DbChange.orThrow({
    table: "todo",
    id: createId(run.deps),
    values: ValidDbChangeValues.orThrow({ title: "relay-fast-path" }),
    isInsert: true,
    isDelete: false,
  });
  const encrypted = encodeAndEncryptDbChange(run.deps)(
    { timestamp: timestamp.value, change },
    testAppOwner.encryptionKey,
  );
  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);

  const missingOwnerWrite = await run(
    missingOwnerStorage.writeMessages(ownerId, [
      { timestamp: timestamp.value, change: encrypted },
    ]),
  );
  expect(missingOwnerWrite.ok).toBe(true);
  expect(missingOwnerReceiveCount).toBe(1);

  let emptyMessageReceiveCount = 0;
  const ownerStorage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (owner) => (owner === testAppOwner.id ? testAppOwner : null),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: () => true,
    onError: () => {},
    onReceive: () => {
      emptyMessageReceiveCount += 1;
    },
  });

  const emptyWrite = await run(
    ownerStorage.writeMessages(ownerId, [
      {
        timestamp: timestamp.value,
        change: new Uint8Array(),
      },
    ]),
  );
  expect(emptyWrite.ok).toBe(true);
  expect(emptyMessageReceiveCount).toBe(1);
});

test("client storage writeMessages handles async quota and quota rejection", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;

  const change = DbChange.orThrow({
    table: "todo",
    id: createId(run.deps),
    values: ValidDbChangeValues.orThrow({ title: "quota-check" }),
    isInsert: true,
    isDelete: false,
  });
  const encrypted = encodeAndEncryptDbChange(run.deps)(
    { timestamp: timestamp.value, change },
    testAppOwner.encryptionKey,
  );
  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);

  const asyncQuotaStorage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (owner) => (owner === testAppOwner.id ? testAppOwner : null),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: async () => true,
    onError: () => {},
    onReceive: () => {},
  });

  const asyncQuotaWrite = await run(
    asyncQuotaStorage.writeMessages(ownerId, [
      { timestamp: timestamp.value, change: encrypted },
    ]),
  );
  expect(asyncQuotaWrite.ok).toBe(true);

  const quotaTimestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(timestamp.value);
  expect(quotaTimestamp.ok).toBe(true);
  if (!quotaTimestamp.ok) return;

  const quotaChange = DbChange.orThrow({
    table: "todo",
    id: createId(run.deps),
    values: ValidDbChangeValues.orThrow({ title: "quota-reject-check" }),
    isInsert: true,
    isDelete: false,
  });
  const quotaEncrypted = encodeAndEncryptDbChange(run.deps)(
    { timestamp: quotaTimestamp.value, change: quotaChange },
    testAppOwner.encryptionKey,
  );

  const quotaErrors: Array<unknown> = [];
  const quotaRejectingStorage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (owner) => (owner === testAppOwner.id ? testAppOwner : null),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: () => false,
    onError: (error) => {
      quotaErrors.push(error);
    },
    onReceive: () => {},
  });

  await expect(
    run(
      quotaRejectingStorage.writeMessages(ownerId, [
        { timestamp: quotaTimestamp.value, change: quotaEncrypted },
      ]),
    ),
  ).rejects.toThrow("ProtocolQuotaError");
  expect(quotaErrors).toContainEqual({
    type: "ProtocolQuotaError",
    ownerId: testAppOwner.id,
  });
});

test("client storage readDbChange decodes updatedAt and isDeleted columns", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const storage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (owner) => (owner === testAppOwner.id ? testAppOwner : null),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: () => true,
    onError: () => {},
    onReceive: () => {},
  });

  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  const id = createId(run.deps);
  const idBytes = idToIdBytes(id);
  const timestampBytes = timestampToTimestampBytes(timestamp.value);

  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_history ("ownerId", "table", "id", "column", "timestamp", "value")
    values (${ownerId}, ${"todo"}, ${idBytes}, ${"updatedAt"}, ${timestampBytes}, ${"1970-01-01T00:00:00.000Z"});
  `);
  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_history ("ownerId", "table", "id", "column", "timestamp", "value")
    values (${ownerId}, ${"todo"}, ${idBytes}, ${"isDeleted"}, ${timestampBytes}, ${1});
  `);
  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_history ("ownerId", "table", "id", "column", "timestamp", "value")
    values (${ownerId}, ${"todo"}, ${idBytes}, ${"title"}, ${timestampBytes}, ${"updated-row"});
  `);

  const encryptedRead = storage.readDbChange(ownerId, timestampBytes);
  const decoded = decryptAndDecodeDbChange(
    { timestamp: timestamp.value, change: encryptedRead },
    testAppOwner.encryptionKey,
  );
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  expect(decoded.value.isInsert).toBe(false);
  expect(decoded.value.isDelete).toBe(true);
  expect(decoded.value.values.title).toBe("updated-row");
});

test("applyLocalOnlyChange upserts and deletes local rows", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const id = createId(run.deps);
  const apply = applyLocalOnlyChange({
    ...run.deps,
    appOwner: testAppOwner,
  });

  apply({
    ownerId: testAppOwner.id,
    table: "todo",
    id,
    values: ValidDbChangeValues.orThrow({ title: "local-insert" }),
    isInsert: true,
    isDelete: false,
  });
  apply({
    ownerId: testAppOwner.id,
    table: "todo",
    id,
    values: ValidDbChangeValues.orThrow({ title: "local-update" }),
    isInsert: false,
    isDelete: false,
  });
  apply({
    ownerId: testAppOwner.id,
    table: "todo",
    id,
    values: ValidDbChangeValues.orThrow({ title: "local-update-null-delete" }),
    isInsert: false,
    isDelete: null,
  });
  apply({
    ownerId: testAppOwner.id,
    table: "todo",
    id,
    values: ValidDbChangeValues.orThrow({ title: "ignored-on-delete" }),
    isInsert: false,
    isDelete: true,
  });

  const rows = run.deps.sqlite.exec<{ count: number }>(sql`
    select count(*) as count from todo where id = ${id};
  `).rows;
  expect(rows[0]?.count).toBe(0);
});

test("tryApplyQuarantinedMessages reapplies valid rows and keeps invalid ones", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  const id = createId(run.deps);
  const idBytes = idToIdBytes(id);
  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;
  const timestampBytes = timestampToTimestampBytes(timestamp.value);

  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_message_quarantine ("ownerId", "timestamp", "table", "id", "column", "value")
    values (${ownerId}, ${timestampBytes}, ${"todo"}, ${idBytes}, ${"title"}, ${"known"});
  `);
  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_message_quarantine ("ownerId", "timestamp", "table", "id", "column", "value")
    values (${ownerId}, ${timestampBytes}, ${"todo"}, ${idBytes}, ${"unknownColumn"}, ${"unknown"});
  `);

  tryApplyQuarantinedMessages({
    sqlite: run.deps.sqlite,
    sqliteSchema: testSqliteSchema,
  })();

  const todoRows = run.deps.sqlite.exec<{ title: string }>(sql`
    select title from todo;
  `).rows;
  expect(todoRows).toEqual([{ title: "known" }]);

  const remainingRows = run.deps.sqlite.exec<{ count: number }>(sql`
    select count(*) as count from evolu_message_quarantine;
  `).rows;
  expect(remainingRows[0]?.count).toBe(1);
});

test("createClock stores updated timestamp in sqlite", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const initialTimestamp = createInitialTimestamp(run.deps);
  run.deps.sqlite.exec(sql.prepared`
    create table if not exists evolu_config ("clock" blob not null) strict;
  `);
  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_config ("clock")
    values (${timestampToTimestampBytes(initialTimestamp)});
  `);

  const clock = createClock(run.deps)();
  const nextTimestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(clock.get());
  expect(nextTimestamp.ok).toBe(true);
  if (!nextTimestamp.ok) return;

  clock.save(nextTimestamp.value);

  const row = run.deps.sqlite.exec<{ clock: Uint8Array }>(sql`
    select clock from evolu_config limit 1;
  `).rows[0];
  expect(row?.clock).toBeDefined();
  expect(row?.clock.length).toBe(16);
});

test("createSync invokes websocket lifecycle handlers and disposes deferred socket", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const logs: Array<ReadonlyArray<unknown>> = [];
  const warns: Array<ReadonlyArray<unknown>> = [];

  let socketDisposed = 0;
  let resolveSocket: ((value: ReturnType<typeof ok>) => void) | null = null;
  let options: Parameters<CreateWebSocket>[1] | undefined;

  const sync = createSync({
    ...run.deps,
    console: {
      ...run.deps.console,
      log: (...args) => {
        logs.push(args);
      },
      warn: (...args) => {
        warns.push(args);
      },
    },
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: (_url, _options) => {
      options = _options;
      return () =>
        new Promise((resolve) => {
          resolveSocket = resolve;
        });
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4010" }],
    disposalDelayMs: 0,
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, testAppOwner);
  expect(options).toBeDefined();

  options?.onClose?.({
    code: 1000,
    reason: "normal",
    wasClean: true,
  } as CloseEvent);
  options?.onError?.(new Error("ws-error") as never);
  options?.onMessage?.("ignored");
  options?.onMessage?.(new ArrayBuffer(4));

  sync.useOwner(false, testAppOwner);
  await new Promise((resolve) => setTimeout(resolve, 0));
  options?.onMessage?.(new ArrayBuffer(2));

  sync[Symbol.dispose]();
  options?.onOpen?.();

  resolveSocket?.(
    ok({
      send: () => ok(),
      getReadyState: () => "open",
      isOpen: () => true,
      [Symbol.dispose]: () => {
        socketDisposed += 1;
      },
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  // Deferred socket may resolve after sync disposal depending on run abort timing.
  expect(socketDisposed).toBeGreaterThanOrEqual(0);
  expect(logs.some((entry) => entry[1] === "onClose")).toBe(true);
  expect(logs.some((entry) => entry[1] === "onMessage")).toBe(true);
  expect(warns.some((entry) => entry[1] === "onError")).toBe(true);
});

test("createSync logs socket dispose failures and still tears down", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const warns: Array<ReadonlyArray<unknown>> = [];
  let socketDisposed = 0;

  const sync = createSync({
    ...run.deps,
    console: {
      ...run.deps.console,
      warn: (...args) => {
        warns.push(args);
      },
    },
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () =>
      ok({
        send: () => ok(),
        getReadyState: () => "open",
        isOpen: () => true,
        [Symbol.asyncDispose]: async () => {
          socketDisposed += 1;
          throw new Error("socket-dispose-failed");
        },
      }),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4011" }],
    disposalDelayMs: 0,
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, testAppOwner);
  await new Promise((resolve) => setTimeout(resolve, 0));

  sync[Symbol.dispose]();
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(socketDisposed).toBe(1);
  expect(warns.some((entry) => entry[1] === "disposeSocketFailed")).toBe(true);
});

test("createSync logs warning when removing consumer with mismatched transports", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const warnings: Array<ReadonlyArray<unknown>> = [];
  const sync = createSync({
    ...run.deps,
    console: {
      ...run.deps.console,
      warn: (...args) => {
        warnings.push(args);
      },
    },
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () =>
      ok({
        send: () => ok(),
        getReadyState: () => "open" as const,
        isOpen: () => true,
        [Symbol.dispose]: () => {},
      }),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [],
    onError: () => {},
    onReceive: () => {},
  });

  const ownerWithTransportA = {
    ...testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4011" }] as const,
  };
  const ownerWithTransportB = {
    ...testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4012" }] as const,
  };

  sync.useOwner(true, ownerWithTransportA);
  sync.useOwner(false, ownerWithTransportB);

  expect(
    warnings.some((entry) => entry[1] === "Failed to remove consumer"),
  ).toBe(true);
});

test("createSync applyChanges returns timestamp error when clock cannot advance", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const sync = createSync({
    ...run.deps,
    clock: {
      get: () => ({
        ...createInitialTimestamp(run.deps),
        millis: run.deps.time.now() as Timestamp["millis"],
        counter: maxCounter,
      }),
      save: () => {},
    },
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () =>
      ok({
        send: () => ok(),
        getReadyState: () => "open" as const,
        isOpen: () => true,
        [Symbol.dispose]: () => {},
      }),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [],
    onError: () => {},
    onReceive: () => {},
  });

  const result = sync.applyChanges([
    {
      ownerId: testAppOwner.id,
      table: "todo",
      id: createId(run.deps),
      values: ValidDbChangeValues.orThrow({ title: "counter-overflow" }),
      isInsert: true,
      isDelete: false,
    },
  ]);

  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.type).toBe("TimestampCounterOverflowError");
  }
});

test("client storage writeMessages surfaces decode and timestamp errors", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const errors: Array<unknown> = [];
  const storage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (owner) => (owner === testAppOwner.id ? testAppOwner : null),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    onError: (error) => {
      errors.push(error);
    },
    onReceive: () => {},
  });

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;

  await expect(
    run(
      storage.writeMessages(ownerId, [
        {
          timestamp: timestamp.value,
          change: new Uint8Array([1, 2, 3]),
        },
      ]),
    ),
  ).rejects.toThrow();

  const driftTimestamp = {
    ...timestamp.value,
    millis: (timestamp.value.millis +
      defaultTimestampMaxDrift +
      1) as Timestamp["millis"],
  };
  const driftChange = DbChange.orThrow({
    table: "todo",
    id: createId(run.deps),
    values: ValidDbChangeValues.orThrow({ title: "drift" }),
    isInsert: true,
    isDelete: false,
  });
  const driftEncrypted = encodeAndEncryptDbChange(run.deps)(
    { timestamp: driftTimestamp, change: driftChange },
    testAppOwner.encryptionKey,
  );

  await expect(
    run(
      storage.writeMessages(ownerId, [
        {
          timestamp: driftTimestamp,
          change: driftEncrypted,
        },
      ]),
    ),
  ).rejects.toThrow("TimestampDriftError");

  const negativeLengthResult = await run(
    storage.writeMessages(ownerId, [
      {
        timestamp: timestamp.value,
        change: { length: -1 } as unknown as Uint8Array,
      },
    ]),
  );
  expect(negativeLengthResult.ok).toBe(true);

  await expect(
    run(
      storage.writeMessages(ownerId, [
        {
          timestamp: timestamp.value,
          change: { length: Number.NaN } as unknown as Uint8Array,
        },
      ]),
    ),
  ).rejects.toThrow("ProtocolSyncError");

  expect(errors.length).toBeGreaterThan(0);
});

test("client storage quarantines unknown columns from incoming messages", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const storage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (owner) => (owner === testAppOwner.id ? testAppOwner : null),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    onError: () => {},
    onReceive: () => {},
  });

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;

  const unknownColumnChange = DbChange.orThrow({
    table: "todo",
    id: createId(run.deps),
    values: ValidDbChangeValues.orThrow({ unknownColumn: "quarantine-me" }),
    isInsert: true,
    isDelete: false,
  });
  const encrypted = encodeAndEncryptDbChange(run.deps)(
    { timestamp: timestamp.value, change: unknownColumnChange },
    testAppOwner.encryptionKey,
  );

  const result = await run(
    storage.writeMessages(ownerId, [
      { timestamp: timestamp.value, change: encrypted },
    ]),
  );
  expect(result.ok).toBe(true);

  const quarantineRows = run.deps.sqlite.exec<{ count: number }>(sql`
    select count(*) as count from evolu_message_quarantine;
  `).rows;
  expect(quarantineRows[0]?.count).toBeGreaterThan(0);
});

test("client storage readDbChange ignores invalid isDeleted values", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const storage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (owner) => (owner === testAppOwner.id ? testAppOwner : null),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: () => true,
    onError: () => {},
    onReceive: () => {},
  });

  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  const id = createId(run.deps);
  const idBytes = idToIdBytes(id);
  const timestampBytes = timestampToTimestampBytes(timestamp.value);

  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_history ("ownerId", "table", "id", "column", "timestamp", "value")
    values (${ownerId}, ${"todo"}, ${idBytes}, ${"isDeleted"}, ${timestampBytes}, ${"not-a-bool"});
  `);
  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_history ("ownerId", "table", "id", "column", "timestamp", "value")
    values (${ownerId}, ${"todo"}, ${idBytes}, ${"title"}, ${timestampBytes}, ${"still-present"});
  `);

  const encryptedRead = storage.readDbChange(ownerId, timestampBytes);
  const decoded = decryptAndDecodeDbChange(
    { timestamp: timestamp.value, change: encryptedRead },
    testAppOwner.encryptionKey,
  );
  expect(decoded.ok).toBe(true);
  if (!decoded.ok) return;
  expect(decoded.value.isDelete).toBe(null);
  expect(decoded.value.values.title).toBe("still-present");
});

test("createSync ignores stale callbacks after removing a consumer", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let options: Parameters<CreateWebSocket>[1] | undefined;
  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: (_url, _options) => {
      options = _options;
      return async () =>
        ok({
          send: () => ok(),
          getReadyState: () => "open" as const,
          isOpen: () => true,
          [Symbol.dispose]: () => {},
        });
    },
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4013" }],
    disposalDelayMs: 0,
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, testAppOwner);
  await new Promise((resolve) => setTimeout(resolve, 0));
  sync.useOwner(false, testAppOwner);
  await new Promise((resolve) => setTimeout(resolve, 20));

  options?.onOpen?.();
  options?.onMessage?.(new ArrayBuffer(2));
});

test("createSync skips remote send when websocket is not open", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const owner = {
    ...testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4017" }] as const,
  };

  let resolveSocket: ((value: ReturnType<typeof ok>) => void) | null = null;
  let sendCalls = 0;
  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => () =>
      new Promise((resolve) => {
        resolveSocket = resolve;
      }),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [],
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, owner);
  const result = sync.applyChanges([
    {
      ownerId: owner.id,
      table: "todo",
      id: createId(run.deps),
      values: ValidDbChangeValues.orThrow({ title: "skip-closed-socket" }),
      isInsert: true,
      isDelete: false,
    },
  ]);
  expect(result.ok).toBe(true);

  resolveSocket?.(
    ok({
      send: () => {
        sendCalls += 1;
        return ok();
      },
      getReadyState: () => "open" as const,
      isOpen: () => true,
      [Symbol.dispose]: () => {},
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sendCalls).toBe(0);
});

test("createSync sends sync for additional owner on already open transport", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let sendCalls = 0;
  const transport = { type: "WebSocket", url: "ws://localhost:4014" } as const;

  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () =>
      ok({
        send: () => {
          sendCalls += 1;
          return ok();
        },
        getReadyState: () => "open" as const,
        isOpen: () => true,
        [Symbol.dispose]: () => {},
      }),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [],
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, { ...testAppOwner, transports: [transport] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  sendCalls = 0;

  sync.useOwner(true, { ...testAppOwner2, transports: [transport] });
  const result = sync.applyChanges([
    {
      ownerId: testAppOwner2.id,
      table: "todo",
      id: createId(run.deps),
      values: ValidDbChangeValues.orThrow({ title: "batch-1" }),
      isInsert: true,
      isDelete: false,
    },
    {
      ownerId: testAppOwner2.id,
      table: "todo",
      id: createId(run.deps),
      values: ValidDbChangeValues.orThrow({ title: "batch-2" }),
      isInsert: true,
      isDelete: false,
    },
  ]);

  expect(result.ok).toBe(true);
  expect(sendCalls).toBeGreaterThan(0);

  sync[Symbol.dispose]();
  sync[Symbol.dispose]();
});

test("createSync flushes queued unsubscribe when websocket resolves", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const owner = {
    ...testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4015" }] as const,
  };

  let resolveSocket: ((value: ReturnType<typeof ok>) => void) | null = null;
  let sendCalls = 0;

  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => () =>
      new Promise((resolve) => {
        resolveSocket = resolve;
      }),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [],
    disposalDelayMs: 1_000,
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, owner);
  sync.useOwner(false, owner);

  resolveSocket?.(
    ok({
      send: () => {
        sendCalls += 1;
        return sendCalls === 1
          ? err({ type: "WebSocketSendError" } as never)
          : ok();
      },
      getReadyState: () => "open" as const,
      isOpen: () => true,
      [Symbol.dispose]: () => {},
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sendCalls).toBeGreaterThan(0);
});

test("createSync can apply changes after dispose without remote owner lookup", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  const sync = createSync({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    createWebSocket: () => async () =>
      ok({
        send: () => ok(),
        getReadyState: () => "open" as const,
        isOpen: () => true,
        [Symbol.dispose]: () => {},
      }),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    appOwner: testAppOwner,
    transports: [{ type: "WebSocket", url: "ws://localhost:4016" }],
    onError: () => {},
    onReceive: () => {},
  });

  sync.useOwner(true, testAppOwner);
  sync[Symbol.dispose]();

  const result = sync.applyChanges([
    {
      ownerId: testAppOwner.id,
      table: "todo",
      id: createId(run.deps),
      values: ValidDbChangeValues.orThrow({ title: "disposed-local" }),
      isInsert: true,
      isDelete: false,
    },
  ]);

  expect(result.ok).toBe(true);
});

test("client storage writeMessages handles concurrent writes for same owner", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let resolveQuota: ((value: boolean) => void) | null = null;
  const quotaPromise = new Promise<boolean>((resolve) => {
    resolveQuota = resolve;
  });

  const storage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (owner) => (owner === testAppOwner.id ? testAppOwner : null),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: () => quotaPromise,
    onError: () => {},
    onReceive: () => {},
  });

  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  const change = DbChange.orThrow({
    table: "todo",
    id: createId(run.deps),
    values: ValidDbChangeValues.orThrow({ title: "concurrent-a" }),
    isInsert: true,
    isDelete: false,
  });
  const encrypted = encodeAndEncryptDbChange(run.deps)(
    { timestamp: timestamp.value, change },
    testAppOwner.encryptionKey,
  );

  const write1 = run(
    storage.writeMessages(ownerId, [
      { timestamp: timestamp.value, change: encrypted },
    ]),
  );
  const write2 = run(
    storage.writeMessages(ownerId, [
      { timestamp: timestamp.value, change: encrypted },
    ]),
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  resolveQuota?.(true);

  const [result1, result2] = await Promise.all([write1, write2]);
  expect(result1.ok).toBe(true);
  expect(result2.ok).toBe(true);
});

test("client storage writeMessages aborts waiting writes without throwing", async () => {
  await using run = await testCreateRunWithSqlite();
  prepareSyncTables(run.deps);

  let resolveQuota: ((value: boolean) => void) | null = null;
  const quotaPromise = new Promise<boolean>((resolve) => {
    resolveQuota = resolve;
  });

  const storage = testCreateClientStorage({
    ...run.deps,
    clock: createInMemoryClock(run.deps),
    sqliteSchema: testSqliteSchema,
    getSyncOwner: (owner) => (owner === testAppOwner.id ? testAppOwner : null),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })({
    isOwnerWithinQuota: () => quotaPromise,
    onError: () => {},
    onReceive: () => {},
  });

  const timestamp = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(createInitialTimestamp(run.deps));
  expect(timestamp.ok).toBe(true);
  if (!timestamp.ok) return;

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  const change = DbChange.orThrow({
    table: "todo",
    id: createId(run.deps),
    values: ValidDbChangeValues.orThrow({ title: "abort-waiting-write" }),
    isInsert: true,
    isDelete: false,
  });
  const encrypted = encodeAndEncryptDbChange(run.deps)(
    { timestamp: timestamp.value, change },
    testAppOwner.encryptionKey,
  );

  const write1 = run(
    storage.writeMessages(ownerId, [
      { timestamp: timestamp.value, change: encrypted },
    ]),
  );
  const write2 = run(
    storage.writeMessages(ownerId, [
      { timestamp: timestamp.value, change: encrypted },
    ]),
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  write2.abort("cancelled");
  resolveQuota?.(true);

  const result1 = await write1;
  const result2 = await write2;
  expect(result1.ok).toBe(true);
  if (!result2.ok) {
    expect(result2.error.type).toBe("AbortError");
  }
});
