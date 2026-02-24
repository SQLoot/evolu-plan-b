import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const packageDirs = [
  resolve(rootDir, "packages/common"),
  resolve(rootDir, "packages/nodejs"),
];

const checkBetterSqlite = (cwd: string) =>
  spawnSync(
    "bun",
    [
      "-e",
      "const Database=require('better-sqlite3');const db=new Database(':memory:');db.close();",
    ],
    { cwd, encoding: "utf8" },
  );

const formatOutput = (stdout: string | null, stderr: string | null): string =>
  [stdout, stderr].filter(Boolean).join("\n");

const initialFailures = packageDirs
  .map((cwd) => ({ cwd, result: checkBetterSqlite(cwd) }))
  .filter(({ result }) => result.status !== 0);

if (initialFailures.length === 0) process.exit(0);

const initialOutput = initialFailures
  .map(({ cwd, result }) =>
    [`[cwd: ${cwd}]`, formatOutput(result.stdout, result.stderr)].join("\n"),
  )
  .join("\n\n");

const isRecoverable =
  initialOutput.includes("compiled against a different Node.js version") ||
  initialOutput.includes("NODE_MODULE_VERSION") ||
  initialOutput.includes("Cannot find module 'better-sqlite3'") ||
  initialOutput.includes("Cannot find package 'better-sqlite3'");

if (!isRecoverable) {
  console.error(
    "[test:preflight] better-sqlite3 check failed with unexpected error.",
  );
  console.error(initialOutput);
  process.exit(1);
}

console.warn(
  "[test:preflight] Detected better-sqlite3 ABI mismatch. Reinstalling workspace dependencies.",
);

const reinstall = spawnSync(
  "bun",
  [
    "install",
    "--force",
    "--filter=@evolu/common",
    "--filter=@evolu/nodejs",
  ],
  { stdio: "inherit" },
);

if (reinstall.status !== 0) {
  process.exit(reinstall.status ?? 1);
}

const retryFailures = packageDirs
  .map((cwd) => ({ cwd, result: checkBetterSqlite(cwd) }))
  .filter(({ result }) => result.status !== 0);

if (retryFailures.length === 0) {
  console.warn("[test:preflight] better-sqlite3 ABI repair succeeded.");
  process.exit(0);
}

console.error("[test:preflight] better-sqlite3 ABI mismatch still present.");
console.error(
  retryFailures
    .map(({ cwd, result }) =>
      [`[cwd: ${cwd}]`, formatOutput(result.stdout, result.stderr)].join("\n"),
    )
    .join("\n\n"),
);
process.exit(1);
