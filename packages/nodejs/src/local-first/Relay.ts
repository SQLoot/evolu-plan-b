import { existsSync } from "node:fs";
import { createServer } from "node:http";
import {
  type CreateSqliteDriverDep,
  createRandom,
  createRelation,
  createSqlite,
  isPromiseLike,
  Name,
  type OwnerId,
  ok,
  type RandomDep,
  type Sqlite,
  type Task,
  type TimingSafeEqualDep,
  Uint8Array,
} from "@evolu/common";
import {
  type ApplyProtocolMessageAsRelayOptions,
  applyProtocolMessageAsRelay,
  createBaseSqliteStorageTables,
  createRelaySqliteStorage,
  createRelayStorageTables,
  defaultProtocolMessageMaxSize,
  parseOwnerIdFromOwnerWebSocketTransportUrl,
  type Relay,
  type RelayConfig,
} from "@evolu/common/local-first";
import { WebSocket, WebSocketServer } from "ws";
import { createTimingSafeEqual } from "../Crypto.js";
import { createBetterSqliteDriver } from "../Sqlite.js";

export interface NodeJsRelayConfig extends RelayConfig {
  /** The port number for the HTTP server. */
  readonly port?: number;
}

export type RelayDeps = CreateSqliteDriverDep & RandomDep & TimingSafeEqualDep;

/** Dependencies for {@link startRelay} using better-sqlite3. */
export const createRelayDeps = (): RelayDeps => ({
  createSqliteDriver: createBetterSqliteDriver,
  random: createRandom(),
  timingSafeEqual: createTimingSafeEqual(),
});

/**
 * Starts an Evolu relay server using Node.js.
 *
 * Use {@link createRelayDeps} to create dependencies for better-sqlite3, or
 * provide a custom SQLite driver implementation.
 *
 * ### Example
 *
 * ```ts
 * // Ensure the database is created in a predictable location for Docker.
 * mkdirSync("data", { recursive: true });
 * process.chdir("data");
 *
 * const console = createConsole({
 *   // level: "debug",
 *   formatter: createConsoleFormatter()({
 *     timestampFormat: "relative",
 *   }),
 * });
 *
 * const deps = { ...createRelayDeps(), console };
 *
 * await using run = createRun(deps);
 * await using stack = new AsyncDisposableStack();
 *
 * stack.use(
 *   await run.orThrow(
 *     startRelay({
 *       port: 4000,
 *
 *       // Note: Relay requires URL in format ws://host:port/<ownerId>
 *       // isOwnerAllowed: (_ownerId) => true,
 *
 *       isOwnerWithinQuota: (_ownerId, requiredBytes) => {
 *         const maxBytes = 1024 * 1024; // 1MB
 *         return requiredBytes <= maxBytes;
 *       },
 *     }),
 *   ),
 * );
 *
 * await run.deps.shutdown;
 * ```
 */
export const startRelay =
  ({
    port = 443,
    name = Name.orThrow("evolu-relay"),
    isOwnerAllowed,
    isOwnerWithinQuota,
  }: NodeJsRelayConfig): Task<Relay, never, RelayDeps> =>
  async (run) => {
    const console = run.deps.console.child("relay");
    let sqlite: Sqlite | undefined;
    let relayRunToDispose: ReturnType<typeof run.create> | undefined;
    let disposingPromise: Promise<void> | undefined;

    try {
      const dbFileExists = existsSync(`${name}.db`);

      const sqliteResult = await run(createSqlite(name));
      if (!sqliteResult.ok) return sqliteResult;
      sqlite = sqliteResult.value;

      const deps = { ...run.deps, sqlite };

      if (!dbFileExists) {
        createBaseSqliteStorageTables(deps);
        createRelayStorageTables(deps);
      }

      const relayRun = run.create().addDeps({
        storage: createRelaySqliteStorage(deps)({
          isOwnerWithinQuota,
        }),
      });
      relayRunToDispose = relayRun;

      const server = createServer();
      const wss = new WebSocketServer({
        maxPayload: defaultProtocolMessageMaxSize,
        noServer: true,
      });
      const ownerSocketRelation = createRelation<OwnerId, WebSocket>();

      server.on("upgrade", (request, socket, head) => {
        socket.on("error", console.debug);

        const completeUpgrade = () => {
          socket.removeListener("error", console.debug);

          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit("connection", ws, request);
          });
        };

        if (!isOwnerAllowed) {
          completeUpgrade();
          return;
        }

        const ownerId = parseOwnerIdFromOwnerWebSocketTransportUrl(
          request.url ?? "",
        );

        if (!ownerId) {
          console.debug("invalid or missing ownerId in URL", request.url);
          socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
          socket.destroy();
          return;
        }

        void (async () => {
          const result = isOwnerAllowed(ownerId);
          const isAllowed = isPromiseLike(result) ? await result : result;
          if (!isAllowed) {
            console.debug("unauthorized owner", ownerId);
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }
          completeUpgrade();
        })();
      });

      wss.on("connection", (ws) => {
        console.debug("on connection", wss.clients.size);

        const options: ApplyProtocolMessageAsRelayOptions = {
          subscribe: (ownerId) => {
            ownerSocketRelation.add(ownerId, ws);
            console.debug(
              "subscribe",
              ownerId,
              ownerSocketRelation.bCountForA(ownerId),
            );
          },

          unsubscribe: (ownerId) => {
            ownerSocketRelation.remove(ownerId, ws);
            console.debug(
              "unsubscribe",
              ownerId,
              ownerSocketRelation.bCountForA(ownerId),
            );
          },

          broadcast: (ownerId, message) => {
            for (const socket of ownerSocketRelation.iterateB(ownerId)) {
              if (socket !== ws && socket.readyState === WebSocket.OPEN) {
                socket.send(message, { binary: true });
              }
            }

            console.debug(
              "broadcast",
              ownerId,
              ownerSocketRelation.bCountForA(ownerId),
            );
          },
        };

        ws.on("message", (message) => {
          if (!Uint8Array.is(message)) return;

          void (async () => {
            const response = await relayRun(
              applyProtocolMessageAsRelay(message, options),
            );
            if (!response.ok) {
              console.error(response);
              return;
            }
            ws.send(response.value.message, { binary: true });
          })();
        });

        ws.on("close", () => {
          ownerSocketRelation.removeByB(ws);
          console.debug("ws close", wss.clients.size);
        });
      });

      // Cleanup runs in LIFO order: clients → WebSocketServer → HTTP server
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          server.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          server.off("error", onError);
          resolve();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port);
      });
      console.info(`Started on port ${port}`);

      return ok({
        [Symbol.asyncDispose]: () => {
          if (disposingPromise) return disposingPromise;

          disposingPromise = (async () => {
            console.info("Shutting down...");

            for (const client of wss.clients) {
              if (client.readyState === WebSocket.OPEN) {
                client.close(1000, "Evolu Relay shutting down");
              }
            }

            await new Promise<void>((resolve) => {
              // wss.close() emits 'close' when all clients have disconnected.
              wss.close(() => {
                console.info("WebSocketServer closed");
                resolve();
              });
            });

            await new Promise<void>((resolve) => {
              server.close(() => {
                console.info("HTTP server closed");
                resolve();
              });
            });

            await relayRun[Symbol.asyncDispose]();

            if (sqlite) {
              await sqlite[Symbol.asyncDispose]();
            }

            console.info("Shutdown complete");
          })();

          return disposingPromise;
        },
      });
    } catch (error) {
      if (relayRunToDispose) {
        await relayRunToDispose[Symbol.asyncDispose]();
      }
      if (sqlite) {
        await sqlite[Symbol.asyncDispose]();
      }
      throw error;
    }
  };
