import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const websiteRoot = resolve(scriptDir, "../../website");
const websitePackageJsonPath = resolve(websiteRoot, "package.json");

if (!existsSync(websitePackageJsonPath)) {
  console.log(
    "[docs:sync:website] Skipping: ../website workspace not found.",
  );
  process.exit(0);
}

const child = spawn("bun", ["run", "--cwd", websiteRoot, "docs:sync:evolu"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

const exitCode = await new Promise<number>((resolve) => {
  child.on("close", (code) => resolve(code ?? 1));
  child.on("error", () => resolve(1));
});

if (exitCode !== 0) process.exit(exitCode);
