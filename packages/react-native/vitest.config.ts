import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "react-native": fileURLToPath(
        new URL("./test/mocks/react-native.ts", import.meta.url),
      ),
      "react-native-sensitive-info": fileURLToPath(
        new URL("./test/mocks/react-native-sensitive-info.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "react-native",
    setupFiles: ["./test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
  },
});
