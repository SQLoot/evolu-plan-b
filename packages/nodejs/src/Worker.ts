import type {
  CreateMessagePort,
  MessageChannel,
  NativeMessagePort,
  Worker,
  WorkerSelf,
} from "@evolu/common";

const createNotImplementedError = (api: string): Error =>
  new Error(
    `${api} is not implemented in @evolu/nodejs yet. ` +
      "TODO(#node-worker-threads): implement via node:worker_threads.",
  );

/**
 * Node.js Worker API placeholder.
 *
 * TODO(#node-worker-threads): implement dedicated worker support via
 * `node:worker_threads`.
 */
export const createWorker = <Input, Output = never>(
  _initWorker: (self: WorkerSelf<Input, Output>) => void,
): Worker<Input, Output> => {
  throw createNotImplementedError("createWorker");
};

/**
 * Node.js MessageChannel API placeholder.
 *
 * TODO(#node-worker-threads): implement message channels via
 * `node:worker_threads`.
 */
export const createMessageChannel = <Input, Output = never>(): MessageChannel<
  Input,
  Output
> => {
  throw createNotImplementedError("createMessageChannel");
};

/**
 * Node.js MessagePort adapter placeholder.
 *
 * TODO(#node-worker-threads): implement message port wrapping via
 * `node:worker_threads`.
 */
export const createMessagePort: CreateMessagePort = (_nativePort) => {
  throw createNotImplementedError("createMessagePort");
};

/**
 * Node.js worker self placeholder.
 *
 * TODO(#node-worker-threads): implement worker scope wrapper for
 * `worker_threads`.
 */
export const createWorkerSelf = <Input, Output = never>(
  _nativeSelf: unknown,
): WorkerSelf<Input, Output> => {
  throw createNotImplementedError("createWorkerSelf");
};

/**
 * Backward-compatible alias for legacy imports.
 *
 * TODO(#node-worker-threads): remove this alias once worker scope API is fully
 * consolidated.
 */
export const createWorkerScope = <Input, Output = never>(
  nativeSelf: NativeMessagePort<Output, Input> | unknown,
): WorkerSelf<Input, Output> => createWorkerSelf(nativeSelf);
