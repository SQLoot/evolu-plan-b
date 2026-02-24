import { describe, expect, test, vi } from "vitest";
import { createResources } from "../src/Resources.js";

type ResourceKey = `resource:${string}`;
type ConsumerId = `consumer:${string}`;

interface TestResource extends Disposable {
  readonly key: ResourceKey;
  readonly disposed: () => boolean;
}

interface TestResourceConfig {
  readonly key: ResourceKey;
}

interface TestConsumer {
  readonly id: ConsumerId;
}

const createTestResource = (key: ResourceKey): TestResource => {
  let isDisposed = false;

  return {
    key,
    disposed: () => isDisposed,
    [Symbol.dispose]: () => {
      isDisposed = true;
    },
  };
};

const createTestResources = (disposalDelay = 100) => {
  const created: ResourceKey[] = [];
  const added: `${ConsumerId}->${ResourceKey}`[] = [];
  const removed: `${ConsumerId}->${ResourceKey}`[] = [];

  const resources = createResources<
    TestResource,
    ResourceKey,
    TestResourceConfig,
    TestConsumer,
    ConsumerId
  >({
    createResource: (config) => {
      created.push(config.key);
      return createTestResource(config.key);
    },
    getResourceKey: (config) => config.key,
    getConsumerId: (consumer) => consumer.id,
    disposalDelay,
    onConsumerAdded: (consumer, _resource, key) => {
      added.push(`${consumer.id}->${key}`);
    },
    onConsumerRemoved: (consumer, _resource, key) => {
      removed.push(`${consumer.id}->${key}`);
    },
  });

  return { resources, created, added, removed };
};

const consumer1: TestConsumer = { id: "consumer:1" };
const consumer2: TestConsumer = { id: "consumer:2" };
const unknownConsumer: TestConsumer = { id: "consumer:unknown" };

const resource1: TestResourceConfig = { key: "resource:1" };

describe("createResources", () => {
  test("shares one resource across consumers and tracks membership", () => {
    const { resources, created, added, removed } = createTestResources();

    resources.addConsumer(consumer1, [resource1]);
    resources.addConsumer(consumer2, [resource1]);

    expect(created).toEqual([resource1.key]);
    expect(added).toEqual([
      `${consumer1.id}->${resource1.key}`,
      `${consumer2.id}->${resource1.key}`,
    ]);

    expect(resources.getConsumersForResource(resource1.key).toSorted()).toEqual(
      [consumer1.id, consumer2.id],
    );
    expect(resources.hasConsumerAnyResource(consumer1)).toBe(true);
    expect(resources.getConsumer(consumer2.id)).toBe(consumer2);

    const removeFirst = resources.removeConsumer(consumer1, [resource1]);
    expect(removeFirst.ok).toBe(true);
    expect(removed).toEqual([`${consumer1.id}->${resource1.key}`]);
  });

  test("schedules disposal and cancels it when resource is reused before timeout", () => {
    vi.useFakeTimers();
    const { resources } = createTestResources(100);

    resources.addConsumer(consumer1, [resource1]);
    const resource = resources.getResource(resource1.key);
    expect(resource).not.toBeNull();

    const remove = resources.removeConsumer(consumer1, [resource1]);
    expect(remove.ok).toBe(true);

    vi.advanceTimersByTime(50);
    resources.addConsumer(consumer2, [resource1]);
    vi.advanceTimersByTime(100);

    expect(resources.getResource(resource1.key)).toBe(resource);
    expect(resource?.disposed()).toBe(false);

    vi.useRealTimers();
  });

  test("returns typed errors for unknown resource/consumer", () => {
    const { resources } = createTestResources();

    const missingResource = resources.removeConsumer(consumer1, [resource1]);
    expect(missingResource).toEqual({
      ok: false,
      error: { type: "ResourceNotFoundError", resourceKey: resource1.key },
    });

    resources.addConsumer(consumer1, [resource1]);

    const missingConsumer = resources.removeConsumer(unknownConsumer, [
      resource1,
    ]);
    expect(missingConsumer).toEqual({
      ok: false,
      error: {
        type: "ConsumerNotFoundError",
        consumerId: unknownConsumer.id,
        resourceKey: resource1.key,
      },
    });
  });

  test("dispose clears pending timers and disposes live resources", () => {
    vi.useFakeTimers();
    const { resources } = createTestResources(100);

    resources.addConsumer(consumer1, [resource1]);
    const resource = resources.getResource(resource1.key);
    expect(resource).not.toBeNull();

    const remove = resources.removeConsumer(consumer1, [resource1]);
    expect(remove.ok).toBe(true);

    resources[Symbol.dispose]();
    vi.advanceTimersByTime(1_000);

    expect(resource?.disposed()).toBe(true);
    expect(resources.getResource(resource1.key)).toBeNull();
    expect(resources.getConsumersForResource(resource1.key)).toEqual([]);

    vi.useRealTimers();
  });
});
