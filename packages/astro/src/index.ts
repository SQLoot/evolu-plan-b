export interface AstroClientOnlyError extends Error {
  code: "ASTRO_CLIENT_ONLY";
}

export const isAstroClientRuntime = (): boolean =>
  typeof window !== "undefined" && typeof document !== "undefined";

export const assertAstroClientRuntime = (): void => {
  if (isAstroClientRuntime()) return;

  const error = new Error(
    'Astro integration must run in a client-only island (for example client:only="react").',
  ) as AstroClientOnlyError;
  error.name = "AstroClientOnlyError";
  error.code = "ASTRO_CLIENT_ONLY";
  throw error;
};

export const withAstroClientRuntime =
  <TArgs extends ReadonlyArray<unknown>, TResult>(
    fn: (...args: TArgs) => TResult,
  ) =>
  (...args: TArgs): TResult => {
    assertAstroClientRuntime();
    return fn(...args);
  };
