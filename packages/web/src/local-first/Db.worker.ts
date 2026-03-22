/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { installPolyfills } from "@evolu/common/polyfills";

installPolyfills();

import { initDbWorker } from "@evolu/common/local-first";
import { createWasmSqliteDriver } from "../Sqlite.js";
import { createLeaderLock } from "../Task.js";
import { createWorkerRun, createWorkerSelf } from "../Worker.js";

// TODO: Disposal.
const run = createWorkerRun().addDeps({
  createSqliteDriver: createWasmSqliteDriver,
  leaderLock: createLeaderLock(),
});

run(initDbWorker(createWorkerSelf(self)));
