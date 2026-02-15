import { existsSync } from "node:fs";
import { resolve } from "node:path";

const websiteRoot = resolve(import.meta.dir, "../../website");
const websitePackageJsonPath = resolve(websiteRoot, "package.json");

if (!existsSync(websitePackageJsonPath)) {
  console.log(
    "[docs:sync:website] Skipping: ../website workspace not found.",
  );
  process.exit(0);
}

const processHandle = Bun.spawn({
  cmd: ["bun", "run", "--cwd", websiteRoot, "docs:sync:evolu"],
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await processHandle.exited;
if (exitCode !== 0) process.exit(exitCode);
