import { rm } from "node:fs/promises";

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error("Usage: bun ./scripts/rm.mts <path> [<path> ...]");
  process.exit(1);
}

await Promise.all(
  targets.map((target) =>
    rm(target, {
      force: true,
      recursive: true,
      maxRetries: 3,
      retryDelay: 100,
    }),
  ),
);
