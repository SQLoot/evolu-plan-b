import { expect, test, vi } from "vitest";
import { createUnknownError } from "../../src/Error.js";
import type {
  DbWorkerInput,
  DbWorkerLeaderInput,
  DbWorkerLeaderOutput,
  DbWorkerOutput,
} from "../../src/local-first/DbWorkerProtocol.js";
import {
  type EvoluTabOutput,
  type EvoluWorkerInput,
  runEvoluWorkerScope,
} from "../../src/local-first/Worker.js";
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

  runEvoluWorkerScope({
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
    port: dbPort.port,
    brokerPort: brokerPort.port,
  });
});
