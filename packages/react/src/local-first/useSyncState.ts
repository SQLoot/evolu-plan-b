import type { SyncState } from "@evolu/common/local-first";
import { use } from "react";
import { EvoluContext } from "./EvoluContext.js";

/**
 * Subscribe to {@link SyncState} changes.
 *
 * @deprecated TODO(#owner-api-sync-state): wire real sync state subscription in
 * the owner API.
 */
export const useSyncState = (): SyncState => {
  // Keep context subscription semantics until sync-state API is reintroduced.
  void use(EvoluContext);
  return 123 as SyncState;
};
