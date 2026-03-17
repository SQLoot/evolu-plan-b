import { afterAll, assert, beforeAll, expect, test, vi } from "vitest";
import { utf8ToBytes } from "../src/Buffer.js";
import { isServer } from "../src/Platform.js";
import { spaced, take } from "../src/Schedule.js";
import { createRunner } from "../src/Task.js";
import { createWebSocket, type WebSocketError } from "../src/WebSocket.js";

declare module "vitest/browser" {
  interface BrowserCommands {
    startWsServer: () => Promise<number>;
    stopWsServer: (port: number) => Promise<void>;
  }
}

let port: number | undefined;
const getServerUrl = (path = ""): string => {
  if (port === undefined) throw new Error("Server port not initialized");
  return `ws://127.0.0.1:${port}${path ? `/${path}` : ""}`;
};

beforeAll(async () => {
  if (isServer) {
    const { createServer } = await import("./_globalSetup.js");
    port = await createServer();
  } else {
    const { commands } = await import("vitest/browser");
    port = await commands.startWsServer();
  }
});

afterAll(async () => {
  if (port === undefined) return;
  const currentPort = port;
  port = undefined;
  if (isServer) {
    const { closeServer } = await import("./_globalSetup.js");
    await closeServer(currentPort);
  } else {
    const { commands } = await import("vitest/browser");
    await commands.stopWsServer(currentPort);
  }
});

const envValue =
  (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.EVOLU_BROWSER_WS_TESTS ??
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.EVOLU_BROWSER_WS_TESTS ??
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
    ?.VITE_EVOLU_BROWSER_WS_TESTS;
const browserWsEnabled = envValue === "1";
const wsTest = isServer || browserWsEnabled ? test : test.skip;

wsTest("connects, receives message, sends message, and disposes", async () => {
  await using run = createRunner();

  const messages: Array<Uint8Array> = [];

  const result = await run(
    createWebSocket(getServerUrl(), {
      binaryType: "arraybuffer",
      onMessage: (data) => {
        assert(data instanceof ArrayBuffer);
        messages.push(new Uint8Array(data));
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(messages).toHaveLength(1));
  expect(messages).toEqual([utf8ToBytes("welcome")]);

  const sendResult = ws.send(utf8ToBytes("hello"));
  expect(sendResult.ok).toBe(true);

  await vi.waitFor(() => expect(messages).toHaveLength(2));
  expect(messages).toEqual([utf8ToBytes("welcome"), utf8ToBytes("hello")]);

  await ws[Symbol.asyncDispose]();
  expect(ws.getReadyState()).toBe("closed");
});

wsTest("calls onOpen callback", async () => {
  await using run = createRunner();

  let openCalled = false;

  const result = await run(
    createWebSocket(getServerUrl(), {
      onOpen: () => {
        openCalled = true;
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(openCalled).toBe(true));
  expect(ws.isOpen()).toBe(true);
  expect(ws.getReadyState()).toBe("open");

  await ws[Symbol.asyncDispose]();
  expect(ws.isOpen()).toBe(false);
});

wsTest("does not call onClose when disposed", async () => {
  await using run = createRunner();

  let openCalled = false;
  let closeCalled = false;

  const result = await run(
    createWebSocket(getServerUrl(), {
      onOpen: () => {
        openCalled = true;
      },
      onClose: () => {
        closeCalled = true;
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(openCalled).toBe(true));

  await ws[Symbol.asyncDispose]();

  expect(closeCalled).toBe(false);
});

wsTest("send returns error when socket is not ready", async () => {
  await using run = createRunner();

  const result = await run(createWebSocket(getServerUrl()));

  assert(result.ok);
  const ws = result.value;

  await ws[Symbol.asyncDispose]();

  const sendResult = ws.send("test");
  expect(sendResult.ok).toBe(false);
  if (!sendResult.ok) {
    expect(sendResult.error.type).toBe("WebSocketSendError");
  }
});

wsTest("supports protocols as array", async () => {
  await using run = createRunner();

  let openCalled = false;

  const result = await run(
    createWebSocket(getServerUrl(), {
      protocols: ["protocol1", "protocol2"],
      onOpen: () => {
        openCalled = true;
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(openCalled).toBe(true));
  await ws[Symbol.asyncDispose]();
});

wsTest("supports protocols as string", async () => {
  await using run = createRunner();

  let openCalled = false;

  const result = await run(
    createWebSocket(getServerUrl(), {
      protocols: "protocol1",
      onOpen: () => {
        openCalled = true;
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(openCalled).toBe(true));
  await ws[Symbol.asyncDispose]();
});

wsTest("getReadyState returns connecting when socket is null", async () => {
  await using run = createRunner();

  const result = await run(
    createWebSocket("ws://localhost:1", {
      schedule: take(0)(spaced("1ms")),
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(ws.getReadyState()).toBe("connecting"));

  await ws[Symbol.asyncDispose]();
});

wsTest("calls onError on connection failure", async () => {
  await using run = createRunner();

  const errors: Array<WebSocketError> = [];

  const result = await run(
    createWebSocket("ws://localhost:1", {
      schedule: take(0)(spaced("1ms")),
      onError: (error) => {
        errors.push(error);
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
  expect(errors[0]?.type).toBe("WebSocketConnectError");

  await ws[Symbol.asyncDispose]();
});

wsTest("calls onClose when server closes connection", async () => {
  await using run = createRunner();

  let closeCalled = false;

  const result = await run(
    createWebSocket(getServerUrl("close"), {
      schedule: take(0)(spaced("1ms")),
      onClose: () => {
        closeCalled = true;
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(closeCalled).toBe(true));
  await ws[Symbol.asyncDispose]();
});

wsTest("does not retry when shouldRetryOnClose returns false", async () => {
  await using run = createRunner();

  const errors: Array<WebSocketError> = [];
  let closeCount = 0;

  const result = await run(
    createWebSocket(getServerUrl("close"), {
      schedule: take(2)(spaced("1ms")),
      shouldRetryOnClose: () => false,
      onClose: () => {
        closeCount++;
      },
      onError: (error) => {
        errors.push(error);
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(closeCount).toBe(1));
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(closeCount).toBe(1);
  expect(errors).toHaveLength(0);

  await ws[Symbol.asyncDispose]();
});

wsTest("reconnects after server closes connection", async () => {
  await using run = createRunner();

  const messages: Array<Uint8Array> = [];
  let closeCount = 0;

  const result = await run(
    createWebSocket(getServerUrl("close-after-message"), {
      binaryType: "arraybuffer",
      schedule: spaced("1ms"),
      onMessage: (data) => {
        assert(data instanceof ArrayBuffer);
        messages.push(new Uint8Array(data));
      },
      onClose: () => {
        closeCount++;
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(messages).toHaveLength(1));
  ws.send("trigger-close");

  await vi.waitFor(() => expect(messages.length).toBeGreaterThanOrEqual(2));
  expect(closeCount).toBeGreaterThan(0);

  await ws[Symbol.asyncDispose]();
});

wsTest("reports RetryError when schedule is exhausted", async () => {
  await using run = createRunner();

  const errors: Array<WebSocketError> = [];

  const result = await run(
    createWebSocket(getServerUrl("close"), {
      schedule: take(2)(spaced("1ms")),
      onError: (error) => {
        errors.push(error);
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
  expect(errors.map((e) => e.type)).toMatchInlineSnapshot(`
    [
      "RetryError",
    ]
  `);

  await ws[Symbol.asyncDispose]();
});

wsTest("WebSocketConnectionError behavior on abrupt termination", async () => {
  await using run = createRunner();

  const errors: Array<WebSocketError> = [];
  let closeCalled = false;

  const result = await run(
    createWebSocket(getServerUrl("terminate"), {
      schedule: take(0)(spaced("1ms")),
      onError: (error) => {
        errors.push(error);
      },
      onClose: () => {
        closeCalled = true;
      },
    }),
  );

  assert(result.ok);
  const ws = result.value;

  await vi.waitFor(() => expect(closeCalled).toBe(true), { timeout: 2000 });

  const mapped = errors.map((e) =>
    e.type === "RetryError"
      ? { type: e.type, attempts: e.attempts, causeType: e.cause.type }
      : { type: e.type },
  );

  const isWebKit =
    !isServer &&
    (await import("vitest/browser").then((m) => m.server.browser === "webkit"));

  if (isWebKit) {
    expect(mapped).toMatchInlineSnapshot(`
      [
        {
          "type": "WebSocketConnectionError",
        },
        {
          "attempts": 1,
          "causeType": "WebSocketConnectionCloseError",
          "type": "RetryError",
        },
      ]
    `);
  } else {
    expect(mapped).toMatchInlineSnapshot(`
      [
        {
          "attempts": 1,
          "causeType": "WebSocketConnectionCloseError",
          "type": "RetryError",
        },
      ]
    `);
  }

  await ws[Symbol.asyncDispose]();
});
