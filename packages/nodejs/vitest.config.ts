import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    setupFiles: ["./test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    include: ["test/**/*.test.ts"],
  },
});
