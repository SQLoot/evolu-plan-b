/**
 * Database Worker message protocol.
 *
 * Defines all messages exchanged between main thread and the database worker.
 * The worker runs SQLite operations off the main thread for better performance.
 *
 * @module
 */

import type { SimpleName, Typed } from "../Type.js";
import type { AppOwner } from "./Owner.js";
import type { Row } from "./Query.js";

// === Worker Input Messages (Main → Worker) ===

/** Initialize the database worker with configuration. */
export interface DbWorkerInitMessage extends Typed<"DbWorkerInit"> {
  readonly dbName: string;
  readonly schemaVersion: number;
}

/** Request the current AppOwner from storage. */
export interface DbWorkerGetAppOwnerMessage
  extends Typed<"DbWorkerGetAppOwner"> {}

/** Execute a query and return results. */
export interface DbWorkerQueryMessage extends Typed<"DbWorkerQuery"> {
  readonly requestId: number;
  readonly sql: string;
  readonly params?: ReadonlyArray<unknown>;
}

/** Execute a mutation (insert/update/delete). */
export interface DbWorkerMutateMessage extends Typed<"DbWorkerMutate"> {
  readonly requestId: number;
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

/** Export the database as a binary blob. */
export interface DbWorkerExportMessage extends Typed<"DbWorkerExport"> {
  readonly requestId: number;
}

/** Reset the database (delete all data). */
export interface DbWorkerResetMessage extends Typed<"DbWorkerReset"> {
  readonly requestId: number;
}

/** Close database resources for deterministic lifecycle handling. */
export interface DbWorkerCloseMessage extends Typed<"DbWorkerClose"> {
  readonly requestId: number;
}

export type DbWorkerInput =
  | DbWorkerInitMessage
  | DbWorkerGetAppOwnerMessage
  | DbWorkerQueryMessage
  | DbWorkerMutateMessage
  | DbWorkerExportMessage
  | DbWorkerResetMessage
  | DbWorkerCloseMessage;

// === Worker Output Messages (Worker → Main) ===

/** Worker initialized successfully. */
export interface DbWorkerInitResponseMessage
  extends Typed<"DbWorkerInitResponse"> {
  readonly success: boolean;
  readonly error?: string;
}

/** AppOwner from storage. */
export interface DbWorkerAppOwnerMessage extends Typed<"DbWorkerAppOwner"> {
  readonly appOwner: AppOwner | null;
}

/** Query results. */
export interface DbWorkerQueryResponseMessage
  extends Typed<"DbWorkerQueryResponse"> {
  readonly requestId: number;
  readonly rows: ReadonlyArray<Row>;
}

/** Mutation completed. */
export interface DbWorkerMutateResponseMessage
  extends Typed<"DbWorkerMutateResponse"> {
  readonly requestId: number;
  readonly changes: number;
}

/** Database exported. */
export interface DbWorkerExportResponseMessage
  extends Typed<"DbWorkerExportResponse"> {
  readonly requestId: number;
  readonly data: Uint8Array;
}

/** Database reset. */
export interface DbWorkerResetResponseMessage
  extends Typed<"DbWorkerResetResponse"> {
  readonly requestId: number;
}

/** Database resources closed. */
export interface DbWorkerCloseResponseMessage
  extends Typed<"DbWorkerCloseResponse"> {
  readonly requestId: number;
}

/** Error from worker. */
export interface DbWorkerErrorMessage extends Typed<"DbWorkerError"> {
  readonly requestId: number | undefined;
  readonly error: string;
}

/**
 * Leader lock lifecycle event emitted by the DB worker channel.
 *
 * This uses a dedicated broker channel, not the request/response DB channel.
 */
export interface DbWorkerLeaderOutput extends Typed<"LeaderAcquired"> {
  readonly name: SimpleName;
}

/** Heartbeat sent by an Evolu client over the broker channel. */
export interface DbWorkerLeaderInput extends Typed<"LeaderHeartbeat"> {
  readonly name: SimpleName;
}

/** Default heartbeat interval for broker liveness checks. */
export const dbWorkerLeaderHeartbeatIntervalMs = 5_000;

/** Timeout after which missing heartbeats mark a worker port as stale. */
export const dbWorkerLeaderHeartbeatTimeoutMs = 30_000;

export type DbWorkerOutput =
  | DbWorkerInitResponseMessage
  | DbWorkerAppOwnerMessage
  | DbWorkerQueryResponseMessage
  | DbWorkerMutateResponseMessage
  | DbWorkerExportResponseMessage
  | DbWorkerResetResponseMessage
  | DbWorkerCloseResponseMessage
  | DbWorkerErrorMessage;
