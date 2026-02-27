import { expect, test } from "vitest";
import {
  testCreateClock,
  testHandleMutation,
  testInitializeDb,
  testStartDbWorker,
  testTryApplyQuarantinedMessages,
} from "../../src/local-first/Db.js";
import { ownerIdToOwnerIdBytes } from "../../src/local-first/Owner.js";
import { serializeQuery } from "../../src/local-first/Query.js";
import type {
  DbWorkerInput,
  DbWorkerOutput,
} from "../../src/local-first/Shared.js";
import {
  createBaseSqliteStorage,
  ValidDbChangeValues,
} from "../../src/local-first/Storage.js";
import {
  createInitialTimestamp,
  defaultTimestampMaxDrift,
  sendTimestamp,
  timestampToTimestampBytes,
} from "../../src/local-first/Timestamp.js";
import { sql } from "../../src/Sqlite.js";
import { createId, idToIdBytes, SimpleName } from "../../src/Type.js";
import type { MessagePort } from "../../src/Worker.js";
import { testCreateRunWithSqlite } from "../_deps.js";
import { testAppOwner } from "./_fixtures.js";

const sqliteSchema = {
  tables: {
    todo: new Set(["title"]),
    _local_meta: new Set(["value"]),
  },
  indexes: [],
} as const;

const prepareTodoTables = (
  exec: (query: ReturnType<typeof sql>) => unknown,
) => {
  exec(sql`
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

  exec(sql`
    create table _local_meta (
      "id" text,
      "createdAt" any,
      "updatedAt" any,
      "isDeleted" any,
      "ownerId" any,
      "value" any,
      primary key ("ownerId", "id")
    )
    without rowid, strict;
  `);
};

type DbPortMessage = {
  readonly message: DbWorkerOutput;
  readonly transfer?: ReadonlyArray<Transferable>;
};

const createDbPort = (): {
  readonly port: MessagePort<DbWorkerOutput, DbWorkerInput>;
  readonly messages: Array<DbPortMessage>;
} => {
  const messages: Array<DbPortMessage> = [];

  return {
    port: {
      postMessage: (message, transfer) => {
        messages.push({ message, transfer });
      },
      onMessage: null,
      native: {} as never,
      [Symbol.dispose]: () => {},
    },
    messages,
  };
};

test("testHandleMutation writes local and shared changes", async () => {
  await using run = await testCreateRunWithSqlite();

  const initialTimestamp = createInitialTimestamp(run.deps);
  testInitializeDb(run.deps)(initialTimestamp);
  prepareTodoTables(run.deps.sqlite.exec);

  const deps = {
    ...run.deps,
    sqliteSchema,
    encryptionKey: testAppOwner.encryptionKey,
    baseSqliteStorage: createBaseSqliteStorage(run.deps),
    clock: testCreateClock(run.deps)(true),
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  };

  const todoId = createId(run.deps);
  const localId = createId(run.deps);
  const todoQuery = serializeQuery(sql`select title from todo order by title;`);

  const result = testHandleMutation(deps)({
    type: "Mutate",
    changes: [
      {
        ownerId: testAppOwner.id,
        table: "_local_meta",
        id: localId,
        values: ValidDbChangeValues.orThrow({ value: "local-only" }),
        isInsert: true,
        isDelete: false,
      },
      {
        ownerId: testAppOwner.id,
        table: "todo",
        id: todoId,
        values: ValidDbChangeValues.orThrow({ title: "todo-from-mutate" }),
        isInsert: true,
        isDelete: false,
      },
    ],
    onCompleteIds: [],
    subscribedQueries: new Set([todoQuery]),
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;

  expect(result.value.type).toBe("Mutate");
  expect(result.value.messagesByOwnerId.size).toBe(1);

  const todoRows = run.deps.sqlite.exec<{ title: string }>(sql`
    select title from todo order by title;
  `).rows;
  expect(todoRows).toEqual([{ title: "todo-from-mutate" }]);

  const localRows = run.deps.sqlite.exec<{ value: string }>(sql`
    select value from _local_meta;
  `).rows;
  expect(localRows).toEqual([{ value: "local-only" }]);
});

test("testTryApplyQuarantinedMessages applies known columns and keeps unknown", async () => {
  await using run = await testCreateRunWithSqlite();

  const initialTimestamp = createInitialTimestamp(run.deps);
  testInitializeDb(run.deps)(initialTimestamp);
  prepareTodoTables(run.deps.sqlite.exec);

  const ownerId = ownerIdToOwnerIdBytes(testAppOwner.id);
  const id = createId(run.deps);
  const idBytes = idToIdBytes(id);
  const timestamp = timestampToTimestampBytes(initialTimestamp);

  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_message_quarantine
      ("ownerId", "timestamp", "table", "id", "column", "value")
    values (${ownerId}, ${timestamp}, ${"todo"}, ${idBytes}, ${"title"}, ${"known"});
  `);
  run.deps.sqlite.exec(sql.prepared`
    insert into evolu_message_quarantine
      ("ownerId", "timestamp", "table", "id", "column", "value")
    values (${ownerId}, ${timestamp}, ${"todo"}, ${idBytes}, ${"unknownColumn"}, ${"unknown"});
  `);

  testTryApplyQuarantinedMessages({
    sqlite: run.deps.sqlite,
    sqliteSchema,
  });

  const todoRows = run.deps.sqlite.exec<{ title: string }>(sql`
    select title from todo;
  `).rows;
  expect(todoRows).toEqual([{ title: "known" }]);

  const remainingRows = run.deps.sqlite.exec<{ count: number }>(sql`
    select count(*) as count from evolu_message_quarantine;
  `).rows;
  expect(remainingRows[0]?.count).toBe(1);
});

test("testCreateClock persists saved timestamp to evolu_config", async () => {
  await using run = await testCreateRunWithSqlite();

  const initialTimestamp = createInitialTimestamp(run.deps);
  testInitializeDb(run.deps)(initialTimestamp);

  const clock = testCreateClock(run.deps)(true);
  const next = sendTimestamp({
    ...run.deps,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(clock.get());
  expect(next.ok).toBe(true);
  if (!next.ok) return;

  clock.save(next.value);

  const row = run.deps.sqlite.exec<{ clock: Uint8Array }>(sql`
    select clock from evolu_config limit 1;
  `).rows[0];
  expect(Array.from(row?.clock ?? [])).toEqual(
    Array.from(timestampToTimestampBytes(next.value)),
  );
});

test("testStartDbWorker handles Query, Mutate, Export and callback dedupe", async () => {
  await using run = await testCreateRunWithSqlite();
  const { port, messages } = createDbPort();

  const workerName = SimpleName.orThrow(`DbWorker${Date.now()}`);
  const task = testStartDbWorker(
    workerName,
    sqliteSchema,
    testAppOwner.encryptionKey,
  );
  const started = await run.addDeps({
    port,
    timestampConfig: { maxDrift: defaultTimestampMaxDrift },
  })(task);
  expect(started.ok).toBe(true);
  if (!started.ok) return;

  const query = serializeQuery(sql`select 'query-ok' as "value";`);
  const callbackIdQuery = createId(run.deps);
  const evoluPortId = createId(run.deps);

  port.onMessage?.({
    callbackId: callbackIdQuery,
    evoluPortId,
    request: {
      type: "Query",
      queries: new Set([query]),
    },
  });

  const callbackIdMutate = createId(run.deps);
  port.onMessage?.({
    callbackId: callbackIdMutate,
    evoluPortId,
    request: {
      type: "Mutate",
      changes: [
        {
          ownerId: testAppOwner.id,
          table: "_local_meta",
          id: createId(run.deps),
          values: ValidDbChangeValues.orThrow({ value: "mutate-from-worker" }),
          isInsert: true,
          isDelete: false,
        },
      ],
      onCompleteIds: [],
      subscribedQueries: new Set([query]),
    },
  });

  const callbackIdExport = createId(run.deps);
  port.onMessage?.({
    callbackId: callbackIdExport,
    evoluPortId,
    request: {
      type: "Export",
    },
  });

  const countBeforeDuplicate = messages.length;
  port.onMessage?.({
    callbackId: callbackIdExport,
    evoluPortId,
    request: {
      type: "Query",
      queries: new Set([query]),
    },
  });
  expect(messages.length).toBe(countBeforeDuplicate);

  const responseTypes = messages
    .filter(
      (
        item,
      ): item is {
        readonly message: Extract<DbWorkerOutput, { type: "OnQueuedResponse" }>;
      } => item.message.type === "OnQueuedResponse",
    )
    .map((item) => item.message.response.type);
  expect(responseTypes).toEqual(["Query", "Mutate", "Export"]);

  const exportMessage = messages.find(
    (item) =>
      item.message.type === "OnQueuedResponse" &&
      item.message.response.type === "Export",
  );
  expect(exportMessage?.transfer?.length).toBe(1);
});
