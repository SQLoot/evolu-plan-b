/**
 * Platform-agnostic Evolu Worker.
 *
 * @module
 */

import {
  emptyArray,
  firstInArray,
  isNonEmptyArray,
  type NonEmptyReadonlyArray,
  shiftFromArray,
} from "../Array.js";
import { assert } from "../Assert.js";
import { createCallbacks } from "../Callbacks.js";
import type { Console, ConsoleEntry, ConsoleLevel } from "../Console.js";
import { exhaustiveCheck } from "../Function.js";
import { createInstances } from "../Instances.js";
import { ok } from "../Result.js";
import { spaced } from "../Schedule.js";
import type { NonEmptyReadonlySet } from "../Set.js";
import { type Fiber, type Run, repeat, type Task } from "../Task.js";
import type { Millis, TimeDep } from "../Time.js";
import { createId, type Id, type Name } from "../Type.js";
import type { Callback, ExtractType } from "../Types.js";
import type {
  SharedWorker as CommonSharedWorker,
  MessagePort,
  NativeMessagePort,
  SharedWorkerSelf,
  WorkerDeps,
} from "../Worker.js";
import type { EvoluError } from "./Error.js";
import type { OwnerId } from "./Owner.js";
import {
  makePatches,
  type Patch,
  type Query,
  type RowsByQueryMap,
} from "./Query.js";
import type { MutationChange } from "./Schema.js";
import type { CrdtMessage } from "./Storage.js";

export type SharedWorker = CommonSharedWorker<SharedWorkerInput>;

export interface SharedWorkerDep {
  readonly sharedWorker: SharedWorker;
}

export type SharedWorkerInput =
  | {
      readonly type: "InitTab";
      readonly consoleLevel: ConsoleLevel;
      readonly port: NativeMessagePort<EvoluTabOutput>;
    }
  | {
      readonly type: "CreateEvolu";
      readonly name: Name;
      readonly evoluPort: NativeMessagePort<EvoluOutput, EvoluInput>;
      readonly dbWorkerPort: NativeMessagePort<DbWorkerInput, DbWorkerOutput>;
    };

export type EvoluTabOutput =
  | {
      readonly type: "OnConsoleEntry";
      readonly entry: ConsoleEntry;
    }
  | {
      readonly type: "OnError";
      readonly error: EvoluError;
    };

export type EvoluInput =
  | {
      readonly type: "Mutate";
      readonly changes: NonEmptyReadonlyArray<MutationChange>;
      readonly onCompleteIds: ReadonlyArray<Id>;
      readonly subscribedQueries: ReadonlySet<Query>;
    }
  | {
      readonly type: "Query";
      readonly queries: NonEmptyReadonlySet<Query>;
    }
  | {
      readonly type: "Export";
    }
  | {
      readonly type: "Dispose";
    };

export type EvoluOutput =
  | {
      readonly type: "OnPatchesByQuery";
      readonly patchesByQuery: ReadonlyMap<Query, ReadonlyArray<Patch>>;
      readonly onCompleteIds: ReadonlyArray<Id>;
    }
  | {
      readonly type: "RefreshQueries";
    }
  | {
      readonly type: "OnExport";
      readonly file: Uint8Array<ArrayBuffer>;
    };

export const initSharedWorker =
  (
    self: SharedWorkerSelf<SharedWorkerInput>,
  ): Task<AsyncDisposableStack, never, WorkerDeps & TimeDep> =>
  async (run) => {
    const { createMessagePort, consoleStoreOutputEntry } = run.deps;
    const console = run.deps.console.child("SharedWorker");

    const tabPorts = new Set<MessagePort<EvoluTabOutput>>();

    const queuedTabOutputs: Array<EvoluTabOutput> = [];
    const postTabOutput = (output: EvoluTabOutput): void => {
      if (tabPorts.size === 0) queuedTabOutputs.push(output);
      else for (const port of tabPorts) port.postMessage(output);
    };

    await using stack = run.stack();

    // Shared worker instance lifecycle is managed by per-evolu heartbeats.
    const sharedEvolus = stack.use(createInstances<Name, SharedEvolu>());

    const unsubscribeConsoleStoreOutputEntry =
      consoleStoreOutputEntry.subscribe(() => {
        const entry = consoleStoreOutputEntry.get();
        if (entry) postTabOutput({ type: "OnConsoleEntry", entry });
      });
    stack.defer(() => {
      unsubscribeConsoleStoreOutputEntry();
      return ok();
    });

    console.info("initSharedWorker");

    self.onConnect = (port) => {
      console.debug("onConnect");

      port.onMessage = (message) => {
        switch (message.type) {
          case "InitTab": {
            // One SharedWorker serves multiple tabs, so console level is global
            // here. The most recently initialized tab's level wins.
            console.setLevel(message.consoleLevel);

            const tabPort = createMessagePort<EvoluTabOutput>(message.port);
            tabPorts.add(tabPort);
            if (queuedTabOutputs.length > 0) {
              queuedTabOutputs.forEach(postTabOutput);
              queuedTabOutputs.length = 0;
            }
            break;
          }

          case "CreateEvolu": {
            sharedEvolus
              .ensure(message.name, () =>
                createSharedEvolu({
                  run,
                  console,
                  name: message.name,
                  postTabOutput,
                  onDispose: () => {
                    sharedEvolus.delete(message.name);
                  },
                }),
              )
              .addPorts(message.evoluPort, message.dbWorkerPort);
            break;
          }
          default:
            exhaustiveCheck(message);
        }
      };
    };

    return ok(stack.move());
  };

interface SharedEvolu extends Disposable {
  readonly addPorts: (
    evoluPort: NativeMessagePort<EvoluOutput, EvoluInput>,
    dbWorkerPort: NativeMessagePort<DbWorkerInput, DbWorkerOutput>,
  ) => void;
}

export interface DbWorkerQueueItem {
  readonly evoluPortId: Id;
  readonly request: ExtractType<EvoluInput, "Mutate" | "Query" | "Export">;
}

export interface DbWorkerInput extends DbWorkerQueueItem {
  readonly callbackId: Id;
}

export type DbWorkerOutput =
  | {
      readonly type: "LeaderAcquired";
      readonly name: Name;
    }
  | {
      readonly type: "LeaderHeartbeat";
      readonly name: Name;
    }
  | {
      readonly type: "OnQueuedResponse";
      readonly callbackId: Id;
      readonly evoluPortId: Id;
      readonly response: QueuedResponse;
    }
  | EvoluTabOutput;

export type QueuedResponse =
  | {
      readonly type: "Mutate";
      readonly messagesByOwnerId: ReadonlyMap<
        OwnerId,
        NonEmptyReadonlyArray<CrdtMessage>
      >;
      readonly rowsByQuery: RowsByQueryMap;
    }
  | {
      readonly type: "Query";
      readonly rowsByQuery: RowsByQueryMap;
    }
  | {
      readonly type: "Export";
      readonly file: Uint8Array<ArrayBuffer>;
    };

export interface QueuedResult {
  readonly evoluPortId: Id;
  readonly response: QueuedResponse;
}

export const dbWorkerHeartbeatIntervalMs = 5_000;
export const dbWorkerHeartbeatTimeoutMs = 30_000;

// createSharedEvolu could be Task, but Instances doesn't support it yet.
const createSharedEvolu = ({
  run,
  console,
  name,
  postTabOutput,
  onDispose,
}: {
  run: Run<WorkerDeps & TimeDep>;
  console: Console;
  name: Name;
  postTabOutput: Callback<EvoluTabOutput>;
  onDispose: () => void;
}): SharedEvolu => {
  const { createMessagePort } = run.deps;

  const evoluPorts = new Map<Id, MessagePort<EvoluOutput, EvoluInput>>();
  const dbWorkerPorts = new Set<MessagePort<DbWorkerInput, DbWorkerOutput>>();
  const dbWorkerPortByEvoluPortId = new Map<
    Id,
    MessagePort<DbWorkerInput, DbWorkerOutput>
  >();
  const rowsByQueryByEvoluPortId = new Map<Id, RowsByQueryMap>();
  const queue: Array<DbWorkerQueueItem> = [];
  const callbacks = createCallbacks<QueuedResult>(run.deps);

  let activeDbWorkerPort = null as MessagePort<
    DbWorkerInput,
    DbWorkerOutput
  > | null;
  let activeDbWorkerLastHeartbeatAt = 0 as Millis;
  const lastHeartbeatByDbWorkerPort = new Map<
    MessagePort<DbWorkerInput, DbWorkerOutput>,
    Millis
  >();

  let queueProcessingFiber: Fiber<void, never, WorkerDeps & TimeDep> | null =
    null;
  let activeQueueCallback: {
    readonly callbackId: Id;
    readonly evoluPortId: Id;
  } | null = null;

  const dropQueuedRequestsForEvoluPort = (evoluPortId: Id): void => {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i]?.evoluPortId === evoluPortId) queue.splice(i, 1);
    }
  };

  const cancelActiveQueueForEvoluPort = (evoluPortId: Id): void => {
    if (activeQueueCallback?.evoluPortId !== evoluPortId) return;

    callbacks.cancel(activeQueueCallback.callbackId);
    activeQueueCallback = null;
    queueProcessingFiber?.abort();
    queueProcessingFiber = null;

    if (queue[0]?.evoluPortId === evoluPortId) queue.shift();
  };

  const cleanupEvoluPort = (
    evoluPortId: Id,
    disposeDbWorkerPort: boolean,
  ): void => {
    dropQueuedRequestsForEvoluPort(evoluPortId);
    cancelActiveQueueForEvoluPort(evoluPortId);

    const dbWorkerPortForEvolu = dbWorkerPortByEvoluPortId.get(evoluPortId);
    if (dbWorkerPortForEvolu) {
      dbWorkerPortByEvoluPortId.delete(evoluPortId);

      if (disposeDbWorkerPort) {
        dbWorkerPorts.delete(dbWorkerPortForEvolu);

        if (activeDbWorkerPort === dbWorkerPortForEvolu) {
          cancelActiveQueue();
          activeDbWorkerPort = null;
        }

        lastHeartbeatByDbWorkerPort.delete(dbWorkerPortForEvolu);
        dbWorkerPortForEvolu[Symbol.dispose]();
      }
    }

    evoluPorts.delete(evoluPortId);
    rowsByQueryByEvoluPortId.delete(evoluPortId);
  };

  const cancelActiveQueue = (): void => {
    if (activeQueueCallback) {
      callbacks.cancel(activeQueueCallback.callbackId);
      activeQueueCallback = null;
    }
    queueProcessingFiber?.abort();
    queueProcessingFiber = null;
  };

  const markDbWorkerHeartbeat = (
    dbWorkerPort: MessagePort<DbWorkerInput, DbWorkerOutput>,
  ): void => {
    const now = run.deps.time.now();
    lastHeartbeatByDbWorkerPort.set(dbWorkerPort, now);
    if (activeDbWorkerPort === dbWorkerPort)
      activeDbWorkerLastHeartbeatAt = now;
  };

  const setActiveDbWorkerPort = (
    dbWorkerPort: MessagePort<DbWorkerInput, DbWorkerOutput>,
  ): void => {
    activeDbWorkerPort = dbWorkerPort;
    const now = run.deps.time.now();
    activeDbWorkerLastHeartbeatAt = now;
    lastHeartbeatByDbWorkerPort.set(dbWorkerPort, now);
  };

  const clearActiveDbWorkerIfStale = (): void => {
    if (!activeDbWorkerPort) return;
    const elapsed = run.deps.time.now() - activeDbWorkerLastHeartbeatAt;
    if (elapsed <= dbWorkerHeartbeatTimeoutMs) return;

    console.warn("leaderHeartbeatTimeout", {
      name,
      timeoutMs: dbWorkerHeartbeatTimeoutMs,
      elapsedMs: elapsed,
    });
    activeDbWorkerPort = null;
    cancelActiveQueue();
  };

  const pruneStaleDbWorkerPorts = (): void => {
    const now = run.deps.time.now();

    for (const [dbWorkerPort, lastHeartbeatAt] of lastHeartbeatByDbWorkerPort) {
      const elapsed = now - lastHeartbeatAt;
      if (elapsed <= dbWorkerHeartbeatTimeoutMs) continue;

      const wasActive = dbWorkerPort === activeDbWorkerPort;
      if (wasActive) {
        activeDbWorkerPort = null;
        cancelActiveQueue();
      }

      const staleEvoluPortIds: Array<Id> = [];
      for (const [
        evoluPortId,
        mappedDbWorkerPort,
      ] of dbWorkerPortByEvoluPortId) {
        if (mappedDbWorkerPort === dbWorkerPort) {
          staleEvoluPortIds.push(evoluPortId);
        }
      }
      for (const evoluPortId of staleEvoluPortIds) {
        cleanupEvoluPort(evoluPortId, false);
      }

      lastHeartbeatByDbWorkerPort.delete(dbWorkerPort);
      dbWorkerPorts.delete(dbWorkerPort);
      dbWorkerPort[Symbol.dispose]();

      console.warn("prunedStaleDbWorkerPort", {
        name,
        timeoutMs: dbWorkerHeartbeatTimeoutMs,
        elapsedMs: elapsed,
      });

      if (evoluPorts.size === 0) {
        onDispose();
        return;
      }
    }
  };

  const heartbeatFiber = run.daemon(
    repeat(() => {
      pruneStaleDbWorkerPorts();
      clearActiveDbWorkerIfStale();
      return ok();
    }, spaced("1s")),
  );

  const ensureQueueProcessing = (): void => {
    if (
      queueProcessingFiber ||
      !isNonEmptyArray(queue) ||
      !activeDbWorkerPort
    ) {
      return;
    }

    const first = firstInArray(queue);

    const callbackId = callbacks.register(({ evoluPortId, response }) => {
      activeQueueCallback = null;
      queueProcessingFiber?.abort();
      queueProcessingFiber = null;

      const evoluPort = evoluPorts.get(evoluPortId);

      switch (response.type) {
        case "Mutate":
        case "Query": {
          if (evoluPort)
            evoluPort.postMessage({
              type: "OnPatchesByQuery",
              patchesByQuery: createPatchesByQuery(
                evoluPortId,
                response.rowsByQuery,
              ),
              onCompleteIds:
                first.request.type === "Mutate"
                  ? first.request.onCompleteIds
                  : emptyArray,
            });

          if (response.type === "Mutate") {
            for (const [otherEvoluPortId, otherEvoluPort] of evoluPorts) {
              if (otherEvoluPortId === evoluPortId) continue;
              otherEvoluPort.postMessage({ type: "RefreshQueries" });
            }
          }
          break;
        }
        case "Export":
          if (evoluPort)
            evoluPort.postMessage(
              {
                type: "OnExport",
                file: response.file,
              },
              [response.file.buffer],
            );

          break;
        default:
          exhaustiveCheck(response);
      }

      // Complete the current queue item and continue with the next one.
      shiftFromArray(queue);
      ensureQueueProcessing();
    });
    activeQueueCallback = { callbackId, evoluPortId: first.evoluPortId };

    queueProcessingFiber = run.daemon(
      repeat(() => {
        assert(activeDbWorkerPort, "Expected an active DbWorker");
        activeDbWorkerPort.postMessage({ callbackId, ...first });
        return ok();
      }, spaced("5s")), // 5s seems to be a good balance
    );
  };

  const createPatchesByQuery = (
    evoluPortId: Id,
    rowsByQuery: RowsByQueryMap,
  ): ReadonlyMap<Query, ReadonlyArray<Patch>> => {
    const previousRowsByQuery = rowsByQueryByEvoluPortId.get(evoluPortId);
    const nextRowsByQuery = new Map(previousRowsByQuery ?? emptyArray);
    const patchesByQuery = new Map<Query, ReadonlyArray<Patch>>();

    for (const [query, rows] of rowsByQuery) {
      nextRowsByQuery.set(query, rows);
      patchesByQuery.set(
        query,
        makePatches(previousRowsByQuery?.get(query), rows),
      );
    }

    rowsByQueryByEvoluPortId.set(evoluPortId, nextRowsByQuery);
    return patchesByQuery;
  };

  return {
    addPorts: (nativeEvoluPort, nativeDbWorkerPort) => {
      const evoluPort = createMessagePort<EvoluOutput, EvoluInput>(
        nativeEvoluPort,
      );
      const dbWorkerPort = createMessagePort<DbWorkerInput, DbWorkerOutput>(
        nativeDbWorkerPort,
      );

      const evoluPortId = createId(run.deps);

      evoluPorts.set(evoluPortId, evoluPort);
      dbWorkerPorts.add(dbWorkerPort);
      dbWorkerPortByEvoluPortId.set(evoluPortId, dbWorkerPort);

      dbWorkerPort.onMessage = (message) => {
        switch (message.type) {
          case "LeaderAcquired": {
            console.info("leaderAcquired");
            setActiveDbWorkerPort(dbWorkerPort);
            ensureQueueProcessing();
            break;
          }
          case "LeaderHeartbeat": {
            markDbWorkerHeartbeat(dbWorkerPort);
            if (!activeDbWorkerPort) {
              console.info("leaderHeartbeat adopted");
              setActiveDbWorkerPort(dbWorkerPort);
              ensureQueueProcessing();
            }
            break;
          }
          case "OnQueuedResponse": {
            if (dbWorkerPort !== activeDbWorkerPort) {
              console.debug("ignoredQueuedResponseFromInactiveDbWorker");
              break;
            }
            callbacks.execute(message.callbackId, {
              evoluPortId: message.evoluPortId,
              response: message.response,
            });
            break;
          }
          case "OnConsoleEntry":
          case "OnError": {
            postTabOutput(message);
            break;
          }
          default:
            exhaustiveCheck(message);
        }
      };

      evoluPort.onMessage = (evoluMessage) => {
        switch (evoluMessage.type) {
          case "Dispose": {
            console.info("evoluDispose", {
              name,
              evoluPortId,
              hadLastPort: evoluPorts.size === 1,
            });

            cleanupEvoluPort(evoluPortId, true);

            if (activeDbWorkerPort) ensureQueueProcessing();
            if (evoluPorts.size === 0) onDispose();

            break;
          }

          case "Mutate":
          case "Query":
          case "Export": {
            queue.push({ evoluPortId, request: evoluMessage });
            ensureQueueProcessing();
            break;
          }
          default:
            exhaustiveCheck(evoluMessage);
        }
      };
    },

    [Symbol.dispose]: () => {
      heartbeatFiber.abort();
      queueProcessingFiber?.abort();
      queueProcessingFiber = null;
      callbacks[Symbol.dispose]();
      activeQueueCallback = null;
      activeDbWorkerPort = null;
      lastHeartbeatByDbWorkerPort.clear();
      queue.length = 0;
      evoluPorts.clear();
      rowsByQueryByEvoluPortId.clear();
      dbWorkerPortByEvoluPortId.clear();
      dbWorkerPorts.clear();
    },
  };
};

//   | (Typed<"reset"> & {
//       readonly onCompleteId: CallbackId;
//       readonly reload: boolean;
//       readonly restore?: {
//         readonly sqliteSchema: SqliteSchema;
//         readonly mnemonic: Mnemonic;
//       };
//     })
//   | (Typed<"ensureSqliteSchema"> & {
//       readonly sqliteSchema: SqliteSchema;
//     })
//   | (Typed<"export"> & {
//       readonly onCompleteId: CallbackId;
//     })
//   | (Typed<"useOwner"> & {
//       readonly use: boolean;
//       readonly owner: SyncOwner;
//     });
//   | (Typed<"onReset"> & {
//       readonly onCompleteId: CallbackId;
//       readonly reload: boolean;
//     })
