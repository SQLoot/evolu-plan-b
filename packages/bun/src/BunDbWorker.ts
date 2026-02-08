/**
 * Bun-specific Database Worker implementation.
 *
 * Uses bun:sqlite for synchronous SQLite operations inside a worker.
 * The worker receives messages from the main thread and executes
 * database operations.
 *
 * @module
 */

import type {
    DbWorkerInput,
    DbWorkerMutateResponseMessage,
    DbWorkerOutput,
    DbWorkerQueryResponseMessage,
    Row,
} from "@evolu/common/local-first";
import {
  Database,
  type Database as BunDatabase,
  type SQLQueryBindings,
} from "bun:sqlite";

/**
 * Database Worker scope for Bun.
 *
 * This is the entry point for the worker. It handles all incoming messages
 * and routes them to appropriate handlers.
 */
export const runBunDbWorkerScope = (self: Worker): void => {
  let db: BunDatabase | null = null;

  const postMessage = (message: DbWorkerOutput): void => {
    self.postMessage(message);
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
          // Use in-memory database for now, can be changed to file-based
          db = new Database(`:memory:`);
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

          postMessage({ type: "DbWorkerInitResponse", success: true });
          break;
        }

        case "DbWorkerGetAppOwner": {
          if (!db) throw new Error("Database not initialized");

          // Try to get stored AppOwner from meta table
          const stmt = db.query(
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
          if (!db) throw new Error("Database not initialized");

          // Execute the query SQL
          const stmt = db.query<Row, SQLQueryBindings[]>(message.sql);
          const params = (message.params ?? []) as SQLQueryBindings[];
          const rows = stmt.all(...params) as Row[];

          postMessage({
            type: "DbWorkerQueryResponse",
            requestId: message.requestId,
            rows,
          } satisfies DbWorkerQueryResponseMessage);
          break;
        }

        case "DbWorkerMutate": {
          if (!db) throw new Error("Database not initialized");

          const params = message.params as SQLQueryBindings[];
          const result = db.run(message.sql, params);

          postMessage({
            type: "DbWorkerMutateResponse",
            requestId: message.requestId,
            changes: result.changes,
          } satisfies DbWorkerMutateResponseMessage);
          break;
        }

        case "DbWorkerExport": {
          if (!db) throw new Error("Database not initialized");

          // Bun's serialize() exports the database as a Buffer
          const data = db.serialize();

          postMessage({
            type: "DbWorkerExportResponse",
            requestId: message.requestId,
            data: new Uint8Array(data),
          });
          break;
        }

        case "DbWorkerReset": {
          if (!db) throw new Error("Database not initialized");

          // Get all user tables (excluding system tables)
          const tables = db
            .query(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__evolu_%' AND name NOT LIKE 'sqlite_%'",
            )
            .all() as Array<{ name: string }>;

          // Drop all user tables
          for (const { name } of tables) {
            db.run(`DROP TABLE IF EXISTS "${name}"`);
          }

          postMessage({
            type: "DbWorkerResetResponse",
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

self.onmessage = (event) => {
  const message = event.data;
  
  try {
    switch (message.type) {
      case "DbWorkerInit": {
        db = new Database(":memory:");
        db.run("PRAGMA journal_mode = WAL;");
        db.run("PRAGMA foreign_keys = ON;");
        db.run("PRAGMA busy_timeout = 5000;");
        db.run(\`
          CREATE TABLE IF NOT EXISTS __evolu_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          );
        \`);
        self.postMessage({ type: "DbWorkerInitResponse", success: true });
        break;
      }
      
      case "DbWorkerGetAppOwner": {
        if (!db) throw new Error("Database not initialized");
        const stmt = db.query("SELECT value FROM __evolu_meta WHERE key = 'appOwner'");
        const result = stmt.get();
        self.postMessage({
          type: "DbWorkerAppOwner",
          appOwner: result ? JSON.parse(result.value) : null,
        });
        break;
      }
      
      case "DbWorkerQuery": {
        if (!db) throw new Error("Database not initialized");
        const stmt = db.query(message.query.sql);
        const rows = stmt.all();
        self.postMessage({ 
          type: "DbWorkerQueryResponse", 
          requestId: message.requestId, 
          rows 
        });
        break;
      }
      
      case "DbWorkerMutate": {
        if (!db) throw new Error("Database not initialized");
        const result = db.run(message.sql, message.params || []);
        self.postMessage({ 
          type: "DbWorkerMutateResponse", 
          requestId: message.requestId, 
          changes: result.changes 
        });
        break;
      }
      
      case "DbWorkerExport": {
        if (!db) throw new Error("Database not initialized");
        const data = db.serialize();
        self.postMessage({ 
          type: "DbWorkerExportResponse", 
          requestId: message.requestId, 
          data: new Uint8Array(data) 
        });
        break;
      }
      
      case "DbWorkerReset": {
        if (!db) throw new Error("Database not initialized");
        const tables = db.query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__evolu_%' AND name NOT LIKE 'sqlite_%'"
        ).all();
        for (const { name } of tables) {
          db.run(\`DROP TABLE IF EXISTS "\${name}"\`);
        }
        self.postMessage({ 
          type: "DbWorkerResetResponse", 
          requestId: message.requestId 
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
