import { describe, expect, test, vi } from "vitest";
import {
  createSqliteApiWarnHandler,
  createWasmSqliteDriver,
  testSetSqlite3InitModule,
} from "../src/Sqlite.js";

interface SqliteMockState {
  readonly dbNames: Array<string>;
  readonly execSql: Array<string>;
}

const createSqlite3Mock = () => {
  const state: SqliteMockState = {
    dbNames: [],
    execSql: [],
  };

  class MockPreparedStatement {
    readonly bind = vi.fn();
    readonly step = vi.fn(() => false);
    readonly get = vi.fn(() => ({}));
    readonly reset = vi.fn();
    readonly finalize = vi.fn();
  }

  class MockDatabase {
    constructor(name: string) {
      state.dbNames.push(name);
    }

    readonly prepare = vi.fn((_sql: string) => new MockPreparedStatement());

    readonly exec = vi.fn((query: string) => {
      state.execSql.push(query);
      return [];
    });

    readonly changes = vi.fn(() => 0);

    readonly close = vi.fn();
  }

  const installOpfsSAHPoolVfs = vi.fn(async (_options: unknown) => ({
    OpfsSAHPoolDb: MockDatabase,
  }));
  const sqlite3mc_vfs_create = vi.fn();
  const sqlite3_js_db_export = vi.fn(() => new Uint8Array([1, 2, 3]));

  return {
    sqlite3: {
      capi: { sqlite3mc_vfs_create, sqlite3_js_db_export },
      installOpfsSAHPoolVfs,
      oo1: { DB: MockDatabase },
    },
    installOpfsSAHPoolVfs,
    sqlite3mc_vfs_create,
    sqlite3_js_db_export,
    state,
  };
};

describe("Sqlite module test seams", () => {
  test("createSqliteApiWarnHandler suppresses only known OPFS warning", () => {
    const warn = vi.fn();
    const handler = createSqliteApiWarnHandler(warn);

    handler("Ignoring inability to install OPFS sqlite3_vfs test");
    expect(warn).not.toHaveBeenCalled();

    handler("Other warning");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Other warning");
  });

  test("createWasmSqliteDriver uses encrypted OPFS path", async () => {
    const sqlite3Mock = createSqlite3Mock();
    using _restore = testSetSqlite3InitModule(
      async () => sqlite3Mock.sqlite3 as never,
    );

    const result = await createWasmSqliteDriver("encrypted-db", {
      mode: "encrypted",
      encryptionKey: new Uint8Array([0x01, 0x02, 0x0a, 0xff]),
    })();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(sqlite3Mock.sqlite3mc_vfs_create).toHaveBeenCalledWith("opfs", 1);
    expect(sqlite3Mock.installOpfsSAHPoolVfs).toHaveBeenCalledWith({
      directory: ".encrypted-db",
    });
    expect(sqlite3Mock.state.dbNames).toContain(
      "file:evolu1.db?vfs=multipleciphers-opfs-sahpool",
    );
    expect(
      sqlite3Mock.state.execSql.some((sql) =>
        sql.includes("PRAGMA cipher = 'sqlcipher'"),
      ),
    ).toBe(true);
    expect(
      sqlite3Mock.state.execSql.some((sql) =>
        sql.includes(`PRAGMA key = "x'01020aff'"`),
      ),
    ).toBe(true);

    result.value[Symbol.dispose]();
  });

  test("createWasmSqliteDriver uses default OPFS path", async () => {
    const sqlite3Mock = createSqlite3Mock();
    using _restore = testSetSqlite3InitModule(
      async () => sqlite3Mock.sqlite3 as never,
    );

    const result = await createWasmSqliteDriver("plain-db")();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(sqlite3Mock.sqlite3mc_vfs_create).toHaveBeenCalledWith("opfs", 1);
    expect(sqlite3Mock.installOpfsSAHPoolVfs).toHaveBeenCalledWith({
      name: "plain-db",
    });
    expect(sqlite3Mock.state.dbNames).toContain("file:evolu1.db");

    result.value[Symbol.dispose]();
  });

  test("retries sqlite init after first init failure", async () => {
    const sqlite3Mock = createSqlite3Mock();
    const initModule = vi.fn(async () => {
      if (initModule.mock.calls.length === 1) {
        throw new Error("init failed once");
      }
      return sqlite3Mock.sqlite3 as never;
    });

    using _restore = testSetSqlite3InitModule(initModule);

    await expect(createWasmSqliteDriver("retry-db")()).rejects.toThrow(
      "init failed once",
    );

    const result = await createWasmSqliteDriver("retry-db")();
    expect(result.ok).toBe(true);
    expect(initModule).toHaveBeenCalledTimes(2);
    if (!result.ok) return;

    result.value[Symbol.dispose]();
  });
});
