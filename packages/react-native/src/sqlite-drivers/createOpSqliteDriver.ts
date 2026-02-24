import {
  bytesToHex,
  type CreateSqliteDriver,
  createPreparedStatementsCache,
  lazyVoid,
  ok,
  type SqliteRow,
} from "@evolu/common";
import { open, type PreparedStatement } from "@op-engineering/op-sqlite";

export const createOpSqliteDriver: CreateSqliteDriver =
  (name, options) => () => {
    // https://op-engineering.github.io/op-sqlite/docs/configuration#in-memory
    const db = open(
      options?.mode === "memory"
        ? { name: `inMemoryDb`, location: ":memory:" }
        : {
            name: `evolu1-${name}.db`,
            ...(options?.mode === "encrypted" && {
              encryptionKey: `x'${bytesToHex(options.encryptionKey)}'`,
            }),
          },
    );
    let isDisposed = false;
    const getDbPath = (): string | null => {
      try {
        return db.getDbPath();
      } catch {
        return null;
      }
    };

    const cache = createPreparedStatementsCache<PreparedStatement>(
      (sql) => db.prepareStatement(sql),
      // op-sqlite doesn't have API for that
      lazyVoid,
    );

    return ok({
      exec: (query) => {
        const prepared = cache.get(query);

        if (prepared) {
          prepared.bindSync(query.parameters);
        }

        const { rows, rowsAffected } = db.executeSync(
          query.sql,
          query.parameters,
        );
        return { rows: rows as Array<SqliteRow>, changes: rowsAffected };
      },

      export: () => {
        const dbPath = getDbPath();
        const pathSuffix = dbPath ? ` Database path: ${dbPath}.` : "";
        throw new Error(
          "Evolu export() is not supported with @op-engineering/op-sqlite because the driver does not expose database bytes." +
            pathSuffix +
            " Use @evolu/react-native/expo-sqlite when export is required.",
        );
      },

      [Symbol.dispose]: () => {
        if (isDisposed) return;
        isDisposed = true;
        cache[Symbol.dispose]();
        db.close();
      },
    });
  };
