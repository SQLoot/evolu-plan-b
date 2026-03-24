import type {
  NonEmptyReadonlyArray,
  Owner,
  OwnerTransport,
  ReadonlyOwner,
} from "@evolu/common";
import { useEvolu } from "./useEvolu.js";

const registerOwnerForSync = (
  evolu: {
    readonly useOwner: (
      owner: ReadonlyOwner | Owner,
      transports?: NonEmptyReadonlyArray<OwnerTransport>,
    ) => void | (() => void);
  },
  owner: ReadonlyOwner | Owner,
  transports?: NonEmptyReadonlyArray<OwnerTransport>,
) => evolu["useOwner"](owner, transports);

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

  registerOwnerForSync(evolu, owner, transports);
};
