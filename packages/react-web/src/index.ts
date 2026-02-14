import type { ConsoleDep } from "@evolu/common";
import type { EvoluDeps } from "@evolu/common/local-first";
import { createEvoluDeps as createWebEvoluDeps } from "@evolu/web";
import { flushSync } from "react-dom";

export * from "./components/index.js";

/** Creates Evolu dependencies for React web with React DOM flush sync support. */
export const createEvoluDeps = (deps: Partial<ConsoleDep> = {}): EvoluDeps => {
  const evoluDeps = createWebEvoluDeps(deps);
  return { ...evoluDeps, flushSync };
};
