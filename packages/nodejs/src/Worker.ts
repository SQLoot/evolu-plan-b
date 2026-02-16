/**
 * Node.js-specific Worker and MessageChannel utilities.
 *
 * @module
 */

import {
  MessageChannel as NodeMessageChannel,
  type MessagePort as NodeMessagePort,
  Worker as NodeWorker,
  type TransferListItem,
  parentPort as workerParentPort,
} from "node:worker_threads";
import type {
  CreateMessagePort,
  MessageChannel,
  MessagePort,
  NativeMessagePort,
  Transferable,
  Worker,
  WorkerScope,
  WorkerSelf,
} from "@evolu/common";
import { assert, handleGlobalError } from "@evolu/common";

/** Creates an Evolu {@link Worker} from Node.js `worker_threads.Worker`. */
export const createWorker = <Input, Output>(
  nativeWorker: NodeWorker,
): Worker<Input, Output> => wrap(nativeWorker);

/**
 * Creates a {@link MessageChannel} from Node.js `worker_threads.MessageChannel`.
 */
export const createMessageChannel = <Input, Output = never>(): MessageChannel<
  Input,
  Output
> => {
  const nativeChannel = new NodeMessageChannel();
  const stack = new DisposableStack();

  return {
    port1: stack.use(wrap<Input, Output>(nativeChannel.port1)),
    port2: stack.use(wrap<Output, Input>(nativeChannel.port2)),
    [Symbol.dispose]: () => {
      stack.dispose();
    },
  };
};

/** Creates an Evolu {@link MessagePort} from Node.js native message port. */
export const createMessagePort: CreateMessagePort = (nativePort) =>
  wrap(nativePort as unknown as NodeMessagePort);

/**
 * Creates an Evolu {@link WorkerSelf} inside a Node.js worker thread.
 *
 * By default it uses `worker_threads.parentPort`.
 */
export const createWorkerSelf = <Input, Output = never>(
  nativeParentPort: NodeMessagePort | null = workerParentPort,
): WorkerSelf<Input, Output> => {
  assert(
    nativeParentPort != null,
    "parentPort is null; createWorkerSelf must run inside a worker thread or receive explicit parent port",
  );
  return wrap<Output, Input>(nativeParentPort);
};

/**
 * @deprecated Use {@link createWorkerSelf}. Retained for backwards compatibility.
 */
export const createWorkerScope = <Input, Output = never>(
  nativeParentPort: NodeMessagePort | null = workerParentPort,
): WorkerScope<Input, Output> => {
  const stack = new DisposableStack();
  const self = stack.use(createWorkerSelf<Input, Output>(nativeParentPort));

  const scope: WorkerScope<Input, Output> = {
    ...self,
    onError: null,
    [Symbol.dispose]: () => {
      stack.dispose();
    },
  };

  const uncaughtExceptionHandler = (error: unknown) => {
    handleGlobalError(scope, error);
  };

  const unhandledRejectionHandler = (reason: unknown) => {
    handleGlobalError(scope, reason);
  };

  process.on("uncaughtException", uncaughtExceptionHandler);
  process.on("unhandledRejection", unhandledRejectionHandler);

  stack.defer(() => {
    process.off("uncaughtException", uncaughtExceptionHandler);
    process.off("unhandledRejection", unhandledRejectionHandler);
  });

  return scope;
};

const wrap = <Input, Output>(
  native: NodeWorker | NodeMessagePort,
): MessagePort<Input, Output> => {
  let port: MessagePort<Input, Output>;

  const onNativeMessage = (message: Output) => {
    assert(
      port.onMessage != null,
      "onMessage must be set before receiving messages",
    );
    port.onMessage(message);
  };

  port = {
    postMessage: (message: Input, transfer?: ReadonlyArray<Transferable>) => {
      if (transfer == null) native.postMessage(message);
      else native.postMessage(message, toTransferList(transfer));
    },
    onMessage: null,
    native: native as unknown as NativeMessagePort<Input, Output>,
    [Symbol.dispose]: () => {
      port.onMessage = null;
      native.off("message", onNativeMessage);
      if (native instanceof NodeWorker) void native.terminate();
      else native.close();
    },
  };

  native.on("message", onNativeMessage);

  return port;
};

const toTransferList = (
  transfer: ReadonlyArray<Transferable>,
): Array<TransferListItem> =>
  transfer.map((item) =>
    item instanceof ArrayBuffer ? item : (item as unknown as NodeMessagePort),
  );
