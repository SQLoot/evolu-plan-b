/// <reference lib="webworker" />
declare const self: SharedWorkerGlobalScope;

import { initEvoluWorker } from "@evolu/common/local-first";
import { createRun } from "../Task.js";
import { createMessagePort, createSharedWorkerScope } from "../Worker.js";
import { runWebDbWorkerPort } from "./DbWorker.js";

await using run = createRun({
  createMessagePort,
  runDbWorkerPort: runWebDbWorkerPort,
});
await run(initEvoluWorker(createSharedWorkerScope(self)));
