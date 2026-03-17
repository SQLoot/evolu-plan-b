import {
  createRandom,
  createRelation,
  createSqlite,
  type CreateSqliteDriverDep,
  isPromiseLike,
  Name,
  ok,
  OwnerId,
  type RandomDep,
  type Task,
  type TimingSafeEqualDep,
  Uint8Array,
} from "@evolu/common";
import {
  applyProtocolMessageAsRelay,
  type ApplyProtocolMessageAsRelayOptions,
  createBaseSqliteStorageTables,
  createRelaySqliteStorage,
  createRelayStorageTables,
  defaultProtocolMessageMaxSize,
  parseOwnerIdFromOwnerWebSocketTransportUrl,
  type Relay,
  type RelayConfig,
} from "@evolu/common/local-first";
import { existsSync } from "fs";
import { createServer } from "http";
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
    await using stack = new AsyncDisposableStack();
    const console = run.deps.console.child("relay");

    const dbFileExists = existsSync(`${name}.db`);

    const sqliteResult = await run(createSqlite(name));
    if (!sqliteResult.ok) return sqliteResult;
    const sqlite = stack.use(sqliteResult.value);

    const deps = { ...run.deps, sqlite };

    if (!dbFileExists) {
      createBaseSqliteStorageTables(deps);
      createRelayStorageTables(deps);
    }

    const storage = createRelaySqliteStorage(deps)({
      isOwnerWithinQuota,
    });

    // WebSocket callbacks outlive the startRelay task scope.
    const daemonRun = run.daemon.addDeps({ storage });

    const server = createServer();
    const wss = new WebSocketServer({
      maxPayload: defaultProtocolMessageMaxSize,
      noServer: true,
    });
    const ownerSocketRelation = createRelation<OwnerId, WebSocket>();

    server.on("upgrade", (request, socket, head) => {
      socket.on("error", console.debug);

      const rejectUpgrade = (
        statusCode: 400 | 401 | 500,
        statusText: "Bad Request" | "Unauthorized" | "Internal Server Error",
      ) => {
        socket.end(
          `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
            "Connection: close\r\n" +
            "Content-Length: 0\r\n" +
            "\r\n",
        );
      };

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
        rejectUpgrade(400, "Bad Request");
        return;
      }

      void (async () => {
        try {
          const result = isOwnerAllowed(ownerId);
          const isAllowed = isPromiseLike(result) ? await result : result;
          if (!isAllowed) {
            console.debug("unauthorized owner", ownerId);
            rejectUpgrade(401, "Unauthorized");
            return;
          }

          completeUpgrade();
        } catch (error) {
          console.error("owner authorization failed", error);
          rejectUpgrade(500, "Internal Server Error");
        }
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
            ownerSocketRelation.getB(ownerId)?.size ?? 0,
          );
        },

        unsubscribe: (ownerId) => {
          ownerSocketRelation.remove(ownerId, ws);
          console.debug(
            "unsubscribe",
            ownerId,
            ownerSocketRelation.getB(ownerId)?.size ?? 0,
          );
        },

        broadcast: (ownerId, message) => {
          const sockets = ownerSocketRelation.getB(ownerId);
          if (!sockets) return;

          for (const socket of sockets) {
            if (socket !== ws && socket.readyState === WebSocket.OPEN) {
              socket.send(message, { binary: true });
            }
          }

          console.debug(
            "broadcast",
            ownerId,
            sockets.size,
          );
        },
      };

      ws.on("message", (message) => {
        if (!Uint8Array.is(message)) return;

        void (async () => {
          const response = await daemonRun(
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
        ownerSocketRelation.deleteB(ws);
        console.debug("ws close", wss.clients.size);
      });
    });

    // Cleanup runs in LIFO order: clients → WebSocketServer → HTTP server
    stack.defer(() => {
      console.info("Shutdown complete");
    });

    stack.defer(async () => {
      const serverWithCloseAll = server as typeof server & {
        closeAllConnections?: () => void;
      };

      await new Promise<void>((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          serverWithCloseAll.closeAllConnections?.();
          console.warn("HTTP server close timed out");
          resolve();
        }, 1_000);
        timeout.unref?.();

        server.close(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          console.info("HTTP server closed");
          resolve();
        });
      });
    });

    stack.defer(async () => {
      // wss.close() emits 'close' when all clients have disconnected.
      await new Promise<void>((resolve) => {
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          for (const client of wss.clients) {
            client.terminate();
          }
          console.warn("WebSocketServer close timed out");
          resolve();
        }, 1_000);
        timeout.unref?.();

        wss.close(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          console.info("WebSocketServer closed");
          resolve();
        });
      });
    });

    stack.defer(() => {
      console.info("Shutting down...");
      for (const client of wss.clients) {
        if (
          client.readyState === WebSocket.OPEN ||
          client.readyState === WebSocket.CONNECTING ||
          client.readyState === WebSocket.CLOSING
        ) {
          client.close(1000, "Evolu Relay shutting down");
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.removeListener("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };

      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port);
    });
    console.info(`Started on port ${port}`);

    return ok(stack.move());
  };
