import type { CreateSqliteDriver, SqliteRow } from "@evolu/common";
import { bytesToHex, createPreparedStatementsCache, ok } from "@evolu/common";
import sqlite3InitModule, {
  type Database,
  type PreparedStatement,
} from "@evolu/sqlite-wasm";

type Sqlite3Module = Awaited<ReturnType<typeof sqlite3InitModule>>;
type InitSqlite3Module = () => Promise<Sqlite3Module>;

export const createSqliteApiWarnHandler =
  (warn: (arg: unknown) => void = console.warn.bind(console)) =>
  (arg: unknown): void => {
    // Ignore irrelevant warning.
    // https://github.com/sqlite/sqlite-wasm/issues/62
    if (
      typeof arg === "string" &&
      arg.startsWith("Ignoring inability to install OPFS sqlite3_vfs")
    )
      return;
    warn(arg);
  };

// @ts-expect-error Missing types.
globalThis.sqlite3ApiConfig = {
  warn: createSqliteApiWarnHandler(),
};

let initSqlite3Module: InitSqlite3Module = sqlite3InitModule;
let sqlite3Promise: Promise<Sqlite3Module> | null = null;

const getSqlite3 = (): Promise<Sqlite3Module> => {
  if (!sqlite3Promise) {
    sqlite3Promise = initSqlite3Module().catch((error) => {
      sqlite3Promise = null;
      throw error;
    });
  }
  return sqlite3Promise;
};

// Init ASAP, keep promise cached for first driver use.
void getSqlite3();

/** Test helper for replacing sqlite-wasm module loader. */
export const testSetSqlite3InitModule = (
  initModule: InitSqlite3Module,
): Disposable => {
  initSqlite3Module = initModule;
  sqlite3Promise = null;
  return {
    [Symbol.dispose]: () => {
      initSqlite3Module = sqlite3InitModule;
      sqlite3Promise = null;
    },
  };
};

export const createWasmSqliteDriver: CreateSqliteDriver =
  (name, options) => async () => {
    const sqlite3 = await getSqlite3();
    // This is used to make OPFS default vfs for multipleciphers
    // @ts-expect-error Missing types (update @evolu/sqlite-wasm types)
    sqlite3.capi.sqlite3mc_vfs_create("opfs", 1);

    let db: Database;
    switch (options?.mode) {
      case "memory":
        db = new sqlite3.oo1.DB(":memory:");
        break;
      case "encrypted": {
        const pool = await sqlite3.installOpfsSAHPoolVfs({
          directory: `.${name}`,
        });
        db = new pool.OpfsSAHPoolDb(
          "file:evolu1.db?vfs=multipleciphers-opfs-sahpool",
        );
        db.exec(`
          PRAGMA cipher = 'sqlcipher';
          PRAGMA key = "x'${bytesToHex(options.encryptionKey)}'";
        `);
        break;
      }
      default: {
        const pool = await sqlite3.installOpfsSAHPoolVfs({ name });
        db = new pool.OpfsSAHPoolDb("file:evolu1.db");
      }
    }

    let isDisposed = false;

    const cache = createPreparedStatementsCache<PreparedStatement>(
      (sql) => db.prepare(sql),
      (statement) => {
        statement.finalize();
      },
    );

    return ok({
      exec: (query) => {
        const prepared = cache.get(query);

        if (prepared) {
          if (query.parameters.length > 0) prepared.bind(query.parameters);

          const rows = [];
          while (prepared.step()) {
            rows.push(prepared.get({}));
          }
          prepared.reset();

          return {
            rows: rows as ReadonlyArray<SqliteRow>,
            changes: db.changes(),
          };
        }

        const rows = db.exec(query.sql, {
          returnValue: "resultRows",
          rowMode: "object",
          bind: query.parameters,
        }) as ReadonlyArray<SqliteRow>;

        const changes = db.changes();

        return { rows, changes };
      },

      export: () => sqlite3.capi.sqlite3_js_db_export(db),

      [Symbol.dispose]: () => {
        if (isDisposed) return;
        isDisposed = true;
        // poolUtil.unlink?
        cache[Symbol.dispose]();
        db.close();
      },
    });
  };
