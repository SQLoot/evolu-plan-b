/**
 * Local-first platform.
 *
 * @module
 */

import { dedupeArray, isNonEmptyArray } from "../Array.js";
import { assertNonEmptyReadonlyArray } from "../Assert.js";
import {
  type Console,
  type ConsoleDep,
  type ConsoleEntry,
  createConsole,
} from "../Console.js";
import {
  createRandomBytes,
  type EncryptionKey,
  type RandomBytesDep,
} from "../Crypto.js";
import { eqArrayNumber } from "../Eq.js";
import { createUnknownError } from "../Error.js";
import { exhaustiveCheck } from "../Function.js";
import type { Listener, Unsubscribe } from "../Listeners.js";
import type { FlushSyncDep, ReloadAppDep } from "../Platform.js";
import { createDisposableDep, type DisposableStackDep } from "../Resources.js";
import { err, ok } from "../Result.js";
import { SqliteBoolean, sqliteBooleanToBoolean } from "../Sqlite.js";
import { createStore, type ReadonlyStore, type Store } from "../Store.js";
import {
  brand,
  createId,
  type Id,
  type Mnemonic,
  SimpleName,
  type TypeError,
  UrlSafeString,
} from "../Type.js";
import type { CreateMessageChannelDep } from "../Worker.js";
import type {
  DbWorkerInput,
  DbWorkerLeaderOutput,
  DbWorkerOutput,
} from "./DbWorkerProtocol.js";
import type { EvoluError } from "./Error.js";
import type { AppOwner, OwnerId, OwnerTransport } from "./Owner.js";
import {
  createAppOwner,
  createOwnerSecret,
  mnemonicToOwnerSecret,
} from "./Owner.js";
import { pack } from "./Protocol.js";
import {
  createSubscribedQueries,
  deserializeQuery,
  emptyRows,
  type Queries,
  type QueriesToQueryRowsPromises,
  type Query,
  type QueryRows,
  type QueryRowsMap,
  type Row,
  type SubscribedQueries,
} from "./Query.js";
import {
  type EvoluSchema,
  evoluSchemaToDbSchema,
  type IndexesConfig,
  type Mutation,
  type MutationChange,
  type MutationKind,
  type MutationOptions,
  type MutationValues,
  SystemColumns,
  type ValidateSchema,
} from "./Schema.js";
import type { DbChange, ValidDbChangeValues } from "./Storage.js";
import type { SyncOwner } from "./Sync.js";
import type { EvoluTabOutput, EvoluWorkerDep } from "./Worker.js";

export interface EvoluConfig {
  /**
   * The name of the Evolu instance. Evolu is multitenant - it can run multiple
   * instances concurrently. Each instance must have a unique name.
   *
   * The instance name is used as the SQLite database filename for persistent
   * storage, ensuring that database files are separated and invisible to each
   * other.
   *
   * ### Example
   *
   * ```ts
   * // name: SimpleName.orThrow("MyApp")
   * ```
   */
  readonly name?: SimpleName;

  /**
   * @deprecated Use {@link EvoluConfig.name}. Compatibility alias for
   * `upstream/common-v8`.
   */
  readonly appName?: AppName;

  /**
   * External AppOwner to use when creating Evolu instance. Use this when you
   * want to manage AppOwner creation and persistence externally (e.g., with
   * your own authentication system). If omitted, Evolu will automatically
   * create and persist an AppOwner locally.
   *
   * For device-specific settings and account management state, we can use a
   * separate local-only Evolu instance via `transports: []`.
   *
   * ### Example
   *
   * ```ts
   * const ConfigId = id("Config");
   * type ConfigId = typeof ConfigId.Type;
   *
   * const DeviceSchema = {
   *   config: {
   *     id: ConfigId,
   *     key: NonEmptyString50,
   *     value: NonEmptyString50,
   *   },
   * };
   *
   * // Local-only instance for device settings (no sync)
   * const deviceEvolu = createEvolu(evoluReactWebDeps)(DeviceSchema, {
   *   name: SimpleName.orThrow("MyApp-Device"),
   *   transports: [], // No sync - stays local to device
   * });
   *
   * // Main synced instance for user data
   * const evolu = createEvolu(evoluReactWebDeps)(MainSchema, {
   *   name: SimpleName.orThrow("MyApp"),
   *   // Default transports for sync
   * });
   * ```
   */
  readonly appOwner?: AppOwner;

  /**
   * @deprecated Use {@link EvoluConfig.appOwner}. Kept for transitional
   * backward compatibility in downstream apps.
   */
  readonly externalAppOwner?: AppOwner;

  /**
   * Transport configuration for data sync and backup. Supports single transport
   * or multiple transports simultaneously for redundancy.
   *
   * **Redundancy:** The ideal setup uses at least two completely independent
   * relays - for example, a home relay and a geographically separate relay.
   * Data is sent to both relays simultaneously, providing true redundancy
   * similar to using two independent clouds. This eliminates vendor lock-in and
   * ensures your app continues working regardless of circumstances - whether
   * home relay hardware is stolen or a remote relay provider shuts down.
   *
   * Currently supports:
   *
   * - WebSocket: Real-time bidirectional communication with relay servers
   *
   * Empty transports create local-only instances. Transports can be dynamically
   * added and removed for any owner (including {@link AppOwner}) via
   * {@link Evolu.useOwner}.
   *
   * Use `createOwnerWebSocketTransport` to create WebSocket transport
   * configurations with proper URL formatting and {@link OwnerId} inclusion. The
   * {@link OwnerId} in the URL enables relay authentication, allowing relay
   * servers to control access (e.g., for paid tiers or private instances).
   *
   * The default value is:
   *
   * `{ type: "WebSocket", url: "wss://free.evoluhq.com" }`.
   *
   * ### Example
   *
   * ```ts
   * // Single WebSocket relay
   * transports: [{ type: "WebSocket", url: "wss://relay1.example.com" }];
   *
   * // Multiple WebSocket relays for redundancy
   * transports: [
   *   { type: "WebSocket", url: "wss://relay1.example.com" },
   *   { type: "WebSocket", url: "wss://relay2.example.com" },
   *   { type: "WebSocket", url: "wss://relay3.example.com" },
   * ];
   *
   * // Local-only instance (no sync) - useful for device settings or when relay
   * // URL will be provided later (e.g., after authentication), allowing users
   * // to work offline before the app connects
   * transports: [];
   *
   * // Using createOwnerWebSocketTransport helper for relay authentication
   * transports: [
   *   createOwnerWebSocketTransport({
   *     url: "ws://localhost:4000",
   *     ownerId,
   *   }),
   * ];
   * ```
   */
  readonly transports?: ReadonlyArray<OwnerTransport>;

  /**
   * Use in-memory SQLite database instead of persistent storage. Useful for
   * testing or temporary data that doesn't need persistence.
   *
   * In-memory databases exist only in RAM and are completely destroyed when the
   * process ends, making them forensically safe for sensitive data.
   *
   * The default value is: `false`.
   */
  readonly inMemory?: boolean;

  /**
   * Use the `indexes` option to define SQLite indexes.
   *
   * Table and column names are not typed because Kysely doesn't support it.
   *
   * https://medium.com/@JasonWyatt/squeezing-performance-from-sqlite-indexes-indexes-c4e175f3c346
   *
   * ### Example
   *
   * ```ts
   * const evolu = createEvolu(evoluReactDeps)(Schema, {
   *   indexes: (create) => [
   *     create("todoCreatedAt").on("todo").column("createdAt"),
   *     create("todoCategoryCreatedAt")
   *       .on("todoCategory")
   *       .column("createdAt"),
   *   ],
   * });
   * ```
   */
  readonly indexes?: IndexesConfig;

  /**
   * Encryption key for the SQLite database.
   *
   * Note: If an unencrypted SQLite database already exists and you provide an
   * encryptionKey, SQLite will throw an error.
   *
   */
  readonly encryptionKey?: EncryptionKey;
}

/**
 * @deprecated Use {@link SimpleName}. Kept as compatibility alias for
 * `upstream/common-v8`.
 */
export const AppName = /*#__PURE__*/ brand("AppName", UrlSafeString, (value) =>
  value.length >= 1 && value.length <= 41
    ? ok(value)
    : err<AppNameError>({ type: "AppName", value }),
);
export type AppName = typeof AppName.Type;
export interface AppNameError extends TypeError<"AppName"> {}

export const testAppName = /*#__PURE__*/ AppName.orThrow("AppName");

/** Local-first SQL database with typed queries, mutations, and sync. */
export interface Evolu<S extends EvoluSchema = EvoluSchema>
  extends AsyncDisposable {
  /** The name of the Evolu instance from {@link EvoluConfig}. */
  readonly name: SimpleName;

  /** {@link AppOwner}. */
  readonly appOwner: Promise<AppOwner>;

  /**
   * Transitional compatibility API. Will be removed once downstream packages
   * migrate to Task-native error handling.
   */
  readonly subscribeError: (listener: Listener) => Unsubscribe;

  /**
   * Transitional compatibility API. Returns `null` in Task-based stub mode.
   */
  readonly getError: () => EvoluError | null;

  /**
   * Load {@link Query} and return a promise with {@link QueryRows}.
   *
   * The returned promise always resolves successfully because there is no
   * reason why loading should fail. All data are local, and the query is
   * typed.
   *
   * Loading is batched, and returned promises are cached until resolved to
   * prevent redundant database queries and to support React Suspense (which
   * requires stable promise references while pending).
   *
   * To subscribe a query for automatic updates, use
   * {@link Evolu.subscribeQuery}.
   *
   * ### Example
   *
   * ```ts
   * const createQuery = createQueryBuilder(Schema);
   * const allTodos = createQuery((db) =>
   *   db.selectFrom("todo").selectAll(),
   * );
   * evolu.loadQuery(allTodos).then((rows) => {
   *   console.log(rows);
   * });
   * ```
   */
  readonly loadQuery: <R extends Row>(query: Query<R>) => Promise<QueryRows<R>>;

  /**
   * Load an array of {@link Query} queries and return an array of
   * {@link QueryRows} promises. It's like `queries.map(loadQuery)` but with
   * proper types for returned promises.
   *
   * ### Example
   *
   * ```ts
   * evolu.loadQueries([allTodos, todoById(1)]);
   * ```
   */
  readonly loadQueries: <R extends Row, Q extends Queries<R>>(
    queries: [...Q],
  ) => [...QueriesToQueryRowsPromises<Q>];

  /**
   * Subscribe to {@link Query} {@link QueryRows} changes.
   *
   * ### Example
   *
   * ```ts
   * const unsubscribe = evolu.subscribeQuery(allTodos)(() => {
   *   const rows = evolu.getQueryRows(allTodos);
   * });
   * ```
   */
  readonly subscribeQuery: (
    query: Query,
  ) => (listener: Listener) => Unsubscribe;

  /**
   * Get {@link QueryRows}.
   *
   * ### Example
   *
   * ```ts
   * const unsubscribe = evolu.subscribeQuery(allTodos)(() => {
   *   const rows = evolu.getQueryRows(allTodos);
   * });
   * ```
   */
  readonly getQueryRows: <R extends Row>(query: Query<R>) => QueryRows<R>;

  /**
   * Inserts a row into the database and returns a {@link Result} with the new
   * {@link Id}.
   *
   * The first argument is the table name, and the second is an object
   * containing the row data. An optional third argument provides mutation
   * options including `onComplete` callback and custom `ownerId`.
   *
   * Returns a Result type - use `.ok` to check if the insertion succeeded, and
   * `.value.id` to access the generated ID on success, or `.error` to handle
   * validation errors.
   *
   * Evolu does not use SQL for mutations to ensure data can be safely and
   * predictably merged without conflicts. Explicit mutations also allow Evolu
   * to automatically update {@link SystemColumns}.
   *
   * ### Example
   *
   * ```ts
   * const result = evolu.insert("todo", {
   *   title: "Learn Evolu",
   *   isCompleted: false,
   * });
   *
   * if (result.ok) {
   *   console.log("Todo created with ID:", result.value.id);
   * } else {
   *   console.error("Validation error:", result.error);
   * }
   *
   * // With onComplete callback
   * evolu.insert(
   *   "todo",
   *   { title: "Another todo" },
   *   {
   *     onComplete: () => {
   *       console.log("Insert completed");
   *     },
   *   },
   * );
   * ```
   */
  insert: Mutation<S, "insert">;

  /**
   * Updates a row in the database and returns a {@link Result} with the existing
   * {@link Id}.
   *
   * The first argument is the table name, and the second is an object
   * containing the row data including the required `id` field. An optional
   * third argument provides mutation options including `onComplete` callback
   * and custom `ownerId`.
   *
   * Returns a Result type - use `.ok` to check if the update succeeded, and
   * `.value.id` to access the ID on success, or `.error` to handle validation
   * errors.
   *
   * Evolu does not use SQL for mutations to ensure data can be safely and
   * predictably merged without conflicts. Explicit mutations also allow Evolu
   * to automatically update {@link SystemColumns}.
   *
   * ### Example
   *
   * ```ts
   * const result = evolu.update("todo", {
   *   id: todoId,
   *   title: "Updated title",
   *   isCompleted: true,
   * });
   *
   * if (result.ok) {
   *   console.log("Todo updated with ID:", result.value.id);
   * } else {
   *   console.error("Validation error:", result.error);
   * }
   *
   * // To delete a row, set isDeleted to true
   * evolu.update("todo", { id: todoId, isDeleted: true });
   *
   * // With onComplete callback
   * evolu.update(
   *   "todo",
   *   { id: todoId, title: "New title" },
   *   {
   *     onComplete: () => {
   *       console.log("Update completed");
   *     },
   *   },
   * );
   * ```
   */
  update: Mutation<S, "update">;

  /**
   * Upserts a row in the database and returns a {@link Result} with the existing
   * {@link Id}.
   *
   * The first argument is the table name, and the second is an object
   * containing the row data including the required `id` field. An optional
   * third argument provides mutation options including `onComplete` callback
   * and custom `ownerId`.
   *
   * This function allows you to use custom IDs and optionally set `createdAt`,
   * which is useful for external systems, data migrations, or when the same row
   * may already be created on a different device.
   *
   * Returns a Result type - use `.ok` to check if the upsert succeeded, and
   * `.value.id` to access the ID on success, or `.error` to handle validation
   * errors.
   *
   * Evolu does not use SQL for mutations to ensure data can be safely and
   * predictably merged without conflicts. Explicit mutations also allow Evolu
   * to automatically update {@link SystemColumns}.
   *
   * ### Example
   *
   * ```ts
   * // Use deterministic ID for stable upserts across devices
   * const stableId = createIdFromString("my-todo-1");
   *
   * const result = evolu.upsert("todo", {
   *   id: stableId,
   *   title: "Learn Evolu",
   *   isCompleted: false,
   * });
   *
   * if (result.ok) {
   *   console.log("Todo upserted with ID:", result.value.id);
   * } else {
   *   console.error("Validation error:", result.error);
   * }
   *
   * // Data migration with custom createdAt
   * evolu.upsert("todo", {
   *   id: externalId,
   *   title: "Migrated todo",
   *   createdAt: new Date("2023-01-01"), // Preserve original timestamp
   * });
   *
   * // With onComplete callback
   * evolu.upsert(
   *   "todo",
   *   { id: stableId, title: "Updated title" },
   *   {
   *     onComplete: () => {
   *       console.log("Upsert completed");
   *     },
   *   },
   * );
   * ```
   */
  upsert: Mutation<S, "upsert">;

  /**
   * Delete {@link AppOwner} and all their data from the current device. After
   * the deletion, Evolu will purge the application state. For browsers, this
   * will reload all tabs using Evolu. For native apps, it will restart the
   * app.
   *
   * Reloading can be turned off via options if you want to provide a different
   * UX.
   */
  readonly resetAppOwner: (options?: {
    readonly reload?: boolean;
  }) => Promise<void>;

  /**
   * Restore {@link AppOwner} with all their synced data. It uses
   * {@link Evolu.resetAppOwner}, so be careful.
   */
  readonly restoreAppOwner: (
    mnemonic: Mnemonic,
    options?: {
      readonly reload?: boolean;
    },
  ) => Promise<void>;

  /**
   * Reload the app in a platform-specific way. For browsers, this will reload
   * all tabs using Evolu. For native apps, it will restart the app.
   */
  readonly reloadApp: () => void;

  /**
   * Export SQLite database file as Uint8Array.
   *
   * In the future, it will be possible to import a database and export/import
   * history for 1:1 migrations across owners.
   */
  readonly exportDatabase: () => Promise<Uint8Array>;

  /**
   * Use a {@link SyncOwner}. Returns a {@link UnuseOwner}.
   *
   * Using an owner means syncing it with its transports, or the transports
   * defined in Evolu config if the owner has no transports defined.
   *
   * Transport are automatically deduplicated and reference-counted, so multiple
   * owners using the same transport will share a single connection.
   *
   * ### Example
   *
   * ```ts
   * // Use an owner (starts syncing).
   * const unuseOwner = evolu.useOwner(shardOwner);
   *
   * // Later, stop using the owner.
   * unuseOwner();
   *
   * // Bulk operations.
   * const unuseOwners = owners.map((owner) => evolu.useOwner(owner));
   * // Later: for (const unuse of unuseOwners) unuse();
   * ```
   */
  readonly useOwner: (owner: SyncOwner) => UnuseOwner;
}

/** Function returned by {@link Evolu.useOwner} to stop using an {@link SyncOwner}. */
export type UnuseOwner = () => void;

export type EvoluDeps = EvoluPlatformDeps &
  ErrorStoreDep &
  CreateMessageChannelDep &
  ReloadAppDep &
  EvoluWorkerDep &
  Partial<FlushSyncDep> &
  DisposableStackDep &
  ConsoleDep &
  RandomBytesDep;

export type EvoluPlatformDeps = ReloadAppDep &
  Partial<ConsoleDep> &
  Partial<FlushSyncDep>;

const writeConsoleEntry = (console: Console, entry: ConsoleEntry): void => {
  const method = console[entry.method] as (
    ...args: ReadonlyArray<unknown>
  ) => void;
  method(...entry.args);
};

const summarizeConsoleArg = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string(${value.length})`;
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "function") return "function";
  if (value instanceof Error) return `Error(${value.name})`;
  if (value instanceof globalThis.Uint8Array)
    return `Uint8Array(${value.byteLength})`;
  if (Array.isArray(value)) return `Array(${value.length})`;
  return "object";
};

const createConsoleFallbackError = (args: ReadonlyArray<unknown>): EvoluError =>
  createUnknownError([
    "Worker console.error without typed EvoluError payload",
    {
      argCount: args.length,
      argKinds: args.map(summarizeConsoleArg),
    },
  ]);

/** Creates Evolu dependencies from platform-specific dependencies. */
export const createEvoluDeps = <D extends EvoluPlatformDeps>(
  deps: D,
): EvoluDeps => {
  const { createMessageChannel, evoluWorker } = deps as D &
    CreateMessageChannelDep &
    EvoluWorkerDep;
  const disposableStack = new DisposableStack();
  const console = deps.console ?? createConsole();
  const evoluError = disposableStack.use(createStore<EvoluError | null>(null));
  const tabChannel = disposableStack.use(
    createMessageChannel<EvoluTabOutput>(),
  );

  disposableStack.use(evoluWorker);

  tabChannel.port2.onMessage = (output: EvoluTabOutput) => {
    switch (output.type) {
      case "ConsoleEntry": {
        writeConsoleEntry(console, output.entry);
        if (output.entry.method === "error") {
          // Fallback when an error was logged without typed EvoluError payload.
          evoluError.set(createConsoleFallbackError(output.entry.args));
        }
        break;
      }
      case "EvoluError": {
        evoluError.set(output.error);
        console.error(output.error);
        break;
      }
      default:
        exhaustiveCheck(output);
    }
  };

  evoluWorker.port.postMessage(
    { type: "InitTab", port: tabChannel.port1.native },
    [tabChannel.port1.native],
  );

  return {
    ...deps,
    disposableStack,
    ...createDisposableDep(disposableStack),
    console,
    evoluError,
    randomBytes: createRandomBytes(),
  } as unknown as EvoluDeps;
};

export interface ErrorStoreDep {
  /**
   * Shared error store for all Evolu instances. Subscribe once to handle errors
   * globally across all instances.
   *
   * ### Example
   *
   * ```ts
   * deps.evoluError.subscribe(() => {
   *   const error = deps.evoluError.get();
   *   if (!error) return;
   *   console.error(error);
   * });
   * ```
   */
  readonly evoluError: ReadonlyStore<EvoluError | null>;
}

/**
 * Creates an {@link Evolu} instance for a platform configured with the specified
 * {@link EvoluSchema} and optional {@link EvoluConfig} providing a typed
 * interface for querying, mutating, and syncing data.
 *
 * ### Example
 *
 * ```ts
 * const TodoId = id("Todo");
 * type TodoId = InferType<typeof TodoId>;
 *
 * const TodoCategoryId = id("TodoCategory");
 * type TodoCategoryId = InferType<typeof TodoCategoryId>;
 *
 * const NonEmptyString50 = maxLength(50, NonEmptyString);
 * type NonEmptyString50 = InferType<typeof NonEmptyString50>;
 *
 * const Schema = {
 *   todo: {
 *     id: TodoId,
 *     title: NonEmptyString1000,
 *     isCompleted: nullOr(SqliteBoolean),
 *     categoryId: nullOr(TodoCategoryId),
 *   },
 *   todoCategory: {
 *     id: TodoCategoryId,
 *     name: NonEmptyString50,
 *   },
 * };
 *
 * const evolu = createEvolu(evoluReactDeps)(Schema);
 * ```
 */
export const createEvolu =
  (deps: EvoluDeps) =>
  <S extends EvoluSchema>(
    schema: ValidateSchema<S> extends never ? S : ValidateSchema<S>,
    config: EvoluConfig = {},
  ): Evolu<S> => {
    const {
      name: configName,
      appName,
      // TODO:
      transports: _transports = [
        { type: "WebSocket", url: "wss://free.evoluhq.com" },
      ],
      externalAppOwner,
      appOwner: configAppOwner, // Alias to avoid variable name conflict with promise
      inMemory: _inMemory,
      indexes: _indexes,
    } = config;
    const name =
      configName ??
      (appName ? SimpleName.orThrow(appName) : undefined) ??
      SimpleName.orThrow("default");

    const errorStore = deps.evoluError as Store<EvoluError | null>;
    const rowsStore = createStore<QueryRowsMap>(new Map());
    const subscribedQueries = createSubscribedQueries(rowsStore);
    const loadingPromises = createLoadingPromises(subscribedQueries);

    const loadQueryMicrotaskQueue: Array<Query> = [];
    const useOwnerMicrotaskQueue: Array<[SyncOwner, boolean, Uint8Array]> = [];

    let appOwnerState = Promise.withResolvers<AppOwner>();

    const getAppOwnerPromise = (): Promise<AppOwner> => appOwnerState.promise;

    const resolveAppOwner = (nextAppOwner: AppOwner): void => {
      appOwnerState.resolve(nextAppOwner);
    };

    const resetAppOwnerPromise = (): void => {
      appOwnerState = Promise.withResolvers<AppOwner>();
    };

    const setUnknownError = (error: unknown): void => {
      errorStore.set(createUnknownError(error));
    };

    const dbSchema = evoluSchemaToDbSchema(schema as EvoluSchema, _indexes);
    const dbWorker = createDbWorkerClient(deps, name, setUnknownError);

    const storeAppOwner = async (nextAppOwner: AppOwner): Promise<void> => {
      await dbWorker.mutate(
        `
          insert into __evolu_meta (key, value)
          values ('appOwner', ?)
          on conflict(key) do update set value = excluded.value
        `,
        [JSON.stringify(nextAppOwner)],
      );
    };

    const initializeDb = async (forcedAppOwner?: AppOwner): Promise<void> => {
      await dbWorker.init(_inMemory ? ":memory:" : name, 1);

      for (const statement of createDbSchemaStatements(dbSchema)) {
        await dbWorker.mutate(statement.sql, statement.params);
      }

      const preferredAppOwner =
        forcedAppOwner ?? configAppOwner ?? externalAppOwner;

      if (preferredAppOwner) {
        await storeAppOwner(preferredAppOwner);
        resolveAppOwner(preferredAppOwner);
        return;
      }

      const storedAppOwner = await dbWorker.getAppOwner();
      if (storedAppOwner) {
        resolveAppOwner(storedAppOwner);
        return;
      }

      const generatedAppOwner = createAppOwner(createOwnerSecret(deps));
      await storeAppOwner(generatedAppOwner);
      resolveAppOwner(generatedAppOwner);
    };

    let dbReady: Promise<void>;

    const startDbInitialization = (
      forcedAppOwner?: AppOwner,
    ): Promise<void> => {
      dbReady = initializeDb(forcedAppOwner).catch((error) => {
        setUnknownError(error);
        appOwnerState.reject(error);
        throw error;
      });
      return dbReady;
    };

    void startDbInitialization();

    const mutateMicrotaskQueue: Array<
      [MutationChange, MutationOptions["onComplete"] | undefined]
    > = [];

    const createMutation =
      <Kind extends MutationKind>(kind: Kind): Mutation<S, Kind> =>
      <TableName extends keyof S>(
        table: TableName,
        values: MutationValues<S[TableName], Kind>,
        options?: MutationOptions,
      ) => {
        const {
          id: _,
          isDeleted,
          ...dbValues
        } = values as {
          readonly id?: Id;
          readonly isDeleted?: unknown;
          readonly [key: string]: unknown;
        };
        const id =
          kind === "insert"
            ? (createId(deps) as ReturnType<Mutation<S, Kind>>["id"])
            : ((values as unknown as { readonly id: Id }).id as ReturnType<
                Mutation<S, Kind>
              >["id"]);

        const dbChange: DbChange = {
          table: table as string,
          id,
          values: dbValues as ValidDbChangeValues,
          isInsert: kind === "insert" || kind === "upsert",
          isDelete: SqliteBoolean.is(isDeleted)
            ? sqliteBooleanToBoolean(isDeleted)
            : null,
        };

        mutateMicrotaskQueue.push([
          { ...dbChange, ownerId: options?.ownerId },
          options?.onComplete,
        ]);

        if (mutateMicrotaskQueue.length === 1) {
          queueMicrotask(processMutationQueue);
        }

        return { id };
      };

    const publishQueries = async (queries: ReadonlyArray<Query>) => {
      if (!isNonEmptyArray(queries)) return;

      await dbReady;
      const nextState = new Map(rowsStore.get());

      for (const query of queries) {
        const sqlQuery = deserializeQuery(query);
        const rows = await dbWorker.query(sqlQuery.sql, sqlQuery.parameters);
        nextState.set(query, rows);
        loadingPromises.resolve(query, rows);
      }

      if (deps.flushSync) {
        deps.flushSync(() => {
          rowsStore.set(nextState);
        });
      } else {
        rowsStore.set(nextState);
      }
    };

    const refreshLoadedQueries = async () => {
      loadingPromises.releaseUnsubscribedOnMutation();
      const queries = dedupeArray([
        ...loadingPromises.getQueries(),
        ...subscribedQueries.get(),
      ]);
      await publishQueries(queries);
    };

    const processMutationQueue = () => {
      const changes: Array<MutationChange> = [];
      const onCompletes: Array<NonNullable<MutationOptions["onComplete"]>> = [];

      for (const [change, onComplete] of mutateMicrotaskQueue) {
        changes.push(change);
        if (onComplete) onCompletes.push(onComplete);
      }

      mutateMicrotaskQueue.length = 0;

      if (!isNonEmptyArray(changes)) return;

      void (async () => {
        try {
          await dbReady;
          const defaultOwnerId = (await getAppOwnerPromise()).id;

          for (const change of changes) {
            const ownerId = change.ownerId ?? defaultOwnerId;
            const statements = mutationChangeToStatements(change, ownerId);
            for (const statement of statements) {
              await dbWorker.mutate(statement.sql, statement.params);
            }
          }

          await refreshLoadedQueries();

          for (const onComplete of onCompletes) onComplete();
        } catch (error) {
          setUnknownError(error);
        }
      })();
    };

    const evolu: Evolu<S> = {
      name,

      subscribeError: errorStore.subscribe,
      getError: errorStore.get,

      loadQuery: <R extends Row>(query: Query<R>): Promise<QueryRows<R>> => {
        const { promise, isNew } = loadingPromises.get(query);

        if (isNew) {
          loadQueryMicrotaskQueue.push(query);
          if (loadQueryMicrotaskQueue.length === 1) {
            queueMicrotask(() => {
              const queries = dedupeArray(loadQueryMicrotaskQueue);
              loadQueryMicrotaskQueue.length = 0;
              assertNonEmptyReadonlyArray(queries);
              deps.console.log("[evolu]", "loadQuery", { queries });
              void publishQueries(queries).catch((error) => {
                setUnknownError(error);
                for (const queuedQuery of queries) {
                  loadingPromises.resolve(queuedQuery, emptyRows);
                }
              });
            });
          }
        }

        return promise;
      },

      loadQueries: <R extends Row, Q extends Queries<R>>(
        queries: [...Q],
      ): [...QueriesToQueryRowsPromises<Q>] =>
        queries.map(evolu.loadQuery) as [...QueriesToQueryRowsPromises<Q>],

      subscribeQuery: (query) => (listener) => {
        // Call the listener only if the result has been changed.
        let previousRows: unknown = null;
        const unsubscribe = subscribedQueries.subscribe(query)(() => {
          const rows = evolu.getQueryRows(query);
          if (previousRows === rows) return;
          previousRows = rows;
          listener();
        });
        return () => {
          previousRows = null;
          unsubscribe();
        };
      },

      getQueryRows: <R extends Row>(query: Query<R>): QueryRows<R> =>
        (rowsStore.get().get(query) ?? emptyRows) as QueryRows<R>,

      get appOwner() {
        return getAppOwnerPromise();
      },

      // TODO: Update it for the owner-api
      // subscribeSyncState: syncStore.subscribe,
      // getSyncState: syncStore.get,

      insert: createMutation("insert"),
      update: createMutation("update"),
      upsert: createMutation("upsert"),

      resetAppOwner: async (options) => {
        await dbReady;
        await dbWorker.reset();
        rowsStore.set(new Map());
        if ((options?.reload ?? true) && deps.reloadApp) {
          deps.reloadApp();
          return;
        }

        resetAppOwnerPromise();
        await startDbInitialization();
      },

      restoreAppOwner: async (mnemonic, options) => {
        await dbReady;
        await dbWorker.reset();
        rowsStore.set(new Map());
        resetAppOwnerPromise();
        await startDbInitialization(
          createAppOwner(mnemonicToOwnerSecret(mnemonic)),
        );
        if ((options?.reload ?? true) && deps.reloadApp) deps.reloadApp();
      },

      reloadApp: () => {
        // TODO:
        // deps.reloadApp(reloadUrl);
        if (deps.reloadApp) deps.reloadApp();
      },

      // ensureSchema: (schema) => {
      //   mutationTypesCache.clear();
      //   const dbSchema = evoluSchemaToDbSchema(schema);
      //   dbWorker.postMessage({ type: "ensureDbSchema", dbSchema });
      // },

      exportDatabase: async () => {
        await dbReady;
        return dbWorker.exportDatabase();
      },

      useOwner: (owner) => {
        const scheduleOwnerQueueProcessing = () => {
          if (useOwnerMicrotaskQueue.length !== 1) return;
          queueMicrotask(() => {
            const queue = [...useOwnerMicrotaskQueue];
            useOwnerMicrotaskQueue.length = 0;

            const result: Array<[SyncOwner, boolean, Uint8Array]> = [];
            const skipIndices = new Set<number>();

            for (let i = 0; i < queue.length; i++) {
              if (skipIndices.has(i)) continue;

              const [currentOwner, currentUse, currentOwnerSerialized] =
                queue[i];

              // Look for opposite action with same owner
              for (let j = i + 1; j < queue.length; j++) {
                if (skipIndices.has(j)) continue;

                const [, otherUse, otherOwnerSerialized] = queue[j];

                if (
                  currentUse !== otherUse &&
                  eqArrayNumber(currentOwnerSerialized, otherOwnerSerialized)
                ) {
                  // Found cancel-out pair, skip both
                  skipIndices.add(i).add(j);
                  break;
                }
              }

              if (!skipIndices.has(i)) {
                result.push([currentOwner, currentUse, currentOwnerSerialized]);
              }
            }

            for (const [_owner, _use] of result) {
              // dbWorker.postMessage({ type: "useOwner", owner, use });
            }
          });
        };

        useOwnerMicrotaskQueue.push([owner, true, pack(owner)]);
        scheduleOwnerQueueProcessing();

        const unuse = () => {
          useOwnerMicrotaskQueue.push([owner, false, pack(owner)]);
          scheduleOwnerQueueProcessing();
        };

        return unuse;
      },

      [Symbol.asyncDispose]: async () => {
        loadQueryMicrotaskQueue.length = 0;
        useOwnerMicrotaskQueue.length = 0;
        mutateMicrotaskQueue.length = 0;
        await dbWorker[Symbol.asyncDispose]();
      },
    };

    return evolu;
  };

interface SqlStatement {
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

interface DbWorkerClient extends Disposable, AsyncDisposable {
  readonly init: (dbName: string, schemaVersion: number) => Promise<void>;
  readonly getAppOwner: () => Promise<AppOwner | null>;
  readonly query: (
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Promise<ReadonlyArray<Row>>;
  readonly mutate: (
    sql: string,
    params: ReadonlyArray<unknown>,
  ) => Promise<number>;
  readonly exportDatabase: () => Promise<Uint8Array>;
  readonly reset: () => Promise<void>;
}

type DbWorkerResponseWithRequestId = Extract<
  DbWorkerOutput,
  { readonly requestId: number }
>;

const createDbWorkerClient = (
  deps: CreateMessageChannelDep & EvoluWorkerDep & DisposableStackDep,
  name: SimpleName,
  onError: (error: unknown) => void,
): DbWorkerClient => {
  const channel = deps.disposableStack.use(
    deps.createMessageChannel<DbWorkerOutput, DbWorkerInput>(),
  );
  const brokerChannel = deps.disposableStack.use(
    deps.createMessageChannel<DbWorkerLeaderOutput>(),
  );
  const port = channel.port2;
  const brokerPort = brokerChannel.port2;

  let requestIdCounter = 1;
  let isDisposed = false;
  let closePromise: Promise<void> | null = null;

  const pendingRequests = new Map<
    number,
    {
      readonly expectedType: DbWorkerResponseWithRequestId["type"];
      readonly resolve: (message: DbWorkerResponseWithRequestId) => void;
      readonly reject: (error: unknown) => void;
    }
  >();

  const initWaiters: Array<{
    readonly resolve: () => void;
    readonly reject: (error: unknown) => void;
  }> = [];
  const appOwnerWaiters: Array<{
    readonly resolve: (appOwner: AppOwner | null) => void;
    readonly reject: (error: unknown) => void;
  }> = [];

  const rejectAllPending = (error: unknown) => {
    for (const { reject } of pendingRequests.values()) reject(error);
    pendingRequests.clear();

    while (initWaiters.length > 0) initWaiters.shift()?.reject(error);
    while (appOwnerWaiters.length > 0) appOwnerWaiters.shift()?.reject(error);
  };

  const disposeNow = (error: unknown): void => {
    if (isDisposed) return;
    isDisposed = true;
    rejectAllPending(error);
    port.onMessage = null;
    brokerPort.onMessage = null;
    channel[Symbol.dispose]();
    brokerChannel[Symbol.dispose]();
  };

  port.onMessage = (message) => {
    if (message.type === "DbWorkerError") {
      const requestId = message.requestId;
      if (requestId != null) {
        const pending = pendingRequests.get(requestId);
        if (pending) {
          pendingRequests.delete(requestId);
          pending.reject(new Error(message.error));
          return;
        }
      }
      onError(new Error(message.error));
      return;
    }

    if (message.type === "DbWorkerInitResponse") {
      const waiter = initWaiters.shift();
      if (!waiter) {
        onError(new Error("Received unexpected DbWorkerInitResponse"));
        return;
      }
      if (message.success) waiter.resolve();
      else waiter.reject(new Error(message.error ?? "DbWorker init failed"));
      return;
    }

    if (message.type === "DbWorkerAppOwner") {
      const waiter = appOwnerWaiters.shift();
      if (!waiter) {
        onError(new Error("Received unexpected DbWorkerAppOwner"));
        return;
      }
      waiter.resolve(message.appOwner);
      return;
    }

    const pending = pendingRequests.get(message.requestId);
    if (!pending) {
      onError(
        new Error(`Missing pending request for requestId ${message.requestId}`),
      );
      return;
    }

    pendingRequests.delete(message.requestId);

    if (pending.expectedType !== message.type) {
      pending.reject(
        new Error(
          `Expected ${pending.expectedType}, received ${message.type} for requestId ${message.requestId}`,
        ),
      );
      return;
    }

    pending.resolve(message);
  };

  brokerPort.onMessage = (output) => {
    if (output.type === "LeaderAcquired" && output.name !== name) {
      onError(
        new Error(
          `Unexpected LeaderAcquired for '${output.name}' in '${name}' channel`,
        ),
      );
    }
  };

  deps.evoluWorker.port.postMessage(
    {
      type: "InitEvolu",
      name,
      port: channel.port1.native,
      brokerPort: brokerChannel.port1.native,
    },
    [channel.port1.native, brokerChannel.port1.native],
  );

  const request = <TExpected extends DbWorkerResponseWithRequestId["type"]>(
    message: DbWorkerInput,
    expectedType: TExpected,
  ): Promise<Extract<DbWorkerResponseWithRequestId, { type: TExpected }>> =>
    new Promise((resolve, reject) => {
      if (isDisposed) {
        reject(new Error("DbWorkerClient disposed"));
        return;
      }

      if (!("requestId" in message)) {
        reject(
          new Error(
            `Message ${message.type} must include requestId for request/response flow`,
          ),
        );
        return;
      }

      pendingRequests.set(message.requestId, {
        expectedType,
        resolve: resolve as (message: DbWorkerResponseWithRequestId) => void,
        reject,
      });
      port.postMessage(message);
    });

  const close = async (): Promise<void> => {
    if (closePromise) return closePromise;

    closePromise = (async () => {
      if (isDisposed) return;

      try {
        const requestId = requestIdCounter++;
        await request(
          { type: "DbWorkerClose", requestId },
          "DbWorkerCloseResponse",
        );
      } finally {
        disposeNow(new Error("DbWorkerClient disposed"));
      }
    })();

    return closePromise;
  };

  return {
    init: (dbName, schemaVersion) =>
      new Promise<void>((resolve, reject) => {
        if (isDisposed) {
          reject(new Error("DbWorkerClient disposed"));
          return;
        }
        initWaiters.push({ resolve, reject });
        port.postMessage({ type: "DbWorkerInit", dbName, schemaVersion });
      }),

    getAppOwner: () =>
      new Promise((resolve, reject) => {
        if (isDisposed) {
          reject(new Error("DbWorkerClient disposed"));
          return;
        }
        appOwnerWaiters.push({ resolve, reject });
        port.postMessage({ type: "DbWorkerGetAppOwner" });
      }),

    query: async (sql, params) => {
      const requestId = requestIdCounter++;
      const response = await request(
        params == null
          ? { type: "DbWorkerQuery", requestId, sql }
          : { type: "DbWorkerQuery", requestId, sql, params },
        "DbWorkerQueryResponse",
      );
      return response.rows;
    },

    mutate: async (sql, params) => {
      const requestId = requestIdCounter++;
      const response = await request(
        { type: "DbWorkerMutate", requestId, sql, params },
        "DbWorkerMutateResponse",
      );
      return response.changes;
    },

    exportDatabase: async () => {
      const requestId = requestIdCounter++;
      const response = await request(
        { type: "DbWorkerExport", requestId },
        "DbWorkerExportResponse",
      );
      return response.data;
    },

    reset: async () => {
      const requestId = requestIdCounter++;
      await request(
        { type: "DbWorkerReset", requestId },
        "DbWorkerResetResponse",
      );
    },

    [Symbol.asyncDispose]: close,

    [Symbol.dispose]: () => {
      disposeNow(new Error("DbWorkerClient disposed"));
    },
  };
};

const createDbSchemaStatements = (
  dbSchema: ReturnType<typeof evoluSchemaToDbSchema>,
): ReadonlyArray<SqlStatement> => {
  const statements: Array<SqlStatement> = [];

  const systemColumnNames = Object.keys(SystemColumns.props);

  for (const [tableName, columns] of Object.entries(dbSchema.tables)) {
    const allColumns = [...systemColumnNames, ...columns];
    const tableSql = [
      `create table if not exists ${escapeIdentifier(tableName)} (`,
      `"id" text,`,
      allColumns.map((column) => `${escapeIdentifier(column)} any`).join(", "),
      'primary key ("ownerId", "id")',
      ") without rowid, strict",
    ].join(" ");
    statements.push({ sql: tableSql, params: [] });
  }

  for (const index of dbSchema.indexes) {
    statements.push({
      sql: ensureCreateIndexIfNotExists(index.sql),
      params: [],
    });
  }

  return statements;
};

const mutationChangeToStatements = (
  change: MutationChange,
  ownerId: OwnerId,
): ReadonlyArray<SqlStatement> => {
  const tableIdentifier = escapeIdentifier(change.table);
  if (change.isDelete) {
    return [
      {
        sql: `delete from ${tableIdentifier} where "ownerId" = ? and "id" = ?`,
        params: [ownerId, change.id],
      },
    ];
  }

  const nowIso = new Date().toISOString();
  const columns: Array<readonly [string, unknown]> = [
    ...Object.entries(change.values),
    [change.isInsert ? "createdAt" : "updatedAt", nowIso],
  ];

  if (change.isDelete != null) {
    columns.push(["isDeleted", change.isDelete ? 1 : 0]);
  }

  return columns.map(([column, value]) => {
    const columnIdentifier = escapeIdentifier(column);
    return {
      sql: [
        `insert into ${tableIdentifier} ("ownerId", "id", ${columnIdentifier})`,
        "values (?, ?, ?)",
        'on conflict ("ownerId", "id") do update',
        `set ${columnIdentifier} = excluded.${columnIdentifier}`,
      ].join(" "),
      params: [ownerId, change.id, value],
    };
  });
};

const ensureCreateIndexIfNotExists = (sql: string): string =>
  sql
    .replace(/^create unique index /i, "create unique index if not exists ")
    .replace(/^create index /i, "create index if not exists ");

const escapeIdentifier = (identifier: string): string =>
  `"${identifier.replaceAll('"', '""')}"`;

interface LoadingPromises {
  get: <R extends Row>(
    query: Query<R>,
  ) => {
    readonly promise: Promise<QueryRows<R>>;
    readonly isNew: boolean;
  };

  resolve: (query: Query, rows: ReadonlyArray<Row>) => void;

  releaseUnsubscribedOnMutation: () => void;

  getQueries: () => ReadonlyArray<Query>;
}

interface LoadingPromise {
  /** Promise with props for the React use hook. */
  promise: Promise<QueryRows> & {
    status?: "pending" | "fulfilled" | "rejected";
    value?: QueryRows;
    reason?: unknown;
  };
  resolve: (rows: QueryRows) => void;
  releaseOnResolve: boolean;
}

const createLoadingPromises = (
  subscribedQueries: SubscribedQueries,
): LoadingPromises => {
  const loadingPromiseMap = new Map<Query, LoadingPromise>();

  return {
    get: <R extends Row>(
      query: Query<R>,
    ): {
      readonly promise: Promise<QueryRows<R>>;
      readonly isNew: boolean;
    } => {
      let loadingPromise = loadingPromiseMap.get(query);
      const isNew = !loadingPromise;
      if (!loadingPromise) {
        const { promise, resolve } = Promise.withResolvers<QueryRows>();
        loadingPromise = { resolve, promise, releaseOnResolve: false };
        loadingPromiseMap.set(query, loadingPromise);
      }
      return {
        promise: loadingPromise.promise as Promise<QueryRows<R>>,
        isNew,
      };
    },

    resolve: (query, rows) => {
      const loadingPromise = loadingPromiseMap.get(query);
      if (!loadingPromise) return;

      if (loadingPromise.promise.status !== "fulfilled") {
        loadingPromise.resolve(rows);
      } else {
        loadingPromise.promise = Promise.resolve(rows);
      }

      // Set status and value fields for React's `use` Hook to unwrap synchronously.
      // While undocumented in React docs, React still uses these properties internally,
      // and Evolu's own promise caching logic depends on checking `promise.status`.
      // https://github.com/acdlite/rfcs/blob/first-class-promises/text/0000-first-class-support-for-promises.md
      void Object.assign(loadingPromise.promise, {
        status: "fulfilled",
        value: rows,
      });

      if (loadingPromise.releaseOnResolve) {
        loadingPromiseMap.delete(query);
      }
    },

    releaseUnsubscribedOnMutation: () => {
      [...loadingPromiseMap.entries()]
        .filter(([query]) => !subscribedQueries.has(query))
        .forEach(([query, loadingPromise]) => {
          if (loadingPromise.promise.status === "fulfilled") {
            loadingPromiseMap.delete(query);
          } else {
            loadingPromise.releaseOnResolve = true;
          }
        });
    },

    getQueries: () => Array.from(loadingPromiseMap.keys()),
  };
};
