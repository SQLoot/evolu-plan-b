import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TimingSafeEqual } from "../src/Crypto.js";
import { lazyTrue, lazyVoid } from "../src/Function.js";
import {
  createRelaySqliteStorage,
  createRelayStorageTables,
} from "../src/local-first/Relay.js";
import {
  createBaseSqliteStorageTables,
  type StorageConfig,
  type StorageDep,
} from "../src/local-first/Storage.js";
import { ok } from "../src/Result.js";
import type {
  CreateSqliteDriver,
  CreateSqliteDriverDep,
  SqliteDep,
  SqliteDriver,
  SqliteRow,
  SqliteValue,
} from "../src/Sqlite.js";
import {
  createPreparedStatementsCache,
  testCreateRunWithSqlite as createTestRunWithSqlite,
} from "../src/Sqlite.js";
import type { Run } from "../src/Task.js";
import type { TestDeps } from "../src/Test.js";

const require = createRequire(import.meta.url);

export const testTimingSafeEqual: TimingSafeEqual = timingSafeEqual;

export const testCreateSqliteDeps = (): CreateSqliteDriverDep => ({
  createSqliteDriver: testCreateSqliteDriver,
});

export const testCreateRunWithSqlite = async (): Promise<
  Run<TestDeps & CreateSqliteDriverDep & SqliteDep>
> => {
  return createTestRunWithSqlite(testCreateSqliteDeps());
};

/** Creates a test Run with relay storage and SQLite deps. */
export const testCreateRunWithSqliteAndRelayStorage = async (
  config?: Partial<StorageConfig>,
): Promise<Run<TestDeps & CreateSqliteDriverDep & SqliteDep & StorageDep>> => {
  const run = await testCreateRunWithSqlite();

  createBaseSqliteStorageTables(run.deps);
  createRelayStorageTables(run.deps);

  const storage = createRelaySqliteStorage({
    ...run.deps,
    timingSafeEqual: testTimingSafeEqual,
  })({
    isOwnerWithinQuota: lazyTrue,
    ...config,
  });

  return run.addDeps<StorageDep>({ storage });
};

/** In-memory better-sqlite3 driver for tests. */
export const testCreateSqliteDriver: CreateSqliteDriver = (name) =>
  createBetterSqliteDriver(name, { mode: "memory" });

interface StatementLike {
  readonly reader?: boolean;
  readonly all: (...parameters: ReadonlyArray<unknown>) => Array<SqliteRow>;
  readonly run: (...parameters: ReadonlyArray<unknown>) => {
    readonly changes: number;
  };
}

interface DbLike {
  readonly prepare: (sql: string) => StatementLike;
  readonly serialize: () => Uint8Array;
  readonly close: () => void;
}

interface BetterSqliteStatementLike {
  readonly reader: boolean;
  readonly all: (parameters?: ReadonlyArray<SqliteValue>) => Array<SqliteRow>;
  readonly run: (parameters?: ReadonlyArray<SqliteValue>) => {
    readonly changes: number;
  };
}

interface BetterSqliteDbLike {
  readonly prepare: (sql: string) => BetterSqliteStatementLike;
  readonly serialize: () => Uint8Array;
  readonly close: () => void;
}

type BetterSqliteConstructor = new (filename: string) => BetterSqliteDbLike;

interface BunSqliteStatementLike {
  readonly all: (...parameters: ReadonlyArray<SqliteValue>) => Array<SqliteRow>;
  readonly run: (...parameters: ReadonlyArray<SqliteValue>) => {
    readonly changes: number;
  };
}

interface BunSqliteDbLike {
  readonly prepare: (sql: string) => BunSqliteStatementLike;
  readonly serialize: () => Uint8Array;
  readonly close: () => void;
}

interface BunSqliteModule {
  readonly Database: new (filename: string) => BunSqliteDbLike;
}

interface NodeSqliteStatementLike {
  readonly all: (...parameters: ReadonlyArray<SqliteValue>) => Array<SqliteRow>;
  readonly run: (...parameters: ReadonlyArray<SqliteValue>) => {
    readonly changes?: number;
  };
}

interface NodeSqliteDbLike {
  readonly prepare: (sql: string) => NodeSqliteStatementLike;
  readonly exec: (sql: string) => void;
  readonly close: () => void;
}

interface NodeSqliteModule {
  readonly DatabaseSync: new (filename: string) => NodeSqliteDbLike;
}

const isReaderSql = (sql: string): boolean =>
  /^\s*(select|pragma|with|explain|values)\b/i.test(sql);

const sqliteEscape = (value: string): string => value.replaceAll("'", "''");

const serializeToBytes = (exec: (sql: string) => void): Uint8Array => {
  const path = join(tmpdir(), `evolu-test-export-${randomUUID()}.db`);

  try {
    exec(`vacuum into '${sqliteEscape(path)}'`);
    const file = readFileSync(path);
    const { buffer } = file;

    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer, file.byteOffset, file.byteLength);
    }

    return new Uint8Array(file);
  } finally {
    rmSync(path, { force: true });
  }
};

const createDb = (filename: string): DbLike => {
  try {
    const BetterSQLite = require("better-sqlite3") as BetterSqliteConstructor;
    const db = new BetterSQLite(filename);

    return {
      prepare: (sql) => {
        const statement = db.prepare(sql);
        return {
          reader: statement.reader,
          all: (...parameters) => statement.all(parameters),
          run: (...parameters) => statement.run(parameters),
        };
      },
      serialize: () => db.serialize(),
      close: () => db.close(),
    };
  } catch {}

  try {
    const { Database } = require("bun:sqlite") as BunSqliteModule;
    const db = new Database(filename);

    return {
      prepare: (sql) => {
        const statement = db.prepare(sql);
        return {
          reader: isReaderSql(sql),
          all: (...parameters) => statement.all(...parameters),
          run: (...parameters) => statement.run(...parameters),
        };
      },
      serialize: () => db.serialize(),
      close: () => db.close(),
    };
  } catch {}

  const { DatabaseSync } = require("node:sqlite") as NodeSqliteModule;
  const db = new DatabaseSync(filename);

  return {
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        reader: isReaderSql(sql),
        all: (...parameters) => statement.all(...parameters),
        run: (...parameters) => ({
          changes: statement.run(...parameters).changes ?? 0,
        }),
      };
    },
    serialize: () => serializeToBytes((sql) => db.exec(sql)),
    close: () => db.close(),
  };
};

// Duplicated from @evolu/nodejs because @evolu/common cannot depend on it
// (nodejs depends on common — importing back would create a circular dependency).
const createBetterSqliteDriver: CreateSqliteDriver = (name, options) => () => {
  const filename = options?.mode === "memory" ? ":memory:" : `${name}.db`;
  const db = createDb(filename);
  let isDisposed = false;

  const cache = createPreparedStatementsCache<StatementLike>(
    (sql) => db.prepare(sql),
    // Not needed.
    // https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#class-statement
    lazyVoid,
  );

  const driver: SqliteDriver = {
    exec: (query) => {
      // Always prepare is recommended for better-sqlite3
      const prepared = cache.get(query, true);

      if (prepared.reader ?? isReaderSql(query.sql)) {
        const rows = prepared.all(...query.parameters) as Array<SqliteRow>;
        return { rows, changes: 0 };
      }

      const changes = prepared.run(...query.parameters).changes;
      return { rows: [], changes };
    },

    export: () => {
      const file = db.serialize();
      const { buffer } = file;

      if (buffer instanceof ArrayBuffer) {
        return new Uint8Array(buffer, file.byteOffset, file.byteLength);
      }

      // Ensure export uses transferable ArrayBuffer backing.
      return new Uint8Array(file);
    },

    [Symbol.dispose]: () => {
      if (isDisposed) return;
      isDisposed = true;
      cache[Symbol.dispose]();
      db.close();
    },
  };

  return ok(driver);
};
