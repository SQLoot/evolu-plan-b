import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "tauri",
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
  },
});
