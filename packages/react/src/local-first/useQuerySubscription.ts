import { emptyArray, lazyVoid } from "@evolu/common";
import type {
  EvoluSchema,
  Query,
  QueryRows,
  Row,
} from "@evolu/common/local-first";
import { use, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { EvoluContext } from "./EvoluContext.js";

/** Subscribe to {@link Query} {@link QueryRows} changes. */
export const useQuerySubscription = <S extends EvoluSchema, R extends Row>(
  query: Query<S, R>,
  options: Partial<{
    /**
     * Only subscribe and get the current value once. Subscribed query will not
     * invoke React Suspense after a mutation.
     */
    readonly once: boolean;
  }> = {},
): QueryRows<R> => {
  const evolu = use(EvoluContext);

  // useRef to not break "rules-of-hooks"
  const { once } = useRef(options).current;

  const subscribeQuery = useMemo(
    () => evolu.subscribeQuery(query),
    [evolu, query],
  );
  const getQueryRows = useMemo(
    () => () => evolu.getQueryRows(query),
    [evolu, query],
  );

  useEffect(() => {
    if (!once) return;
    return subscribeQuery(lazyVoid);
  }, [once, subscribeQuery]);

  const rows = useSyncExternalStore(
    subscribeQuery,
    getQueryRows,
    () => emptyArray as QueryRows<R>,
    /* eslint-enable react-hooks/rules-of-hooks */
  );

  return once ? evolu.getQueryRows(query) : rows;
};
