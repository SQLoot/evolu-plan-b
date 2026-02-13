import {
  MessageChannel as NodeMessageChannel,
  Worker as NodeWorker,
} from "node:worker_threads";
import { expect, test } from "vitest";
import {
  createMessageChannel,
  createMessagePort,
  createWorker,
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
