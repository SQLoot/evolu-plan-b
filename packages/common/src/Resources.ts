/**
 * Reference-counted resource management.
 *
 * @module
 */

import { assert } from "./Assert.js";
import { isNone } from "./Option.js";
import { createRefCount, type RefCount } from "./RefCount.js";
import { createRelation } from "./Relation.js";
import type { Result } from "./Result.js";
import { err, ok } from "./Result.js";
import { createMutexByKey, createRun, type Task, unabortable } from "./Task.js";
import {
  createTime,
  type Duration,
  type TimeDep,
  type TimeoutId,
} from "./Time.js";
import { PositiveInt, type Typed } from "./Type.js";

/**
 * Async reference-counted resource management.
 *
 * Tracks which consumers use which shared resources and keeps resources alive
 * while at least one consumer is attached.
 */
export interface Resources<
  TResource extends Disposable,
  TResourceId extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
> extends AsyncDisposable {
  /** Attaches a consumer to resources. */
  readonly addConsumer: (
    consumer: TConsumer,
    resourceConfigs: ReadonlyArray<TResourceConfig>,
  ) => Task<void>;

  /** Detaches a consumer from resources. */
  readonly removeConsumer: (
    consumer: TConsumer,
    resourceConfigs: ReadonlyArray<TResourceConfig>,
  ) => Task<
    void,
    | ResourceNotFoundError<TResourceId>
    | ConsumerNotFoundError<TConsumerId, TResourceId>
  >;

  readonly getConsumerIdsForResource: (
    resourceId: TResourceId,
  ) => ReadonlySet<TConsumerId>;

  readonly getResourcesForConsumerId: (
    consumerId: TConsumerId,
  ) => ReadonlySet<TResource>;
}

/** Configuration for async {@link Resources}. */
export interface AsyncResourcesConfig<
  TResource extends Disposable,
  TResourceId extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
> {
  /** Creates a resource for the provided configuration. */
  readonly createResource: (
    resourceConfig: TResourceConfig,
  ) => Promise<TResource>;

  /** Maps a resource configuration to its shared resource identifier. */
  readonly getResourceId: (resourceConfig: TResourceConfig) => TResourceId;

  /** Maps a consumer value to its stable consumer identifier. */
  readonly getConsumerId: (consumer: TConsumer) => TConsumerId;

  /** Delay before disposing unused resources. Defaults to `"100ms"`. */
  readonly disposalDelay?: Duration;

  /** Optional clock for timeout scheduling (useful for deterministic tests). */
  readonly time?: TimeDep["time"];
}

/**
 * Legacy synchronous resource manager with delayed disposal.
 *
 * Kept for local-first internals and tests that use synchronous resource
 * creation and deterministic timeout behavior.
 */
export interface LegacyResources<
  TResource extends Disposable,
  TResourceKey extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
> extends Disposable {
  readonly addConsumer: (
    consumer: TConsumer,
    resourceConfigs: ReadonlyArray<TResourceConfig>,
  ) => void;

  readonly removeConsumer: (
    consumer: TConsumer,
    resourceConfigs: ReadonlyArray<TResourceConfig>,
  ) => Result<
    void,
    | ResourceNotFoundError<TResourceKey>
    | ConsumerNotFoundError<TConsumerId, TResourceKey>
  >;

  readonly getResource: (key: TResourceKey) => TResource | null;

  readonly getConsumersForResource: (
    key: TResourceKey,
  ) => ReadonlyArray<TConsumerId>;

  readonly hasConsumerAnyResource: (consumer: TConsumer) => boolean;

  readonly getConsumer: (consumerId: TConsumerId) => TConsumer | null;
}

/** Error when trying to remove a consumer from a resource that doesn't exist. */
export interface ResourceNotFoundError<TResourceKey extends string = string>
  extends Typed<"ResourceNotFoundError"> {
  readonly resourceKey: TResourceKey;
}

/** Error when trying to remove a consumer that wasn't added to a resource. */
export interface ConsumerNotFoundError<
  TConsumerId extends string = string,
  TResourceKey extends string = string,
> extends Typed<"ConsumerNotFoundError"> {
  readonly consumerId: TConsumerId;
  readonly resourceKey: TResourceKey;
}

/** Configuration for legacy synchronous {@link LegacyResources}. */
export interface LegacyResourcesConfig<
  TResource extends Disposable,
  TResourceKey extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
> {
  readonly createResource: (config: TResourceConfig) => TResource;

  readonly getResourceKey: (config: TResourceConfig) => TResourceKey;

  readonly getConsumerId: (consumer: TConsumer) => TConsumerId;

  readonly disposalDelay?: Duration;

  readonly onConsumerAdded?: (
    consumer: TConsumer,
    resource: TResource,
    resourceKey: TResourceKey,
  ) => void;

  readonly onConsumerRemoved?: (
    consumer: TConsumer,
    resource: TResource,
    resourceKey: TResourceKey,
  ) => void;
}

const createAsyncResources = <
  TResource extends Disposable,
  TResourceId extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
>({
  createResource,
  getResourceId,
  getConsumerId,
  disposalDelay = "100ms",
  time: maybeTime,
}: AsyncResourcesConfig<
  TResource,
  TResourceId,
  TResourceConfig,
  TConsumer,
  TConsumerId
>): Resources<
  TResource,
  TResourceId,
  TResourceConfig,
  TConsumer,
  TConsumerId
> => {
  const time = maybeTime ?? createTime();
  const resourcesById = new Map<TResourceId, TResource>();
  const consumerRefCountsByResourceId = new Map<
    TResourceId,
    RefCount<TConsumerId>
  >();
  const consumerIdsByResourceId = createRelation<TResourceId, TConsumerId>();
  const mutexByResourceId = createMutexByKey<TResourceId>();
  const disposalTimeoutByResourceId = new Map<TResourceId, TimeoutId>();
  const resourceIdsWithMutex = new Set<TResourceId>();
  let disposing = false;
  let disposePromise: Promise<void> | null = null;

  const clearDisposalTimeout = (resourceId: TResourceId): void => {
    const timeout = disposalTimeoutByResourceId.get(resourceId);
    if (!timeout) return;
    time.clearTimeout(timeout);
    disposalTimeoutByResourceId.delete(resourceId);
  };

  const scheduleResourceDisposal = (resourceId: TResourceId): void => {
    clearDisposalTimeout(resourceId);

    const timeout = time.setTimeout(() => {
      void (async () => {
        if (disposing) return;

        await using run = createRun();
        const result = await run(
          unabortable(
            mutexByResourceId.withLock(resourceId, () => {
              disposalTimeoutByResourceId.delete(resourceId);

              if (consumerIdsByResourceId.hasA(resourceId)) return ok();

              consumerRefCountsByResourceId.delete(resourceId);
              const resource = resourcesById.get(resourceId);
              if (!resource) return ok();

              resourcesById.delete(resourceId);
              resource[Symbol.dispose]();
              return ok();
            }),
          ),
        );
        assert(
          result.ok,
          "Unabortable scheduled resource disposal must not abort",
        );
      })();
    }, disposalDelay);

    disposalTimeoutByResourceId.set(resourceId, timeout);
  };

  return {
    addConsumer: (consumer, resourceConfigs) => async (run) => {
      if (disposing) return ok();

      const consumerId = getConsumerId(consumer);

      for (const resourceConfig of resourceConfigs) {
        if (disposing) return ok();

        const resourceId = getResourceId(resourceConfig);
        resourceIdsWithMutex.add(resourceId);

        const result = await run(
          unabortable(
            mutexByResourceId.withLock(resourceId, async () => {
              if (disposing) return ok();
              clearDisposalTimeout(resourceId);

              let resource = resourcesById.get(resourceId);
              if (!resource) {
                resource = await createResource(resourceConfig);
                resourcesById.set(resourceId, resource);
              }

              let consumerRefCountsByConsumerId =
                consumerRefCountsByResourceId.get(resourceId);
              if (!consumerRefCountsByConsumerId) {
                consumerRefCountsByConsumerId = createRefCount<TConsumerId>();
                consumerRefCountsByResourceId.set(
                  resourceId,
                  consumerRefCountsByConsumerId,
                );
              }

              const nextCount =
                consumerRefCountsByConsumerId.increment(consumerId);

              if (nextCount === 1) {
                consumerIdsByResourceId.add(resourceId, consumerId);
              }

              return ok();
            }),
          ),
        );
        if (!result.ok) return result;
      }

      return ok();
    },

    removeConsumer: (consumer, resourceConfigs) => async (run) => {
      if (disposing) return ok();

      const consumerId = getConsumerId(consumer);
      type RemoveConsumerError =
        | ResourceNotFoundError<TResourceId>
        | ConsumerNotFoundError<TConsumerId, TResourceId>;

      for (const resourceConfig of resourceConfigs) {
        if (disposing) return ok();

        const resourceId = getResourceId(resourceConfig);
        resourceIdsWithMutex.add(resourceId);

        const result = await run(
          unabortable(
            mutexByResourceId.withLock(
              resourceId,
              (): Result<void, RemoveConsumerError> => {
                if (disposing) return ok();

                const consumerRefCountsByConsumerId =
                  consumerRefCountsByResourceId.get(resourceId);
                if (!consumerRefCountsByConsumerId) {
                  return err<ResourceNotFoundError<TResourceId>>({
                    type: "ResourceNotFoundError",
                    resourceKey: resourceId,
                  });
                }

                const nextCount =
                  consumerRefCountsByConsumerId.decrement(consumerId);
                if (isNone(nextCount)) {
                  return err<ConsumerNotFoundError<TConsumerId, TResourceId>>({
                    type: "ConsumerNotFoundError",
                    consumerId,
                    resourceKey: resourceId,
                  });
                }

                if (nextCount.value === 0) {
                  consumerIdsByResourceId.remove(resourceId, consumerId);
                }

                if (!consumerIdsByResourceId.hasA(resourceId)) {
                  consumerRefCountsByResourceId.delete(resourceId);
                  scheduleResourceDisposal(resourceId);
                }

                return ok();
              },
            ),
          ),
        );
        if (!result.ok) return result;
      }

      return ok();
    },

    getConsumerIdsForResource: (resourceId) =>
      new Set(consumerIdsByResourceId.getB(resourceId)),

    getResourcesForConsumerId: (consumerId) => {
      const resources = new Set<TResource>();
      const resourceIds = consumerIdsByResourceId.getA(consumerId);
      if (!resourceIds) return resources;

      for (const resourceId of resourceIds) {
        const resource = resourcesById.get(resourceId);
        if (resource) resources.add(resource);
      }

      return resources;
    },

    [Symbol.asyncDispose]: () => {
      if (disposePromise) return disposePromise;

      disposing = true;

      disposePromise = (async () => {
        await using run = createRun();
        for (const timeout of disposalTimeoutByResourceId.values()) {
          time.clearTimeout(timeout);
        }
        disposalTimeoutByResourceId.clear();

        const drainIds = new Set<TResourceId>(resourceIdsWithMutex);
        for (const resourceId of resourcesById.keys()) {
          drainIds.add(resourceId);
        }
        for (const resourceId of consumerRefCountsByResourceId.keys()) {
          drainIds.add(resourceId);
        }

        for (const resourceId of drainIds) {
          const result = await run(
            unabortable(mutexByResourceId.withLock(resourceId, () => ok())),
          );
          assert(
            result.ok,
            "Unabortable resources dispose drain must not abort",
          );
        }

        for (const resource of resourcesById.values()) {
          resource[Symbol.dispose]();
        }
        resourcesById.clear();
        consumerRefCountsByResourceId.clear();
        consumerIdsByResourceId.clear();
        disposalTimeoutByResourceId.clear();
        resourceIdsWithMutex.clear();
        mutexByResourceId[Symbol.dispose]();
      })();

      return disposePromise;
    },
  };
};

const createLegacyResources = <
  TResource extends Disposable,
  TResourceKey extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
>(
  deps: TimeDep,
  config: LegacyResourcesConfig<
    TResource,
    TResourceKey,
    TResourceConfig,
    TConsumer,
    TConsumerId
  >,
): LegacyResources<
  TResource,
  TResourceKey,
  TResourceConfig,
  TConsumer,
  TConsumerId
> => {
  let isDisposed = false;

  const resourcesMap = new Map<TResourceKey, TResource>();
  const consumerCounts = new Map<TResourceKey, Map<TConsumerId, PositiveInt>>();
  const consumers = new Map<TConsumerId, TConsumer>();
  const disposalTimeouts = new Map<TResourceKey, TimeoutId>();

  const disposalDelay = config.disposalDelay ?? "100ms";

  const ensureResource = (
    resourceConfig: TResourceConfig,
  ): {
    readonly resourceKey: TResourceKey;
    readonly resource: TResource;
    readonly created: boolean;
  } => {
    const key = config.getResourceKey(resourceConfig);
    const timeout = disposalTimeouts.get(key);
    if (timeout) {
      deps.time.clearTimeout(timeout);
      disposalTimeouts.delete(key);
    }

    if (resourcesMap.has(key)) {
      const existingResource = resourcesMap.get(key) as TResource;
      return { resourceKey: key, resource: existingResource, created: false };
    }

    const resource = config.createResource(resourceConfig);
    resourcesMap.set(key, resource);

    return { resourceKey: key, resource, created: true };
  };

  const rollbackAddConsumer = (
    consumer: TConsumer,
    consumerId: TConsumerId,
    hadConsumerBefore: boolean,
    previousConsumer: TConsumer | undefined,
    incrementedCountsByResourceKey: ReadonlyMap<TResourceKey, number>,
    onConsumerAddedResourceKeys: ReadonlySet<TResourceKey>,
    createdResourceKeys: ReadonlySet<TResourceKey>,
  ): void => {
    for (const [
      resourceKey,
      incrementedCount,
    ] of incrementedCountsByResourceKey) {
      const counts = consumerCounts.get(resourceKey);
      if (!counts) continue;

      const currentCount = counts.get(consumerId);
      if (currentCount == null) continue;

      const nextCount = currentCount - incrementedCount;
      if (nextCount <= 0) {
        counts.delete(consumerId);
      } else {
        counts.set(consumerId, PositiveInt.orThrow(nextCount));
      }

      if (counts.size === 0) {
        consumerCounts.delete(resourceKey);
      }
    }

    if (config.onConsumerRemoved) {
      for (const resourceKey of onConsumerAddedResourceKeys) {
        const resource = resourcesMap.get(resourceKey);
        if (!resource) continue;
        try {
          config.onConsumerRemoved(consumer, resource, resourceKey);
        } catch {
          // Keep rollback best-effort and preserve the original addConsumer error.
        }
      }
    }

    for (const resourceKey of createdResourceKeys) {
      const counts = consumerCounts.get(resourceKey);
      if (counts && counts.size > 0) continue;

      const resource = resourcesMap.get(resourceKey);
      if (!resource) continue;

      const timeout = disposalTimeouts.get(resourceKey);
      if (timeout) {
        deps.time.clearTimeout(timeout);
        disposalTimeouts.delete(resourceKey);
      }

      try {
        resource[Symbol.dispose]();
      } catch {
        // Keep rollback best-effort and preserve the original addConsumer error.
      }
      resourcesMap.delete(resourceKey);
    }

    if (hadConsumerBefore) {
      consumers.set(consumerId, previousConsumer as TConsumer);
    } else {
      consumers.delete(consumerId);
    }
  };

  const scheduleDisposal = (key: TResourceKey): void => {
    const timeout = deps.time.setTimeout(() => {
      const resource = resourcesMap.get(key);
      if (resource) {
        resource[Symbol.dispose]();
        resourcesMap.delete(key);
      }
      disposalTimeouts.delete(key);
    }, disposalDelay);

    disposalTimeouts.set(key, timeout);
  };

  const resources: LegacyResources<
    TResource,
    TResourceKey,
    TResourceConfig,
    TConsumer,
    TConsumerId
  > = {
    addConsumer: (consumer, resourceConfigs) => {
      if (isDisposed) return;
      if (resourceConfigs.length === 0) return;

      const consumerId = config.getConsumerId(consumer);
      const hadConsumerBefore = consumers.has(consumerId);
      const previousConsumer = consumers.get(consumerId);
      consumers.set(consumerId, consumer);
      const incrementedCountsByResourceKey = new Map<TResourceKey, number>();
      const onConsumerAddedResourceKeys = new Set<TResourceKey>();
      const createdResourceKeys = new Set<TResourceKey>();

      try {
        for (const resourceConfig of resourceConfigs) {
          const { resourceKey, resource, created } =
            ensureResource(resourceConfig);
          if (created) {
            createdResourceKeys.add(resourceKey);
          }

          let counts = consumerCounts.get(resourceKey);
          if (!counts) {
            counts = new Map<TConsumerId, PositiveInt>();
            consumerCounts.set(resourceKey, counts);
          }

          const currentCount = counts.get(consumerId) ?? 0;
          const newCount = currentCount + 1;
          counts.set(consumerId, PositiveInt.orThrow(newCount));
          incrementedCountsByResourceKey.set(
            resourceKey,
            (incrementedCountsByResourceKey.get(resourceKey) ?? 0) + 1,
          );

          if (currentCount === 0 && config.onConsumerAdded && resource) {
            onConsumerAddedResourceKeys.add(resourceKey);
            config.onConsumerAdded(consumer, resource, resourceKey);
          }
        }
      } catch (error) {
        rollbackAddConsumer(
          consumer,
          consumerId,
          hadConsumerBefore,
          previousConsumer,
          incrementedCountsByResourceKey,
          onConsumerAddedResourceKeys,
          createdResourceKeys,
        );
        throw error;
      }
    },

    removeConsumer: (consumer, resourceConfigs) => {
      if (isDisposed) return ok();

      const consumerId = config.getConsumerId(consumer);
      const removeCountsByResourceKey = new Map<TResourceKey, number>();

      for (const resourceConfig of resourceConfigs) {
        const key = config.getResourceKey(resourceConfig);
        const removeCount = (removeCountsByResourceKey.get(key) ?? 0) + 1;
        removeCountsByResourceKey.set(key, removeCount);
      }

      const validatedRemovals = new Map<
        TResourceKey,
        {
          readonly counts: Map<TConsumerId, PositiveInt>;
          readonly currentCount: PositiveInt;
          readonly removeCount: number;
        }
      >();

      for (const [key, removeCount] of removeCountsByResourceKey) {
        const counts = consumerCounts.get(key);
        if (!counts) {
          return err({ type: "ResourceNotFoundError", resourceKey: key });
        }

        const currentCount = counts.get(consumerId);
        if (currentCount == null || currentCount < removeCount) {
          return err({
            type: "ConsumerNotFoundError",
            consumerId,
            resourceKey: key,
          });
        }

        validatedRemovals.set(key, { counts, currentCount, removeCount });
      }

      for (const [key, removal] of validatedRemovals) {
        const { counts, currentCount, removeCount } = removal;
        const nextCount = currentCount - removeCount;

        if (nextCount === 0) {
          counts.delete(consumerId);

          if (config.onConsumerRemoved) {
            const resource = resourcesMap.get(key);
            if (resource) {
              config.onConsumerRemoved(consumer, resource, key);
            }
          }

          if (counts.size === 0) {
            consumerCounts.delete(key);
            scheduleDisposal(key);
          }
        } else {
          counts.set(consumerId, PositiveInt.orThrow(nextCount));
        }
      }

      if (!resources.hasConsumerAnyResource(consumer)) {
        consumers.delete(consumerId);
      }

      return ok();
    },

    getResource: (key) => {
      if (isDisposed) return null;
      return resourcesMap.get(key) ?? null;
    },

    getConsumersForResource: (key) => {
      if (isDisposed) return [];
      const counts = consumerCounts.get(key);
      return counts ? Array.from(counts.keys()) : [];
    },

    hasConsumerAnyResource: (consumer) => {
      if (isDisposed) return false;
      const consumerId = config.getConsumerId(consumer);
      return Array.from(consumerCounts.values()).some((counts) =>
        counts.has(consumerId),
      );
    },

    getConsumer: (consumerId) => {
      if (isDisposed) return null;
      const consumer = consumers.get(consumerId);
      if (!consumer) return null;
      if (!resources.hasConsumerAnyResource(consumer)) return null;
      return consumer;
    },

    [Symbol.dispose]: () => {
      if (isDisposed) return;
      isDisposed = true;

      for (const timeout of disposalTimeouts.values()) {
        deps.time.clearTimeout(timeout);
      }
      disposalTimeouts.clear();

      for (const resource of resourcesMap.values()) {
        resource[Symbol.dispose]();
      }
      resourcesMap.clear();
      consumerCounts.clear();
      consumers.clear();
    },
  };

  return resources;
};

/**
 * Creates {@link Resources}.
 *
 * Supports two call forms:
 *
 * - `createResources(config)` for async Task-based resources.
 * - `createResources({ time })(config)` for legacy synchronous resources.
 */
export function createResources<
  TResource extends Disposable,
  TResourceId extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
>(
  deps: TimeDep,
): (
  config: LegacyResourcesConfig<
    TResource,
    TResourceId,
    TResourceConfig,
    TConsumer,
    TConsumerId
  >,
) => LegacyResources<
  TResource,
  TResourceId,
  TResourceConfig,
  TConsumer,
  TConsumerId
>;
export function createResources<
  TResource extends Disposable,
  TResourceId extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
>(
  config: AsyncResourcesConfig<
    TResource,
    TResourceId,
    TResourceConfig,
    TConsumer,
    TConsumerId
  >,
): Resources<TResource, TResourceId, TResourceConfig, TConsumer, TConsumerId>;
export function createResources<
  TResource extends Disposable,
  TResourceId extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
>(
  configOrDeps:
    | TimeDep
    | AsyncResourcesConfig<
        TResource,
        TResourceId,
        TResourceConfig,
        TConsumer,
        TConsumerId
      >,
):
  | Resources<TResource, TResourceId, TResourceConfig, TConsumer, TConsumerId>
  | ((
      config: LegacyResourcesConfig<
        TResource,
        TResourceId,
        TResourceConfig,
        TConsumer,
        TConsumerId
      >,
    ) => LegacyResources<
      TResource,
      TResourceId,
      TResourceConfig,
      TConsumer,
      TConsumerId
    >) {
  if (isTimeDep(configOrDeps)) {
    return (config) => createLegacyResources(configOrDeps, config);
  }

  return createAsyncResources(configOrDeps);
}

const isTimeDep = (value: unknown): value is TimeDep =>
  typeof value === "object" &&
  value !== null &&
  "time" in value &&
  !("createResource" in value) &&
  !("getResourceId" in value) &&
  !("getConsumerId" in value);
