/**
 * Bun-specific Database Worker implementation.
 *
 * Uses bun:sqlite for synchronous SQLite operations inside a worker.
 * The worker receives messages from the main thread and executes
 * database operations.
 *
 * @module
 */

import {
  type Database as BunDatabase,
  Database,
  type SQLQueryBindings,
} from "bun:sqlite";
import type {
  DbWorkerInput,
  DbWorkerMutateResponseMessage,
  DbWorkerOutput,
  DbWorkerQueryResponseMessage,
  Row,
} from "@evolu/common/local-first";

type BunStatement = ReturnType<BunDatabase["query"]>;

/**
 * Minimal worker scope shape used by {@link runBunDbWorkerScope}.
 *
 * Using this explicit interface allows running the worker logic in tests
 * without spawning a real Worker thread.
 */
export interface BunDbWorkerScope {
  postMessage: (message: DbWorkerOutput) => void;
  onmessage: ((event: MessageEvent<DbWorkerInput>) => void) | null;
}

/**
 * Database Worker scope for Bun.
 *
 * This is the entry point for the worker. It handles all incoming messages
 * and routes them to appropriate handlers.
 */
export const runBunDbWorkerScope = (self: BunDbWorkerScope): void => {
  let db: BunDatabase | null = null;
  const statementCache = new Map<string, BunStatement>();

  const postMessage = (message: DbWorkerOutput): void => {
    self.postMessage(message);
  };

  const clearStatementCache = (): void => {
    for (const statement of statementCache.values()) {
      statement.finalize();
    }
    statementCache.clear();
  };

  const closeDb = (): void => {
    if (!db) return;
    clearStatementCache();
    db.close();
    db = null;
  };

  const requireDb = (): BunDatabase => {
    if (!db) throw new Error("Database not initialized");
    return db;
  };

  const getStatement = (sql: string): BunStatement => {
    let statement = statementCache.get(sql);
    if (!statement) {
      statement = requireDb().query(sql);
      statementCache.set(sql, statement);
    }
    return statement;
  };

  const handleError = (requestId: number | undefined, error: unknown): void => {
    postMessage({
      type: "DbWorkerError",
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
  };

  self.onmessage = (event: MessageEvent<DbWorkerInput>) => {
    const message = event.data;

    try {
      switch (message.type) {
        case "DbWorkerInit": {
          closeDb();
          db = new Database(
            message.dbName === ":memory:"
              ? ":memory:"
              : `${message.dbName}.sqlite`,
          );
          db.run("PRAGMA journal_mode = WAL;");
          db.run("PRAGMA foreign_keys = ON;");
          db.run("PRAGMA busy_timeout = 5000;");

          // Create Evolu system tables
          db.run(`
            CREATE TABLE IF NOT EXISTS __evolu_meta (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL
            );
          `);

          db.run(
            `
              INSERT INTO __evolu_meta (key, value)
              VALUES ('schemaVersion', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value;
            `,
            [String(message.schemaVersion)],
          );

          postMessage({ type: "DbWorkerInitResponse", success: true });
          break;
        }

        case "DbWorkerGetAppOwner": {
          // Try to get stored AppOwner from meta table
          const stmt = getStatement(
            "SELECT value FROM __evolu_meta WHERE key = 'appOwner'",
          );
          const result = stmt.get() as { value: string } | null;

          postMessage({
            type: "DbWorkerAppOwner",
            appOwner: result ? JSON.parse(result.value) : null,
          });
          break;
        }

        case "DbWorkerQuery": {
          // Execute the query SQL
          const stmt = getStatement(message.sql);
          const params = (message.params ?? []) as SQLQueryBindings[];
          const rows =
            params.length > 0
              ? (stmt.all(...params) as Row[])
              : (stmt.all() as Row[]);

          postMessage({
            type: "DbWorkerQueryResponse",
            requestId: message.requestId,
            rows,
          } satisfies DbWorkerQueryResponseMessage);
          break;
        }

        case "DbWorkerMutate": {
          const stmt = getStatement(message.sql);
          const params = message.params as SQLQueryBindings[];
          const result = params.length > 0 ? stmt.run(...params) : stmt.run();

          postMessage({
            type: "DbWorkerMutateResponse",
            requestId: message.requestId,
            changes: result.changes,
          } satisfies DbWorkerMutateResponseMessage);
          break;
        }

        case "DbWorkerExport": {
          // Bun's serialize() exports the database as a Buffer
          const data = requireDb().serialize();

          postMessage({
            type: "DbWorkerExportResponse",
            requestId: message.requestId,
            data: new Uint8Array(data),
          });
          break;
        }

        case "DbWorkerReset": {
          const sqlite = requireDb();

          // Get all user tables (excluding system tables)
          const tables = getStatement(
            `
              SELECT name
              FROM sqlite_master
              WHERE type='table'
                AND name NOT LIKE '__evolu_%'
                AND name NOT LIKE 'sqlite_%'
            `,
          ).all() as Array<{ name: string }>;

          // Drop all user tables
          for (const { name } of tables) {
            const escapedName = name.replaceAll('"', '""');
            sqlite.run(`DROP TABLE IF EXISTS "${escapedName}"`);
          }

          // Reset cached prepared statements and owner metadata
          clearStatementCache();
          sqlite.run("DELETE FROM __evolu_meta WHERE key = 'appOwner'");

          postMessage({
            type: "DbWorkerResetResponse",
            requestId: message.requestId,
          });
          break;
        }

        case "DbWorkerClose": {
          closeDb();
          postMessage({
            type: "DbWorkerCloseResponse",
            requestId: message.requestId,
          });
          break;
        }

        default: {
          const _exhaustive: never = message;
          throw new Error(
            `Unknown message type: ${(message as DbWorkerInput).type}`,
          );
        }
      }
    } catch (error) {
      handleError(
        "requestId" in message ? message.requestId : undefined,
        error,
      );
    }
  };
};

/**
 * Worker code as a string for creating blob URLs.
 *
 * This allows creating workers without external files.
 */
export const bunDbWorkerCode = `
import { Database } from "bun:sqlite";

let db = null;
const statementCache = new Map();

const clearStatementCache = () => {
  for (const statement of statementCache.values()) statement.finalize();
  statementCache.clear();
};

const requireDb = () => {
  if (!db) throw new Error("Database not initialized");
  return db;
};

const getStatement = (sql) => {
  let statement = statementCache.get(sql);
  if (!statement) {
    statement = requireDb().query(sql);
    statementCache.set(sql, statement);
  }
  return statement;
};

self.onmessage = (event) => {
  const message = event.data;
  
  try {
    switch (message.type) {
      case "DbWorkerInit": {
        if (db) {
          clearStatementCache();
          db.close();
        }
        db = new Database(message.dbName === ":memory:" ? ":memory:" : \`\${message.dbName}.sqlite\`);
        db.run("PRAGMA journal_mode = WAL;");
        db.run("PRAGMA foreign_keys = ON;");
        db.run("PRAGMA busy_timeout = 5000;");
        db.run(\`
          CREATE TABLE IF NOT EXISTS __evolu_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
        \`);
        db.run(
          \`INSERT INTO __evolu_meta (key, value)
           VALUES ('schemaVersion', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value;\`,
          [String(message.schemaVersion)],
        );
        self.postMessage({ type: "DbWorkerInitResponse", success: true });
        break;
      }
      
      case "DbWorkerGetAppOwner": {
        const stmt = getStatement("SELECT value FROM __evolu_meta WHERE key = 'appOwner'");
        const result = stmt.get();
        self.postMessage({
          type: "DbWorkerAppOwner",
          appOwner: result ? JSON.parse(result.value) : null,
        });
        break;
      }
      
      case "DbWorkerQuery": {
        const stmt = getStatement(message.sql);
        const params = message.params || [];
        const rows = params.length > 0 ? stmt.all(...params) : stmt.all();
        self.postMessage({ 
          type: "DbWorkerQueryResponse", 
          requestId: message.requestId, 
          rows 
        });
        break;
      }
      
      case "DbWorkerMutate": {
        const stmt = getStatement(message.sql);
        const params = message.params || [];
        const result = params.length > 0 ? stmt.run(...params) : stmt.run();
        self.postMessage({ 
          type: "DbWorkerMutateResponse", 
          requestId: message.requestId, 
          changes: result.changes 
        });
        break;
      }
      
      case "DbWorkerExport": {
        const data = requireDb().serialize();
        self.postMessage({ 
          type: "DbWorkerExportResponse", 
          requestId: message.requestId, 
          data: new Uint8Array(data) 
        });
        break;
      }
      
      case "DbWorkerReset": {
        const sqlite = requireDb();
        const tables = getStatement(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__evolu_%' AND name NOT LIKE 'sqlite_%'"
        ).all();
        for (const { name } of tables) {
          sqlite.run(\`DROP TABLE IF EXISTS "\${name.replaceAll('"', '""')}"\`);
        }
        clearStatementCache();
        sqlite.run("DELETE FROM __evolu_meta WHERE key = 'appOwner'");
        self.postMessage({ 
          type: "DbWorkerResetResponse", 
          requestId: message.requestId 
        });
        break;
      }
      
      case "DbWorkerClose": {
        if (db) {
          clearStatementCache();
          db.close();
          db = null;
        }
        self.postMessage({
          type: "DbWorkerCloseResponse",
          requestId: message.requestId,
        });
        break;
      }
      
      default:
        throw new Error("Unknown message type: " + message.type);
    }
  } catch (error) {
    self.postMessage({ 
      type: "DbWorkerError", 
      requestId: message.requestId,
      error: error.message 
    });
  }
};
`;
