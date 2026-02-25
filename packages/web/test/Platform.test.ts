import { Name, testName } from "@evolu/common";
import { describe, expect, test } from "vitest";
import { createLeaderLock, createRun } from "../src/Task.js";

const withNavigator = async (
  navigator: typeof globalThis.navigator | undefined,
  runTest: () => Promise<void>,
): Promise<void> => {
  const originalNavigator = globalThis.navigator;

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: navigator,
  });

  try {
    await runTest();
  } finally {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      writable: true,
      value: originalNavigator,
    });
  }
};

const expectSequentialAcquireForSameName = async (): Promise<void> => {
  await using run = createRun();
  const leaderLock = createLeaderLock();

  const first = await run(leaderLock.acquire(testName));
  expect(first.ok).toBe(true);
  if (!first.ok) return;

  let secondSettled = false;
  const second = run(leaderLock.acquire(testName));
  void second.then(() => {
    secondSettled = true;
  });

  await Promise.resolve();
  expect(secondSettled).toBe(false);

  first.value[Symbol.dispose]();

  const secondResult = await second;
  expect(secondResult.ok).toBe(true);
  if (!secondResult.ok) return;

  secondResult.value[Symbol.dispose]();
};

describe("leaderLock", () => {
  test("acquire waits until previous lease is disposed", async () => {
    await expectSequentialAcquireForSameName();
  });

  test("different names acquire independently", async () => {
    await using run = createRun();
    const leaderLock = createLeaderLock();

    const aName = Name.orThrow("LeaderLockA");
    const bName = Name.orThrow("LeaderLockB");

    const [a, b] = await Promise.all([
      run(leaderLock.acquire(aName)),
      run(leaderLock.acquire(bName)),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);

    if (a.ok) a.value[Symbol.dispose]();
    if (b.ok) b.value[Symbol.dispose]();
  });

  test("falls back to in-memory lock when navigator.locks is missing", async () => {
    await withNavigator(
      {} as typeof globalThis.navigator,
      expectSequentialAcquireForSameName,
    );
  });

  test("falls back to in-memory lock when locks.request throws", async () => {
    await withNavigator(
      {
        locks: {
          request: () => {
            throw new Error("request unavailable");
          },
        },
      } as unknown as typeof globalThis.navigator,
      expectSequentialAcquireForSameName,
    );
  });

  test("falls back to in-memory lock when locks.request rejects", async () => {
    await withNavigator(
      {
        locks: {
          request: async () => {
            throw new Error("request rejected");
          },
        },
      } as unknown as typeof globalThis.navigator,
      expectSequentialAcquireForSameName,
    );
  });
});
