import type { SyncOwner } from "@evolu/common";
import { useEvolu } from "./useEvolu.js";

/**
 * Vue composable for Evolu `useOwner` method.
 *
 * Using an owner means syncing it with its transports, or the transports
 * defined in Evolu config if the owner has no transports defined.
 */
export const useOwner = (owner: SyncOwner | null): void => {
  const evolu = useEvolu();

  if (owner == null) return;

  // biome-ignore lint/correctness/useHookAtTopLevel: intentional
  evolu.useOwner(owner);
};
