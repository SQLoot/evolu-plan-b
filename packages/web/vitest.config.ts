import { playwright } from "@vitest/browser-playwright";
import { defineProject } from "vitest/config";

// Coverage with v8 only works with a single browser instance. Bun-driven
// workspace runs are also more stable with a single browser instance under
// Vitest 4.1.x.
const isSingleBrowserRun =
  process.argv.includes("--coverage") || "Bun" in globalThis;

export default defineProject({
  // Transpile `using`/`await using` for WebKit which doesn't support it yet
  esbuild: { supported: { using: false } },
  optimizeDeps: {
    // Preserve import.meta.url so the WASM binary can be located at runtime.
    exclude: ["@evolu/sqlite-wasm"],
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**"],
    include: ["test/**/*.test.ts"],
    browser: {
      enabled: true,
      api: { port: 63316 },
      provider: playwright(),
      headless: true,
      fileParallelism: false, // false is faster for some reason.
      instances: isSingleBrowserRun
        ? [{ browser: "chromium" }]
        : [
            { browser: "chromium" },
            { browser: "firefox" },
            { browser: "webkit" },
          ],
    },
  },
});
