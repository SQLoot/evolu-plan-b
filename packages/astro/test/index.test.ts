import { describe, expect, test } from "vitest";
import {
  assertAstroClientRuntime,
  isAstroClientRuntime,
  withAstroClientRuntime,
} from "../src/index.js";

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
const documentDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "document",
);

const deleteRuntimeGlobals = (): void => {
  Reflect.deleteProperty(globalThis, "window");
  Reflect.deleteProperty(globalThis, "document");
};

const setRuntime = (runtime: "server" | "window-only" | "client"): void => {
  deleteRuntimeGlobals();
  if (runtime === "window-only" || runtime === "client") {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {},
      writable: true,
    });
  }
  if (runtime === "client") {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {},
      writable: true,
    });
  }
};

const restoreRuntime = (): void => {
  if (windowDescriptor) {
    Object.defineProperty(globalThis, "window", windowDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
  if (documentDescriptor) {
    Object.defineProperty(globalThis, "document", documentDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "document");
  }
};

describe("@evolu/astro", () => {
  test("reports server runtime in node test environment", () => {
    setRuntime("server");
    expect(isAstroClientRuntime()).toBe(false);
    restoreRuntime();
  });

  test("reports non-client runtime when window exists without document", () => {
    setRuntime("window-only");
    expect(isAstroClientRuntime()).toBe(false);
    restoreRuntime();
  });

  test("reports client runtime when window and document exist", () => {
    setRuntime("client");
    expect(isAstroClientRuntime()).toBe(true);
    restoreRuntime();
  });

  test("throws typed client-only error outside browser runtime", () => {
    setRuntime("server");
    try {
      assertAstroClientRuntime();
      throw new Error("Expected assertAstroClientRuntime to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/client-only island/i);
      expect((error as Error).name).toBe("AstroClientOnlyError");
      expect((error as { code?: unknown }).code).toBe("ASTRO_CLIENT_ONLY");
    } finally {
      restoreRuntime();
    }
  });

  test("does not throw inside client runtime", () => {
    setRuntime("client");
    expect(() => assertAstroClientRuntime()).not.toThrow();
    restoreRuntime();
  });

  test("withAstroClientRuntime preserves failure semantics", () => {
    setRuntime("server");
    const run = withAstroClientRuntime(() => "ok");
    expect(() => run()).toThrowError(/client-only island/i);
    restoreRuntime();
  });

  test("withAstroClientRuntime forwards args and returns result in client runtime", () => {
    setRuntime("client");
    const run = withAstroClientRuntime(
      (left: number, right: number) => `${left + right}`,
    );
    expect(run(2, 3)).toBe("5");
    restoreRuntime();
  });
});
