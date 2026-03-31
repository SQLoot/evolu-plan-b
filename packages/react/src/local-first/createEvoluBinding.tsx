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
  type Context,
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useIsSsr } from "./useIsSsr.js";

const emptySubscribe = () => () => {};

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
      once ? emptySubscribe : subscribeQuery,
      getQueryRows,
      getQueryRows,
    );

    return once ? evolu.getQueryRows(query) : rows;
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
    const allQueries = useMemo(
      () => (once ? queries.concat(once) : queries),
      [once, queries],
    );
    const getQueryRows = useMemo(
      () => () =>
        allQueries.map((query) => evolu.getQueryRows(query)) as [
          ...QueriesToQueryRows<Q>,
          ...QueriesToQueryRows<OQ>,
        ],
      [allQueries, evolu],
    );
    const subscribeQueries = useMemo(
      () => (listener: () => void) => {
        const unsubscribes = queries.map((query) =>
          evolu.subscribeQuery(query)(listener),
        );

        return () => {
          for (const unsubscribe of unsubscribes) unsubscribe();
        };
      },
      [evolu, queries],
    );
    const loadQueriesPromise = useMemo(
      () => Promise.all(options.promises ?? evolu.loadQueries(allQueries)),
      [allQueries, evolu, options.promises],
    );

    const wasSsr = useIsSsr();
    if (wasSsr) {
      if (!options.promises) void loadQueriesPromise;
    } else {
      use(loadQueriesPromise);
    }

    return useSyncExternalStore(subscribeQueries, getQueryRows, getQueryRows);
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
