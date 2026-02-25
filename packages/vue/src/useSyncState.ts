import { initialSyncState, type SyncState } from "@evolu/common/local-first";
import type { Ref } from "vue";
import { ref } from "vue";
import { useEvolu } from "./useEvolu.js";

/**
 * Temporary stub returning a static fallback {@link SyncState}.
 *
 * TODO: Wire real SyncState subscription from the owner API.
 */
export const useSyncState = (): Ref<SyncState> => {
  const _unused = useEvolu();
  void _unused;
  // SyncState API is not wired in the current owner API yet.
  return ref(initialSyncState);
};
