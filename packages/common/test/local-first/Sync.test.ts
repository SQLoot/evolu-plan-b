import { expect, test } from "vitest";
import { createBaseSqliteStorageTables } from "../../src/local-first/Storage.js";
import {
  createSync,
  defaultTimestampMaxDrift,
  initialSyncState,
} from "../../src/local-first/Sync.js";
import {
  createInitialTimestamp,
  type Timestamp,
} from "../../src/local-first/Timestamp.js";
import { ok } from "../../src/Result.js";
import type { SqliteDep } from "../../src/Sqlite.js";
import { sql } from "../../src/Sqlite.js";
import { createId } from "../../src/Type.js";
import type { CreateWebSocket } from "../../src/WebSocket.js";
import { testCreateRunWithSqlite } from "../_deps.js";
import { testAppOwner } from "./_fixtures.js";

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

const testDbSchema = {
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
    dbSchema: testDbSchema,
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
    dbSchema: testDbSchema,
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
    dbSchema: testDbSchema,
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
      values: { title: "Sync local insert" },
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
    dbSchema: testDbSchema,
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
