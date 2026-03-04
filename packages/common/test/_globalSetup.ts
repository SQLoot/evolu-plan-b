import http from "node:http";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

const utf8ToBytes = (value: string): Uint8Array =>
  new TextEncoder().encode(value);

interface ServerInstance {
  readonly httpServer: http.Server;
  readonly wsServer: WebSocketServer;
}

// Track all active servers by port
const servers = new Map<number, ServerInstance>();

const closeWithTimeout = (
  close: (callback: () => void) => void,
  timeoutMs = 500,
): Promise<void> =>
  new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    close(settle);
    const timeout = setTimeout(settle, timeoutMs);
    timeout.unref?.();
  });

/**
 * Creates a new WebSocket server on a random port. Each call creates a
 * completely isolated server instance.
 */
export const createServer = (): Promise<number> => {
  const httpServer = http.createServer();
  const wsServer = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(
      request.url ?? "/",
      "http://localhost",
    ).pathname.slice(1);

    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit("connection", ws, request, pathname);
    });
  });

  wsServer.on(
    "connection",
    (socket: WebSocket, _request: unknown, pathname: string) => {
      switch (pathname) {
        case "close":
          socket.close();
          break;

        case "terminate":
          socket.terminate();
          break;

        case "close-after-message":
          socket.send(utf8ToBytes("hello"));
          socket.once("message", () => {
            socket.close();
          });
          break;

        default:
          socket.on("message", (data: RawData) => {
            socket.send(data);
          });
          socket.send(utf8ToBytes("welcome"));
      }
    },
  );

  return new Promise<number>((resolve, reject) => {
    httpServer.on("listening", () => {
      const address = httpServer.address();
      if (address && typeof address === "object") {
        const port = address.port;
        servers.set(port, { httpServer, wsServer });
        resolve(port);
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
    httpServer.on("error", reject);
    httpServer.listen(0, "127.0.0.1");
  });
};

/** Closes a specific server by port. */
export const closeServer = async (port: number): Promise<void> => {
  const instance = servers.get(port);
  if (!instance) return;

  servers.delete(port);

  // Ensure active sockets don't keep `wsServer.close` pending indefinitely.
  for (const client of instance.wsServer.clients) {
    client.terminate();
  }

  await Promise.all([
    closeWithTimeout((done) => instance.wsServer.close(done)),
    closeWithTimeout((done) => instance.httpServer.close(done)),
  ]);
};
