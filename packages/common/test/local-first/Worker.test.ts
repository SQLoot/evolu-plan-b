import { expect, test, vi } from "vitest";
import { createConsole } from "../../src/Console.js";
import { createUnknownError } from "../../src/Error.js";
import type { ConsoleEntry } from "../../src/index.js";
import type {
  DbWorkerInput,
  DbWorkerLeaderInput,
  DbWorkerLeaderOutput,
  DbWorkerOutput,
} from "../../src/local-first/DbWorkerProtocol.js";
import {
  type EvoluTabOutput,
  type EvoluWorkerInput,
  initEvoluWorker,
  runEvoluWorkerScope,
} from "../../src/local-first/Worker.js";
import { createStore } from "../../src/Store.js";
import { createRun } from "../../src/Task.js";
import { SimpleName } from "../../src/Type.js";
import type {
  CreateMessagePort,
  MessagePort,
  NativeMessagePort,
  SharedWorkerScope,
} from "../../src/Worker.js";

const createTrackedPort = <Input, Output = never>() => {
  let onMessage: ((message: Output) => void) | null = null;
  const sentMessages: Array<Input> = [];
  const native = {} as NativeMessagePort<Input, Output>;

  const port: MessagePort<Input, Output> = {
    postMessage: (message) => {
      sentMessages.push(message);
    },
    get onMessage() {
      return onMessage;
    },
    set onMessage(handler) {
      onMessage = handler;
    },
    native,
    [Symbol.dispose]: () => {
      onMessage = null;
    },
  };

  return {
    native,
    port,
    sentMessages,
    emit: (message: Output) => {
      onMessage?.(message);
    },
  };
};

const createWorkerScope = (): SharedWorkerScope<EvoluWorkerInput> => ({
  onConnect: null,
  onError: null,
  [Symbol.dispose]: () => {},
});

test("runEvoluWorkerScope forwards global errors to registered tab port", () => {
  const workerScope = createWorkerScope();
  const workerConnection = createTrackedPort<never, EvoluWorkerInput>();
  const tabPort = createTrackedPort<EvoluTabOutput, never>();

  const createMessagePort: CreateMessagePort = <Input, Output = never>(
    nativePort: NativeMessagePort<Input, Output>,
  ): MessagePort<Input, Output> => {
    if (
      (nativePort as NativeMessagePort<any, any>) ===
      (tabPort.native as NativeMessagePort<any, any>)
    )
      return tabPort.port as unknown as MessagePort<Input, Output>;
    throw new Error("Unexpected native port");
  };

  const console = createConsole();
  const setLevel = vi.spyOn(console, "setLevel");

  runEvoluWorkerScope({
    console,
    createMessagePort,
    runDbWorkerPort: vi.fn(),
  })(workerScope);

  workerScope.onConnect?.(workerConnection.port);
  workerConnection.emit({
    type: "InitTab",
    consoleLevel: "debug",
    port: tabPort.native,
  });

  const error = createUnknownError(new Error("boom"));
  workerScope.onError?.(error);

  expect(setLevel).toHaveBeenCalledWith("debug");
  expect(tabPort.sentMessages).toEqual([{ type: "EvoluError", error }]);
});

test("runEvoluWorkerScope routes InitEvolu port to db worker runner", () => {
  const workerScope = createWorkerScope();
  const workerConnection = createTrackedPort<never, EvoluWorkerInput>();
  const dbPort = createTrackedPort<DbWorkerOutput, DbWorkerInput>();
  const brokerPort = createTrackedPort<
    DbWorkerLeaderOutput,
    DbWorkerLeaderInput
  >();
  const runDbWorkerPort = vi.fn();
  const console = createConsole();

  const createMessagePort: CreateMessagePort = <Input, Output = never>(
    nativePort: NativeMessagePort<Input, Output>,
  ): MessagePort<Input, Output> => {
    if (
      (nativePort as NativeMessagePort<any, any>) ===
      (dbPort.native as NativeMessagePort<any, any>)
    )
      return dbPort.port as unknown as MessagePort<Input, Output>;
    if (
      (nativePort as NativeMessagePort<any, any>) ===
      (brokerPort.native as NativeMessagePort<any, any>)
    )
      return brokerPort.port as unknown as MessagePort<Input, Output>;
    throw new Error("Unexpected native port");
  };

  runEvoluWorkerScope({
    console,
    createMessagePort,
    runDbWorkerPort,
  })(workerScope);

  workerScope.onConnect?.(workerConnection.port);
  const name = SimpleName.orThrow("TestName");
  workerConnection.emit({
    type: "InitEvolu",
    name,
    port1: dbPort.native,
    port2: brokerPort.native,
  });

  expect(runDbWorkerPort).toHaveBeenCalledTimes(1);
  expect(runDbWorkerPort).toHaveBeenCalledWith({
    name,
    consoleLevel: "log",
    port: dbPort.port,
    brokerPort: brokerPort.port,
  });
});

test("initEvoluWorker forwards console store output to tab port", async () => {
  const workerScope = createWorkerScope();
  const workerConnection = createTrackedPort<never, EvoluWorkerInput>();
  const tabPort = createTrackedPort<EvoluTabOutput, never>();
  const entryStore = createStore<ConsoleEntry | null>(null);

  const createMessagePort: CreateMessagePort = <Input, Output = never>(
    nativePort: NativeMessagePort<Input, Output>,
  ): MessagePort<Input, Output> => {
    if (
      (nativePort as NativeMessagePort<any, any>) ===
      (tabPort.native as NativeMessagePort<any, any>)
    )
      return tabPort.port as unknown as MessagePort<Input, Output>;
    throw new Error("Unexpected native port");
  };

  await using run = createRun({
    console: createConsole(),
    consoleStoreOutputEntry: entryStore,
    createMessagePort,
    runDbWorkerPort: vi.fn(),
  });

  const initResult = await run(initEvoluWorker(workerScope));
  expect(initResult.ok).toBe(true);
  if (!initResult.ok) return;

  workerScope.onConnect?.(workerConnection.port);
  workerConnection.emit({
    type: "InitTab",
    consoleLevel: "debug",
    port: tabPort.native,
  });

  const entry: ConsoleEntry = {
    method: "info",
    path: [],
    args: ["forwarded"],
  };
  entryStore.set(entry);

  expect(tabPort.sentMessages).toContainEqual({ type: "ConsoleEntry", entry });
});

test("runEvoluWorkerScope queues output before InitTab and flushes on first tab", () => {
  const workerScope = createWorkerScope();
  const workerConnection = createTrackedPort<never, EvoluWorkerInput>();
  const tabPort = createTrackedPort<EvoluTabOutput, never>();

  const createMessagePort: CreateMessagePort = <Input, Output = never>(
    nativePort: NativeMessagePort<Input, Output>,
  ): MessagePort<Input, Output> => {
    if (
      (nativePort as NativeMessagePort<any, any>) ===
      (tabPort.native as NativeMessagePort<any, any>)
    )
      return tabPort.port as unknown as MessagePort<Input, Output>;
    throw new Error("Unexpected native port");
  };

  const console = createConsole();
  const { postTabOutput } = runEvoluWorkerScope({
    console,
    createMessagePort,
    runDbWorkerPort: vi.fn(),
  })(workerScope);

  postTabOutput({
    type: "ConsoleEntry",
    entry: { method: "info", path: [], args: ["queued"] },
  });

  workerScope.onConnect?.(workerConnection.port);
  workerConnection.emit({
    type: "InitTab",
    consoleLevel: "debug",
    port: tabPort.native,
  });

  expect(tabPort.sentMessages).toEqual([
    {
      type: "ConsoleEntry",
      entry: { method: "info", path: [], args: ["queued"] },
    },
  ]);
});

test("runEvoluWorkerScope broadcasts output to all registered tabs", () => {
  const workerScope = createWorkerScope();
  const workerConnection = createTrackedPort<never, EvoluWorkerInput>();
  const tabPortA = createTrackedPort<EvoluTabOutput, never>();
  const tabPortB = createTrackedPort<EvoluTabOutput, never>();

  const createMessagePort: CreateMessagePort = <Input, Output = never>(
    nativePort: NativeMessagePort<Input, Output>,
  ): MessagePort<Input, Output> => {
    if (
      (nativePort as NativeMessagePort<any, any>) ===
      (tabPortA.native as NativeMessagePort<any, any>)
    )
      return tabPortA.port as unknown as MessagePort<Input, Output>;
    if (
      (nativePort as NativeMessagePort<any, any>) ===
      (tabPortB.native as NativeMessagePort<any, any>)
    )
      return tabPortB.port as unknown as MessagePort<Input, Output>;
    throw new Error("Unexpected native port");
  };

  const console = createConsole();
  const { postTabOutput } = runEvoluWorkerScope({
    console,
    createMessagePort,
    runDbWorkerPort: vi.fn(),
  })(workerScope);

  workerScope.onConnect?.(workerConnection.port);
  workerConnection.emit({
    type: "InitTab",
    consoleLevel: "debug",
    port: tabPortA.native,
  });
  workerConnection.emit({
    type: "InitTab",
    consoleLevel: "debug",
    port: tabPortB.native,
  });

  const output: EvoluTabOutput = {
    type: "ConsoleEntry",
    entry: { method: "warn", path: [], args: ["fanout"] },
  };
  postTabOutput(output);

  expect(tabPortA.sentMessages).toContainEqual(output);
  expect(tabPortB.sentMessages).toContainEqual(output);
});
