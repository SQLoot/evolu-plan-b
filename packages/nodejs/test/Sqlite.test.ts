import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  type CreateSqliteDriverDep,
  createSqlite,
  SimpleName,
  type SqliteRow,
  type SqliteValue,
  sql,
  testCreateRun,
} from "@evolu/common";
import { afterEach, assert, describe, expect, test, vi } from "vitest";
import { createBetterSqliteDriver } from "../src/Sqlite.js";

const testName = SimpleName.orThrow("Test");
const require = createRequire(import.meta.url);

type BetterSqliteConstructor = new (
  filename: string,
) => {
  readonly exec: (sql: string) => void;
  readonly serialize: () => Uint8Array;
  readonly close: () => void;
};

const BetterSQLite = (() => {
  try {
    const SQLite = require("better-sqlite3") as BetterSqliteConstructor;
    const db = new SQLite(":memory:");
    db.close();
    return SQLite;
  } catch {
    return null;
  }
})();

describe("createBetterSqliteDriver", () => {
  test("creates in-memory database", async () => {
    await using run = testCreateRun<CreateSqliteDriverDep>({
      createSqliteDriver: createBetterSqliteDriver,
    });
    const result = await run(createSqlite(testName, { mode: "memory" }));
    assert(result.ok);
    const sqlite = result.value;

    sqlite.exec(sql`create table t (data text);`);
    sqlite.exec(sql`insert into t (data) values (${"hello"});`);
    const rows = sqlite.exec(sql`select * from t;`);
    expect(rows.rows).toEqual([{ data: "hello" }]);

    sqlite[Symbol.dispose]();
  });

  test("exec returns rows for reader queries", async () => {
    await using run = testCreateRun<CreateSqliteDriverDep>({
      createSqliteDriver: createBetterSqliteDriver,
    });
    const result = await run(createSqlite(testName, { mode: "memory" }));
    assert(result.ok);
    const sqlite = result.value;

    sqlite.exec(sql`create table t (id integer primary key, name text);`);
    sqlite.exec(sql`insert into t (name) values (${"Alice"});`);
    sqlite.exec(sql`insert into t (name) values (${"Bob"});`);

    const rows = sqlite.exec(sql`select name from t order by id;`);
    expect(rows.rows).toEqual([{ name: "Alice" }, { name: "Bob" }]);
    expect(rows.changes).toBe(0);

    sqlite[Symbol.dispose]();
  });

  test("exec returns changes for writer queries", async () => {
    await using run = testCreateRun<CreateSqliteDriverDep>({
      createSqliteDriver: createBetterSqliteDriver,
    });
    const result = await run(createSqlite(testName, { mode: "memory" }));
    assert(result.ok);
    const sqlite = result.value;

    sqlite.exec(sql`create table t (id integer primary key, name text);`);
    sqlite.exec(sql`insert into t (name) values (${"Alice"});`);
    sqlite.exec(sql`insert into t (name) values (${"Bob"});`);

    const deleteResult = sqlite.exec(sql`delete from t;`);
    expect(deleteResult.rows).toEqual([]);
    expect(deleteResult.changes).toBe(2);

    sqlite[Symbol.dispose]();
  });

  test("export returns serialized database bytes", async () => {
    await using run = testCreateRun<CreateSqliteDriverDep>({
      createSqliteDriver: createBetterSqliteDriver,
    });
    const result = await run(createSqlite(testName, { mode: "memory" }));
    assert(result.ok);
    const sqlite = result.value;

    sqlite.exec(sql`create table t (data text);`);
    sqlite.exec(sql`insert into t (data) values (${"foo"});`);

    const exported = sqlite.export();
    expect(exported).toBeInstanceOf(Uint8Array);
    expect(exported.length).toBeGreaterThan(0);

    sqlite[Symbol.dispose]();
  });

  test("dispose is idempotent", async () => {
    await using run = testCreateRun<CreateSqliteDriverDep>({
      createSqliteDriver: createBetterSqliteDriver,
    });
    const result = await run(createSqlite(testName, { mode: "memory" }));
    assert(result.ok);
    const sqlite = result.value;

    sqlite[Symbol.dispose]();
    sqlite[Symbol.dispose]();
  });

  test("prepared statements are cached and reused", async () => {
    await using run = testCreateRun<CreateSqliteDriverDep>({
      createSqliteDriver: createBetterSqliteDriver,
    });
    const result = await run(createSqlite(testName, { mode: "memory" }));
    assert(result.ok);
    const sqlite = result.value;

    sqlite.exec(sql`create table t (id integer primary key, name text);`);

    // Execute the same query twice — both should succeed via cached statement
    const insert1 = sqlite.exec(sql`insert into t (name) values (${"A"});`);
    const insert2 = sqlite.exec(sql`insert into t (name) values (${"B"});`);
    expect(insert1.changes).toBe(1);
    expect(insert2.changes).toBe(1);

    const rows = sqlite.exec(sql`select name from t order by id;`);
    expect(rows.rows).toEqual([{ name: "A" }, { name: "B" }]);

    sqlite[Symbol.dispose]();
  });

  test("driver dispose is idempotent", async () => {
    await using run = testCreateRun();
    const task = createBetterSqliteDriver(testName, { mode: "memory" });
    const result = await run(task);
    assert(result.ok);
    const driver = result.value;

    driver[Symbol.dispose]();
    driver[Symbol.dispose]();
  });

  const testIfBetterSqlite = BetterSQLite ? test : test.skip;
  testIfBetterSqlite(
    "better-sqlite3 serialize returns Buffer backed by ArrayBuffer",
    () => {
      if (!BetterSQLite) return;
      const db = new BetterSQLite(":memory:");
      db.exec("create table t (data text);");
      db.exec("insert into t (data) values ('x');");

      const serialized = db.serialize();

      expect(serialized).toBeInstanceOf(Uint8Array);
      expect(Buffer.isBuffer(serialized)).toBe(true);
      expect(serialized.buffer).toBeInstanceOf(ArrayBuffer);

      db.close();
    },
  );

  test("falls back to node:sqlite when better-sqlite3 initialization fails", async () => {
    vi.resetModules();

    interface MockStatement {
      readonly all: (...parameters: ReadonlyArray<unknown>) => Array<SqliteRow>;
      readonly run: (...parameters: ReadonlyArray<unknown>) => {
        readonly changes?: number;
      };
    }

    class MockDatabaseSync {
      #rows = [] as { readonly name: unknown }[];

      prepare(sqlText: string): MockStatement {
        const normalized = sqlText.trim().toLowerCase();

        return {
          all: (..._parameters) => {
            if (normalized.startsWith("select")) {
              return this.#rows.map((row) => ({ ...row }));
            }

            return [];
          },
          run: (...parameters) => {
            if (normalized.startsWith("insert")) {
              this.#rows.push({ name: parameters[0] });
              return { changes: 1 };
            }

            if (normalized.startsWith("update")) {
              return {};
            }

            return { changes: 0 };
          },
        };
      }

      exec(sqlText: string): void {
        const match = /^vacuum into '(.+)'$/i.exec(sqlText.trim());
        if (!match) return;
        const path = match[1]?.replaceAll("''", "'");
        if (!path) return;
        writeFileSync(path, Buffer.from([1, 2, 3]));
      }

      close(): void {}
    }

    vi.doMock("node:module", () => ({
      createRequire: () => (id: string) => {
        if (id === "better-sqlite3") {
          return class BetterSqliteBroken {
            constructor() {
              throw new Error("simulated better-sqlite3 init failure");
            }
          };
        }
        if (id === "node:sqlite") {
          return { DatabaseSync: MockDatabaseSync };
        }
        throw new Error(`Unexpected module request: ${id}`);
      },
    }));

    try {
      const modulePath = `../src/Sqlite.ts?fallback-${Date.now()}`;
      const { createBetterSqliteDriver: createDriver } = await import(
        modulePath
      );

      await using run = testCreateRun();
      const result = await run(createDriver(testName, { mode: "memory" }));
      assert(result.ok);
      const sqlite = result.value;

      sqlite.exec(sql`create table t (name text);`);
      sqlite.exec(sql`insert into t (name) values (${"Alice"});`);
      const rows = sqlite.exec(sql`select name from t;`);
      const updateResult = sqlite.exec(sql`update t set name = ${"Alice"};`);

      expect(rows.rows).toEqual([{ name: "Alice" }]);
      expect(updateResult.changes).toBe(0);

      const exported = sqlite.export();
      expect(exported).toBeInstanceOf(Uint8Array);
      expect(exported).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      vi.doUnmock("node:module");
      vi.resetModules();
    }
  });

  test("uses bun:sqlite driver when Bun runtime is available", async () => {
    vi.resetModules();
    const originalBun = (globalThis as Record<string, unknown>).Bun;
    (globalThis as Record<string, unknown>).Bun = {};

    interface MockStatement {
      readonly all: (...parameters: ReadonlyArray<unknown>) => Array<SqliteRow>;
      readonly run: (...parameters: ReadonlyArray<unknown>) => {
        readonly changes: number;
      };
    }

    class MockBunDatabase {
      #rows = [] as { readonly name: unknown }[];

      prepare(sqlText: string): MockStatement {
        const normalized = sqlText.trim().toLowerCase();

        return {
          all: (..._parameters) => {
            if (normalized.startsWith("select")) {
              return this.#rows.map((row) => ({ ...row }));
            }
            return [];
          },
          run: (...parameters) => {
            if (normalized.startsWith("insert")) {
              this.#rows.push({ name: parameters[0] });
              return { changes: 1 };
            }
            return { changes: 0 };
          },
        };
      }

      serialize(): Uint8Array {
        return new Uint8Array([5, 6, 7]);
      }

      close(): void {}
    }

    vi.doMock("node:module", () => ({
      createRequire: () => (id: string) => {
        if (id === "bun:sqlite") return { Database: MockBunDatabase };
        if (id === "better-sqlite3") {
          throw new Error("better-sqlite3 should not be used in this test");
        }
        throw new Error(`Unexpected module request: ${id}`);
      },
    }));

    try {
      const modulePath = `../src/Sqlite.ts?bun-runtime-${Date.now()}`;
      const { createBetterSqliteDriver: createDriver } = await import(
        modulePath
      );

      await using run = testCreateRun();
      const result = await run(createDriver(testName, { mode: "memory" }));
      assert(result.ok);
      const sqlite = result.value;

      sqlite.exec(sql`insert into t (name) values (${"Alice"});`);
      const rows = sqlite.exec(sql`select name from t;`);
      expect(rows.rows).toEqual([{ name: "Alice" }]);
      expect(sqlite.export()).toEqual(new Uint8Array([5, 6, 7]));
    } finally {
      vi.doUnmock("node:module");
      vi.resetModules();
      if (originalBun === undefined) {
        delete (globalThis as Record<string, unknown>).Bun;
      } else {
        (globalThis as Record<string, unknown>).Bun = originalBun;
      }
    }
  });

  test("falls back to better-sqlite3 when bun:sqlite init fails in Bun runtime", async () => {
    vi.resetModules();
    const originalBun = (globalThis as Record<string, unknown>).Bun;
    (globalThis as Record<string, unknown>).Bun = {};

    interface MockStatement {
      readonly reader: boolean;
      readonly all: (
        ...parameters: ReadonlyArray<SqliteValue>
      ) => Array<SqliteRow>;
      readonly run: (...parameters: ReadonlyArray<SqliteValue>) => {
        readonly changes: number;
      };
    }

    class MockBetterDatabase {
      #rows = [] as { readonly name: unknown }[];

      prepare(sqlText: string): MockStatement {
        const normalized = sqlText.trim().toLowerCase();
        return {
          reader: normalized.startsWith("select"),
          all: (...parameters) => {
            if (normalized.startsWith("select")) {
              return this.#rows.map((row) => ({ ...row }));
            }
            if (normalized.startsWith("insert") && parameters.length > 0) {
              this.#rows.push({ name: parameters[0] });
              return [];
            }
            return [];
          },
          run: (...parameters) => {
            if (normalized.startsWith("insert")) {
              this.#rows.push({ name: parameters[0] });
              return { changes: 1 };
            }
            return { changes: 0 };
          },
        };
      }

      serialize(): Uint8Array {
        return new Uint8Array([8, 9, 10]);
      }

      close(): void {}
    }

    vi.doMock("node:module", () => ({
      createRequire: () => (id: string) => {
        if (id === "bun:sqlite") {
          return {
            Database: class BunSqliteBroken {
              constructor() {
                throw new Error("simulated bun:sqlite init failure");
              }
            },
          };
        }
        if (id === "better-sqlite3") {
          return MockBetterDatabase;
        }
        throw new Error(`Unexpected module request: ${id}`);
      },
    }));

    try {
      const modulePath = `../src/Sqlite.ts?bun-fallback-${Date.now()}`;
      const { createBetterSqliteDriver: createDriver } = await import(
        modulePath
      );

      await using run = testCreateRun();
      const result = await run(createDriver(testName, { mode: "memory" }));
      assert(result.ok);
      const sqlite = result.value;

      sqlite.exec(sql`insert into t (name) values (${"Bob"});`);
      const rows = sqlite.exec(sql`select name from t;`);
      expect(rows.rows).toEqual([{ name: "Bob" }]);
      expect(sqlite.export()).toEqual(new Uint8Array([8, 9, 10]));
    } finally {
      vi.doUnmock("node:module");
      vi.resetModules();
      if (originalBun === undefined) {
        delete (globalThis as Record<string, unknown>).Bun;
      } else {
        (globalThis as Record<string, unknown>).Bun = originalBun;
      }
    }
  });

  test("rethrows bun:sqlite error when all Bun runtime fallbacks fail", async () => {
    vi.resetModules();
    const originalBun = (globalThis as Record<string, unknown>).Bun;
    (globalThis as Record<string, unknown>).Bun = {};

    vi.doMock("node:module", () => ({
      createRequire: () => (id: string) => {
        if (id === "bun:sqlite") {
          return {
            Database: class BunSqliteBroken {
              constructor() {
                throw new Error("simulated bun:sqlite init failure");
              }
            },
          };
        }
        if (id === "better-sqlite3") {
          return class BetterSqliteBroken {
            constructor() {
              throw new Error("simulated better-sqlite3 init failure");
            }
          };
        }
        if (id === "node:sqlite") {
          return {
            DatabaseSync: class NodeSqliteBroken {
              constructor() {
                throw new Error("simulated node:sqlite init failure");
              }
            },
          };
        }
        throw new Error(`Unexpected module request: ${id}`);
      },
    }));

    try {
      const modulePath = `../src/Sqlite.ts?bun-all-fail-${Date.now()}`;
      const { createBetterSqliteDriver: createDriver } = await import(
        modulePath
      );

      await using run = testCreateRun();
      await expect(
        run(createDriver(testName, { mode: "memory" })),
      ).rejects.toThrow("simulated bun:sqlite init failure");
    } finally {
      vi.doUnmock("node:module");
      vi.resetModules();
      if (originalBun === undefined) {
        delete (globalThis as Record<string, unknown>).Bun;
      } else {
        (globalThis as Record<string, unknown>).Bun = originalBun;
      }
    }
  });

  test("rethrows better-sqlite3 error when non-Bun fallbacks fail", async () => {
    vi.resetModules();
    const originalBun = (globalThis as Record<string, unknown>).Bun;
    delete (globalThis as Record<string, unknown>).Bun;

    vi.doMock("node:module", () => ({
      createRequire: () => (id: string) => {
        if (id === "better-sqlite3") {
          return class BetterSqliteBroken {
            constructor() {
              throw new Error("simulated better-sqlite3 init failure");
            }
          };
        }
        if (id === "node:sqlite") {
          return {
            DatabaseSync: class NodeSqliteBroken {
              constructor() {
                throw new Error("simulated node:sqlite init failure");
              }
            },
          };
        }
        throw new Error(`Unexpected module request: ${id}`);
      },
    }));

    try {
      const modulePath = `../src/Sqlite.ts?non-bun-all-fail-${Date.now()}`;
      const { createBetterSqliteDriver: createDriver } = await import(
        modulePath
      );

      await using run = testCreateRun();
      await expect(
        run(createDriver(testName, { mode: "memory" })),
      ).rejects.toThrow("simulated better-sqlite3 init failure");
    } finally {
      vi.doUnmock("node:module");
      vi.resetModules();
      if (originalBun === undefined) {
        delete (globalThis as Record<string, unknown>).Bun;
      } else {
        (globalThis as Record<string, unknown>).Bun = originalBun;
      }
    }
  });

  test("export handles SharedArrayBuffer-backed serialization in Bun path", async () => {
    vi.resetModules();
    const originalBun = (globalThis as Record<string, unknown>).Bun;
    (globalThis as Record<string, unknown>).Bun = {};

    class MockBunDatabase {
      prepare() {
        return {
          all: () => [] as Array<SqliteRow>,
          run: () => ({ changes: 0 }),
        };
      }

      serialize(): Uint8Array {
        const bytes = new Uint8Array(new SharedArrayBuffer(3));
        bytes.set([11, 12, 13]);
        return bytes;
      }

      close(): void {}
    }

    vi.doMock("node:module", () => ({
      createRequire: () => (id: string) => {
        if (id === "bun:sqlite") return { Database: MockBunDatabase };
        throw new Error(`Unexpected module request: ${id}`);
      },
    }));

    try {
      const modulePath = `../src/Sqlite.ts?bun-shared-buffer-${Date.now()}`;
      const { createBetterSqliteDriver: createDriver } = await import(
        modulePath
      );

      await using run = testCreateRun();
      const result = await run(createDriver(testName, { mode: "memory" }));
      assert(result.ok);
      const sqlite = result.value;

      expect(sqlite.export()).toEqual(new Uint8Array([11, 12, 13]));
      sqlite[Symbol.dispose]();
    } finally {
      vi.doUnmock("node:module");
      vi.resetModules();
      if (originalBun === undefined) {
        delete (globalThis as Record<string, unknown>).Bun;
      } else {
        (globalThis as Record<string, unknown>).Bun = originalBun;
      }
    }
  });

  test("node serialize fallback handles non-ArrayBuffer file backing", async () => {
    vi.resetModules();
    const originalBun = (globalThis as Record<string, unknown>).Bun;
    delete (globalThis as Record<string, unknown>).Bun;

    class MockNodeDatabase {
      prepare() {
        return {
          all: (..._parameters: ReadonlyArray<unknown>) =>
            [] as Array<SqliteRow>,
          run: (..._parameters: ReadonlyArray<unknown>) => ({ changes: 0 }),
        };
      }

      exec(_sqlText: string): void {}

      close(): void {}
    }

    vi.doMock("node:fs", () => ({
      readFileSync: () => {
        const bytes = new Uint8Array(new SharedArrayBuffer(3));
        bytes.set([3, 4, 5]);
        return bytes;
      },
      rmSync: () => {},
      existsSync,
      unlinkSync,
      writeFileSync,
    }));

    vi.doMock("node:module", () => ({
      createRequire: () => (id: string) => {
        if (id === "better-sqlite3") {
          return class BetterSqliteBroken {
            constructor() {
              throw new Error("simulated better-sqlite3 init failure");
            }
          };
        }
        if (id === "node:sqlite") {
          return { DatabaseSync: MockNodeDatabase };
        }
        throw new Error(`Unexpected module request: ${id}`);
      },
    }));

    try {
      const modulePath = `../src/Sqlite.ts?node-serialize-fallback-${Date.now()}`;
      const { createBetterSqliteDriver: createDriver } = await import(
        modulePath
      );

      await using run = testCreateRun();
      const result = await run(createDriver(testName, { mode: "memory" }));
      assert(result.ok);
      const sqlite = result.value;

      expect(sqlite.export()).toEqual(new Uint8Array([3, 4, 5]));
      sqlite[Symbol.dispose]();
    } finally {
      vi.doUnmock("node:module");
      vi.doUnmock("node:fs");
      vi.resetModules();
      if (originalBun === undefined) {
        delete (globalThis as Record<string, unknown>).Bun;
      } else {
        (globalThis as Record<string, unknown>).Bun = originalBun;
      }
    }
  });

  describe("file-based database", () => {
    const dbPath = `${testName}.db`;

    afterEach(() => {
      if (existsSync(dbPath)) unlinkSync(dbPath);
    });

    test("creates database file on disk", async () => {
      await using run = testCreateRun();
      const task = createBetterSqliteDriver(testName);
      const result = await run(task);
      assert(result.ok);
      const driver = result.value;

      expect(existsSync(dbPath)).toBe(true);
      driver[Symbol.dispose]();
    });
  });
});
