/**
 * Synchronization logic between client and relay.
 *
 * @module
 */

import type { NonEmptyArray, NonEmptyReadonlyArray } from "../Array.js";
import {
  appendToArray,
  firstInArray,
  isNonEmptyArray,
  mapArray,
} from "../Array.js";
import { assert, assertNonEmptyReadonlyArray } from "../Assert.js";
import type { Brand } from "../Brand.js";
import type { ConsoleDep } from "../Console.js";
import type {
  DecryptWithXChaCha20Poly1305Error,
  RandomBytesDep,
} from "../Crypto.js";
import type { UnknownError } from "../Error.js";
import { createUnknownError } from "../Error.js";
import { createInstances } from "../Instances.js";
import { createRecord, getProperty, objectToEntries } from "../Object.js";
import type { RandomDep } from "../Random.js";
import { createRefCount } from "../RefCount.js";
import { createResources } from "../Resources.js";
import type { Result } from "../Result.js";
import { err, ok } from "../Result.js";
import type { SqliteDep } from "../Sqlite.js";
import {
  booleanToSqliteBoolean,
  SqliteBoolean,
  type SqliteValue,
  sql,
  sqliteBooleanToBoolean,
} from "../Sqlite.js";
import { createMutex, createRun } from "../Task.js";
import type { TimeDep } from "../Time.js";
import { Millis, millisToDateIso } from "../Time.js";
import type { Typed } from "../Type.js";
import {
  type Id,
  type IdBytes,
  idBytesToId,
  idToIdBytes,
  PositiveInt,
} from "../Type.js";
import { isPromiseLike } from "../Types.js";
import type { CreateWebSocketDep, WebSocket } from "../WebSocket.js";
import type {
  AppOwner,
  AppOwnerDep,
  Owner,
  OwnerTransport,
  OwnerWriteKey,
  ReadonlyOwner,
} from "./Owner.js";
import {
  type OwnerId,
  type OwnerIdBytes,
  ownerIdBytesToOwnerId,
  ownerIdToOwnerIdBytes,
} from "./Owner.js";
import type {
  ProtocolError,
  ProtocolInvalidDataError,
  ProtocolQuotaError,
  ProtocolSyncError,
  ProtocolTimestampMismatchError,
} from "./Protocol.js";
import {
  createProtocolMessageForSync,
  createProtocolMessageForUnsubscribe,
  createProtocolMessageFromCrdtMessages,
  decryptAndDecodeDbChange,
  encodeAndEncryptDbChange,
  SubscriptionFlags,
} from "./Protocol.js";
import type { MutationChange, SqliteSchemaDep } from "./Schema.js";
import { systemColumns } from "./Schema.js";
import type {
  BaseSqliteStorage,
  CrdtMessage,
  Storage,
  StorageConfig,
} from "./Storage.js";
import {
  createBaseSqliteStorage,
  DbChange,
  getNextStoredBytes,
  getOwnerUsage,
  getTimestampInsertStrategy,
  updateOwnerUsage,
} from "./Storage.js";
import type {
  Timestamp,
  TimestampBytes,
  TimestampConfigDep,
  TimestampCounterOverflowError,
  TimestampDriftError,
  TimestampTimeOutOfRangeError,
} from "./Timestamp.js";
import {
  createInitialTimestamp,
  receiveTimestamp,
  sendTimestamp,
  timestampBytesToTimestamp,
  timestampToTimestampBytes,
} from "./Timestamp.js";

export interface Sync extends Disposable {
  /**
   * Assigns or removes an owner to/from transports with reference counting.
   *
   * Owners are only synced if assigned to at least one transport. Uses
   * `owner.transports` or falls back to {@link SyncConfig} transports. Multiple
   * calls increment/decrement reference counts (useful for React Hooks).
   */
  readonly useOwner: (use: boolean, owner: SyncOwner) => void;

  readonly applyChanges: (
    changes: NonEmptyReadonlyArray<MutationChange>,
  ) => Result<
    void,
    | TimestampCounterOverflowError
    | TimestampDriftError
    | TimestampTimeOutOfRangeError
  >;
}

export interface SyncDep {
  readonly sync: Sync;
}

/**
 * Represents an owner for sync operations.
 *
 * Includes readonly owner fields plus optional write key (for clients that
 * write) and optional transports to override SyncConfig transports per owner.
 */
export interface SyncOwner extends ReadonlyOwner {
  readonly writeKey?: Owner["writeKey"];
  readonly transports?: ReadonlyArray<OwnerTransport>;
}

export interface SyncConfig {
  readonly appOwner: AppOwner;

  readonly transports: ReadonlyArray<OwnerTransport>;

  readonly isOwnerWithinQuota?: StorageConfig["isOwnerWithinQuota"];

  /**
   * Delay in milliseconds before disposing unused WebSocket connections.
   * Defaults to 100ms.
   */
  readonly disposalDelayMs?: number;

  readonly onError: (
    error:
      | ProtocolError
      | ProtocolInvalidDataError
      | ProtocolTimestampMismatchError
      | DecryptWithXChaCha20Poly1305Error
      | TimestampCounterOverflowError
      | TimestampDriftError
      | TimestampTimeOutOfRangeError
      | UnknownError,
  ) => void;

  readonly onReceive: () => void;
}

export const createSync =
  (
    deps: ClockDep &
      ConsoleDep &
      CreateWebSocketDep &
      SqliteSchemaDep &
      // PostMessageDep &
      RandomBytesDep &
      RandomDep &
      SqliteDep &
      TimeDep &
      TimestampConfigDep,
  ) =>
  (config: SyncConfig): Sync => {
    let isDisposed = false;
    const disposalDelayResult =
      config.disposalDelayMs == null
        ? ok(Millis.orThrow(100))
        : Millis.from(config.disposalDelayMs);

    assert(
      disposalDelayResult.ok,
      "Invalid SyncConfig.disposalDelayMs: expected a non-negative integer.",
    );
    const disposalDelay = disposalDelayResult.value;

    /** Returns owner data only if actively assigned to at least one transport. */
    const getSyncOwner = (ownerId: OwnerId): SyncOwner | null => {
      if (isDisposed) return null;
      return resources.getConsumer(ownerId);
    };

    const storage = createClientStorage({
      ...deps,
      getSyncOwner,
    })(config);

    const createResource = (transport: OwnerTransport): WebSocket => {
      const transportKey = createTransportKey(transport);

      deps.console.log("[sync]", "createWebSocket", {
        transportKey,
        url: transport.url,
      });

      const run = createRun(deps);
      let socket: WebSocket | null = null;
      let isDisposed = false;
      const pendingSends: Array<
        string | ArrayBufferLike | Blob | ArrayBufferView
      > = [];

      const flushPendingSends = (): void => {
        if (isDisposed || !socket || pendingSends.length === 0) return;

        for (const data of pendingSends.splice(0, pendingSends.length)) {
          const result = socket.send(data);
          if (!result.ok) {
            deps.console.warn("[sync]", "flushPendingSendFailed", {
              transportKey,
            });
            break;
          }
        }
      };

      const webSocket: WebSocket = {
        send: (data) => {
          if (isDisposed) return err({ type: "WebSocketSendError" });
          if (!socket) {
            pendingSends.push(data);
            return ok();
          }
          return socket.send(data);
        },

        /* v8 ignore next */
        getReadyState: () => {
          if (isDisposed) return "closed";
          return socket?.getReadyState() ?? "connecting";
        },

        isOpen: () => !isDisposed && (socket?.isOpen() ?? false),

        [Symbol.dispose]: () => {
          if (isDisposed) return;
          isDisposed = true;
          pendingSends.length = 0;
          socket?.[Symbol.dispose]();
          void run[Symbol.asyncDispose]();
        },
      };

      void run(
        deps.createWebSocket(transport.url, {
          binaryType: "arraybuffer",

          onOpen: () => {
            if (isDisposed) return;

            const currentWebSocket = resources.getResource(transportKey);
            if (!currentWebSocket) return;

            const ownerIds = resources.getConsumersForResource(transportKey);
            deps.console.log("[sync]", "onOpen", { transportKey, ownerIds });

            for (const ownerId of ownerIds) {
              const message = createProtocolMessageForSync({
                storage,
                console: deps.console,
              })(ownerId, SubscriptionFlags.Subscribe);
              if (!message) continue;
              deps.console.log("[sync]", "send", { message });
              currentWebSocket.send(message);
            }
          },

          onClose: (event) => {
            deps.console.log("[sync]", "onClose", {
              transportKey,
              code: event.code,
              reason: event.reason,
              wasClean: event.wasClean,
            });
          },

          onError: (error) => {
            deps.console.warn("[sync]", "onError", { transportKey, error });
          },

          onMessage: (data: string | ArrayBuffer | Blob) => {
            // Only handle ArrayBuffer data for sync messages.
            if (isDisposed || !(data instanceof ArrayBuffer)) return;

            const currentWebSocket = resources.getResource(transportKey);
            if (!currentWebSocket) return;

            const input = new Uint8Array(data);
            deps.console.log("[sync]", "onMessage", {
              transportKey,
              message: input,
            });

            // TODO: Re-enable protocol message application once worker bridge is ready.
            // Keep current behavior explicit and observable for transport lifecycle tests.
          },
        }),
      ).then(
        (result) => {
          if (!result.ok) {
            if (result.error.type !== "AbortError") {
              config.onError(createUnknownError(result.error));
            }
            return;
          }

          socket = result.value;
          flushPendingSends();

          if (isDisposed) {
            socket[Symbol.dispose]();
          }
        },
        (error: unknown) => {
          if (isDisposed) return;
          config.onError(createUnknownError(error));
        },
      );

      return webSocket;
    };

    const resources = createResources<
      WebSocket,
      TransportKey,
      OwnerTransport,
      SyncOwner,
      OwnerId
    >(deps)({
      createResource,
      getResourceKey: createTransportKey,
      getConsumerId: (owner) => owner.id,
      disposalDelay,

      onConsumerAdded: (owner, webSocket) => {
        deps.console.log("[sync]", "onConsumerAdded", {
          ownerId: owner.id,
          isOpen: webSocket.isOpen(),
        });

        // The onOpen handler will sync it.
        if (!webSocket.isOpen()) return;
        const message = createProtocolMessageForSync({
          storage,
          console: deps.console,
        })(owner.id, SubscriptionFlags.Subscribe);
        if (message) webSocket.send(message);
      },

      onConsumerRemoved: (owner, webSocket) => {
        deps.console.log("[sync]", "onConsumerRemoved", {
          ownerId: owner.id,
          isOpen: webSocket.isOpen(),
        });

        const message = createProtocolMessageForUnsubscribe(owner.id);
        webSocket.send(message);
      },
    });

    const sync: Sync = {
      useOwner: (use, owner) => {
        if (isDisposed) {
          deps.console.warn(
            "[sync]",
            "useOwner called on disposed Sync instance",
            { owner },
          );
          return;
        }

        deps.console.log("[sync]", "useOwner", { use, owner });
        const transports = owner.transports ?? config.transports;

        if (use) {
          resources.addConsumer(owner, transports);
        } else {
          const result = resources.removeConsumer(owner, transports);
          if (!result.ok) {
            deps.console.warn("[sync]", "Failed to remove consumer", {
              transports,
              ownerId: owner.id,
              error: result.error,
            });
          }
        }
      },

      applyChanges: (changes) => {
        deps.console.log("[sync]", "applyChanges", { changes });

        let clockTimestamp = deps.clock.get();
        const ownerMessages = new Map<OwnerId, NonEmptyArray<CrdtMessage>>();

        for (const change of changes) {
          const nextTimestamp = sendTimestamp(deps)(clockTimestamp);
          if (!nextTimestamp.ok) return nextTimestamp;
          clockTimestamp = nextTimestamp.value;

          const { ownerId, ...dbChange } = change;
          const message: CrdtMessage = {
            timestamp: clockTimestamp,
            change: dbChange,
          };

          const messages = ownerMessages.get(ownerId);
          if (messages) messages.push(message);
          else ownerMessages.set(ownerId, [message]);
        }

        for (const [ownerId, messages] of ownerMessages) {
          const owner = getSyncOwner(ownerId);
          const encryptionKey =
            owner?.encryptionKey ?? config.appOwner.encryptionKey;
          const incomingBytes = PositiveInt.orThrow(
            messages.reduce(
              (sum, message) =>
                sum +
                encodeAndEncryptDbChange(deps)(message, encryptionKey).length,
              0,
            ),
          );

          applyMessages({ ...deps, storage })(ownerId, messages, incomingBytes);

          if (!owner?.writeKey) continue;

          const message = createProtocolMessageFromCrdtMessages(deps)(
            {
              id: owner.id,
              encryptionKey: owner.encryptionKey,
              writeKey: owner.writeKey,
            },
            messages,
          );

          const transports = owner.transports ?? config.transports;

          // Send message to all transports for this owner
          for (const transport of transports) {
            const transportKey = createTransportKey(transport);

            const webSocket = resources.getResource(transportKey);
            if (!webSocket) continue;

            if (webSocket.isOpen()) {
              deps.console.log("[sync]", "send", { transportKey, message });
              webSocket.send(message);
            }
          }
        }

        deps.clock.save(clockTimestamp);
        return ok();
      },

      [Symbol.dispose]: () => {
        if (isDisposed) return;
        isDisposed = true;
        resources[Symbol.dispose]();
      },
    };

    return sync;
  };

export interface ClockDep {
  readonly clock: Clock;
}

export interface Clock {
  readonly get: () => Timestamp;
  readonly save: (timestamp: Timestamp) => void;
}

export const createClock =
  (deps: RandomBytesDep & SqliteDep) =>
  (initialTimestamp = createInitialTimestamp(deps)): Clock => {
    let currentTimestamp = initialTimestamp;

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

interface GetSyncOwnerDep {
  readonly getSyncOwner: (ownerId: OwnerId) => SyncOwner | null;
}

export interface ClientStorage extends Storage, BaseSqliteStorage {}

export interface ClientStorageDep {
  readonly storage: ClientStorage;
}

const createClientStorage =
  (
    deps: ClockDep &
      ConsoleDep &
      SqliteSchemaDep &
      GetSyncOwnerDep &
      RandomBytesDep &
      RandomDep &
      SqliteDep &
      TimeDep &
      TimestampConfigDep,
  ) =>
  (
    config: Pick<SyncConfig, "isOwnerWithinQuota" | "onError" | "onReceive">,
  ): ClientStorage => {
    const sqliteStorageBase = createBaseSqliteStorage(deps);
    deps.sqlite.exec(sql`
      create table if not exists evolu_writeKey (
        "ownerId" blob primary key,
        "writeKey" blob not null
      )
      strict;
    `);

    const ownerMutexes = createInstances<
      OwnerId,
      ReturnType<typeof createMutex>
    >();
    const ownerMutexRefs = createRefCount<OwnerId>();

    const storage: ClientStorage = {
      ...sqliteStorageBase,

      validateWriteKey: (ownerId, writeKey) => {
        deps.sqlite.exec(sql`
          insert into evolu_writeKey (ownerId, writeKey)
          values (${ownerId}, ${writeKey})
          on conflict (ownerId) do nothing;
        `);

        const selectWriteKey = deps.sqlite.exec<{ writeKey: OwnerWriteKey }>(
          sql`
            select writeKey
            from evolu_writeKey
            where ownerId = ${ownerId};
          `,
        );

        if (!isNonEmptyArray(selectWriteKey.rows)) return false;

        return isSameWriteKey(selectWriteKey.rows[0].writeKey, writeKey);
      },

      setWriteKey: (ownerId, writeKey) => {
        deps.sqlite.exec(sql`
          insert into evolu_writeKey (ownerId, writeKey)
          values (${ownerId}, ${writeKey})
          on conflict (ownerId) do update
            set writeKey = excluded.writeKey;
        `);
      },

      writeMessages: (ownerIdBytes, encryptedMessages) => async (run) => {
        const ownerId = ownerIdBytesToOwnerId(ownerIdBytes);
        const ownerMutex = ownerMutexes.ensure(ownerId, createMutex);
        ownerMutexRefs.increment(ownerId);

        const result = await (async () => {
          try {
            return await run(
              ownerMutex.withLock(
                async (): Promise<
                  Result<
                    boolean,
                    | ProtocolInvalidDataError
                    | ProtocolQuotaError
                    | ProtocolSyncError
                    | ProtocolTimestampMismatchError
                    | DecryptWithXChaCha20Poly1305Error
                    | TimestampCounterOverflowError
                    | TimestampDriftError
                    | TimestampTimeOutOfRangeError
                  >
                > => {
                  const owner = deps.getSyncOwner(ownerId);
                  // Owner can be removed during syncing.
                  // `ok(true)` means success, we just skipped the write.
                  if (!owner) return ok(true);

                  // Check quota before accepting collaborative data.

                  const messagesWithTimestampBytes = mapArray(
                    encryptedMessages,
                    (message) => ({
                      message,
                      timestampBytes: timestampToTimestampBytes(
                        message.timestamp,
                      ),
                    }),
                  );
                  const existingTimestampsSet = new Set(
                    sqliteStorageBase
                      .getExistingTimestamps(
                        ownerIdBytes,
                        mapArray(
                          messagesWithTimestampBytes,
                          (item) => item.timestampBytes,
                        ),
                      )
                      .map((timestamp) => timestamp.toString()),
                  );
                  const seenNewTimestamps = new Set<string>();
                  const newMessagesWithTimestampBytes: Array<{
                    message: (typeof encryptedMessages)[number];
                    timestampBytes: TimestampBytes;
                  }> = [];
                  for (const item of messagesWithTimestampBytes) {
                    const key = item.timestampBytes.toString();
                    if (
                      item.message.change.length === 0 ||
                      existingTimestampsSet.has(key) ||
                      seenNewTimestamps.has(key)
                    ) {
                      continue;
                    }
                    seenNewTimestamps.add(key);
                    newMessagesWithTimestampBytes.push(item);
                  }
                  if (!isNonEmptyArray(newMessagesWithTimestampBytes))
                    return ok(true);

                  const incomingBytesSum = newMessagesWithTimestampBytes.reduce(
                    (sum, { message }) => sum + message.change.length,
                    0,
                  );
                  if (incomingBytesSum <= 0) return ok(true);
                  const incomingBytesResult =
                    PositiveInt.from(incomingBytesSum);
                  if (!incomingBytesResult.ok) {
                    return err<ProtocolSyncError>({
                      type: "ProtocolSyncError",
                      ownerId,
                    });
                  }
                  const incomingBytes = incomingBytesResult.value;
                  const usage = getOwnerUsage(deps)(
                    ownerIdBytes,
                    firstInArray(newMessagesWithTimestampBytes).timestampBytes,
                  );
                  /* v8 ignore next */
                  if (!usage.ok) {
                    return err<ProtocolSyncError>({
                      type: "ProtocolSyncError",
                      ownerId,
                    });
                  }

                  const requiredBytes = getNextStoredBytes(
                    usage.value.storedBytes,
                    incomingBytes,
                  );
                  const quotaResult = config.isOwnerWithinQuota?.(
                    ownerId,
                    requiredBytes,
                  );
                  const isWithinQuota =
                    quotaResult == null
                      ? true
                      : isPromiseLike(quotaResult)
                        ? await quotaResult
                        : quotaResult;
                  if (!isWithinQuota) {
                    return err<ProtocolQuotaError>({
                      type: "ProtocolQuotaError",
                      ownerId,
                    });
                  }

                  const messages: Array<CrdtMessage> = [];

                  for (const { message } of newMessagesWithTimestampBytes) {
                    const change = decryptAndDecodeDbChange(
                      message,
                      owner.encryptionKey,
                    );
                    if (!change.ok) return change;

                    messages.push({
                      timestamp: message.timestamp,
                      change: change.value,
                    });
                  }

                  const transaction = deps.sqlite.transaction(() => {
                    let clockTimestamp = deps.clock.get();

                    for (const message of messages) {
                      const nextTimestamp = receiveTimestamp(deps)(
                        clockTimestamp,
                        message.timestamp,
                      );
                      if (!nextTimestamp.ok) return nextTimestamp;

                      clockTimestamp = nextTimestamp.value;
                    }

                    if (isNonEmptyArray(messages)) {
                      applyMessages({ ...deps, storage })(
                        owner.id,
                        messages,
                        incomingBytes,
                      );
                    }

                    deps.clock.save(clockTimestamp);
                    return ok();
                  });

                  if (!transaction.ok) return transaction;

                  return ok(true);
                },
              ),
            );
          } finally {
            ownerMutexRefs.decrement(ownerId);
            if (!ownerMutexRefs.has(ownerId)) {
              ownerMutexes.delete(ownerId);
            }
          }
        })();

        if (!result.ok) {
          if (result.error.type !== "AbortError") {
            config.onError(result.error);
            throw new Error(result.error.type, { cause: result.error });
          }
          return ok();
        }

        config.onReceive();

        return ok();
      },

      readDbChange: (ownerId, timestamp) => {
        const owner = deps.getSyncOwner(ownerIdBytesToOwnerId(ownerId));
        assert(owner, "Sync owner must exist while reading db change");

        const result = deps.sqlite.exec<{
          readonly table: string;
          readonly id: IdBytes;
          readonly column: string;
          readonly value: SqliteValue;
        }>(sql`
          select "table", "id", "column", "value"
          from evolu_history
          where "ownerId" = ${ownerId} and "timestamp" = ${timestamp}
          union all
          select "table", "id", "column", "value"
          from evolu_message_quarantine
          where "ownerId" = ${ownerId} and "timestamp" = ${timestamp};
        `);

        const { rows } = result;
        assertNonEmptyReadonlyArray(rows, "Every timestamp must have rows");
        const firstRow = firstInArray(rows);

        const values = createRecord<string, SqliteValue>();
        let isInsert: DbChange["isInsert"] = false;
        let isDelete: DbChange["isDelete"] = null;

        for (const r of rows) {
          switch (r.column) {
            case "createdAt":
              isInsert = true;
              break;
            case "updatedAt":
              isInsert = false;
              break;
            case "isDeleted":
              if (SqliteBoolean.is(r.value)) {
                isDelete = sqliteBooleanToBoolean(r.value);
              }
              break;
            default:
              values[r.column] = r.value;
          }
        }

        const message: CrdtMessage = {
          timestamp: timestampBytesToTimestamp(timestamp),
          change: DbChange.orThrow({
            table: firstRow.table,
            id: idBytesToId(firstRow.id),
            values,
            isInsert,
            isDelete,
          }),
        };

        return encodeAndEncryptDbChange(deps)(message, owner.encryptionKey);
      },
    };

    return storage;
  };

export const testCreateClientStorage = createClientStorage;

const isSameWriteKey = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
};

type TransportKey = string & Brand<"TransportKey">;

/** Creates a unique identifier for a {@link OwnerTransport}. */
const createTransportKey = (transport: OwnerTransport): TransportKey =>
  `${transport.type}:${transport.url}` as TransportKey;

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

export const applyLocalOnlyChange =
  (deps: SqliteDep & TimeDep & AppOwnerDep) =>
  (change: MutationChange): void => {
    if (change.isDelete) {
      deps.sqlite.exec(sql`
        delete from ${sql.identifier(change.table)}
        where id = ${change.id};
      `);
    } else {
      const ownerId = deps.appOwner.id;
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
    deps: ClientStorageDep &
      ClockDep &
      ConsoleDep &
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
    const firstMessageTimestamp = timestampToTimestampBytes(
      firstInArray(messages).timestamp,
    );

    const usage = getOwnerUsage(deps)(ownerIdBytes, firstMessageTimestamp);
    /* v8 ignore next */
    if (!usage.ok) {
      deps.console.error("[sync]", "applyMessages/getOwnerUsage failed", {
        ownerId,
        ownerIdBytes,
        firstMessageTimestamp,
        error: usage.error,
      });
      return;
    }

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

      deps.storage.insertTimestamp(ownerIdBytes, timestampBytes, strategy);
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

/**
 * System columns that can appear in sync messages. Excludes `ownerId` because
 * it's handled separately (stored per-row, not per-column in messages).
 */
const systemColumnsWithoutOwnerId: ReadonlySet<string> = (() => {
  const columns = new Set(systemColumns);
  columns.delete("ownerId");
  return columns;
})();

const validateColumnValue =
  (deps: SqliteSchemaDep) =>
  (table: string, column: string, _value: SqliteValue): boolean => {
    const schemaColumns = getProperty(deps.sqliteSchema.tables, table);
    return (
      schemaColumns != null &&
      (systemColumnsWithoutOwnerId.has(column) || schemaColumns.has(column))
    );
  };

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

/**
 * Attempts to apply quarantined messages that may now be valid after a schema
 * update. Messages are quarantined when they reference tables or columns that
 * don't exist in the current schema (e.g., from a newer app version).
 */
export const tryApplyQuarantinedMessages =
  (deps: SqliteSchemaDep & SqliteDep) => (): void => {
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
      if (!validateColumnValue(deps)(row.table, row.column, row.value))
        continue;

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

/**
 * The possible states of a synchronization process.
 *
 * - {@link SyncStateInitial}
 * - {@link SyncStateIsSyncing}
 * - {@link SyncStateIsSynced}
 * - {@link SyncStateIsNotSynced}
 */
export type SyncState =
  | SyncStateInitial
  | SyncStateIsSyncing
  | SyncStateIsSynced
  | SyncStateIsNotSynced;

/**
 * The initial synchronization state when the app starts. In this state, the app
 * needs to determine whether the data is synced.
 */
export interface SyncStateInitial extends Typed<"SyncStateInitial"> {}

export interface SyncStateIsSyncing extends Typed<"SyncStateIsSyncing"> {}

export interface SyncStateIsSynced extends Typed<"SyncStateIsSynced"> {
  readonly time: Millis;
}

export interface SyncStateIsNotSynced extends Typed<"SyncStateIsNotSynced"> {
  readonly error: NetworkError | ServerError | PaymentRequiredError;
}

export interface NetworkError extends Typed<"NetworkError"> {}

export interface ServerError extends Typed<"ServerError"> {
  readonly status: number;
}

export interface PaymentRequiredError extends Typed<"PaymentRequiredError"> {}

export const initialSyncState: SyncStateInitial = { type: "SyncStateInitial" };
