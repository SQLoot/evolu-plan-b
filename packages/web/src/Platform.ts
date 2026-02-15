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

const acquireInMemoryLeaderLock: LeaderLock["acquire"] =
  (name) => async (run) => {
    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    void run.daemon(
      leaderLockMutexes.ensure(name, createMutex).withLock(async () => {
        acquired.resolve();
        await release.promise;
        return ok();
      }),
    );

    await acquired.promise;

    return ok({
      [Symbol.dispose]: () => {
        release.resolve();
      },
    });
  };

export const leaderLock: LeaderLock = {
  acquire: (name) => async (run) => {
    const locks = globalThis.navigator?.locks;
    if (!locks) return run(acquireInMemoryLeaderLock(name));

    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    void locks.request(
      `evolu-leader-${name}`,
      { mode: "exclusive" },
      async () => {
        acquired.resolve();
        await release.promise;
      },
    );

    await acquired.promise;

    return ok({
      [Symbol.dispose]: () => {
        release.resolve();
      },
    });
  },
};

export const reloadApp: ReloadApp = (url) => {
  if (typeof document === "undefined") {
    return;
  }

  location.replace(url ?? "/");
};
