import type { Evolu } from "@evolu/common/local-first";
import { useContext } from "react";
import { EvoluContext } from "./local-first/EvoluContext.js";

/**
 * React Hook returning a generic instance of {@link Evolu}.
 *
 * This is intended for internal usage.
 */
export const useEvolu = (): Evolu => {
  const evolu = useContext(EvoluContext);
  if (evolu == null) {
    throw new Error(
      "Could not find Evolu context value. Ensure the component is wrapped in an <EvoluProvider>.",
    );
  }
  return evolu as Evolu;
};
