/// <reference lib="webworker" />
declare const self: SharedWorkerGlobalScope;

import { initEvoluWorker } from "@evolu/common/local-first";
import { createSharedWorkerScope, createWorkerRun } from "../Worker.js";
import { runWebDbWorkerPort } from "./DbWorker.js";

await using baseRun = createWorkerRun();
const run = baseRun.addDeps({ runDbWorkerPort: runWebDbWorkerPort });
await run(initEvoluWorker(createSharedWorkerScope(self)));
