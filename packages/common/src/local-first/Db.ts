/**
 * Local-first database implementation.
 *
 * @module
 */

import {
  appendToArray,
  firstInArray,
  type NonEmptyArray,
  type NonEmptyReadonlyArray,
} from "../Array.js";
import { assertNonEmptyReadonlyArray } from "../Assert.js";
import type { ConsoleLevel } from "../Console.js";
import type {
  EncryptionKey,
  EncryptionKeyDep,
  RandomBytesDep,
} from "../Crypto.js";
import { getProperty, objectToEntries } from "../Object.js";
import type { RandomDep } from "../Random.js";
import { ok, type Result } from "../Result.js";
import type {
  CreateSqliteDriverDep,
  SqliteDep,
  SqliteRow,
  SqliteSchema,
} from "../Sqlite.js";
import {
  booleanToSqliteBoolean,
  createSqlite,
  type SqliteValue,
  sql,
} from "../Sqlite.js";
import type { AsyncDisposableStack, LeaderLockDep, Task } from "../Task.js";
import { type Millis, millisToDateIso, type TimeDep } from "../Time.js";
import type { Name } from "../Type.js";
import {
  type Id,
  type IdBytes,
  idBytesToId,
  idToIdBytes,
  PositiveInt,
} from "../Type.js";
import type { ExtractType } from "../Types.js";
import type {
  MessagePort,
  NativeMessagePort,
  Worker,
  WorkerDeps,
  WorkerSelf,
} from "../Worker.js";
import type { OwnerId, OwnerIdBytes } from "./Owner.js";
import { ownerIdBytesToOwnerId, ownerIdToOwnerIdBytes } from "./Owner.js";
import { encodeAndEncryptDbChange, protocolVersion } from "./Protocol.js";
import { deserializeQuery, type Query } from "./Query.js";
import type { MutationChange, SqliteSchemaDep } from "./Schema.js";
import {
  ensureSqliteSchema,
  getEvoluSqliteSchema,
  systemColumns,
} from "./Schema.js";
import type {
  DbWorkerInput,
  DbWorkerOutput,
  EvoluInput,
  QueuedResponse,
} from "./Shared.js";
import {
  type BaseSqliteStorageDep,
  type CrdtMessage,
  createBaseSqliteStorage,
  createBaseSqliteStorageTables,
  type DbChange,
  getNextStoredBytes,
  getOwnerUsage,
  getTimestampInsertStrategy,
  updateOwnerUsage,
} from "./Storage.js";
import type {
  Timestamp,
  TimestampCounterOverflowError,
  TimestampDriftError,
  TimestampTimeOutOfRangeError,
} from "./Timestamp.js";
import {
  createInitialTimestamp,
  defaultTimestampMaxDrift,
  sendTimestamp,
  type TimestampBytes,
  type TimestampConfigDep,
  timestampBytesToTimestamp,
  timestampToTimestampBytes,
} from "./Timestamp.js";

export type DbWorker = Worker<DbWorkerInit>;

export interface DbWorkerInit {
  readonly type: "Init";
  readonly name: Name;
  readonly consoleLevel: ConsoleLevel;
  readonly sqliteSchema: SqliteSchema;
  readonly encryptionKey: EncryptionKey;
  readonly port: NativeMessagePort<DbWorkerOutput, DbWorkerInput>;
}

export type CreateDbWorker = () => DbWorker;

export interface CreateDbWorkerDep {
  readonly createDbWorker: CreateDbWorker;
}

export type DbWorkerDeps = WorkerDeps & LeaderLockDep & CreateSqliteDriverDep;

export interface PortDep {
  readonly port: MessagePort<DbWorkerOutput, DbWorkerInput>;
}

const processedRequestIdsLimit = 10_000;

export const initDbWorker =
  (
    self: WorkerSelf<DbWorkerInit>,
  ): Task<AsyncDisposableStack, never, DbWorkerDeps> =>
  (run) => {
    const { leaderLock, createMessagePort, consoleStoreOutputEntry } = run.deps;
    const stack = run.stack();

    let initialized = false;

    self.onMessage = ({
      name,
      consoleLevel,
      sqliteSchema,
      encryptionKey,
      port: nativeLeaderPort,
    }) => {
      if (initialized) return;
      initialized = true;

      const console = run.deps.console.child(name).child("DbWorker");
      const port = stack.use(
        createMessagePort<DbWorkerOutput, DbWorkerInput>(nativeLeaderPort),
      );

      const unsubscribeConsoleStoreOutputEntry =
        consoleStoreOutputEntry.subscribe(() => {
          const entry = consoleStoreOutputEntry.get();
          if (entry) port.postMessage({ type: "OnConsoleEntry", entry });
        });
      stack.defer(() => {
        unsubscribeConsoleStoreOutputEntry();
        return ok();
      });

      // One DbWorker serves multiple tabs, so console level is global
      // here. The most recently initialized tab's level wins.
      console.setLevel(consoleLevel);
      console.info("initDbWorker");

      void run.daemon(async (run) => {
        await stack.use(leaderLock.acquire(name));
        console.info("leaderLock acquired");
        port.postMessage({ type: "LeaderAcquired", name });

        return await run.addDeps({
          port,
          timestampConfig: { maxDrift: defaultTimestampMaxDrift },
        })(startDbWorker(name, sqliteSchema, encryptionKey));
      });
    };

    return ok(stack);
  };

const startDbWorker =
  (
    name: Name,
    sqliteSchema: SqliteSchema,
    encryptionKey: EncryptionKey,
  ): Task<
    globalThis.AsyncDisposableStack,
    never,
    DbWorkerDeps & PortDep & TimestampConfigDep
  > =>
  async (run) => {
    await using stack = run.stack();

    const console = run.deps.console.child(name).child("DbWorker");
    console.info("startDbWorker");

    const sqliteResult = await stack.use(
      createSqlite(name, { mode: "encrypted", encryptionKey }),
    );
    if (!sqliteResult.ok) return sqliteResult;
    const sqlite = sqliteResult.value;
    console.info("SQLite created");

    const baseSqliteStorage = createBaseSqliteStorage({ sqlite, ...run.deps });

    const deps = {
      ...run.deps,
      sqlite,
      sqliteSchema,
      baseSqliteStorage,
      encryptionKey,
    };

    const currentSchema = getEvoluSqliteSchema(deps)();
    const dbIsInitialized = "evolu_version" in currentSchema.tables;
    const clock = createClock(deps)(dbIsInitialized);

    sqlite.transaction(() => {
      if (!dbIsInitialized) initializeDb(deps)(clock.get());
      ensureSqliteSchema(deps)(sqliteSchema, currentSchema);
      tryApplyQuarantinedMessages(deps);
    });

    /**
     * SharedWorker repeats sends until it gets a response, so handling here
     * must be idempotent and ignore already processed IDs.
     *
     * processedRequestIds combines a size-based bound with time-based
     * expiration to limit memory growth and reduce replay windows.
     */
    const processedRequestIds = new Set<Id>();
    const processedRequestIdsOrder: Array<{
      readonly id: Id;
      readonly processedAt: Millis;
    }> = [];
    const processedRequestIdTtl = 5 * 60 * 1000;

    const { port } = run.deps;

    port.onMessage = ({ callbackId, request, evoluPortId }) => {
      const now = run.deps.time.now();

      // Evict expired callback IDs based on time-to-live.
      while (processedRequestIdsOrder.length > 0) {
        const oldest = processedRequestIdsOrder[0];
        if (now - oldest.processedAt <= processedRequestIdTtl) break;
        processedRequestIdsOrder.shift();
        processedRequestIds.delete(oldest.id);
      }

      if (processedRequestIds.has(callbackId)) return;
      processedRequestIds.add(callbackId);
      processedRequestIdsOrder.push({ id: callbackId, processedAt: now });
      if (processedRequestIdsOrder.length > processedRequestIdsLimit) {
        const oldest = processedRequestIdsOrder.shift();
        if (oldest) processedRequestIds.delete(oldest.id);
      }

      // console.debug("onQueuedEvoluInput", callbackId);

      let result: Result<
        QueuedResponse,
        | TimestampDriftError
        | TimestampCounterOverflowError
        | TimestampTimeOutOfRangeError
      >;

      switch (request.type) {
        case "Mutate":
          result = handleMutation({ ...deps, clock })(request);
          break;
        case "Query":
          result = ok({
            type: "Query",
            rowsByQuery: loadQueries(deps)(request.queries),
          });
          break;
        case "Export":
          {
            const exported = deps.sqlite.export();
            const file = new Uint8Array(exported);
            result = ok({
              type: "Export",
              file,
            });
          }
          break;
      }

      if (!result.ok) {
        port.postMessage({ type: "OnError", error: result.error });
      } else {
        port.postMessage(
          {
            type: "OnQueuedResponse",
            callbackId,
            evoluPortId,
            response: result.value,
          },
          result.value.type === "Export"
            ? [result.value.file.buffer]
            : undefined,
        );
      }
    };

    return ok(stack.move());
  };

/**
 * Hybrid Logical Clock. Keeps the current timestamp in memory to avoid frequent
 * SQLite reads.
 */
interface Clock {
  readonly get: () => Timestamp;
  readonly save: (timestamp: Timestamp) => void;
}

interface ClockDep {
  readonly clock: Clock;
}

const createClock =
  (deps: RandomBytesDep & SqliteDep) =>
  (dbIsInitialized: boolean): Clock => {
    let currentTimestamp: Timestamp;

    if (dbIsInitialized) {
      const { rows } = deps.sqlite.exec<{ clock: TimestampBytes }>(sql`
        select clock
        from evolu_config
        limit 1;
      `);
      assertNonEmptyReadonlyArray(rows);
      currentTimestamp = timestampBytesToTimestamp(firstInArray(rows).clock);
    } else {
      currentTimestamp = createInitialTimestamp(deps);
    }

    return {
      get: () => currentTimestamp,

      save: (timestamp) => {
        currentTimestamp = timestamp;

        deps.sqlite.exec(sql.prepared`
          update evolu_config
          set "clock" = ${timestampToTimestampBytes(timestamp)};
        `);
      },
    };
  };

const initializeDb =
  ({ sqlite }: SqliteDep) =>
  (initialClock: Timestamp): void => {
    for (const query of [
      sql`
        create table evolu_version (
          "protocolVersion" integer not null
        )
        strict;
      `,

      sql`
        insert into evolu_version ("protocolVersion")
        values (${protocolVersion});
      `,

      sql`
        create table evolu_config (
          "clock" blob not null
        )
        strict;
      `,

      sql`
        insert into evolu_config ("clock")
        values (${timestampToTimestampBytes(initialClock)});
      `,

      /**
       * The History table stores all values per ownerId, timestamp, table, id,
       * and column for conflict-free merging using last-write-win CRDT.
       * Denormalizes Timestamp and DbChange for covering index performance.
       * Time travel is available when last-write-win isn't desired. Future
       * optimization will store history more efficiently.
       */
      sql`
        create table evolu_history (
          "ownerId" blob not null,
          "table" text not null,
          "id" blob not null,
          "column" text not null,
          "timestamp" blob not null,
          "value" any
        )
        strict;
      `,

      // Index for reading database changes by owner and timestamp.
      sql`
        create index evolu_history_ownerId_timestamp on evolu_history (
          "ownerId",
          "timestamp"
        );
      `,

      sql`
        create unique index evolu_history_ownerId_table_id_column_timestampDesc on evolu_history (
          "ownerId",
          "table",
          "id",
          "column",
          "timestamp" desc
        );
      `,

      /**
       * Stores messages with unknown schema in a quarantine table.
       *
       * When a device receives sync messages containing tables or columns that
       * don't exist in its current schema (e.g., from a newer app version),
       * those messages are stored here instead of being discarded. This enables
       * forward compatibility:
       *
       * 1. Unknown data is preserved and can be applied when the app is updated
       * 2. Messages are still propagated to other devices that may understand them
       * 3. Partial messages work - known columns go to app tables, unknown to
       *    quarantine
       *
       * The `union all` query in `readDbChange` combines `evolu_history` and
       * this table, ensuring all data (known and unknown) is included when
       * syncing to other devices.
       */
      sql`
        create table evolu_message_quarantine (
          "ownerId" blob not null,
          "timestamp" blob not null,
          "table" text not null,
          "id" blob not null,
          "column" text not null,
          "value" any,
          primary key ("ownerId", "timestamp", "table", "id", "column")
        )
        strict;
      `,
    ]) {
      sqlite.exec(query);
    }

    createBaseSqliteStorageTables({ sqlite });
  };

const tryApplyQuarantinedMessages = (
  deps: SqliteDep & SqliteSchemaDep,
): void => {
  const rows = deps.sqlite.exec<{
    readonly ownerId: OwnerIdBytes;
    readonly timestamp: TimestampBytes;
    readonly table: string;
    readonly id: IdBytes;
    readonly column: string;
    readonly value: SqliteValue;
  }>(sql`
    select "ownerId", "timestamp", "table", "id", "column", "value"
    from evolu_message_quarantine;
  `);

  for (const row of rows.rows) {
    if (!validateColumnValue(deps)(row.table, row.column, row.value)) continue;

    applyColumnChange(deps)(
      row.ownerId,
      ownerIdBytesToOwnerId(row.ownerId),
      row.table,
      row.id,
      idBytesToId(row.id),
      row.column,
      row.value,
      row.timestamp,
    );

    deps.sqlite.exec(sql`
      delete from evolu_message_quarantine
      where
        "ownerId" = ${row.ownerId}
        and "timestamp" = ${row.timestamp}
        and "table" = ${row.table}
        and "id" = ${row.id}
        and "column" = ${row.column};
    `);
  }
};

const validateColumnValue =
  (deps: SqliteSchemaDep) =>
  (table: string, column: string, _value: SqliteValue): boolean => {
    const schemaColumns = getProperty(deps.sqliteSchema.tables, table);
    return (
      schemaColumns != null &&
      (systemColumnsWithoutOwnerId.has(column) || schemaColumns.has(column))
    );
  };

const systemColumnsWithoutOwnerId: ReadonlySet<string> = (() => {
  const columns = new Set(systemColumns);
  columns.delete("ownerId");
  return columns;
})();

const applyColumnChange =
  (deps: SqliteDep) =>
  (
    ownerIdBytes: OwnerIdBytes,
    ownerId: OwnerId,
    table: string,
    idBytes: IdBytes,
    id: Id,
    column: string,
    value: SqliteValue,
    timestampBytes: TimestampBytes,
  ): void => {
    deps.sqlite.exec(sql.prepared`
      with
        existingTimestamp as (
          select 1
          from evolu_history
          where
            "ownerId" = ${ownerIdBytes}
            and "table" = ${table}
            and "id" = ${idBytes}
            and "column" = ${column}
            and "timestamp" >= ${timestampBytes}
          limit 1
        )
      insert into ${sql.identifier(table)}
        ("ownerId", "id", ${sql.identifier(column)})
      select ${ownerId}, ${id}, ${value}
      where not exists (select 1 from existingTimestamp)
      on conflict ("ownerId", "id") do update
        set ${sql.identifier(column)} = ${value}
        where not exists (select 1 from existingTimestamp);
    `);

    deps.sqlite.exec(sql.prepared`
      insert into evolu_history
        ("ownerId", "table", "id", "column", "value", "timestamp")
      values
        (
          ${ownerIdBytes},
          ${table},
          ${idBytes},
          ${column},
          ${value},
          ${timestampBytes}
        )
      on conflict do nothing;
    `);
  };

const handleMutation =
  (
    deps: BaseSqliteStorageDep &
      ClockDep &
      SqliteSchemaDep &
      EncryptionKeyDep &
      RandomDep &
      RandomBytesDep &
      SqliteDep &
      TimeDep &
      TimestampConfigDep,
  ) =>
  (
    message: ExtractType<EvoluInput, "Mutate">,
  ): Result<
    ExtractType<QueuedResponse, "Mutate">,
    | TimestampDriftError
    | TimestampCounterOverflowError
    | TimestampTimeOutOfRangeError
  > =>
    deps.sqlite.transaction(() => {
      const messagesByOwnerId = new Map<OwnerId, NonEmptyArray<CrdtMessage>>();
      let clockTimestamp = deps.clock.get();
      let clockChanged = false;

      for (const change of message.changes) {
        if (change.table.startsWith("_")) {
          applyLocalOnlyChange(deps)(change);
          continue;
        }

        const nextTimestamp = sendTimestamp(deps)(clockTimestamp);
        if (!nextTimestamp.ok) return nextTimestamp;

        clockTimestamp = nextTimestamp.value;
        clockChanged = true;

        const { ownerId, ...dbChange } = change;
        const message: CrdtMessage = {
          timestamp: clockTimestamp,
          change: dbChange,
        };

        const messages = messagesByOwnerId.get(ownerId);
        if (messages) messages.push(message);
        else messagesByOwnerId.set(ownerId, [message]);
      }

      for (const [ownerId, messages] of messagesByOwnerId) {
        const incomingBytes = PositiveInt.orThrow(
          messages.reduce(
            (sum, message) =>
              sum +
              encodeAndEncryptDbChange(deps)(message, deps.encryptionKey)
                .length,
            0,
          ),
        );
        applyMessages(deps)(ownerId, messages, incomingBytes);
      }

      if (clockChanged) deps.clock.save(clockTimestamp);

      const rowsByQuery = loadQueries(deps)(message.subscribedQueries);

      return ok({
        type: "Mutate",
        messagesByOwnerId,
        rowsByQuery,
      });
    });

const applyLocalOnlyChange =
  (deps: SqliteDep & TimeDep) =>
  (change: MutationChange): void => {
    if (change.isDelete) {
      deps.sqlite.exec(sql`
        delete from ${sql.identifier(change.table)}
        where id = ${change.id};
      `);
    } else {
      const ownerId = change.ownerId;
      const columns = dbChangeToColumns(change, deps.time.now());

      for (const [column, value] of columns) {
        deps.sqlite.exec(sql.prepared`
          insert into ${sql.identifier(change.table)}
            ("ownerId", "id", ${sql.identifier(column)})
          values (${ownerId}, ${change.id}, ${value})
          on conflict ("ownerId", "id") do update
            set ${sql.identifier(column)} = ${value};
        `);
      }
    }
  };

const applyMessages =
  (
    deps: BaseSqliteStorageDep &
      ClockDep &
      SqliteSchemaDep &
      RandomDep &
      SqliteDep,
  ) =>
  (
    ownerId: OwnerId,
    messages: NonEmptyReadonlyArray<CrdtMessage>,
    incomingBytes: PositiveInt,
  ): void => {
    const ownerIdBytes = ownerIdToOwnerIdBytes(ownerId);

    const usage = getOwnerUsage(deps)(
      ownerIdBytes,
      timestampToTimestampBytes(firstInArray(messages).timestamp),
    );
    if (!usage.ok) return;

    let { firstTimestamp, lastTimestamp } = usage.value;

    for (const { timestamp, change } of messages) {
      const columns = dbChangeToColumns(change, timestamp.millis);
      const idBytes = idToIdBytes(change.id);
      const timestampBytes = timestampToTimestampBytes(timestamp);

      for (const [column, value] of columns) {
        if (validateColumnValue(deps)(change.table, column, value)) {
          applyColumnChange(deps)(
            ownerIdBytes,
            ownerId,
            change.table,
            idBytes,
            change.id,
            column,
            value,
            timestampBytes,
          );
        } else {
          deps.sqlite.exec(sql.prepared`
            insert into evolu_message_quarantine
              ("ownerId", "timestamp", "table", "id", "column", "value")
            values
              (
                ${ownerIdBytes},
                ${timestampBytes},
                ${change.table},
                ${idBytes},
                ${column},
                ${value}
              )
            on conflict do nothing;
          `);
        }
      }

      let strategy;
      [strategy, firstTimestamp, lastTimestamp] = getTimestampInsertStrategy(
        timestampBytes,
        firstTimestamp,
        lastTimestamp,
      );

      deps.baseSqliteStorage.insertTimestamp(
        ownerIdBytes,
        timestampBytes,
        strategy,
      );
    }

    const nextStoredBytes = getNextStoredBytes(
      usage.value.storedBytes,
      incomingBytes,
    );
    updateOwnerUsage(deps)(
      ownerIdBytes,
      nextStoredBytes,
      firstTimestamp,
      lastTimestamp,
    );
  };

const dbChangeToColumns = (change: DbChange, now: Millis) => {
  let values = objectToEntries(change.values);

  // SystemColumns are not encoded in change.values.
  values = appendToArray(values, [
    change.isInsert ? "createdAt" : "updatedAt",
    millisToDateIso(now),
  ]);
  if (change.isDelete != null) {
    values = appendToArray(values, [
      "isDeleted",
      booleanToSqliteBoolean(change.isDelete),
    ]);
  }

  return values;
};

const loadQueries =
  (deps: SqliteDep) =>
  (queries: Iterable<Query>): Map<Query, ReadonlyArray<SqliteRow>> => {
    const rowsByQuery = new Map<Query, ReadonlyArray<SqliteRow>>();

    for (const query of queries) {
      const { rows } = deps.sqlite.exec(deserializeQuery(query));
      rowsByQuery.set(query, rows);
    }

    return rowsByQuery;
  };

export const testStartDbWorker = startDbWorker;
export const testCreateClock = createClock;
export const testInitializeDb = initializeDb;
export const testTryApplyQuarantinedMessages = tryApplyQuarantinedMessages;
export const testHandleMutation = handleMutation;

//   reset: (deps) => (message) => {
//     const result = deps.sqlite.transaction(() => {
//       const sqliteSchema = getEvoluSqliteSchema(deps)();
//       if (!sqliteSchema.ok) return sqliteSchema;

//       for (const tableName in sqliteSchema.value.tables) {
//         /**
//          * The dropped table is completely removed from the database schema and
//          * the disk file. The table can not be recovered. All indices and
//          * triggers associated with the table are also deleted.
//          * https://sqlite.org/lang_droptable.html
//          */
//         const result = deps.sqlite.exec(sql`
//           drop table ${sql.identifier(tableName)};
//         `);
//         if (!result.ok) return result;
//       }

//       if (message.restore) {
//         const result = ensureSqliteSchema(deps)(message.restore.sqliteSchema);
//         if (!result.ok) return result;

//         const secret = mnemonicToOwnerSecret(message.restore.mnemonic);
//         const appOwner = createAppOwner(secret);
//         const clock = createClock(deps)();

//         return initializeDb(deps)(appOwner, clock.get());
//       }

//       return ok();
//     });

//     if (!result.ok) {
//       deps.postMessage({ type: "onError", error: result.error });
//       return;
//     }

//     deps.postMessage({
//       type: "onReset",
//       onCompleteId: message.onCompleteId,
//       reload: message.reload,
//     });
//   },

//   ensureSqliteSchema: (deps) => (message) => {
//     const result = deps.sqlite.transaction(() =>
//       ensureSqliteSchema(deps)(message.sqliteSchema),
//     );

//     if (!result.ok) {
//       deps.postMessage({ type: "onError", error: result.error });
//       return;
//     }
//   },
