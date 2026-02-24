/**
 * Public entry point for Expo with OP-SQLite. Exported as
 * "@evolu/react-native/expo-op-sqlite" in package.json.
 *
 * Use this with Expo projects that use `@op-engineering/op-sqlite` for better
 * performance.
 *
 * Note: this flavor does not support Evolu `export()`. Use `expo-sqlite`
 * flavor when database export bytes are required.
 */

import { createExpoDeps } from "../createExpoDeps.js";
import { createOpSqliteDriver } from "../sqlite-drivers/createOpSqliteDriver.js";

export const { evoluReactNativeDeps, localAuth } = createExpoDeps({
  createSqliteDriver: createOpSqliteDriver,
});
