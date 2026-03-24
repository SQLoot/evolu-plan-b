import type { SyncState } from "@evolu/common/local-first";
import type { Ref } from "vue";

/**
 * Subscribe to {@link SyncState} changes.
 *
 * @deprecated Not implemented in owner API yet; calling this composable throws.
 */
export const useSyncState = (): Ref<SyncState> => {
  throw new Error(
    "useSyncState is deprecated and not implemented yet; SyncState subscription is unavailable in the owner API.",
  );
};
