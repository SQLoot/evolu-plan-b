import type {
  MessagePort,
  SafeSql,
  SimpleName,
  SqliteDriver,
  SqliteValue,
} from "@evolu/common";
import { SimpleName as SimpleNameType } from "@evolu/common";
import type {
  AppOwner,
  DbWorkerInput,
  DbWorkerOutput,
  Row,
} from "@evolu/common/local-first";
import { createWasmSqliteDriver } from "../Sqlite.js";
import { createRun } from "../Task.js";

const workerMemoryDbName = "evolu-worker-memory";
const namedDbLocks = new Map<string, { tail: Promise<void> }>();

const acquireDbLock = async (name: string): Promise<() => void> => {
  const state = namedDbLocks.get(name) ?? { tail: Promise.resolve() };
  namedDbLocks.set(name, state);

  const previousTail = state.tail;
  const releaseGate = Promise.withResolvers<void>();
  const myTail = previousTail.then(() => releaseGate.promise);
  state.tail = myTail;

  await previousTail;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseGate.resolve();
    if (state.tail === myTail) namedDbLocks.delete(name);
  };
};

const safeParseAppOwner = (value: string): AppOwner | null => {
  try {
    return JSON.parse(value) as AppOwner;
  } catch {
    return null;
  }
};

const toSimpleName = (dbName: string): SimpleName =>
  SimpleNameType.orThrow(dbName === ":memory:" ? workerMemoryDbName : dbName);

const createDriver = async (dbName: string): Promise<SqliteDriver> => {
  const mode =
    dbName === ":memory:" ? ({ mode: "memory" } as const) : undefined;
  await using run = createRun();
  const result = await run(createWasmSqliteDriver(toSimpleName(dbName), mode));
  if (!result.ok) throw new Error("Failed to create web SQLite driver");
  return result.value;
};

export const runWebDbWorkerPort = (
  port: MessagePort<DbWorkerOutput, DbWorkerInput>,
): void => {
  let db: SqliteDriver | null = null;
  let releaseDbLock: (() => void) | null = null;

  const postMessage = (message: DbWorkerOutput): void => {
    port.postMessage(message);
  };

  const closeDb = (): void => {
    if (!db) return;
    db[Symbol.dispose]();
    db = null;
  };

  const releaseLock = (): void => {
    if (!releaseDbLock) return;
    releaseDbLock();
    releaseDbLock = null;
  };

  const requireDb = (): SqliteDriver => {
    if (!db) throw new Error("Database not initialized");
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
    switch (message.type) {
      case "DbWorkerInit": {
        try {
          closeDb();
          releaseLock();
          releaseDbLock = await acquireDbLock(message.dbName);
          db = await createDriver(message.dbName);

          exec("PRAGMA journal_mode = WAL;");
          exec("PRAGMA foreign_keys = ON;");
          exec("PRAGMA busy_timeout = 5000;");
          exec(`
          CREATE TABLE IF NOT EXISTS __evolu_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
        `);
          exec(
            `
            INSERT INTO __evolu_meta (key, value)
            VALUES ('schemaVersion', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value;
          `,
            [String(message.schemaVersion)],
          );

          postMessage({ type: "DbWorkerInitResponse", success: true });
        } catch (error) {
          postMessage({
            type: "DbWorkerInitResponse",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
          closeDb();
          releaseLock();
        }
        break;
      }

      case "DbWorkerGetAppOwner": {
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
        const result = exec(message.sql, message.params ?? []);
        postMessage({
          type: "DbWorkerQueryResponse",
          requestId: message.requestId,
          rows: result.rows as ReadonlyArray<Row>,
        });
        break;
      }

      case "DbWorkerMutate": {
        const result = exec(message.sql, message.params);
        postMessage({
          type: "DbWorkerMutateResponse",
          requestId: message.requestId,
          changes: result.changes,
        });
        break;
      }

      case "DbWorkerExport": {
        const data = requireDb().export();
        postMessage({
          type: "DbWorkerExportResponse",
          requestId: message.requestId,
          data,
        });
        break;
      }

      case "DbWorkerReset": {
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
        closeDb();
        releaseLock();
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
