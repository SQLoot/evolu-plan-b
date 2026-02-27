import { afterEach, expect, test, vi } from "vitest";
import { reloadApp } from "../../web/src/Platform.js";

const withGlobals = (
  globals: Partial<{
    document: unknown;
    location: unknown;
  }>,
): void => {
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value,
    });
  }
};

afterEach(() => {
  for (const key of ["document", "location"]) {
    // Cleanup to keep node tests isolated.
    Reflect.deleteProperty(globalThis, key);
  }
});

test("reloadApp is a no-op when document is not available", () => {
  withGlobals({
    location: { replace: vi.fn() },
  });

  expect(() => reloadApp("/ignored")).not.toThrow();
});

test("reloadApp replaces location with provided url", () => {
  const replace = vi.fn();
  withGlobals({
    document: {},
    location: { replace },
  });

  reloadApp("/next");

  expect(replace).toHaveBeenCalledWith("/next");
});

test("reloadApp defaults to root path", () => {
  const replace = vi.fn();
  withGlobals({
    document: {},
    location: { replace },
  });

  reloadApp();

  expect(replace).toHaveBeenCalledWith("/");
});
