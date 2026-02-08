/**
 * PoC: Bun Worker + bun:sqlite integration
 *
 * This demonstrates the core pattern for Evolu Worker architecture:
 * 1. Main thread creates Worker
 * 2. Worker initializes SQLite database
 * 3. Bidirectional message passing for queries/mutations
 *
 * Run with: bun test packages/common/test/poc/BunWorker.poc.test.ts
 *
 * @module
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// --- Worker Message Types ---

interface InitMessage {
  type: "init";
  dbName: string;
}

interface QueryMessage {
  type: "query";
  id: number;
  sql: string;
}

interface MutateMessage {
  type: "mutate";
  id: number;
  sql: string;
  params?: unknown[];
}

type WorkerInput = InitMessage | QueryMessage | MutateMessage;

interface InitResponseMessage {
  type: "initResponse";
  success: boolean;
}

interface QueryResponseMessage {
  type: "queryResponse";
  id: number;
  rows: unknown[];
}

interface MutateResponseMessage {
  type: "mutateResponse";
  id: number;
  changes: number;
}

interface ErrorResponseMessage {
  type: "error";
  id?: number;
  message: string;
}

type WorkerOutput =
  | InitResponseMessage
  | QueryResponseMessage
  | MutateResponseMessage
  | ErrorResponseMessage;

// --- Worker Code (as inline blob) ---

const workerCode = `
import { Database } from "bun:sqlite";

let db = null;

self.onmessage = (event) => {
  const message = event.data;
  
  try {
    switch (message.type) {
      case "init": {
        db = new Database(":memory:");
        db.run("PRAGMA journal_mode = WAL;");
        self.postMessage({ type: "initResponse", success: true });
        break;
      }
      
      case "query": {
        if (!db) throw new Error("Database not initialized");
        const stmt = db.query(message.sql);
        const rows = stmt.all();
        self.postMessage({ 
          type: "queryResponse", 
          id: message.id, 
          rows 
        });
        break;
      }
      
      case "mutate": {
        if (!db) throw new Error("Database not initialized");
        const result = db.run(message.sql, message.params || []);
        self.postMessage({ 
          type: "mutateResponse", 
          id: message.id, 
          changes: result.changes 
        });
        break;
      }
      
      default:
        self.postMessage({ 
          type: "error", 
          message: "Unknown message type: " + message.type 
        });
    }
  } catch (error) {
    self.postMessage({ 
      type: "error", 
      id: message.id,
      message: error.message 
    });
  }
};
`;

// --- Test Suite ---

describe("Bun Worker + SQLite PoC", () => {
  let worker: Worker;
  let messageId = 0;

  const sendMessage = <T extends WorkerOutput>(
    message: WorkerInput,
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent<WorkerOutput>) => {
        const response = event.data;
        if (response.type === "error") {
          worker.removeEventListener("message", handler);
          reject(new Error((response as ErrorResponseMessage).message));
        } else if (
          "id" in message &&
          "id" in response &&
          response.id === message.id
        ) {
          worker.removeEventListener("message", handler);
          resolve(response as T);
        } else if (response.type === "initResponse") {
          worker.removeEventListener("message", handler);
          resolve(response as T);
        }
      };
      worker.addEventListener("message", handler);
      worker.postMessage(message);
    });
  };

  beforeAll(async () => {
    // Create worker from blob URL
    const blob = new Blob([workerCode], { type: "application/typescript" });
    const url = URL.createObjectURL(blob);
    worker = new Worker(url);

    // Initialize database
    const response = await sendMessage<InitResponseMessage>({
      type: "init",
      dbName: "test",
    });
    expect(response.success).toBe(true);
  });

  afterAll(() => {
    worker.terminate();
  });

  test("creates table via mutate", async () => {
    const response = await sendMessage<MutateResponseMessage>({
      type: "mutate",
      id: ++messageId,
      sql: "CREATE TABLE todos (id INTEGER PRIMARY KEY, title TEXT, done INTEGER DEFAULT 0)",
    });
    expect(response.type).toBe("mutateResponse");
  });

  test("inserts data via mutate", async () => {
    const response = await sendMessage<MutateResponseMessage>({
      type: "mutate",
      id: ++messageId,
      sql: "INSERT INTO todos (title) VALUES (?)",
      params: ["Learn Bun Workers"],
    });
    expect(response.changes).toBe(1);
  });

  test("queries data", async () => {
    const response = await sendMessage<QueryResponseMessage>({
      type: "query",
      id: ++messageId,
      sql: "SELECT * FROM todos",
    });
    expect(response.rows).toHaveLength(1);
    expect((response.rows[0] as { title: string }).title).toBe(
      "Learn Bun Workers",
    );
  });

  test("handles multiple inserts and queries", async () => {
    // Insert more todos
    await sendMessage<MutateResponseMessage>({
      type: "mutate",
      id: ++messageId,
      sql: "INSERT INTO todos (title) VALUES (?)",
      params: ["Build Evolu"],
    });

    await sendMessage<MutateResponseMessage>({
      type: "mutate",
      id: ++messageId,
      sql: "INSERT INTO todos (title) VALUES (?)",
      params: ["Ship it!"],
    });

    // Query all
    const response = await sendMessage<QueryResponseMessage>({
      type: "query",
      id: ++messageId,
      sql: "SELECT COUNT(*) as count FROM todos",
    });
    expect((response.rows[0] as { count: number }).count).toBe(3);
  });
});
