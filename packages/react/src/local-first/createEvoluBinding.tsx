"use client";

import { assert, emptyArray, lazyVoid } from "@evolu/common";
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
  type ReactNode,
} from "react";
import { useIsSsr } from "./useIsSsr.js";

export interface ReactBinding<S extends EvoluSchema = EvoluSchema> {
  readonly EvoluContext: React.FC<{
    readonly value: Evolu<S>;
    readonly children?: ReactNode;
  }>;
  readonly useEvolu: () => Evolu<S>;
  readonly useQuery: <R extends Row>(
    query: Query<R>,
    options?: Partial<{
      readonly once: boolean;
      readonly promise: Promise<QueryRows<R>>;
    }>,
  ) => QueryRows<R>;
  readonly useQueries: <Q extends Queries, OQ extends Queries>(
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
    query: Query<R>,
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
    query: Query<R>,
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
      () => emptyArray as QueryRows<R>,
    );
  };

  const useQuery = <R extends Row>(
    query: Query<R>,
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

  const useQueries = <Q extends Queries, OQ extends Queries>(
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

    const wasSsr = useIsSsr();
    if (wasSsr) {
      if (!options.promises) void evolu.loadQueries(allQueries);
    } else {
      if (options.promises) options.promises.map(use);
      else evolu.loadQueries(allQueries).map(use);
    }

    return allQueries.map((query, index) =>
      // biome-ignore lint/correctness/useHookAtTopLevel: intentional
      useQuerySubscription(query, { once: index > queries.length - 1 }),
    ) as never;
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
