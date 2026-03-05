import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CreateSqliteDriver,
  createPreparedStatementsCache,
  lazyVoid,
  ok,
  type SqliteDriver,
  type SqliteRow,
  type SqliteValue,
} from "@evolu/common";

const require = createRequire(import.meta.url);

interface StatementLike {
  readonly reader?: boolean;
  readonly all: (...parameters: ReadonlyArray<SqliteValue>) => Array<SqliteRow>;
  readonly run: (...parameters: ReadonlyArray<SqliteValue>) => {
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
  readonly all: (...parameters: ReadonlyArray<SqliteValue>) => Array<SqliteRow>;
  readonly run: (...parameters: ReadonlyArray<SqliteValue>) => {
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

const runtimeOverrideEnvKey = "EVOLU_NODEJS_SQLITE_RUNTIME";

const hasBunRuntime = (): boolean => {
  const runtimeOverride = process.env[runtimeOverrideEnvKey];

  if (runtimeOverride === "bun") return true;
  if (runtimeOverride === "node") return false;

  return (globalThis as Record<string, unknown>).Bun != null;
};

const isReaderSql = (sql: string): boolean =>
  /^\s*(select|pragma|with|explain|values)\b/i.test(sql);

const sqliteEscape = (value: string): string => value.replaceAll("'", "''");

const serializeToBytes = (exec: (sql: string) => void): Uint8Array => {
  const path = join(tmpdir(), `evolu-export-${randomUUID()}.db`);

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

const createBetterDb = (filename: string): DbLike => {
  const BetterSQLite = require("better-sqlite3") as BetterSqliteConstructor;
  const db = new BetterSQLite(filename);

  return {
    prepare: (sql) => {
      const statement = db.prepare(sql);
      return {
        reader: statement.reader,
        all: (...parameters) => statement.all(...parameters),
        run: (...parameters) => statement.run(...parameters),
      };
    },
    serialize: () => db.serialize(),
    close: () => db.close(),
  };
};

const createBunDb = (filename: string): DbLike => {
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
};

const createNodeDb = (filename: string): DbLike => {
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

const createDb = (filename: string): DbLike => {
  if (hasBunRuntime()) {
    try {
      return createBunDb(filename);
    } catch (bunError) {
      try {
        return createBetterDb(filename);
      } catch {
        try {
          return createNodeDb(filename);
        } catch {
          throw bunError;
        }
      }
    }
  }

  try {
    return createBetterDb(filename);
  } catch (betterError) {
    try {
      return createNodeDb(filename);
    } catch {
      throw betterError;
    }
  }
};

export const createBetterSqliteDriver: CreateSqliteDriver =
  (name, options) => () => {
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
