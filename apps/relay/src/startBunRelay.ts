import {
  type CreateSqliteDriverDep,
  createSqlite,
  isPromiseLike,
  type OwnerId,
  ok,
  SimpleName,
  type Task,
  type TimingSafeEqualDep,
} from "@evolu/common";
import {
  type ApplyProtocolMessageAsRelayOptions,
  applyProtocolMessageAsRelay,
  createBaseSqliteStorageTables,
  createRelaySqliteStorage,
  createRelayStorageTables,
  parseOwnerIdFromOwnerWebSocketTransportUrl,
  type Relay,
  type RelayConfig,
} from "@evolu/common/local-first";

interface BunRelayConfig extends RelayConfig {
  readonly port?: number;
}

type BunRelayDeps = CreateSqliteDriverDep & TimingSafeEqualDep;

interface BunLikeServerWebSocket<TData = unknown> {
  readonly data: TData;
  send(data: Uint8Array): number;
}

interface BunLikeServer {
  stop(closeActiveConnections?: boolean): void;
  upgrade(
    request: Request,
    options?: {
      readonly data?: unknown;
    },
  ): boolean;
}

interface BunLike {
  serve(options: {
    readonly port: number;
    readonly fetch: (
      request: Request,
      server: BunLikeServer,
    ) => Promise<Response | undefined>;
    readonly websocket: {
      readonly open?: (socket: BunLikeServerWebSocket) => void;
      readonly message: (
        socket: BunLikeServerWebSocket,
        message: string | ArrayBuffer | ArrayBufferView,
      ) => void;
      readonly close: (socket: BunLikeServerWebSocket) => void;
    };
  }): BunLikeServer;
}

interface SocketSubscriptions {
  readonly ownerIds: Set<OwnerId>;
}

const toUint8Array = (
  message: string | ArrayBuffer | ArrayBufferView,
): Uint8Array | null => {
  if (typeof message === "string") return null;

  if (message instanceof globalThis.ArrayBuffer) {
    return new globalThis.Uint8Array(message);
  }

  if (!globalThis.ArrayBuffer.isView(message)) return null;

  return new globalThis.Uint8Array(
    message.buffer,
    message.byteOffset,
    message.byteLength,
  );
};

export const startBunRelay =
  ({
    port = 4000,
    name,
    isOwnerAllowed,
    isOwnerWithinQuota,
  }: BunRelayConfig): Task<Relay, never, BunRelayDeps> =>
  async (_run) => {
    const bunRuntime = (globalThis as { readonly Bun?: BunLike }).Bun;
    if (!bunRuntime) {
      throw new Error("startBunRelay requires Bun runtime.");
    }

    await using stack = new AsyncDisposableStack();
    const console = _run.deps.console.child("relay");

    const relayName = name ?? SimpleName.orThrow("evolu-relay");
    const sqlite = stack.use(await _run.orThrow(createSqlite(relayName)));
    const deps = { ..._run.deps, sqlite };

    createBaseSqliteStorageTables(deps);
    createRelayStorageTables(deps);

    const storage = createRelaySqliteStorage(deps)({ isOwnerWithinQuota });
    const run = _run.addDeps({ storage });

    const ownerSockets = new Map<OwnerId, Set<BunLikeServerWebSocket>>();
    const socketOwners = new Map<BunLikeServerWebSocket, SocketSubscriptions>();

    const subscribe = (
      ownerId: OwnerId,
      socket: BunLikeServerWebSocket,
    ): void => {
      let sockets = ownerSockets.get(ownerId);
      if (!sockets) {
        sockets = new Set();
        ownerSockets.set(ownerId, sockets);
      }
      sockets.add(socket);

      let subscriptions = socketOwners.get(socket);
      if (!subscriptions) {
        subscriptions = { ownerIds: new Set() };
        socketOwners.set(socket, subscriptions);
      }
      subscriptions.ownerIds.add(ownerId);
    };

    const unsubscribe = (
      ownerId: OwnerId,
      socket: BunLikeServerWebSocket,
    ): void => {
      const sockets = ownerSockets.get(ownerId);
      if (sockets) {
        sockets.delete(socket);
        if (sockets.size === 0) ownerSockets.delete(ownerId);
      }

      const subscriptions = socketOwners.get(socket);
      if (!subscriptions) return;
      subscriptions.ownerIds.delete(ownerId);
      if (subscriptions.ownerIds.size === 0) socketOwners.delete(socket);
    };

    const unsubscribeAll = (socket: BunLikeServerWebSocket): void => {
      const subscriptions = socketOwners.get(socket);
      if (!subscriptions) return;

      for (const ownerId of subscriptions.ownerIds) {
        const sockets = ownerSockets.get(ownerId);
        if (!sockets) continue;
        sockets.delete(socket);
        if (sockets.size === 0) ownerSockets.delete(ownerId);
      }

      socketOwners.delete(socket);
    };

    const server = bunRuntime.serve({
      port,
      fetch: async (request, bunServer) => {
        const url = new URL(request.url);

        if (url.pathname === "/" && request.method === "GET") {
          return new Response("Evolu Relay", { status: 200 });
        }

        const ownerId = parseOwnerIdFromOwnerWebSocketTransportUrl(
          url.pathname,
        );
        if (!ownerId) {
          return new Response("Bad Request", { status: 400 });
        }

        if (isOwnerAllowed) {
          const authorization = isOwnerAllowed(ownerId);
          const isAllowed = isPromiseLike(authorization)
            ? await authorization
            : authorization;
          if (!isAllowed) {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        const didUpgrade = bunServer.upgrade(request, { data: { ownerId } });
        if (!didUpgrade) {
          return new Response("Bad Request", { status: 400 });
        }

        return undefined;
      },
      websocket: {
        message: (socket, rawMessage) => {
          const message = toUint8Array(rawMessage);
          if (!message) return;

          const options: ApplyProtocolMessageAsRelayOptions = {
            subscribe: (ownerId) => {
              subscribe(ownerId, socket);
              console.debug(
                "subscribe",
                ownerId,
                ownerSockets.get(ownerId)?.size ?? 0,
              );
            },
            unsubscribe: (ownerId) => {
              unsubscribe(ownerId, socket);
              console.debug(
                "unsubscribe",
                ownerId,
                ownerSockets.get(ownerId)?.size ?? 0,
              );
            },
            broadcast: (ownerId, outgoingMessage) => {
              const sockets = ownerSockets.get(ownerId);
              if (!sockets) return;

              let broadcastCount = 0;
              for (const targetSocket of sockets) {
                if (targetSocket === socket) continue;
                targetSocket.send(outgoingMessage);
                broadcastCount++;
              }

              console.debug("broadcast", ownerId, broadcastCount, sockets.size);
            },
          };

          void (async () => {
            try {
              const response = await run(
                applyProtocolMessageAsRelay(message, options),
              );
              if (!response.ok) {
                console.error(response);
                return;
              }

              socket.send(response.value.message);
            } catch (error) {
              console.error("Error processing WebSocket message:", error);
            }
          })();
        },
        close: (socket) => {
          unsubscribeAll(socket);
          console.debug("ws close");
        },
      },
    });

    stack.defer(() => {
      console.info("Shutdown complete");
    });

    stack.defer(() => {
      console.info("Shutting down...");
      server.stop(true);
      console.info("Bun server stopped");
    });

    console.info(`Started on port ${port} (Bun native runtime)`);

    return ok(stack.move());
  };
