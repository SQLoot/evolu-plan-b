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
    const stack = new globalThis.DisposableStack();
    const db = stack.adopt(
      open(
        options?.mode === "memory"
          ? { name: `inMemoryDb`, location: ":memory:" }
          : {
              name: `evolu1-${name}.db`,
              ...(options?.mode === "encrypted" && {
                encryptionKey: `x'${bytesToHex(options.encryptionKey)}'`,
              }),
            },
      ),
      (db) => {
        db.close();
      },
    );

    const cache = stack.use(
      createPreparedStatementsCache<PreparedStatement>(
        (sql) => db.prepareStatement(sql),
        // op-sqlite doesn't have API for that
        lazyVoid,
      ),
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

      // FIXME: op-sqlite does not expose binary, but a path to the database file
      // another react native dependency would be needed to implement this
      export: () => {
        let message =
          "Database export is not supported with @op-engineering/op-sqlite.";

        try {
          const dbPath = db.getDbPath?.();
          if (dbPath) {
            message += ` Database path: ${dbPath}.`;
          }
        } catch {
          // Best-effort path lookup only.
        }

        throw new Error(message);
      },

      [Symbol.dispose]: () => {
        stack.dispose();
      },
    });
  };
