import { useSyncExternalStore } from "react";

const constFalse = () => false;
const constTrue = () => true;

// eslint-disable-next-line @typescript-eslint/no-empty-function
const emptySubscribe = () => () => {};

/**
 * Avoiding hydration mismatches.
 *
 * @see https://kurtextrem.de/posts/react-uses-hydration
 */
export const useIsSsr = (): boolean =>
	// TODO: Consider useDeferredValue(isSSRSync);
	useSyncExternalStore(emptySubscribe, constFalse, constTrue);
