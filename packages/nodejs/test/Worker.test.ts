import {
  MessageChannel as NodeMessageChannel,
  Worker as NodeWorker,
} from "node:worker_threads";
import { expect, test, vi } from "vitest";
import {
  createMessageChannel,
  createMessagePort,
  createWorker,
  createWorkerScope,
  createWorkerSelf,
} from "../src/Worker.js";

test("createMessageChannel forwards messages both directions", async () => {
  const channel = createMessageChannel<
    { readonly ping: string },
    { readonly pong: number }
  >();

  const pingPromise = new Promise<{ readonly ping: string }>((resolve) => {
    channel.port2.onMessage = resolve;
  });
  channel.port1.postMessage({ ping: "hello" });
  await expect(pingPromise).resolves.toEqual({ ping: "hello" });

  const pongPromise = new Promise<{ readonly pong: number }>((resolve) => {
    channel.port1.onMessage = resolve;
  });
  channel.port2.postMessage({ pong: 42 });
  await expect(pongPromise).resolves.toEqual({ pong: 42 });

  channel[Symbol.dispose]();
});

test("createMessagePort wraps native Node MessagePort", async () => {
  const nativeChannel = new NodeMessageChannel();
  const port = createMessagePort<
    { readonly ack: true },
    { readonly value: number }
  >(nativeChannel.port1 as never);

  const incoming = new Promise<{ readonly value: number }>((resolve) => {
    port.onMessage = resolve;
  });
  nativeChannel.port2.postMessage({ value: 7 });
  await expect(incoming).resolves.toEqual({ value: 7 });

  const outgoing = new Promise<{ readonly ack: true }>((resolve) => {
    nativeChannel.port2.once("message", (message) => {
      resolve(message as { readonly ack: true });
    });
  });
  port.postMessage({ ack: true });
  await expect(outgoing).resolves.toEqual({ ack: true });

  port[Symbol.dispose]();
  nativeChannel.port2.close();
});

test("createWorker wraps worker_threads Worker", async () => {
  const nativeWorker = new NodeWorker(
    `
      const { parentPort } = require("node:worker_threads");
      parentPort.on("message", (message) => {
        parentPort.postMessage({ doubled: message.value * 2 });
      });
    `,
    { eval: true },
  );

  const worker = createWorker<
    { readonly value: number },
    { readonly doubled: number }
  >(nativeWorker);

  const response = new Promise<{ readonly doubled: number }>((resolve) => {
    worker.onMessage = resolve;
  });
  worker.postMessage({ value: 21 });
  await expect(response).resolves.toEqual({ doubled: 42 });

  worker[Symbol.dispose]();
});

test("createWorkerSelf supports message exchange with explicit parent port", async () => {
  const nativeChannel = new NodeMessageChannel();
  const self = createWorkerSelf<
    { readonly fromMain: string },
    { readonly fromSelf: string }
  >(nativeChannel.port1);

  const fromMain = new Promise<{ readonly fromMain: string }>((resolve) => {
    self.onMessage = resolve;
  });
  nativeChannel.port2.postMessage({ fromMain: "hello" });
  await expect(fromMain).resolves.toEqual({ fromMain: "hello" });

  const fromSelf = new Promise<{ readonly fromSelf: string }>((resolve) => {
    nativeChannel.port2.once("message", (message) => {
      resolve(message as { readonly fromSelf: string });
    });
  });
  self.postMessage({ fromSelf: "pong" });
  await expect(fromSelf).resolves.toEqual({ fromSelf: "pong" });

  self[Symbol.dispose]();
  nativeChannel.port2.close();
});

test("createWorkerSelf throws when parent port is null", () => {
  expect(() => createWorkerSelf(null)).toThrow(
    "parentPort is null; createWorkerSelf must run inside a worker thread or receive explicit parent port",
  );
});

test("createWorkerScope wraps createWorkerSelf and is disposable", () => {
  const nativeChannel = new NodeMessageChannel();
  const scope = createWorkerScope<
    { readonly fromMain: string },
    { readonly fromSelf: string }
  >(nativeChannel.port1);

  expect(scope.onError).toBeNull();
  scope[Symbol.dispose]();
  nativeChannel.port2.close();
});

test("createMessagePort supports transfer list with ArrayBuffer", async () => {
  const nativeChannel = new NodeMessageChannel();
  const port = createMessagePort<
    { readonly payload: ArrayBuffer },
    { readonly payload: ArrayBuffer }
  >(nativeChannel.port1 as never);

  const payload = new ArrayBuffer(4);
  const view = new Uint8Array(payload);
  view.set([1, 2, 3, 4]);

  const outgoing = new Promise<{ readonly payload: ArrayBuffer }>((resolve) => {
    nativeChannel.port2.once("message", (message) => {
      resolve(message as { readonly payload: ArrayBuffer });
    });
  });

  port.postMessage({ payload }, [payload]);
  const received = await outgoing;
  expect(new Uint8Array(received.payload)).toEqual(
    new Uint8Array([1, 2, 3, 4]),
  );

  port[Symbol.dispose]();
  nativeChannel.port2.close();
});

test("createMessagePort supports transfer list with MessagePort", async () => {
  const nativeChannel = new NodeMessageChannel();
  const transferChannel = new NodeMessageChannel();
  const port = createMessagePort<
    { readonly transferredPort: NodeMessageChannel["port1"] },
    { readonly transferredPort: NodeMessageChannel["port1"] }
  >(nativeChannel.port1 as never);

  const outgoing = new Promise<{
    readonly transferredPort: NodeMessageChannel["port1"];
  }>((resolve) => {
    nativeChannel.port2.once("message", (message) => {
      resolve(
        message as { readonly transferredPort: NodeMessageChannel["port1"] },
      );
    });
  });

  port.postMessage({ transferredPort: transferChannel.port1 }, [
    transferChannel.port1 as never,
  ]);
  const received = await outgoing;
  expect(received.transferredPort).toBeDefined();

  port[Symbol.dispose]();
  nativeChannel.port2.close();
  transferChannel.port2.close();
});

test("createWorkerScope forwards process errors and detaches handlers on dispose", () => {
  const nativeChannel = new NodeMessageChannel();
  const uncaughtBefore = process.listenerCount("uncaughtException");
  const unhandledBefore = process.listenerCount("unhandledRejection");
  const scope = createWorkerScope<
    { readonly fromMain: string },
    { readonly fromSelf: string }
  >(nativeChannel.port1);
  expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore + 1);
  expect(process.listenerCount("unhandledRejection")).toBe(unhandledBefore + 1);

  const onError = vi.fn();
  scope.onError = onError;

  const uncaught = new Error("uncaught");
  const rejected = new Error("rejected");
  process.emit("uncaughtException", uncaught);
  process.emit("unhandledRejection", rejected, Promise.resolve());
  expect(onError).toHaveBeenCalledTimes(2);

  scope[Symbol.dispose]();
  expect(process.listenerCount("uncaughtException")).toBe(uncaughtBefore);
  expect(process.listenerCount("unhandledRejection")).toBe(unhandledBefore);

  nativeChannel.port2.close();
});
