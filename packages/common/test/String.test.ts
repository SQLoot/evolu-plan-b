import { describe, expect, test } from "vitest";
import { safelyStringifyUnknownValue } from "../src/String.js";

describe("safelyStringifyUnknownValue", () => {
  test("stringifies null and undefined explicitly", () => {
    expect(safelyStringifyUnknownValue(null)).toBe("null");
    expect(safelyStringifyUnknownValue(undefined)).toBe("undefined");
  });

  test("wraps strings in quotes", () => {
    expect(safelyStringifyUnknownValue("hello")).toBe('"hello"');
  });

  test("returns JSON.stringify output for plain values", () => {
    expect(safelyStringifyUnknownValue({ a: 1 })).toBe('{"a":1}');
    expect(safelyStringifyUnknownValue([1, 2, 3])).toBe("[1,2,3]");
  });

  test("falls back to String when JSON.stringify returns undefined", () => {
    expect(safelyStringifyUnknownValue(Symbol.for("x"))).toBe("Symbol(x)");
  });

  test("falls back to String when JSON.stringify throws", () => {
    const circular: { readonly self?: unknown } = {};
    Object.assign(circular, { self: circular });

    expect(safelyStringifyUnknownValue(circular)).toBe("[object Object]");
  });
});
