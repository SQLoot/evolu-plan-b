import { initialSyncState, type SyncState } from "@evolu/common/local-first";
import { use } from "react";
import { EvoluContext } from "./EvoluContext.js";

/** Subscribe to {@link SyncState} changes. */
export const useSyncState = (): SyncState => {
  const _unused = use(EvoluContext);
  void _unused;
  // SyncState API is not wired in the current owner API yet.
  return initialSyncState;
};
