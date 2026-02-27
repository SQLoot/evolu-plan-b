import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import { getOk, SimpleName, testAppOwner, testCreateRun } from "@evolu/common";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { createRelayDeps, startRelay } from "../src/local-first/Relay.js";

const dbNames = new Set<string>();

const cleanupDbFiles = (name: string): void => {
  for (const suffix of [".db", ".db-shm", ".db-wal"]) {
    const file = `${name}${suffix}`;
    if (existsSync(file)) unlinkSync(file);
  }
};

const getFreePort = async (): Promise<number> =>
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve free port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const waitForOpen = async (ws: WebSocket): Promise<void> =>
  await new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

const waitForError = async (ws: WebSocket): Promise<Error> =>
  await new Promise((resolve) => {
    ws.once("error", (error) => resolve(error));
  });

const waitForNoMessage = async (
  ws: WebSocket,
  timeoutMs = 120,
): Promise<"timeout" | "message"> =>
  await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve("timeout"), timeoutMs);
    ws.once("message", () => {
      clearTimeout(timeout);
      resolve("message");
    });
  });

const waitForClose = async (
  ws: WebSocket,
): Promise<{ code: number; reason: string }> =>
  await new Promise((resolve) => {
    ws.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });

const closeSocket = async (ws: WebSocket): Promise<void> => {
  if (
    ws.readyState === WebSocket.CLOSED ||
    ws.readyState === WebSocket.CLOSING
  ) {
    return;
  }
  await new Promise<void>((resolve) => {
    ws.once("close", () => resolve());
    ws.close();
  });
};

afterEach(() => {
  for (const name of dbNames) cleanupDbFiles(name);
  dbNames.clear();
});

describe("startRelay (nodejs adapter)", () => {
  test("accepts ws connection when owner check is not configured", async () => {
    const port = await getFreePort();
    const name = "RelayNoAuth";
    dbNames.add(name);

    await using run = testCreateRun(createRelayDeps());
    await using relay = getOk(
      await run(startRelay({ port, name: SimpleName.orThrow(name) })),
    );
    void relay;

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await waitForOpen(ws);
    await closeSocket(ws);
  });

  test("rejects invalid owner path with 400 when owner check is enabled", async () => {
    const port = await getFreePort();
    const name = "RelayBadOwner";
    dbNames.add(name);

    await using run = testCreateRun(createRelayDeps());
    await using relay = getOk(
      await run(
        startRelay({
          port,
          name: SimpleName.orThrow(name),
          isOwnerAllowed: () => true,
        }),
      ),
    );
    void relay;

    const ws = new WebSocket(`ws://127.0.0.1:${port}?ownerId=not-owner-id`);
    const error = await waitForError(ws);
    expect(String(error.message)).toContain("Unexpected server response: 400");
    await closeSocket(ws);
  });

  test("rejects unauthorized owner with 401", async () => {
    const port = await getFreePort();
    const name = "RelayUnauthorized";
    dbNames.add(name);

    await using run = testCreateRun(createRelayDeps());
    await using relay = getOk(
      await run(
        startRelay({
          port,
          name: SimpleName.orThrow(name),
          isOwnerAllowed: () => false,
        }),
      ),
    );
    void relay;

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?ownerId=${testAppOwner.id}`,
    );
    const error = await waitForError(ws);
    expect(String(error.message)).toContain("Unexpected server response: 401");
    await closeSocket(ws);
  });

  test("handles malformed binary message without dropping open socket", async () => {
    const port = await getFreePort();
    const name = "RelayProtocol";
    dbNames.add(name);

    await using run = testCreateRun(createRelayDeps());
    await using relay = getOk(
      await run(
        startRelay({
          port,
          name: SimpleName.orThrow(name),
          isOwnerAllowed: () => true,
        }),
      ),
    );
    void relay;

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?ownerId=${testAppOwner.id}`,
    );
    await waitForOpen(ws);

    ws.send(new Uint8Array([0xff, 0xff]), { binary: true });

    const outcome = await Promise.race([
      new Promise<"message">((resolve) => {
        ws.once("message", () => resolve("message"));
      }),
      new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), 120);
      }),
    ]);

    expect(outcome).toBe("timeout");
    expect(ws.readyState).toBe(WebSocket.OPEN);
    await closeSocket(ws);
  });

  test("ignores non-binary websocket payloads", async () => {
    const port = await getFreePort();
    const name = "RelayNonBinary";
    dbNames.add(name);

    await using run = testCreateRun(createRelayDeps());
    await using relay = getOk(
      await run(
        startRelay({
          port,
          name: SimpleName.orThrow(name),
          isOwnerAllowed: () => true,
        }),
      ),
    );
    void relay;

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?ownerId=${testAppOwner.id}`,
    );
    await waitForOpen(ws);

    ws.send("hello-text");

    expect(await waitForNoMessage(ws)).toBe("timeout");
    expect(ws.readyState).toBe(WebSocket.OPEN);
    await closeSocket(ws);
  });

  test("closes open sockets when relay is disposed", async () => {
    const port = await getFreePort();
    const name = "RelayShutdown";
    dbNames.add(name);

    await using run = testCreateRun(createRelayDeps());
    const relay = getOk(
      await run(
        startRelay({
          port,
          name: SimpleName.orThrow(name),
          isOwnerAllowed: () => true,
        }),
      ),
    );

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?ownerId=${testAppOwner.id}`,
    );
    await waitForOpen(ws);

    const closePromise = waitForClose(ws);
    await relay[Symbol.asyncDispose]();

    const { code, reason } = await closePromise;
    expect(code).toBe(1000);
    expect(reason).toContain("shutting down");
  });
});
