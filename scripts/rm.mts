import { rm } from "node:fs/promises";

const targets = process.argv.slice(2);
const scriptName = process.argv[1] ?? "scripts/rm.mts";

if (targets.length === 0) {
  console.error(`Usage: bun ${scriptName} <path> [<path> ...]`);
  process.exit(1);
}

const results = await Promise.allSettled(
  targets.map((target) =>
    rm(target, {
      force: true,
      recursive: true,
      maxRetries: 3,
      retryDelay: 100,
    }),
  ),
);

const failedTargets: Array<{ readonly target: string; readonly error: unknown }> =
  [];

for (let i = 0; i < results.length; i++) {
  const result = results[i];
  if (result?.status === "fulfilled") {
    continue;
  }

  failedTargets.push({
    target: targets[i] ?? "<unknown>",
    error: result?.reason,
  });
}

if (failedTargets.length > 0) {
  console.error(`Failed to remove ${failedTargets.length} target(s):`);
  for (const failedTarget of failedTargets) {
    console.error(`- ${failedTarget.target}`);
    console.error(failedTarget.error);
  }
  process.exit(1);
}
