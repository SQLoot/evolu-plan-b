import { mkdirSync } from "node:fs";
import { createConsole, createConsoleFormatter } from "@evolu/common";
import { createRelayDeps, createRunner, startRelay } from "@evolu/nodejs";
import { startBunRelay } from "./startBunRelay.js";

// Ensure the database is created in a predictable location for Docker.
mkdirSync("data", { recursive: true });
process.chdir("data");

const console = createConsole({
  // level: "debug",
  formatter: createConsoleFormatter()({
    timestampFormat: "relative",
  }),
});

const deps = { ...createRelayDeps(), console };

await using run = createRunner(deps);
await using stack = run.stack();

const isBunRuntime = (globalThis as { readonly Bun?: unknown }).Bun != null;
const startRelayTask = isBunRuntime ? startBunRelay : startRelay;

await stack.use(
  startRelayTask({
    port: 4000,

    // Note: Relay requires URL in format ws://host:port/<ownerId>
    // isOwnerAllowed: (_ownerId) => true,

    isOwnerWithinQuota: (_ownerId, requiredBytes) => {
      const maxBytes = 1024 * 1024; // 1MB
      return requiredBytes <= maxBytes;
    },
  }),
);

await run.deps.shutdown;
