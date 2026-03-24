import { describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BunDbWorkerScope,
  type DbWorkerInput,
  type DbWorkerOutput,
  runBunDbWorkerScope,
} from "../src/BunDbWorker.js";

const expectMessage = <T extends DbWorkerOutput["type"]>(
  message: DbWorkerOutput,
  type: T,
): Extract<DbWorkerOutput, { type: T }> => {
  expect(message.type).toBe(type);
  return message as Extract<DbWorkerOutput, { type: T }>;
};

const createHarness = () => {
  const messages: Array<DbWorkerOutput> = [];
  const scope: BunDbWorkerScope = {
    onmessage: null,
    postMessage: (message) => {
      messages.push(message);
    },
  };

  runBunDbWorkerScope(scope);

  const send = (message: DbWorkerInput): DbWorkerOutput => {
    const prevLength = messages.length;
    scope.onmessage?.({ data: message } as MessageEvent<DbWorkerInput>);
    const output = messages.at(prevLength);
    if (!output) {
      throw new Error(`No response for message type ${message.type}`);
    }
    return output;
  };

  return { send };
};

const init = (send: (message: DbWorkerInput) => DbWorkerOutput): void => {
  const output = send({
    type: "DbWorkerInit",
    dbName: ":memory:",
    schemaVersion: 7,
  });
  const response = expectMessage(output, "DbWorkerInitResponse");
  expect(response.success).toBe(true);
};

describe("runBunDbWorkerScope", () => {
  test("returns worker error before initialization", () => {
    const { send } = createHarness();

    const output = send({
      type: "DbWorkerQuery",
      requestId: 1,
      sql: "SELECT 1",
    });

    const error = expectMessage(output, "DbWorkerError");
    expect(error.requestId).toBe(1);
    expect(error.error).toContain("Database not initialized");
  });

  test("initializes and stores schema version metadata", () => {
    const { send } = createHarness();
    init(send);

    const output = send({
      type: "DbWorkerQuery",
      requestId: 2,
      sql: "SELECT value FROM __evolu_meta WHERE key = 'schemaVersion'",
    });

    const query = expectMessage(output, "DbWorkerQueryResponse");
    expect(query.requestId).toBe(2);
    expect(query.rows).toEqual([{ value: "7" }]);
  });

  test("supports file-backed db name initialization", () => {
    const { send } = createHarness();
    const dbName = join(
      tmpdir(),
      `evolu-bun-db-worker-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const dbPath = `${dbName}.sqlite`;
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;

    try {
      const initOutput = send({
        type: "DbWorkerInit",
        dbName,
        schemaVersion: 9,
      });
      const initResponse = expectMessage(initOutput, "DbWorkerInitResponse");
      expect(initResponse.success).toBe(true);

      const queryOutput = send({
        type: "DbWorkerQuery",
        requestId: 17,
        sql: "SELECT value FROM __evolu_meta WHERE key = 'schemaVersion'",
      });
      const query = expectMessage(queryOutput, "DbWorkerQueryResponse");
      expect(query.rows).toEqual([{ value: "9" }]);
    } finally {
      send({
        type: "DbWorkerClose",
        requestId: 18,
      });
      if (existsSync(dbPath)) rmSync(dbPath);
      if (existsSync(walPath)) rmSync(walPath);
      if (existsSync(shmPath)) rmSync(shmPath);
    }
  });

  test("supports mutate/query flow with SQL parameters", () => {
    const { send } = createHarness();
    init(send);

    send({
      type: "DbWorkerMutate",
      requestId: 3,
      sql: "CREATE TABLE todo (id INTEGER PRIMARY KEY, title TEXT NOT NULL)",
      params: [],
    });

    const insert = send({
      type: "DbWorkerMutate",
      requestId: 4,
      sql: "INSERT INTO todo (title) VALUES (?)",
      params: ["Ship LOOT-030"],
    });
    const mutate = expectMessage(insert, "DbWorkerMutateResponse");
    expect(mutate.requestId).toBe(4);
    expect(mutate.changes).toBe(1);

    const output = send({
      type: "DbWorkerQuery",
      requestId: 5,
      sql: "SELECT id, title FROM todo WHERE title = ?",
      params: ["Ship LOOT-030"],
    });
    const query = expectMessage(output, "DbWorkerQueryResponse");
    expect(query.requestId).toBe(5);
    expect(query.rows).toEqual([{ id: 1, title: "Ship LOOT-030" }]);
  });

  test("exports database content as Uint8Array", () => {
    const { send } = createHarness();
    init(send);

    send({
      type: "DbWorkerMutate",
      requestId: 6,
      sql: "CREATE TABLE todo (id INTEGER PRIMARY KEY, title TEXT NOT NULL)",
      params: [],
    });
    send({
      type: "DbWorkerMutate",
      requestId: 7,
      sql: "INSERT INTO todo (title) VALUES ('Backup')",
      params: [],
    });

    const output = send({
      type: "DbWorkerExport",
      requestId: 8,
    });
    const response = expectMessage(output, "DbWorkerExportResponse");
    expect(response.requestId).toBe(8);
    expect(response.data).toBeInstanceOf(Uint8Array);
    expect(response.data.byteLength).toBeGreaterThan(0);
  });

  test("resets user tables and keeps system metadata table", () => {
    const { send } = createHarness();
    init(send);

    send({
      type: "DbWorkerMutate",
      requestId: 9,
      sql: "CREATE TABLE todo (id INTEGER PRIMARY KEY, title TEXT NOT NULL)",
      params: [],
    });
    send({
      type: "DbWorkerMutate",
      requestId: 10,
      sql: "INSERT INTO todo (title) VALUES ('A')",
      params: [],
    });

    const reset = send({
      type: "DbWorkerReset",
      requestId: 11,
    });
    const resetResponse = expectMessage(reset, "DbWorkerResetResponse");
    expect(resetResponse.requestId).toBe(11);

    const output = send({
      type: "DbWorkerQuery",
      requestId: 12,
      sql: "SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='todo'",
    });
    const query = expectMessage(output, "DbWorkerQueryResponse");
    expect(query.rows).toEqual([{ count: 0 }]);
  });

  test("re-initialization closes previous database state", () => {
    const { send } = createHarness();
    init(send);

    send({
      type: "DbWorkerMutate",
      requestId: 13,
      sql: "CREATE TABLE todo (id INTEGER PRIMARY KEY, title TEXT NOT NULL)",
      params: [],
    });

    const secondInit = send({
      type: "DbWorkerInit",
      dbName: ":memory:",
      schemaVersion: 8,
    });
    expectMessage(secondInit, "DbWorkerInitResponse");

    const output = send({
      type: "DbWorkerQuery",
      requestId: 14,
      sql: "SELECT * FROM todo",
    });
    const error = expectMessage(output, "DbWorkerError");
    expect(error.requestId).toBe(14);
    expect(error.error).toContain("no such table: todo");
  });

  test("returns null app owner by default", () => {
    const { send } = createHarness();
    init(send);

    const output = send({ type: "DbWorkerGetAppOwner" });
    const response = expectMessage(output, "DbWorkerAppOwner");
    expect(response.appOwner).toBeNull();
  });

  test("returns worker error for invalid app owner payload", () => {
    const { send } = createHarness();
    init(send);

    send({
      type: "DbWorkerMutate",
      requestId: 19,
      sql: "INSERT OR REPLACE INTO __evolu_meta (key, value) VALUES ('appOwner', ?)",
      params: ["{not-json"],
    });

    const output = send({ type: "DbWorkerGetAppOwner" });
    const error = expectMessage(output, "DbWorkerError");
    expect(error.requestId).toBeUndefined();
    expect(error.error).toContain("JSON");
  });

  test("closes database on close message", () => {
    const { send } = createHarness();
    init(send);

    const close = send({
      type: "DbWorkerClose",
      requestId: 15,
    });
    const closeResponse = expectMessage(close, "DbWorkerCloseResponse");
    expect(closeResponse.requestId).toBe(15);

    const output = send({
      type: "DbWorkerQuery",
      requestId: 16,
      sql: "SELECT 1",
    });
    const error = expectMessage(output, "DbWorkerError");
    expect(error.requestId).toBe(16);
    expect(error.error).toContain("Database not initialized");
  });

  test("returns worker error for unknown message type", () => {
    const { send } = createHarness();

    const output = send({
      type: "DbWorkerTotallyUnknown",
      requestId: 999,
    } as unknown as DbWorkerInput);

    const error = expectMessage(output, "DbWorkerError");
    expect(error.requestId).toBe(999);
    expect(error.error).toContain("Unknown message type");
  });
});
