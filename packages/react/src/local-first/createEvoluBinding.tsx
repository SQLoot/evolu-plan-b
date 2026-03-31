"use client";

import { assert, lazyVoid } from "@evolu/common";
import type {
  Evolu,
  EvoluSchema,
  Queries,
  QueriesToQueryRows,
  QueriesToQueryRowsPromises,
  Query,
  QueryRows,
  Row,
} from "@evolu/common/local-first";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type Context,
} from "react";
import { useIsSsr } from "./useIsSsr.js";

export interface ReactBinding<S extends EvoluSchema = EvoluSchema> {
  readonly EvoluContext: Context<Evolu<S> | null>;
  readonly useEvolu: () => Evolu<S>;
  readonly useQuery: <R extends Row>(
    query: Query<S, R>,
    options?: Partial<{
      readonly once: boolean;
      readonly promise: Promise<QueryRows<R>>;
    }>,
  ) => QueryRows<R>;
  readonly useQueries: <Q extends Queries<S>, OQ extends Queries<S>>(
    queries: [...Q],
    options?: Partial<{
      readonly once: [...OQ];
      readonly promises: [
        ...QueriesToQueryRowsPromises<Q>,
        ...QueriesToQueryRowsPromises<OQ>,
      ];
    }>,
  ) => [...QueriesToQueryRows<Q>, ...QueriesToQueryRows<OQ>];
  readonly useQuerySubscription: <R extends Row>(
    query: Query<S, R>,
    options?: Partial<{
      readonly once: boolean;
    }>,
  ) => QueryRows<R>;
  readonly useOwner: (
    owner: Parameters<Evolu<S>["useOwner"]>[0],
    transports?: Parameters<Evolu<S>["useOwner"]>[1],
  ) => ReturnType<Evolu<S>["useOwner"]>;
}

/**
 * Creates a React binding for a specific {@link EvoluSchema}.
 */
export const createEvoluBinding = <S extends EvoluSchema>(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  schema: S,
): ReactBinding<S> => {
  const EvoluContext = createContext<Evolu<S> | null>(null);

  const useEvolu = (): Evolu<S> => {
    const evolu = use(EvoluContext);
    assert(evolu, "EvoluContext is missing.");
    return evolu;
  };

  const useQuerySubscription = <R extends Row>(
    query: Query<S, R>,
    options: Partial<{
      readonly once: boolean;
    }> = {},
  ): QueryRows<R> => {
    const evolu = useEvolu();
    const { once } = useRef(options).current;

    if (once) {
      // biome-ignore lint/correctness/useHookAtTopLevel: intentional
      useEffect(() => evolu.subscribeQuery(query)(lazyVoid), [evolu, query]);
      return evolu.getQueryRows(query);
    }

    return useSyncExternalStore(
      useMemo(() => evolu.subscribeQuery(query), [evolu, query]),
      useMemo(() => () => evolu.getQueryRows(query), [evolu, query]),
      () => evolu.getQueryRows(query),
    );
  };

  const useQuery = <R extends Row>(
    query: Query<S, R>,
    options: Partial<{
      readonly once: boolean;
      readonly promise: Promise<QueryRows<R>>;
    }> = {},
  ): QueryRows<R> => {
    const evolu = useEvolu();
    const isSsr = useIsSsr();

    if (isSsr) {
      if (!options.promise) void evolu.loadQuery(query);
    } else {
      use(options.promise ?? evolu.loadQuery(query));
    }

    return useQuerySubscription(query, options);
  };

  const useQueries = <Q extends Queries<S>, OQ extends Queries<S>>(
    queries: [...Q],
    options: Partial<{
      readonly once: [...OQ];
      readonly promises: [
        ...QueriesToQueryRowsPromises<Q>,
        ...QueriesToQueryRowsPromises<OQ>,
      ];
    }> = {},
  ): [...QueriesToQueryRows<Q>, ...QueriesToQueryRows<OQ>] => {
    const evolu = useEvolu();
    const once = useRef(options).current.once;
    const allQueries = once ? queries.concat(once) : queries;
    const queriesLengthRef = useRef<number | null>(null);
    const allQueriesLengthRef = useRef<number | null>(null);
    const usesPromisesRef = useRef<boolean | null>(null);

    if (queriesLengthRef.current === null) queriesLengthRef.current = queries.length;
    else {
      assert(
        queriesLengthRef.current === queries.length,
        "createEvoluBinding.useQueries requires a stable queries length between renders.",
      );
    }

    if (allQueriesLengthRef.current === null) {
      allQueriesLengthRef.current = allQueries.length;
    } else {
      assert(
        allQueriesLengthRef.current === allQueries.length,
        "createEvoluBinding.useQueries requires a stable total query count between renders.",
      );
    }

    if (usesPromisesRef.current === null) {
      usesPromisesRef.current = options.promises !== undefined;
    } else {
      assert(
        usesPromisesRef.current === (options.promises !== undefined),
        "createEvoluBinding.useQueries requires stable promise usage between renders.",
      );
    }

    const wasSsr = useIsSsr();
    if (wasSsr) {
      if (!options.promises) void evolu.loadQueries(allQueries);
    } else {
      const promises = options.promises ?? evolu.loadQueries(allQueries);
      for (const promise of promises) use(promise);
    }

    const rows = [];
    for (const [index, query] of allQueries.entries()) {
      // biome-ignore lint/correctness/useHookAtTopLevel: guarded by stable query-count assertions above
      rows.push(useQuerySubscription(query, { once: index > queries.length - 1 }));
    }

    return rows as never;
  };

  const useOwner = (
    owner: Parameters<Evolu<S>["useOwner"]>[0],
    transports?: Parameters<Evolu<S>["useOwner"]>[1],
  ): ReturnType<Evolu<S>["useOwner"]> => {
    const evolu = useEvolu();
    return evolu.useOwner(owner, transports);
  };

  return {
    EvoluContext,
    useEvolu,
    useQuery,
    useQueries,
    useQuerySubscription,
    useOwner,
  };
};
