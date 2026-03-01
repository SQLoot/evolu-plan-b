/// <reference lib="webworker" />
declare const self: SharedWorkerGlobalScope;

import { installPolyfills } from "@evolu/common";
import { initEvoluWorker } from "@evolu/common/local-first";
import { createSharedWorkerScope, createWorkerRun } from "../Worker.js";
import { runWebDbWorkerPort } from "./DbWorker.js";

installPolyfills();

await using baseRun = createWorkerRun();
const run = baseRun.addDeps({ runDbWorkerPort: runWebDbWorkerPort });
await run(initEvoluWorker(createSharedWorkerScope(self)));
