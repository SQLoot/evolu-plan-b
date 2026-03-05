import { existsSync } from "node:fs";
import { createServer } from "node:http";
import {
  type CreateSqliteDriverDep,
  callback,
  createRandom,
  createRelation,
  createSqlite,
  getOk,
  isPromiseLike,
  type OwnerId,
  ok,
  type RandomDep,
  SimpleName,
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
 * const deps = { ...createRelayDeps(), console };
 *
 * await using run = createRun(deps);
 * await using stack = run.stack();
 *
 * await stack.use(startRelay({ port: 4000 }));
 *
 * await run.deps.shutdown;
 * ```
 */
export const startRelay =
  ({
    port = 443,
    name = SimpleName.orThrow("evolu-relay"),
    isOwnerAllowed,
    isOwnerWithinQuota,
  }: NodeJsRelayConfig): Task<Relay, never, RelayDeps> =>
  async (_run) => {
    await using stack = _run.stack();
    const console = _run.deps.console.child("relay");

    const dbFileExists = existsSync(`${name}.db`);

    const sqlite = getOk(await stack.use(createSqlite(name)));
    const deps = { ..._run.deps, sqlite };

    if (!dbFileExists) {
      createBaseSqliteStorageTables(deps);
      createRelayStorageTables(deps);
    }

    const storage = createRelaySqliteStorage(deps)({
      isOwnerWithinQuota,
    });

    // Use root daemon runner for WS callbacks; task-scoped runner closes
    // after startRelay returns and would reject message handling with
    // RunnerClosingError.
    const run = _run.daemon.addDeps({ storage });

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

          let broadcastCount = 0;
          for (const socket of sockets) {
            if (socket !== ws && socket.readyState === WebSocket.OPEN) {
              socket.send(message, { binary: true });
              broadcastCount++;
            }
          }

          console.debug("broadcast", ownerId, broadcastCount, sockets.size);
        },
      };

      ws.on("message", (message) => {
        if (!Uint8Array.is(message)) return;

        void (async () => {
          const response = await run(
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
      return ok();
    });

    stack.defer(
      callback(({ ok }) => {
        const serverWithCloseAll = server as typeof server & {
          closeAllConnections?: () => void;
        };

        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          serverWithCloseAll.closeAllConnections?.();
          console.warn("HTTP server close timed out");
          ok();
        }, 1_000);
        timeout.unref?.();

        server.close(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          console.info("HTTP server closed");
          ok();
        });
      }),
    );

    stack.defer(
      callback(({ ok }) => {
        // wss.close() emits 'close' when all clients have disconnected.
        // Guard with timeout to avoid hanging shutdown on stale sockets.
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          for (const client of wss.clients) {
            client.terminate();
          }
          console.warn("WebSocketServer close timed out");
          ok();
        }, 1_000);
        timeout.unref?.();

        wss.close(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          console.info("WebSocketServer closed");
          ok();
        });
      }),
    );

    stack.defer(
      callback(({ ok }) => {
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
        ok();
      }),
    );

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
