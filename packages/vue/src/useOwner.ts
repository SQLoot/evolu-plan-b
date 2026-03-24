import type {
  NonEmptyReadonlyArray,
  Owner,
  OwnerTransport,
  ReadonlyOwner,
} from "@evolu/common";
import { onScopeDispose } from "vue";
import { useEvolu } from "./useEvolu.js";

const registerOwnerForSync = (
  evolu: {
    readonly useOwner: (
      owner: ReadonlyOwner | Owner,
      transports?: NonEmptyReadonlyArray<OwnerTransport>,
    ) => (() => void) | undefined;
  },
  owner: ReadonlyOwner | Owner,
  transports?: NonEmptyReadonlyArray<OwnerTransport>,
) => {
  // biome-ignore lint/complexity/useLiteralKeys: Bracket access avoids false hook detection for non-React useOwner call.
  return evolu["useOwner"](owner, transports);
};

/**
 * Vue composable for Evolu `useOwner` method.
 *
 * Using an Owner means syncing it with the provided transports, or the
 * transports defined in Evolu config when transports are omitted.
 */
export const useOwner = (
  owner: ReadonlyOwner | Owner | null,
  transports?: NonEmptyReadonlyArray<OwnerTransport>,
): void => {
  const evolu = useEvolu();
  if (owner == null) return;

  const cleanup = registerOwnerForSync(evolu, owner, transports);
  if (cleanup) onScopeDispose(cleanup);
};
