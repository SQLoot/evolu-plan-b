import { describe, expect, test } from "vitest";
import {
  assertTanStackClientRuntime,
  isTanStackServerRuntime,
  withTanStackClientRuntime,
} from "../src/index.js";

describe("@evolu/tanstack-start", () => {
  test("detects node runtime as server-side", () => {
    expect(isTanStackServerRuntime()).toBe(true);
  });

  test("throws when initialized outside client boundary", () => {
    expect(() => assertTanStackClientRuntime()).toThrowError(
      /client boundary/i,
    );
  });

  test("wrapper keeps runtime guard active", () => {
    const wrapped = withTanStackClientRuntime(() => "ok");
    expect(() => wrapped()).toThrowError(/client boundary/i);
  });
});
