import type { MessagePort } from "@evolu/common";
import { describe, expect, test, vi } from "vitest";
import {
  createMessageChannel,
  createMessagePort,
  createSharedWorker,
  createSharedWorkerScope,
  createSharedWorkerSelf,
  createWorker,
  createWorkerRun,
  createWorkerScope,
  createWorkerSelf,
} from "../src/Worker.js";

const createInlineWorkerUrl = (): string => {
  const code = `
    self.onmessage = (event) => {
      self.postMessage({ echo: event.data });
    };
  `;
  return URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
};

const createFakeWorkerSelf = () => {
  const listeners = {
    error: new Set<(event: ErrorEvent) => void>(),
    unhandledrejection: new Set<(event: PromiseRejectionEvent) => void>(),
  };

  const nativeSelf = {
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(
      (type: "error" | "unhandledrejection", listener: unknown) => {
        listeners[type].add(listener as never);
      },
    ),
    removeEventListener: vi.fn(
      (type: "error" | "unhandledrejection", listener: unknown) => {
        listeners[type].delete(listener as never);
      },
    ),
  };

  return {
    nativeSelf,
    emitMessage: (data: unknown) => {
      nativeSelf.onmessage?.({ data } as MessageEvent<unknown>);
    },
    emitError: (error: Error) => {
      for (const listener of listeners.error) {
        listener({ error } as ErrorEvent);
      }
    },
    emitUnhandledRejection: (reason: unknown) => {
      for (const listener of listeners.unhandledrejection) {
        listener({ reason } as PromiseRejectionEvent);
      }
    },
  };
};

const createFakeSharedWorkerSelf = () => {
  const listeners = {
    error: new Set<(event: ErrorEvent) => void>(),
    unhandledrejection: new Set<(event: PromiseRejectionEvent) => void>(),
  };

  const nativeSelf = {
    onconnect: null as ((event: MessageEvent) => void) | null,
    close: vi.fn(),
    addEventListener: vi.fn(
      (type: "error" | "unhandledrejection", listener: unknown) => {
        listeners[type].add(listener as never);
      },
    ),
    removeEventListener: vi.fn(
      (type: "error" | "unhandledrejection", listener: unknown) => {
        listeners[type].delete(listener as never);
      },
    ),
  };

  return {
    nativeSelf,
    emitConnect: (port: globalThis.MessagePort) => {
      nativeSelf.onconnect?.({ ports: [port] } as unknown as MessageEvent);
    },
    emitError: (error: Error) => {
      for (const listener of listeners.error) {
        listener({ error } as ErrorEvent);
      }
    },
    emitUnhandledRejection: (reason: unknown) => {
      for (const listener of listeners.unhandledrejection) {
        listener({ reason } as PromiseRejectionEvent);
      }
    },
  };
};

describe("Worker wrappers", () => {
  test("createMessageChannel forwards messages both directions", async () => {
    const channel = createMessageChannel<
      { readonly ping: string },
      { readonly pong: number }
    >();

    const ping = new Promise<{ readonly ping: string }>((resolve) => {
      channel.port2.onMessage = resolve;
    });
    channel.port1.postMessage({ ping: "hello" });
    await expect(ping).resolves.toEqual({ ping: "hello" });

    const pong = new Promise<{ readonly pong: number }>((resolve) => {
      channel.port1.onMessage = resolve;
    });
    channel.port2.postMessage({ pong: 42 });
    await expect(pong).resolves.toEqual({ pong: 42 });

    channel[Symbol.dispose]();
  });

  test("createMessagePort supports normal and transfer-list postMessage", async () => {
    const native = new MessageChannel();
    const port = createMessagePort<
      { readonly payload: Uint8Array | ArrayBuffer },
      { readonly ok: true }
    >(native.port1 as never);

    const normal = new Promise<{ readonly payload: Uint8Array }>((resolve) => {
      native.port2.onmessage = (event) => {
        resolve(event.data as { readonly payload: Uint8Array });
      };
    });
    port.postMessage({ payload: new Uint8Array([1, 2, 3]) });
    await expect(normal).resolves.toEqual({ payload: new Uint8Array([1, 2, 3]) });

    const buffer = new ArrayBuffer(4);
    new Uint8Array(buffer).set([9, 8, 7, 6]);
    const transferred = new Promise<{ readonly payload: ArrayBuffer }>(
      (resolve) => {
        native.port2.onmessage = (event) => {
          resolve(event.data as { readonly payload: ArrayBuffer });
        };
      },
    );
    port.postMessage({ payload: buffer }, [buffer]);
    const transferredValue = await transferred;
    expect(new Uint8Array(transferredValue.payload)).toEqual(
      new Uint8Array([9, 8, 7, 6]),
    );

    port[Symbol.dispose]();
    native.port2.close();
  });

  test("createWorker wraps native worker and disposes via terminate", async () => {
    const url = createInlineWorkerUrl();
    try {
      const nativeWorker = new Worker(url);
      const worker = createWorker<
        { readonly value: string },
        { readonly echo: { readonly value: string } }
      >(nativeWorker);

      const response = new Promise<{ readonly echo: { readonly value: string } }>(
        (resolve) => {
          worker.onMessage = resolve;
        },
      );
      worker.postMessage({ value: "ok" });
      await expect(response).resolves.toEqual({ echo: { value: "ok" } });

      worker[Symbol.dispose]();
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  test("createSharedWorker wraps provided shared worker port", async () => {
    const channel = new MessageChannel();
    const shared = createSharedWorker<{ readonly ping: number }, { readonly pong: number }>(
      { port: channel.port1 } as unknown as globalThis.SharedWorker,
    );

    const response = new Promise<{ readonly ping: number }>((resolve) => {
      shared.port.onMessage = resolve;
    });
    channel.port2.postMessage({ ping: 10 });
    await expect(response).resolves.toEqual({ ping: 10 });

    shared[Symbol.dispose]();
    channel.port2.close();
  });

  test("createWorkerSelf enforces onMessage before receiving messages", () => {
    const fake = createFakeWorkerSelf();
    const self = createWorkerSelf<{ readonly input: string }, { readonly output: string }>(
      fake.nativeSelf as unknown as globalThis.DedicatedWorkerGlobalScope,
    );

    expect(() => fake.emitMessage({ input: "x" })).toThrow(
      "onMessage must be set before receiving messages",
    );

    const onMessage = vi.fn();
    self.onMessage = onMessage;
    fake.emitMessage({ input: "ok" });
    expect(onMessage).toHaveBeenCalledWith({ input: "ok" });

    self.postMessage({ output: "pong" });
    expect(fake.nativeSelf.postMessage).toHaveBeenCalledWith({ output: "pong" });

    self[Symbol.dispose]();
    expect(fake.nativeSelf.close).toHaveBeenCalledTimes(1);
  });

  test("createSharedWorkerSelf enforces onConnect and wraps connecting ports", async () => {
    const fake = createFakeSharedWorkerSelf();
    const self = createSharedWorkerSelf<
      { readonly fromClient: string },
      { readonly fromWorker: string }
    >(fake.nativeSelf as unknown as globalThis.SharedWorkerGlobalScope);

    const nativeChannel = new MessageChannel();
    expect(() => fake.emitConnect(nativeChannel.port1)).toThrow(
      "onConnect must be set before receiving connections",
    );

    const onConnect = vi.fn();
    self.onConnect = onConnect;
    fake.emitConnect(nativeChannel.port1);
    expect(onConnect).toHaveBeenCalledTimes(1);

    const wrappedPort = onConnect.mock.calls[0]?.[0] as MessagePort<
      { readonly fromWorker: string },
      { readonly fromClient: string }
    >;
    wrappedPort.postMessage({ fromWorker: "hello" });

    const received = new Promise<{ readonly fromWorker: string }>((resolve) => {
      nativeChannel.port2.onmessage = (event) => {
        resolve(event.data as { readonly fromWorker: string });
      };
    });
    await expect(received).resolves.toEqual({ fromWorker: "hello" });

    self[Symbol.dispose]();
    expect(fake.nativeSelf.close).toHaveBeenCalledTimes(1);
    nativeChannel.port2.close();
  });

  test("createWorkerRun provides createMessagePort and console deps", async () => {
    await using run = createWorkerRun();
    const native = new MessageChannel();
    const port = run.deps.createMessagePort<
      { readonly ack: true },
      { readonly value: number }
    >(native.port1 as never);

    const incoming = new Promise<{ readonly value: number }>((resolve) => {
      port.onMessage = resolve;
    });
    native.port2.postMessage({ value: 7 });
    await expect(incoming).resolves.toEqual({ value: 7 });
    expect(run.deps.consoleStoreOutputEntry).toBeDefined();

    port[Symbol.dispose]();
    native.port2.close();
  });

  test("deprecated createWorkerScope wires error handlers and disposes", () => {
    const fake = createFakeWorkerSelf();
    const scope = createWorkerScope<
      { readonly input: string },
      { readonly output: string }
    >(fake.nativeSelf as unknown as globalThis.DedicatedWorkerGlobalScope);

    const onError = vi.fn();
    scope.onError = onError;

    fake.emitError(new Error("boom"));
    fake.emitUnhandledRejection(new Error("rejected"));
    expect(onError).toHaveBeenCalledTimes(2);

    scope[Symbol.dispose]();
    expect(fake.nativeSelf.close).toHaveBeenCalledTimes(1);
  });

  test("deprecated createSharedWorkerScope wires connect/error handlers and disposes", () => {
    const fake = createFakeSharedWorkerSelf();
    const scope = createSharedWorkerScope<
      { readonly fromClient: string },
      { readonly fromWorker: string }
    >(fake.nativeSelf as unknown as globalThis.SharedWorkerGlobalScope);

    const onConnect = vi.fn();
    const onError = vi.fn();
    scope.onConnect = onConnect;
    scope.onError = onError;

    const nativeChannel = new MessageChannel();
    fake.emitConnect(nativeChannel.port1);
    expect(onConnect).toHaveBeenCalledTimes(1);

    fake.emitError(new Error("boom"));
    fake.emitUnhandledRejection(new Error("rejected"));
    expect(onError).toHaveBeenCalledTimes(2);

    scope[Symbol.dispose]();
    expect(fake.nativeSelf.close).toHaveBeenCalledTimes(1);
    nativeChannel.port2.close();
  });
});
