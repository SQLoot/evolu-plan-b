"use client";

import { assert, type Run } from "@evolu/common";
import { createContext, use, type ReactNode } from "react";

/**
 * Creates typed React Context and hook for {@link Run}.
 *
 * The `run` argument is used to infer the deps type for the returned API.
 */
export const createRunBinding = <D,>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  run: Run<D>,
): {
  readonly RunContext: React.FC<{
    readonly value: Run<D>;
    readonly children?: ReactNode;
  }>;
  readonly useRun: () => Run<D>;
} => {
  const RunContext = createContext<Run<D> | null>(null);

  return {
    RunContext,
    useRun: () => {
      const currentRun = use(RunContext);
      assert(currentRun, "RunContext is missing.");
      return currentRun;
    },
  };
};
