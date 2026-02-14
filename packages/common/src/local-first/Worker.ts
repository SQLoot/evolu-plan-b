/**
 * SharedWorker integration for Evolu.
 *
 * @module
 */

import type { ConsoleEntry } from "../Console.js";
import { exhaustiveCheck } from "../Function.js";
import { ok } from "../Result.js";
import type { Task } from "../Task.js";
import type {
  SharedWorker as CommonSharedWorker,
  CreateMessagePortDep,
  SharedWorkerScope as EvoluWorkerScope,
  MessagePort,
  NativeMessagePort,
} from "../Worker.js";
import type { DbWorkerInput, DbWorkerOutput } from "./DbWorkerProtocol.js";
import type { EvoluError } from "./Error.js";

export type EvoluWorker = CommonSharedWorker<EvoluWorkerInput>;

export interface EvoluWorkerDep {
  readonly evoluWorker: EvoluWorker;
}

export type EvoluWorkerInput =
  | {
      readonly type: "InitTab";
      readonly port: NativeMessagePort;
    }
  | {
      readonly type: "InitEvolu";
      readonly port: NativeMessagePort;
    };

export type EvoluTabOutput =
  | {
      readonly type: "ConsoleEntry";
      readonly entry: ConsoleEntry;
    }
  | {
      readonly type: "EvoluError";
      readonly error: EvoluError;
    };

export interface RunDbWorkerPortDep {
  readonly runDbWorkerPort: (
    port: MessagePort<DbWorkerOutput, DbWorkerInput>,
  ) => void;
}

export const runEvoluWorkerScope =
  (deps: CreateMessagePortDep & RunDbWorkerPortDep) =>
  (self: EvoluWorkerScope<EvoluWorkerInput>): void => {
    const tabPorts = new Set<MessagePort<EvoluTabOutput>>();
    const queuedTabOutputs: Array<EvoluTabOutput> = [];

    const postTabOutput = (output: EvoluTabOutput): void => {
      if (tabPorts.size === 0) {
        queuedTabOutputs.push(output);
        return;
      }
      for (const port of tabPorts) port.postMessage(output);
    };

    self.onError = (error) => {
      postTabOutput({ type: "EvoluError", error });
    };

    self.onConnect = (port) => {
      port.onMessage = (message) => {
        switch (message.type) {
          case "InitTab": {
            const tabPort = deps.createMessagePort<EvoluTabOutput>(
              message.port,
            );
            tabPorts.add(tabPort);

            if (queuedTabOutputs.length > 0) {
              for (const output of queuedTabOutputs)
                tabPort.postMessage(output);
              queuedTabOutputs.length = 0;
            }
            break;
          }
          case "InitEvolu": {
            deps.runDbWorkerPort(
              deps.createMessagePort<DbWorkerOutput, DbWorkerInput>(
                message.port,
              ),
            );
            break;
          }
          default:
            exhaustiveCheck(message);
        }
      };
    };
  };

/**
 * Initializes Evolu worker handlers in a Task-based style.
 *
 * @deprecated Use platform-specific worker run helpers where available.
 */
export const initEvoluWorker =
  (
    self: EvoluWorkerScope<EvoluWorkerInput>,
  ): Task<void, never, CreateMessagePortDep & RunDbWorkerPortDep> =>
  (run) => {
    runEvoluWorkerScope(run.deps)(self);
    return ok();
  };
