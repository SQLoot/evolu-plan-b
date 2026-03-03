import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "react-web",
    exclude: ["**/node_modules/**", "**/dist/**"],
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
