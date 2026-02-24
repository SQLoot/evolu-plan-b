import { installPolyfills } from "../../common/src/Polyfills.js";

installPolyfills();

if (!(Promise as any).try) {
  (Promise as any).try = <T, Args extends readonly unknown[]>(
    callback: (...args: Args) => T | PromiseLike<T>,
    ...args: Args
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      try {
        resolve(callback(...args));
      } catch (error) {
        reject(error);
      }
    });
}

if (!(Promise as any).withResolvers) {
  (Promise as any).withResolvers = <T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  } => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
