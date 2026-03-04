import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:http";
import {
  createId,
  createRandomBytes,
  getOk,
  SimpleName,
  testAppOwner,
  testCreateRun,
} from "@evolu/common";
import {
  createProtocolMessageBuffer,
  createProtocolMessageForUnsubscribe,
  createProtocolMessageFromCrdtMessages,
  MessageType,
  SubscriptionFlags,
  testCreateCrdtMessage,
} from "@evolu/common/local-first";
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
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  }).then(waitForMacrotask);

const waitForMacrotask = async (): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const waitForError = async (ws: WebSocket): Promise<Error> =>
  await new Promise((resolve) => {
    ws.once("error", (error) => {
      // Some runtimes may emit multiple error events for the same failed
      // upgrade; keep a no-op listener to avoid unhandled EventEmitter errors.
      ws.on("error", () => {});
      resolve(error);
    });
  });

const waitForMessage = async (
  ws: WebSocket,
  timeoutMs = 1_000,
): Promise<unknown> =>
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      ws.removeListener("message", onMessage);
      ws.removeListener("close", onClose);
      ws.removeListener("error", onError);
    };

    const onMessage = (message: unknown) => {
      cleanup();
      resolve(message);
    };

    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(
        new Error(`Socket closed before message: ${code} ${reason.toString()}`),
      );
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message"));
    }, timeoutMs);

    ws.once("message", onMessage);
    ws.once("close", onClose);
    ws.once("error", onError);
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
  const isOwnerWithinQuota = () => true;

  test("accepts ws connection when owner check is not configured", async () => {
    const port = await getFreePort();
    const name = "RelayNoAuth";
    dbNames.add(name);

    await using run = testCreateRun(createRelayDeps());
    await using relay = getOk(
      await run(
        startRelay({
          port,
          name: SimpleName.orThrow(name),
          isOwnerWithinQuota,
        }),
      ),
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
          isOwnerWithinQuota,
        }),
      ),
    );
    void relay;

    const ws = new WebSocket(`ws://127.0.0.1:${port}?ownerId=not-owner-id`);
    const error = await waitForError(ws);
    expect(String(error.message)).toMatch(
      /Unexpected server response: 400|Connection ended/,
    );
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
          isOwnerWithinQuota,
        }),
      ),
    );
    void relay;

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?ownerId=${testAppOwner.id}`,
    );
    const error = await waitForError(ws);
    expect(String(error.message)).toMatch(
      /Unexpected server response: 401|Connection ended/,
    );
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
          isOwnerWithinQuota,
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
          isOwnerWithinQuota,
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
          isOwnerWithinQuota,
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

  test("handles subscribe, broadcast, and unsubscribe flow for same owner", async () => {
    const port = await getFreePort();
    const name = "RelaySubscribeBroadcastUnsubscribe";
    dbNames.add(name);
    const randomBytes = createRandomBytes();
    const protocolDeps = { randomBytes };

    await using run = testCreateRun(createRelayDeps());
    await using relay = getOk(
      await run(
        startRelay({
          port,
          name: SimpleName.orThrow(name),
          isOwnerAllowed: () => true,
          isOwnerWithinQuota,
        }),
      ),
    );
    void relay;

    const ws1 = new WebSocket(
      `ws://127.0.0.1:${port}?ownerId=${testAppOwner.id}`,
    );
    const ws2 = new WebSocket(
      `ws://127.0.0.1:${port}?ownerId=${testAppOwner.id}`,
    );

    await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);

    const subscribeMessage = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
      subscriptionFlag: SubscriptionFlags.Subscribe,
    }).unwrap();
    const subscribe1Response = waitForMessage(ws1);
    const subscribe2Response = waitForMessage(ws2);
    ws1.send(Buffer.from(subscribeMessage), { binary: true });
    ws2.send(Buffer.from(subscribeMessage), { binary: true });
    await Promise.all([subscribe1Response, subscribe2Response]);

    const syncMessage1 = createProtocolMessageFromCrdtMessages(protocolDeps)(
      testAppOwner,
      [testCreateCrdtMessage(createId(protocolDeps), 1, "first")],
    );
    const sync1SenderResponse = waitForMessage(ws1);
    const sync1PeerBroadcast = waitForMessage(ws2);
    ws1.send(Buffer.from(syncMessage1), { binary: true });
    await Promise.all([sync1SenderResponse, sync1PeerBroadcast]);

    const unsubscribeMessage = createProtocolMessageForUnsubscribe(
      testAppOwner.id,
    );
    const unsubscribeResponse = waitForMessage(ws2);
    ws2.send(Buffer.from(unsubscribeMessage), { binary: true });
    await unsubscribeResponse;

    const syncMessage2 = createProtocolMessageFromCrdtMessages(protocolDeps)(
      testAppOwner,
      [testCreateCrdtMessage(createId(protocolDeps), 2, "second")],
    );
    const sync2SenderResponse = waitForMessage(ws1);
    ws1.send(Buffer.from(syncMessage2), { binary: true });
    await sync2SenderResponse;
    expect(await waitForNoMessage(ws2)).toBe("timeout");

    await Promise.all([closeSocket(ws1), closeSocket(ws2)]);
  });

  test("restarts with existing database file and still serves protocol messages", async () => {
    const port = await getFreePort();
    const name = "RelayExistingDb";
    dbNames.add(name);

    {
      await using run = testCreateRun(createRelayDeps());
      await using relay = getOk(
        await run(
          startRelay({
            port,
            name: SimpleName.orThrow(name),
            isOwnerAllowed: () => true,
            isOwnerWithinQuota,
          }),
        ),
      );
      void relay;

      const ws = new WebSocket(
        `ws://127.0.0.1:${port}?ownerId=${testAppOwner.id}`,
      );
      await waitForOpen(ws);
      await closeSocket(ws);
    }

    await using run = testCreateRun(createRelayDeps());
    await using relay = getOk(
      await run(
        startRelay({
          port,
          name: SimpleName.orThrow(name),
          isOwnerAllowed: () => true,
          isOwnerWithinQuota,
        }),
      ),
    );
    void relay;

    const ws = new WebSocket(
      `ws://127.0.0.1:${port}?ownerId=${testAppOwner.id}`,
    );
    await waitForOpen(ws);

    const subscribeMessage = createProtocolMessageBuffer(testAppOwner.id, {
      messageType: MessageType.Request,
      subscriptionFlag: SubscriptionFlags.Subscribe,
    }).unwrap();
    const subscribeResponse = waitForMessage(ws);
    ws.send(Buffer.from(subscribeMessage), { binary: true });
    await subscribeResponse;
    await closeSocket(ws);
  });
});
