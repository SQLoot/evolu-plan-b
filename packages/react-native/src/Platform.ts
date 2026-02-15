import {
  createInstances,
  createMutex,
  type LeaderLock,
  type Mutex,
  ok,
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

export const leaderLock: LeaderLock = {
  acquire: (name) => async (run) => {
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
  },
};
