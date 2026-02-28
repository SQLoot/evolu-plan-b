import { SimpleName, testCreateRun } from "@evolu/common";
import { assert, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@op-engineering/op-sqlite", () => ({
  open: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseSync: vi.fn(),
}));

import { open } from "@op-engineering/op-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { createExpoSqliteDriver } from "../src/sqlite-drivers/createExpoSqliteDriver.js";
import { createOpSqliteDriver } from "../src/sqlite-drivers/createOpSqliteDriver.js";

const testName = SimpleName.orThrow("Test");

const createQuery = (sql: string, prepared = false) =>
  ({
    sql: sql as any,
    parameters: [] as Array<never>,
    ...(prepared ? { options: { prepare: true } } : {}),
  }) as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createExpoSqliteDriver", () => {
  test("opens memory database and executes non-prepared query", async () => {
    const resultSet = {
      changes: 2,
      getAllSync: vi.fn(() => [{ id: 1 }]),
      resetSync: vi.fn(),
    };
    const statement = {
      executeSync: vi.fn(() => resultSet),
      finalizeSync: vi.fn(),
    };
    const db = {
      closeSync: vi.fn(),
      execSync: vi.fn(),
      prepareSync: vi.fn(() => statement),
      serializeSync: vi.fn(() => new Uint8Array([1, 2, 3])),
    };
    vi.mocked(openDatabaseSync).mockReturnValue(db as any);

    await using run = testCreateRun();
    const taskResult = await run(
      createExpoSqliteDriver(testName, { mode: "memory" }),
    );
    assert(taskResult.ok);

    const execResult = taskResult.value.exec(createQuery("select 1"));
    expect(execResult).toEqual({ rows: [{ id: 1 }], changes: 2 });
    expect(Array.from(taskResult.value.export())).toEqual([1, 2, 3]);
    expect(resultSet.resetSync).toHaveBeenCalledTimes(1);
    expect(statement.finalizeSync).toHaveBeenCalledTimes(1);
    expect(openDatabaseSync).toHaveBeenCalledWith(":memory:");
  });

  test("encrypts db, uses prepared cache path, and disposes idempotently", async () => {
    const resultSet = {
      changes: 1,
      getAllSync: vi.fn(() => [{ prepared: true }]),
      resetSync: vi.fn(),
    };
    const preparedStatement = {
      executeSync: vi.fn(() => resultSet),
      finalizeSync: vi.fn(),
    };
    const db = {
      closeSync: vi.fn(),
      execSync: vi.fn(),
      prepareSync: vi.fn(() => preparedStatement),
      serializeSync: vi.fn(() => new Uint8Array([4, 5])),
    };
    vi.mocked(openDatabaseSync).mockReturnValue(db as any);

    await using run = testCreateRun();
    const taskResult = await run(
      createExpoSqliteDriver(testName, {
        mode: "encrypted",
        encryptionKey: new Uint8Array([1, 2, 3]) as any,
      }),
    );
    assert(taskResult.ok);

    const query = createQuery("select prepared", true);
    taskResult.value.exec(query);
    taskResult.value.exec(query);

    expect(db.execSync).toHaveBeenCalledWith(`PRAGMA key = "x'010203'"`);
    expect(db.prepareSync).toHaveBeenCalledTimes(1);
    expect(preparedStatement.executeSync).toHaveBeenCalledTimes(2);

    taskResult.value[Symbol.dispose]();
    taskResult.value[Symbol.dispose]();

    expect(preparedStatement.finalizeSync).toHaveBeenCalledTimes(1);
    expect(db.closeSync).toHaveBeenCalledTimes(1);
  });

  test("exports Uint8Array when serialize result is not ArrayBuffer-backed view", async () => {
    const statement = {
      executeSync: vi.fn(() => ({
        changes: 0,
        getAllSync: vi.fn(() => []),
        resetSync: vi.fn(),
      })),
      finalizeSync: vi.fn(),
    };
    const db = {
      closeSync: vi.fn(),
      execSync: vi.fn(),
      prepareSync: vi.fn(() => statement),
      serializeSync: vi.fn(() => [9, 8, 7]),
    };
    vi.mocked(openDatabaseSync).mockReturnValue(db as any);

    await using run = testCreateRun();
    const taskResult = await run(createExpoSqliteDriver(testName));
    assert(taskResult.ok);

    expect(Array.from(taskResult.value.export())).toEqual([9, 8, 7]);
  });
});

describe("createOpSqliteDriver", () => {
  test("opens memory db and executes non-prepared query", async () => {
    const prepared = {
      bindSync: vi.fn(),
    };
    const db = {
      close: vi.fn(),
      executeSync: vi.fn(() => ({ rows: [{ ok: true }], rowsAffected: 4 })),
      getDbPath: vi.fn(() => "/tmp/evolu1-Test.db"),
      prepareStatement: vi.fn(() => prepared),
    };
    vi.mocked(open).mockReturnValue(db as any);

    await using run = testCreateRun();
    const taskResult = await run(
      createOpSqliteDriver(testName, { mode: "memory" }),
    );
    assert(taskResult.ok);

    const execResult = taskResult.value.exec(createQuery("select 1"));
    expect(execResult).toEqual({ rows: [{ ok: true }], changes: 4 });
    expect(db.prepareStatement).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith({
      name: "inMemoryDb",
      location: ":memory:",
    });
  });

  test("uses encrypted config and binds parameters for prepared query", async () => {
    const prepared = {
      bindSync: vi.fn(),
    };
    const db = {
      close: vi.fn(),
      executeSync: vi.fn(() => ({ rows: [], rowsAffected: 0 })),
      getDbPath: vi.fn(() => "/tmp/evolu1-Test.db"),
      prepareStatement: vi.fn(() => prepared),
    };
    vi.mocked(open).mockReturnValue(db as any);

    await using run = testCreateRun();
    const taskResult = await run(
      createOpSqliteDriver(testName, {
        mode: "encrypted",
        encryptionKey: new Uint8Array([10, 11]) as any,
      }),
    );
    assert(taskResult.ok);

    const query = {
      sql: "select prepared" as any,
      parameters: [1, "a"] as any,
      options: { prepare: true },
    };
    taskResult.value.exec(query);

    expect(open).toHaveBeenCalledWith({
      name: "evolu1-Test.db",
      encryptionKey: "x'0a0b'",
    });
    expect(prepared.bindSync).toHaveBeenCalledWith([1, "a"]);
  });

  test("export throws clear error with db path", async () => {
    vi.mocked(open).mockReturnValue({
      close: vi.fn(),
      executeSync: vi.fn(() => ({ rows: [], rowsAffected: 0 })),
      getDbPath: vi.fn(() => "/tmp/evolu1-Test.db"),
      prepareStatement: vi.fn(() => ({ bindSync: vi.fn() })),
    } as any);

    await using run = testCreateRun();
    const result = await run(createOpSqliteDriver(testName));
    assert(result.ok);

    expect(() => result.value.export()).toThrowError(
      /not supported with @op-engineering\/op-sqlite/i,
    );
    expect(() => result.value.export()).toThrowError(
      /Database path: \/tmp\/evolu1-Test\.db\./,
    );
  });

  test("export throws clear error even when db path is unavailable", async () => {
    vi.mocked(open).mockReturnValue({
      close: vi.fn(),
      executeSync: vi.fn(() => ({ rows: [], rowsAffected: 0 })),
      getDbPath: vi.fn(() => {
        throw new Error("path unavailable");
      }),
      prepareStatement: vi.fn(() => ({ bindSync: vi.fn() })),
    } as any);

    await using run = testCreateRun();
    const result = await run(createOpSqliteDriver(testName));
    assert(result.ok);

    expect(() => result.value.export()).toThrowError(
      /not supported with @op-engineering\/op-sqlite/i,
    );
    expect(() => result.value.export()).not.toThrowError(/Database path:/);
  });

  test("dispose is idempotent", async () => {
    const db = {
      close: vi.fn(),
      executeSync: vi.fn(() => ({ rows: [], rowsAffected: 0 })),
      getDbPath: vi.fn(() => "/tmp/evolu1-Test.db"),
      prepareStatement: vi.fn(() => ({ bindSync: vi.fn() })),
    };
    vi.mocked(open).mockReturnValue(db as any);

    await using run = testCreateRun();
    const result = await run(createOpSqliteDriver(testName));
    assert(result.ok);

    result.value[Symbol.dispose]();
    result.value[Symbol.dispose]();

    expect(db.close).toHaveBeenCalledTimes(1);
  });
});
