import { describe, expect, test, vi } from "vitest";
import {
  createRandom,
  createRandomLib,
  createRandomWithSeed,
  testCreateRandom,
  testCreateRandomLib,
} from "../src/Random.js";

describe("Random", () => {
  test("createRandom wraps Math.random", () => {
    const spy = vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    try {
      const random = createRandom();
      expect(random.next()).toBe(0.123456789);
    } finally {
      spy.mockRestore();
    }
  });

  test("createRandomWithSeed is deterministic for equal seeds", () => {
    const randomA = createRandomWithSeed("same-seed");
    const randomB = createRandomWithSeed("same-seed");

    const valuesA = Array.from({ length: 8 }, () => randomA.next());
    const valuesB = Array.from({ length: 8 }, () => randomB.next());
    expect(valuesA).toEqual(valuesB);
  });

  test("testCreateRandom default seed matches createRandomWithSeed('evolu')", () => {
    const fromHelper = testCreateRandom();
    const explicit = createRandomWithSeed("evolu");

    const helperValues = Array.from({ length: 6 }, () => fromHelper.next());
    const explicitValues = Array.from({ length: 6 }, () => explicit.next());
    expect(helperValues).toEqual(explicitValues);
  });
});

describe("RandomLib", () => {
  test("testCreateRandomLib is deterministic for next/int/bool", () => {
    const randomA = testCreateRandomLib("deterministic-seed");
    const randomB = testCreateRandomLib("deterministic-seed");

    const resultA = {
      next: Array.from({ length: 5 }, () => randomA.next()),
      ints: Array.from({ length: 5 }, () => randomA.int(0, 99)),
      bools: Array.from({ length: 5 }, () => randomA.bool()),
    };
    const resultB = {
      next: Array.from({ length: 5 }, () => randomB.next()),
      ints: Array.from({ length: 5 }, () => randomB.int(0, 99)),
      bools: Array.from({ length: 5 }, () => randomB.bool()),
    };

    expect(resultA).toEqual(resultB);
  });

  test("int/ integer use inclusive bounds and one-argument overload", () => {
    const random = testCreateRandomLib("bounds-seed");

    const defaults = Array.from({ length: 50 }, () => random.int());
    expect(defaults.every((value) => value === 0 || value === 1)).toBe(true);

    const singleArg = Array.from({ length: 200 }, () => random.int(7));
    expect(singleArg.every((value) => value >= 0 && value <= 7)).toBe(true);

    const ranged = Array.from({ length: 200 }, () => random.int(-3, 3));
    expect(ranged.every((value) => value >= -3 && value <= 3)).toBe(true);

    const swapped = Array.from({ length: 200 }, () => random.int(5, 2));
    expect(swapped.every((value) => value >= 2 && value <= 5)).toBe(true);

    const integers = Array.from({ length: 100 }, () => random.integer(5, 9));
    expect(integers.every((value) => value >= 5 && value <= 9)).toBe(true);
  });

  test("shuffle returns deterministic copy and does not mutate source", () => {
    const source = [1, 2, 3, 4, 5, 6];
    const randomA = testCreateRandomLib("shuffle-seed");
    const randomB = testCreateRandomLib("shuffle-seed");

    const shuffledA = randomA.shuffle(source);
    const shuffledB = randomB.shuffle(source);

    expect(shuffledA).toEqual(shuffledB);
    expect(shuffledA).not.toEqual(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("clone keeps sequence position and remains deterministic", () => {
    const random = testCreateRandomLib("clone-seed");
    random.next();
    random.next();
    random.int(0, 1000);

    const clone = random.clone();
    expect(clone.next()).toBe(random.next());
    expect(clone.next()).toBe(random.next());
  });

  test("createRandomLib creates values in expected ranges", () => {
    const random = createRandomLib();
    const values = Array.from({ length: 20 }, () => random.next());
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    const ints = Array.from({ length: 20 }, () => random.int(2));
    expect(ints.every((value) => value >= 0 && value <= 2)).toBe(true);
  });
});
