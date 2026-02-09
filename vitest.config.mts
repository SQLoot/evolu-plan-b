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
      "packages/nodejs",
      "packages/react-native",
      {
        test: {
          name: "scripts",
          include: ["scripts/**/*.test.mts"],
          // Exclude typedoc test because it requires generated docs.
          // It runs explicitly after build:docs in the verify script.
          exclude: process.env.INCLUDE_DOCS_TESTS
            ? []
            : ["scripts/typedoc-plugin-evolu.test.mts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/index.ts"],
      reporter: ["text", "html", "json-summary"],
    },
  },
});
