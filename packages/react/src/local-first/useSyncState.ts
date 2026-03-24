import type { SyncState } from "@evolu/common/local-first";
import { use } from "react";
import { EvoluContext } from "./EvoluContext.js";

/**
 * Subscribe to {@link SyncState} changes.
 *
 * @deprecated Not implemented in owner API yet; calling this hook throws.
 */
export const useSyncState = (): SyncState => {
  // Keep context subscription semantics until sync-state API is reintroduced.
  void use(EvoluContext);
  throw new Error(
    "useSyncState is deprecated and not implemented yet; SyncState subscription is unavailable in the owner API.",
  );
};
