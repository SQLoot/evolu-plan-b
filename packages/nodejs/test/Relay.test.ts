import { once } from "node:events";
import { existsSync, unlinkSync } from "node:fs";
import { createServer } from "node:net";
import {
  createId,
  Name,
  type RandomBytesDep,
  testCreateConsole,
  testCreateRun,
} from "@evolu/common";
import {
  type CrdtMessage,
  createInitialTimestamp,
  createProtocolMessageFromCrdtMessages,
  DbChange,
  testAppOwner,
} from "@evolu/common/local-first";
import BetterSQLite from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket } from "ws";
import { createRelayDeps, startRelay } from "../src/index.js";

const relayName = Name.orThrow("RelayRunLifetimeTest");
const relayTest = "Bun" in globalThis ? test.skip : test;

describe("startRelay", () => {
  afterEach(() => {
    for (const suffix of [".db", ".db-shm", ".db-wal"]) {
      const filePath = `${relayName}${suffix}`;
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });

  // TODO: Clean up.
  relayTest(
    "processes websocket messages after startup task settles",
    async () => {
      const console = testCreateConsole();
      const port = await getAvailablePort();

      const run = testCreateRun({
        ...createRelayDeps(),
        console,
      });
      try {
        const relay = await run.orThrow(
          startRelay({
            port,
            name: relayName,
            isOwnerWithinQuota: () => true,
          }),
        );

        try {
          const ws = new WebSocket(`ws://127.0.0.1:${port}/${testAppOwner.id}`);
          await once(ws, "open");

          try {
            const responsePromise = waitForMessage(ws, 2000);

            ws.send(
              createProtocolMessageFromCrdtMessages(run.deps)(testAppOwner, [
                createTestCrdtMessage(run.deps),
              ]),
            );

            const response = await responsePromise;

            expect(response).toBeInstanceOf(Uint8Array);
            expect(getRelayErrorEntries(console.getEntriesSnapshot())).toEqual(
              [],
            );

            expect(await readStoredMessageCount(`${relayName}.db`)).toBe(1);
          } finally {
            await closeWebSocket(ws);
          }
        } finally {
          await relay[Symbol.asyncDispose]();
        }
      } finally {
        await run[Symbol.asyncDispose]();
      }
    },
  );
});

const createTestCrdtMessage = (deps: RandomBytesDep): CrdtMessage => ({
  timestamp: createInitialTimestamp(deps),
  change: DbChange.orThrow({
    table: "employee",
    id: createId(deps),
    values: { name: "Victoria" },
    isInsert: true,
    isDelete: null,
  }),
});

const getAvailablePort = async (): Promise<number> => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Expected TCP address");
  }

  const { port } = address;
  server.close();
  await once(server, "close");
  return port;
};

const waitForMessage = async (
  ws: WebSocket,
  timeoutMs: number,
): Promise<Uint8Array> => {
  const timeout = new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for websocket message after ${timeoutMs}ms`,
        ),
      );
    }, timeoutMs);

    ws.once("message", () => {
      clearTimeout(timeoutId);
    });
  });

  const [message] = (await Promise.race([once(ws, "message"), timeout])) as [
    Uint8Array,
  ];

  return message;
};

const closeWebSocket = async (ws: WebSocket): Promise<void> => {
  if (ws.readyState === WebSocket.CLOSED) return;

  const closed = once(ws, "close");
  ws.close();
  await closed;
};

const getRelayErrorEntries = (
  entries: ReturnType<
    ReturnType<typeof testCreateConsole>["getEntriesSnapshot"]
  >,
) => entries.filter((entry) => entry.method === "error");

const readStoredMessageCount = async (path: string): Promise<number> => {
  if ("Bun" in globalThis) {
    const { Database } = await import("bun:sqlite");
    const db = new Database(path, { readonly: true });
    try {
      const row = db
        .query("select count(*) as count from evolu_message;")
        .get() as { readonly count: number } | null;

      return row?.count ?? 0;
    } finally {
      db.close();
    }
  }

  const db = new BetterSQLite(path, { readonly: true });
  try {
    const row = db
      .prepare("select count(*) as count from evolu_message;")
      .get() as { readonly count: number };

    return row.count;
  } finally {
    db.close();
  }
};
