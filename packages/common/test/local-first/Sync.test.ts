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
  createSync,
  initialSyncState,
  testCreateClientStorage,
} from "../../src/local-first/Sync.js";
import {
  createInitialTimestamp,
  defaultTimestampMaxDrift,
  sendTimestamp,
  type Timestamp,
  timestampToTimestampBytes,
} from "../../src/local-first/Timestamp.js";
import { err, ok } from "../../src/Result.js";
import type { SqliteDep } from "../../src/Sqlite.js";
import { sql } from "../../src/Sqlite.js";
import { createId } from "../../src/Type.js";
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
