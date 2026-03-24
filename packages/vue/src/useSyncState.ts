import type { SyncState } from "@evolu/common/local-first";
import { type Ref, ref } from "vue";

/**
 * Subscribe to {@link SyncState} changes.
 *
 * @deprecated TODO(#owner-api-sync-state): wire real sync-state subscription in
 * the owner API.
 */
export const useSyncState = (): Ref<SyncState> => {
  return ref(123 as SyncState);
};
