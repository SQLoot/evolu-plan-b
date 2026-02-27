export interface TanStackClientOnlyError extends Error {
  code: "TANSTACK_CLIENT_ONLY";
}

export const isTanStackServerRuntime = (): boolean =>
  typeof window === "undefined";

export const assertTanStackClientRuntime = (): void => {
  if (!isTanStackServerRuntime()) return;

  const error = new Error(
    "TanStack integration must be initialized from a client boundary.",
  ) as TanStackClientOnlyError;
  error.name = "TanStackClientOnlyError";
  error.code = "TANSTACK_CLIENT_ONLY";
  throw error;
};

export const withTanStackClientRuntime =
  <TArgs extends ReadonlyArray<unknown>, TResult>(
    fn: (...args: TArgs) => TResult,
  ) =>
  (...args: TArgs): TResult => {
    assertTanStackClientRuntime();
    return fn(...args);
  };
