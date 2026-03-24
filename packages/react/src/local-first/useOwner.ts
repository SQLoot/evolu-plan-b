import type {
  NonEmptyReadonlyArray,
  Owner,
  OwnerTransport,
  ReadonlyOwner,
} from "@evolu/common";
import { use, useEffect } from "react";
import { EvoluContext } from "./EvoluContext.js";

/**
 * React Hook for Evolu `useOwner` method.
 *
 * Using an Owner means syncing it with the provided transports, or the
 * transports defined in Evolu config when transports are omitted.
 *
 * To avoid unnecessary register/unregister cycles, callers should pass a
 * memoized transports array when possible.
 */
export const useOwner = (
  owner: ReadonlyOwner | Owner | null,
  transports?: NonEmptyReadonlyArray<OwnerTransport>,
): void => {
  const evolu = use(EvoluContext);

  useEffect(() => {
    if (owner == null) return;
    // biome-ignore lint/complexity/useLiteralKeys: Bracket access avoids false React hook detection for evolu.useOwner inside Effect callback.
    return evolu["useOwner"](owner, transports);
  }, [evolu, owner, transports]);
};
