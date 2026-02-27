import type {
  ConsoleLevel,
  MessagePort,
  SafeSql,
  SimpleName,
  SqliteDriver,
  SqliteValue,
} from "@evolu/common";
import { assert, SimpleName as SimpleNameType } from "@evolu/common";
import type {
  AppOwner,
  ExperimentalDbWorkerInput as DbWorkerInput,
  ExperimentalDbWorkerLeaderInput as DbWorkerLeaderInput,
  ExperimentalDbWorkerLeaderOutput as DbWorkerLeaderOutput,
  ExperimentalDbWorkerOutput as DbWorkerOutput,
  Row,
} from "@evolu/common/local-first";
import { experimentalDbWorkerLeaderHeartbeatTimeoutMs as defaultHeartbeatTimeoutMs } from "@evolu/common/local-first";
import { createWasmSqliteDriver } from "../Sqlite.js";
import { createRun } from "../Task.js";

const workerMemoryDbName = "evolu-worker-memory";

interface SharedDbState {
  driver: SqliteDriver | null;
  initPromise: Promise<SqliteDriver> | null;
  refs: number;
  schemaVersion: number;
}

const sharedDbStates = new Map<string, SharedDbState>();

const safeParseAppOwner = (value: string): AppOwner | null => {
  try {
    return JSON.parse(value) as AppOwner;
  } catch {
    return null;
  }
};

const toSimpleName = (dbName: string): SimpleName =>
  SimpleNameType.orThrow(dbName === ":memory:" ? workerMemoryDbName : dbName);

type CreateDbDriver = (dbName: string) => Promise<SqliteDriver>;

const createDriver = async (dbName: string): Promise<SqliteDriver> => {
  const mode =
    dbName === ":memory:" ? ({ mode: "memory" } as const) : undefined;
  await using run = createRun();
  const result = await run(createWasmSqliteDriver(toSimpleName(dbName), mode));
  if (!result.ok) throw new Error("Failed to create web SQLite driver");
  return result.value;
};

const prepareDriver = (
  driver: SqliteDriver,
  schemaVersion: number,
): ReturnType<SqliteDriver["exec"]> => {
  driver.exec({ sql: "PRAGMA journal_mode = WAL;" as SafeSql, parameters: [] });
  driver.exec({ sql: "PRAGMA foreign_keys = ON;" as SafeSql, parameters: [] });
  driver.exec({
    sql: "PRAGMA busy_timeout = 5000;" as SafeSql,
    parameters: [],
  });
  driver.exec({
    sql: `
          CREATE TABLE IF NOT EXISTS __evolu_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
        ` as SafeSql,
    parameters: [],
  });
  return driver.exec({
    sql: `
            INSERT INTO __evolu_meta (key, value)
            VALUES ('schemaVersion', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
          ` as SafeSql,
    parameters: [String(schemaVersion)] as Array<SqliteValue>,
  });
};

const acquireSharedDb = async (
  config: {
    readonly dbName: string;
    readonly schemaVersion: number;
  },
  createDbDriver: CreateDbDriver = createDriver,
): Promise<{
  driver: SqliteDriver;
  isLeader: boolean;
}> => {
  const { dbName, schemaVersion } = config;
  const existing = sharedDbStates.get(dbName);
  if (existing) {
    if (existing.schemaVersion !== schemaVersion) {
      throw new Error(
        `Schema version mismatch for '${dbName}': existing ${existing.schemaVersion}, requested ${schemaVersion}`,
      );
    }
    existing.refs += 1;
    try {
      if (existing.driver) return { driver: existing.driver, isLeader: false };
      const initPromise = existing.initPromise;
      assert(initPromise, "Shared DB initialization missing");
      const driver = await initPromise;
      return { driver, isLeader: false };
    } catch (error) {
      existing.refs -= 1;
      sharedDbStates.delete(dbName);
      throw error;
    }
  }

  const created: SharedDbState = {
    driver: null,
    initPromise: null,
    refs: 1,
    schemaVersion,
  };
  sharedDbStates.set(dbName, created);

  created.initPromise = (async () => {
    const driver = await createDbDriver(dbName);
    prepareDriver(driver, schemaVersion);
    created.driver = driver;
    return driver;
  })();

  try {
    const driver = await created.initPromise;
    return { driver, isLeader: true };
  } catch (error) {
    created.refs -= 1;
    sharedDbStates.delete(dbName);
    throw error;
  } finally {
    created.initPromise = null;
  }
};

const releaseSharedDb = (dbName: string): void => {
  const state = sharedDbStates.get(dbName);
  assert(state, "Shared DB state missing");

  state.refs -= 1;
  if (state.refs > 0) return;

  assert(state.driver, "Shared DB driver missing during release");
  state.driver[Symbol.dispose]();
  sharedDbStates.delete(dbName);
};

export const runWebDbWorkerPort = (config: {
  readonly name: SimpleName;
  readonly consoleLevel?: ConsoleLevel;
  readonly port: MessagePort<DbWorkerOutput, DbWorkerInput>;
  readonly brokerPort: MessagePort<DbWorkerLeaderOutput, DbWorkerLeaderInput>;
}): void => {
  runWebDbWorkerPortWithOptions(config);
};

export const runWebDbWorkerPortWithOptions = (
  config: {
    readonly name: SimpleName;
    readonly consoleLevel?: ConsoleLevel;
    readonly port: MessagePort<DbWorkerOutput, DbWorkerInput>;
    readonly brokerPort: MessagePort<DbWorkerLeaderOutput, DbWorkerLeaderInput>;
  },
  options?: {
    readonly heartbeatTimeoutMs?: number;
    readonly heartbeatCheckIntervalMs?: number;
    readonly now?: () => number;
    readonly createDriver?: CreateDbDriver;
    readonly setInterval?: (
      callback: () => void,
      timeoutMs: number,
    ) => ReturnType<typeof globalThis.setInterval>;
    readonly clearInterval?: (
      id: ReturnType<typeof globalThis.setInterval>,
    ) => void;
  },
): void => {
  const heartbeatTimeoutMs =
    options?.heartbeatTimeoutMs ?? defaultHeartbeatTimeoutMs;
  const heartbeatCheckIntervalMs =
    options?.heartbeatCheckIntervalMs ??
    Math.max(1_000, heartbeatTimeoutMs / 3);
  const now = options?.now ?? Date.now;
  const createDriverImpl = options?.createDriver ?? createDriver;
  const setIntervalImpl = options?.setInterval ?? globalThis.setInterval;
  const clearIntervalImpl = options?.clearInterval ?? globalThis.clearInterval;
  const { name, port, brokerPort } = config;
  let db: SqliteDriver | null = null;
  let dbName: string | null = null;
  let schemaVersion: number | null = null;
  let hasDbRef = false;
  let heartbeatWatchdogId: ReturnType<typeof globalThis.setInterval> | null =
    null;
  let lastHeartbeatAt = now();

  const markAlive = (): void => {
    lastHeartbeatAt = now();
  };

  const stopHeartbeatWatchdog = (): void => {
    if (!heartbeatWatchdogId) return;
    clearIntervalImpl(heartbeatWatchdogId);
    heartbeatWatchdogId = null;
  };

  const startHeartbeatWatchdog = (): void => {
    if (heartbeatWatchdogId) clearIntervalImpl(heartbeatWatchdogId);
    heartbeatWatchdogId = setIntervalImpl(() => {
      if (now() - lastHeartbeatAt > heartbeatTimeoutMs) {
        // Stale client port: release shared DB ref.
        releaseDb({ keepConfig: true });
        stopHeartbeatWatchdog();
      }
    }, heartbeatCheckIntervalMs);
  };

  const releaseDb = (config?: { keepConfig?: boolean }): void => {
    if (hasDbRef && dbName) {
      releaseSharedDb(dbName);
      hasDbRef = false;
    }
    db = null;
    if (!config?.keepConfig) {
      dbName = null;
      schemaVersion = null;
      stopHeartbeatWatchdog();
    }
  };

  const ensureDbReady = async (): Promise<void> => {
    if (db) return;
    if (dbName == null || schemaVersion == null)
      throw new Error("Database not initialized");
    const acquired = await acquireSharedDb(
      { dbName, schemaVersion },
      createDriverImpl,
    );
    db = acquired.driver;
    hasDbRef = true;
    startHeartbeatWatchdog();
    if (acquired.isLeader)
      brokerPort.postMessage({ type: "LeaderAcquired", name });
  };

  brokerPort.onMessage = (message) => {
    if (message.type === "LeaderHeartbeat" && message.name === name) {
      markAlive();
    }
  };

  const postMessage = (message: DbWorkerOutput): void => {
    port.postMessage(message);
  };

  const requireDb = (): SqliteDriver => {
    assert(db, "Database not initialized");
    return db;
  };

  const exec = (
    sql: string,
    params: ReadonlyArray<unknown> = [],
  ): ReturnType<SqliteDriver["exec"]> =>
    requireDb().exec({
      sql: sql as SafeSql,
      parameters: [...params] as Array<SqliteValue>,
    });

  const handleError = (requestId: number | undefined, error: unknown): void => {
    postMessage({
      type: "DbWorkerError",
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  };

  const handleMessage = async (message: DbWorkerInput): Promise<void> => {
    markAlive();
    switch (message.type) {
      case "DbWorkerInit": {
        try {
          if (!db || !dbName) {
            if (dbName && dbName !== message.dbName) {
              throw new Error(
                `DbWorker already initialized for '${dbName}', cannot switch to '${message.dbName}'`,
              );
            }
            if (
              schemaVersion != null &&
              schemaVersion !== message.schemaVersion
            ) {
              throw new Error(
                `DbWorker already initialized for schema version ${schemaVersion}, cannot switch to ${message.schemaVersion}`,
              );
            }

            const acquired = await acquireSharedDb(
              {
                dbName: message.dbName,
                schemaVersion: message.schemaVersion,
              },
              createDriverImpl,
            );
            db = acquired.driver;
            hasDbRef = true;
            dbName = message.dbName;
            schemaVersion = message.schemaVersion;
            startHeartbeatWatchdog();
            if (acquired.isLeader) {
              brokerPort.postMessage({ type: "LeaderAcquired", name });
            }
          } else if (dbName !== message.dbName) {
            throw new Error(
              `DbWorker already initialized for '${dbName}', cannot switch to '${message.dbName}'`,
            );
          } else {
            const state = sharedDbStates.get(dbName);
            if (state && state.schemaVersion !== message.schemaVersion) {
              throw new Error(
                `DbWorker already initialized for schema version ${state.schemaVersion}, cannot switch to ${message.schemaVersion}`,
              );
            }
          }

          postMessage({ type: "DbWorkerInitResponse", success: true });
        } catch (error) {
          postMessage({
            type: "DbWorkerInitResponse",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          releaseDb();
        }
        break;
      }

      case "DbWorkerGetAppOwner": {
        await ensureDbReady();
        const result = exec(
          "SELECT value FROM __evolu_meta WHERE key = 'appOwner'",
        );
        const row = result.rows[0] as { value?: unknown } | undefined;
        const appOwnerValue = row?.value;
        postMessage({
          type: "DbWorkerAppOwner",
          appOwner:
            typeof appOwnerValue === "string"
              ? safeParseAppOwner(appOwnerValue)
              : null,
        });
        break;
      }

      case "DbWorkerQuery": {
        await ensureDbReady();
        const result = exec(message.sql, message.params ?? []);
        postMessage({
          type: "DbWorkerQueryResponse",
          requestId: message.requestId,
          rows: result.rows as ReadonlyArray<Row>,
        });
        break;
      }

      case "DbWorkerMutate": {
        await ensureDbReady();
        const result = exec(message.sql, message.params);
        postMessage({
          type: "DbWorkerMutateResponse",
          requestId: message.requestId,
          changes: result.changes,
        });
        break;
      }

      case "DbWorkerExport": {
        await ensureDbReady();
        const data = requireDb().export();
        postMessage({
          type: "DbWorkerExportResponse",
          requestId: message.requestId,
          data,
        });
        break;
      }

      case "DbWorkerReset": {
        await ensureDbReady();
        const tables = exec(
          `
            SELECT name
            FROM sqlite_master
            WHERE type='table'
              AND name NOT LIKE '__evolu_%'
              AND name NOT LIKE 'sqlite_%'
          `,
        ).rows as Array<{ name: string }>;

        for (const { name } of tables) {
          const escapedName = name.replaceAll('"', '""');
          exec(`DROP TABLE IF EXISTS "${escapedName}"`);
        }

        exec("DELETE FROM __evolu_meta WHERE key = 'appOwner'");

        postMessage({
          type: "DbWorkerResetResponse",
          requestId: message.requestId,
        });
        break;
      }

      case "DbWorkerClose": {
        releaseDb();
        postMessage({
          type: "DbWorkerCloseResponse",
          requestId: message.requestId,
        });
        break;
      }

      default: {
        const _exhaustive: never = message;
        throw new Error(`Unknown message type: ${String(_exhaustive)}`);
      }
    }
  };

  port.onMessage = (message) => {
    const requestId = "requestId" in message ? message.requestId : undefined;
    void handleMessage(message).catch((error) => {
      handleError(requestId, error);
    });
  };
};
