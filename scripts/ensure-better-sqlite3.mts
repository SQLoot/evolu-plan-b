import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const rootDir = resolve(import.meta.dir, "..");
const packageDirs = [
  resolve(rootDir, "packages/common"),
  resolve(rootDir, "packages/nodejs"),
];

type Runtime = "bun" | "node";

const selectedRuntimeArg = process.argv.find((arg) =>
  arg.startsWith("--runtime="),
);
const selectedRuntime = selectedRuntimeArg?.split("=")[1] as
  | Runtime
  | undefined;

if (selectedRuntimeArg && selectedRuntime !== "bun" && selectedRuntime !== "node") {
  console.error(
    `[test:preflight] Unsupported runtime argument: ${selectedRuntimeArg}`,
  );
  process.exit(1);
}

const checkBetterSqlite = (cwd: string, runtime: Runtime) =>
  spawnSync(
    runtime,
    [
      "-e",
      "const Database=require('better-sqlite3');const db=new Database(':memory:');db.close();",
    ],
    { cwd, encoding: "utf8" },
  );

const formatOutput = (stdout: string | null, stderr: string | null): string =>
  [stdout, stderr].filter(Boolean).join("\n");

const isRecoverable =
  (output: string): boolean =>
    output.includes("compiled against a different Node.js version") ||
    output.includes("NODE_MODULE_VERSION") ||
    output.includes("Cannot find module 'better-sqlite3'") ||
    output.includes("Cannot find package 'better-sqlite3'");

const formatFailures = (
  runtime: Runtime,
  failures: Array<{
    readonly cwd: string;
    readonly result: ReturnType<typeof checkBetterSqlite>;
  }>,
): string =>
  failures
    .map(({ cwd, result }) =>
      [
        `[runtime: ${runtime}]`,
        `[cwd: ${cwd}]`,
        formatOutput(result.stdout, result.stderr),
      ].join("\n"),
    )
    .join("\n\n");

const reinstallWorkspace = (): number => {
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

  return reinstall.status ?? 1;
};

const checkRuntime = (runtime: Runtime): number => {
  const initialFailures = packageDirs
    .map((cwd) => ({ cwd, result: checkBetterSqlite(cwd, runtime) }))
    .filter(({ result }) => result.status !== 0);

  if (initialFailures.length === 0) {
    return 0;
  }

  const initialOutput = formatFailures(runtime, initialFailures);

  if (!isRecoverable(initialOutput)) {
    console.error(
      `[test:preflight] better-sqlite3 ${runtime} check failed with unexpected error.`,
    );
    console.error(initialOutput);
    return 1;
  }

  const reinstallStatus = reinstallWorkspace();
  if (reinstallStatus !== 0) return reinstallStatus;

  const retryFailures = packageDirs
    .map((cwd) => ({ cwd, result: checkBetterSqlite(cwd, runtime) }))
    .filter(({ result }) => result.status !== 0);

  if (retryFailures.length === 0) {
    console.warn(
      `[test:preflight] better-sqlite3 ${runtime} ABI repair succeeded.`,
    );
    return 0;
  }

  console.error(`[test:preflight] better-sqlite3 ${runtime} ABI mismatch still present.`);
  console.error(formatFailures(runtime, retryFailures));
  return 1;
};

const getNodeMajor = (): number | null => {
  const result = spawnSync("node", ["-p", "process.versions.node"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  const version = (result.stdout ?? "").trim();
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? null : major;
};

const runtimes: Array<Runtime> =
  selectedRuntime != null ? [selectedRuntime] : ["bun", "node"];

for (const runtime of runtimes) {
  if (runtime === "node") {
    const nodeMajor = getNodeMajor();
    if (nodeMajor == null) {
      console.warn(
        "[test:preflight] node runtime not available; skipping node better-sqlite3 gate.",
      );
      continue;
    }

    if (nodeMajor < 24) {
      console.warn(
        `[test:preflight] node@${nodeMajor} detected (<24); skipping node better-sqlite3 gate.`,
      );
      continue;
    }
  }

  const status = checkRuntime(runtime);
  if (status !== 0) {
    process.exit(status);
  }
}

process.exit(0);
