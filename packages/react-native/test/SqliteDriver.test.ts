import { SimpleName, testCreateRun } from "@evolu/common";
import { assert, describe, expect, test, vi } from "vitest";

vi.mock("@op-engineering/op-sqlite", () => {
  return {
    open: vi.fn(),
  };
});

import { open } from "@op-engineering/op-sqlite";
import { createOpSqliteDriver } from "../src/sqlite-drivers/createOpSqliteDriver.js";

const testName = SimpleName.orThrow("Test");

const createMockDb = (getDbPath: () => string) => ({
  getDbPath,
  close: vi.fn(),
  prepareStatement: vi.fn(() => ({
    bindSync: vi.fn(),
  })),
  executeSync: vi.fn(() => ({
    rows: [],
    rowsAffected: 0,
  })),
});

describe("createOpSqliteDriver", () => {
  test("export throws clear error with db path", async () => {
    vi.mocked(open).mockReturnValue(
      createMockDb(() => "/tmp/evolu1-Test.db") as any,
    );

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
    vi.mocked(open).mockReturnValue(
      createMockDb(() => {
        throw new Error("path unavailable");
      }) as any,
    );

    await using run = testCreateRun();
    const result = await run(createOpSqliteDriver(testName));
    assert(result.ok);

    expect(() => result.value.export()).toThrowError(
      /not supported with @op-engineering\/op-sqlite/i,
    );
    expect(() => result.value.export()).not.toThrowError(/Database path:/);
  });
});
