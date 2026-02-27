import { describe, expect, test } from "vitest";
import {
  assertAstroClientRuntime,
  isAstroClientRuntime,
  withAstroClientRuntime,
} from "../src/index.js";

describe("@evolu/astro", () => {
  test("reports server runtime in node test environment", () => {
    expect(isAstroClientRuntime()).toBe(false);
  });

  test("throws a client-only error outside browser runtime", () => {
    expect(() => assertAstroClientRuntime()).toThrowError(
      /client-only island/i,
    );
  });

  test("withAstroClientRuntime preserves failure semantics", () => {
    const run = withAstroClientRuntime(() => "ok");
    expect(() => run()).toThrowError(/client-only island/i);
  });
});
