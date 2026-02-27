import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: rootDir,
  test: {
    projects: [
      "packages/common/vitest.unit.config.ts",
      "packages/common/vitest.browser.config.ts",
      "packages/web",
      "packages/react-web",
      "packages/nodejs",
      "packages/react-native",
      "packages/astro",
      "packages/tanstack-start",
      "packages/tauri",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.d.ts"],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
