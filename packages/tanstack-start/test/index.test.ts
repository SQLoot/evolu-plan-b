import { describe, expect, test } from "vitest";
import {
  assertTanStackClientRuntime,
  isTanStackServerRuntime,
  withTanStackClientRuntime,
} from "../src/index.js";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");

const setWindowRuntime = (runtime: "server" | "client"): void => {
  Reflect.deleteProperty(globalThis, "window");
  if (runtime === "client") {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
      writable: true,
    });
  }
};

const restoreWindowRuntime = (): void => {
  if (windowDescriptor) {
    Object.defineProperty(globalThis, "window", windowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
};

describe("@evolu/tanstack-start", () => {
  test("detects node runtime as server-side", () => {
    setWindowRuntime("server");
    expect(isTanStackServerRuntime()).toBe(true);
    restoreWindowRuntime();
  });

  test("detects browser runtime as client-side", () => {
    setWindowRuntime("client");
    expect(isTanStackServerRuntime()).toBe(false);
    restoreWindowRuntime();
  });

  test("throws typed error when initialized outside client boundary", () => {
    setWindowRuntime("server");
    try {
      assertTanStackClientRuntime();
      throw new Error("Expected assertTanStackClientRuntime to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/client boundary/i);
      expect((error as Error).name).toBe("TanStackClientOnlyError");
      expect((error as { code?: unknown }).code).toBe("TANSTACK_CLIENT_ONLY");
    } finally {
      restoreWindowRuntime();
    }
  });

  test("wrapper keeps runtime guard active", () => {
    setWindowRuntime("server");
    const wrapped = withTanStackClientRuntime(() => "ok");
    expect(() => wrapped()).toThrowError(/client boundary/i);
    restoreWindowRuntime();
  });

  test("wrapper executes function on client runtime", () => {
    setWindowRuntime("client");
    const wrapped = withTanStackClientRuntime((value: string) => value.length);
    expect(wrapped("tanstack")).toBe(8);
    restoreWindowRuntime();
  });
});
