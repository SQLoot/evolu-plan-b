/**
 * Legacy sync API compatibility layer.
 *
 * @module
 */

import type { NonEmptyReadonlyArray } from "../Array.js";
import type { Result } from "../Result.js";
import type { Task } from "../Task.js";
import type { OwnerIdBytes, OwnerWriteKey, SyncOwner } from "./Owner.js";
import type { MutationChange } from "./Schema.js";
import type {
  BaseSqliteStorage,
  EncryptedCrdtMessage,
  EncryptedDbChange,
  Storage,
  StorageWriteMessagesError,
} from "./Storage.js";
import type {
  Timestamp,
  TimestampCounterOverflowError,
  TimestampDriftError,
  TimestampTimeOutOfRangeError,
} from "./Timestamp.js";

const createNotImplementedError = (symbolName: string): Error =>
  new Error(
    `${symbolName} is not implemented in the current owner-based sync runtime. ` +
      "Use local-first/Evolu + Shared APIs instead.",
  );

/**
 * Legacy Sync facade kept for compatibility.
 *
 * @deprecated Use owner-based sync APIs on {@link Evolu}.
 */
export interface Sync extends Disposable {
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

/** @deprecated Use owner-based sync APIs on {@link Evolu}. */
export interface SyncDep {
  readonly sync: Sync;
}

/** @deprecated Use owner-based sync configuration on {@link Evolu}. */
export interface SyncConfig {
  readonly transports: ReadonlyArray<unknown>;
  readonly onReceive: () => void;
  readonly onError: (error: unknown) => void;
}

/**
 * Legacy Storage surface formerly used by Sync.
 *
 * @deprecated Use `Storage` from `./Storage.js` directly.
 */
export interface ClientStorage extends Storage, BaseSqliteStorage {}

/** @deprecated Use owner-based sync APIs on {@link Evolu}. */
export interface ClientStorageDep {
  readonly storage: ClientStorage;
}

/** @deprecated Use owner-based sync APIs on {@link Evolu}. */
export interface Clock {
  readonly get: () => Timestamp;
  readonly save: (timestamp: Timestamp) => void;
}

/** @deprecated Use owner-based sync APIs on {@link Evolu}. */
export interface ClockDep {
  readonly clock: Clock;
}

/**
 * Legacy clock constructor placeholder.
 *
 * @deprecated Use `createDbWorker`/`createEvolu` runtime instead.
 */
export const createClock =
  () =>
  (_dbIsInitialized = false): Clock => {
    void _dbIsInitialized;
    throw createNotImplementedError("createClock");
  };

/**
 * Legacy sync constructor placeholder.
 *
 * @deprecated Use owner-based sync APIs on {@link Evolu}.
 */
export const createSync =
  () =>
  (_config: SyncConfig): Sync => {
    void _config;
    throw createNotImplementedError("createSync");
  };

/**
 * Legacy local-only mutation helper placeholder.
 *
 * @deprecated Local-only change handling lives in Db worker internals.
 */
export const applyLocalOnlyChange =
  () =>
  (_change: MutationChange): void => {
    void _change;
    throw createNotImplementedError("applyLocalOnlyChange");
  };

/**
 * Legacy sync state shape.
 *
 * @deprecated Use owner-level sync APIs and transport claims in Shared runtime.
 */
export type {
  NetworkError,
  PaymentRequiredError,
  ServerError,
  SyncState,
  SyncStateInitial,
  SyncStateIsNotSynced,
  SyncStateIsSynced,
  SyncStateIsSyncing,
} from "./Shared.js";

/** @deprecated Compatibility constant until sync-state API is reintroduced. */
export const initialSyncState: import("./Shared.js").SyncState = {
  type: "SyncStateInitial",
};

/**
 * Helper to retain legacy function signatures used in older adapters.
 *
 * @deprecated Use Storage APIs directly.
 */
export type LegacyWriteMessages = (
  ownerIdBytes: OwnerIdBytes,
  messages: NonEmptyReadonlyArray<EncryptedCrdtMessage>,
) => Task<void, StorageWriteMessagesError>;

/**
 * Helper to retain legacy function signatures used in older adapters.
 *
 * @deprecated Use Storage APIs directly.
 */
export type LegacyReadDbChange = (
  ownerId: OwnerIdBytes,
  timestamp: Timestamp,
) => EncryptedDbChange;

/**
 * Helper to retain legacy function signatures used in older adapters.
 *
 * @deprecated Use Storage APIs directly.
 */
export type LegacySetWriteKey = (
  ownerIdBytes: OwnerIdBytes,
  writeKey: OwnerWriteKey,
) => void;
