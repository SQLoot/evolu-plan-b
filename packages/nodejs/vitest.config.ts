import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/index.ts"],
      reporter: ["text", "html"],
    },
  },
});
