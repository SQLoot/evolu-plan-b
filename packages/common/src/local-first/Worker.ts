/**
 * SharedWorker integration for Evolu.
 *
 * @module
 */

import { exhaustiveCheck } from "../Function.js";
import { ok } from "../Result.js";
import type { Task } from "../Task.js";
import type { Typed } from "../Type.js";
import type {
  SharedWorker as CommonSharedWorker,
  CreateMessagePortDep,
  SharedWorkerScope as EvoluWorkerScope,
  MessagePort,
  NativeMessagePort,
} from "../Worker.js";
import type { EvoluError } from "./Error.js";

export type EvoluWorker = CommonSharedWorker<EvoluWorkerInput>;

export interface EvoluWorkerDep {
  readonly evoluWorker: EvoluWorker;
}

export interface InitErrorStoreMessage extends Typed<"InitErrorStore"> {
  readonly port: NativeMessagePort;
}

export interface InitEvoluMessage extends Typed<"InitEvolu"> {
  readonly port: NativeMessagePort;
}

export type EvoluWorkerInput = InitErrorStoreMessage | InitEvoluMessage;

export const runEvoluWorkerScope =
  (deps: CreateMessagePortDep) =>
  (self: EvoluWorkerScope<EvoluWorkerInput>): void => {
    const errorStorePorts = new Set<MessagePort<EvoluError>>();

    self.onError = (error) => {
      for (const port of errorStorePorts) port.postMessage(error);
    };

    self.onConnect = (port) => {
      port.onMessage = (message) => {
        switch (message.type) {
          case "InitErrorStore": {
            errorStorePorts.add(
              deps.createMessagePort<EvoluError>(message.port),
            );
            break;
          }
          case "InitEvolu":
            // TODO:
            break;
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
  ): Task<void, never, CreateMessagePortDep> =>
  (run) => {
    runEvoluWorkerScope(run.deps)(self);
    return ok();
  };
