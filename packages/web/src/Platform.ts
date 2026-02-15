import {
  createInstances,
  createMutex,
  type LeaderLock,
  type Mutex,
  ok,
  type ReloadApp,
  type SimpleName,
} from "@evolu/common";

const leaderLockMutexes = createInstances<SimpleName, Mutex>();

const createLeaseRelease = () => {
  const release = Promise.withResolvers<void>();
  let isResolved = false;
  return {
    promise: release.promise,
    resolve: () => {
      if (isResolved) return;
      isResolved = true;
      release.resolve();
    },
  };
};

const acquireInMemoryLeaderLock: LeaderLock["acquire"] =
  (name) => async (run) => {
    const acquired = Promise.withResolvers<void>();
    const release = createLeaseRelease();

    run.onAbort(release.resolve);

    void run.daemon(
      leaderLockMutexes.ensure(name, createMutex).withLock(async () => {
        acquired.resolve();
        await release.promise;
        return ok();
      }),
    );

    await acquired.promise;

    return ok({
      [Symbol.dispose]: release.resolve,
    });
  };

export const leaderLock: LeaderLock = {
  acquire: (name) => async (run) => {
    const locks = globalThis.navigator?.locks;
    if (!locks) return run(acquireInMemoryLeaderLock(name));

    const acquired = Promise.withResolvers<void>();
    const requestFailed = Promise.withResolvers<void>();
    const release = createLeaseRelease();

    run.onAbort(release.resolve);

    let request: Promise<unknown>;
    try {
      request = locks.request(
        `evolu-leader-${name}`,
        { mode: "exclusive" },
        async () => {
          acquired.resolve();
          await release.promise;
        },
      );
    } catch {
      return run(acquireInMemoryLeaderLock(name));
    }

    void request.catch(() => {
      requestFailed.resolve();
    });

    const state = await Promise.race([
      acquired.promise.then(() => "acquired" as const),
      requestFailed.promise.then(() => "failed" as const),
    ]);

    if (state === "failed") {
      release.resolve();
      return run(acquireInMemoryLeaderLock(name));
    }

    return ok({
      [Symbol.dispose]: release.resolve,
    });
  },
};

export const reloadApp: ReloadApp = (url) => {
  if (typeof document === "undefined") {
    return;
  }

  location.replace(url ?? "/");
};
