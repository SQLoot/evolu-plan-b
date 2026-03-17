/**
 * Seeded random number generation.
 *
 * @module
 */

import type { Brand } from "./Brand.js";

interface Arc4RngSnapshot {
  readonly seed: string | number;
  readonly i: number;
  readonly j: number;
  readonly state: ReadonlyArray<number>;
}

const arc4StartDenom = 281_474_976_710_656;
const arc4Significance = 4_503_599_627_370_496;
const arc4Overflow = 9_007_199_254_740_992;

const mixSeedIntoKey = (
  seed: string | number,
  key: Array<number>,
): Array<number> => {
  const seedString = String(seed);
  let smear = 0;

  for (let index = 0; index < seedString.length; index++) {
    const keyIndex = index & 255;
    const previous = key[keyIndex] ?? 0;
    smear ^= previous * 19;
    key[keyIndex] = (smear + seedString.charCodeAt(index)) & 255;
  }

  return key.length > 0 ? key : [0];
};

const createDefaultSeed = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Math.random()}-${Date.now()}`;

const shuffleInPlace = <T>(array: Array<T>, next: () => number): void => {
  for (let i = array.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(next() * (i + 1));
    const temporary = array[i] as T;
    array[i] = array[randomIndex] as T;
    array[randomIndex] = temporary;
  }
};

class Arc4Rng {
  private static readonly stateSize = 256;

  private readonly seed: string | number;
  private i = 0;
  private j = 0;
  private readonly state: Array<number>;

  constructor(
    seedOrSnapshot: string | number | Arc4RngSnapshot = createDefaultSeed(),
  ) {
    if (typeof seedOrSnapshot === "object") {
      this.seed = seedOrSnapshot.seed;
      this.i = seedOrSnapshot.i;
      this.j = seedOrSnapshot.j;
      this.state = [...seedOrSnapshot.state];
      return;
    }

    this.seed = seedOrSnapshot;
    const key = mixSeedIntoKey(seedOrSnapshot, []);
    const state = new Array<number>(Arc4Rng.stateSize);

    for (let index = 0; index < Arc4Rng.stateSize; index++) {
      state[index] = index;
    }

    const keyLength = key.length;
    let j = 0;
    for (let i = 0; i < Arc4Rng.stateSize; i++) {
      const t = state[i] as number;
      j = (j + (key[i % keyLength] as number) + t) & 255;
      state[i] = state[j] as number;
      state[j] = t;
    }

    this.state = state;
    this.generate(256);
  }

  next = (): number => {
    let numerator = this.generate(6);
    let denominator = arc4StartDenom;
    let carry = 0;

    while (numerator < arc4Significance) {
      numerator = (numerator + carry) * 256;
      denominator *= 256;
      carry = this.generate(1);
    }

    while (numerator >= arc4Overflow) {
      numerator /= 2;
      denominator /= 2;
      carry >>>= 1;
    }

    return (numerator + carry) / denominator;
  };

  clone = (): Arc4Rng =>
    new Arc4Rng({
      seed: this.seed,
      i: this.i,
      j: this.j,
      state: this.state,
    });

  private generate = (count: number): number => {
    let result = 0;
    const state = this.state;
    let i = this.i;
    let j = this.j;

    while (count--) {
      i = (i + 1) & 255;
      const t = state[i] as number;
      j = (j + t) & 255;
      state[i] = state[j] as number;
      state[j] = t;
      result =
        result * 256 +
        (state[((state[i] as number) + (state[j] as number)) & 255] as number);
    }

    this.i = i;
    this.j = j;
    return result;
  };
}

/**
 * A random floating point number in [0, 1).
 *
 * Branded to distinguish random values from arbitrary numbers.
 */
export type RandomNumber = number & Brand<"RandomNumber">;

/**
 * A simple wrapper around Math.random().
 *
 * For more complex needs check {@link RandomLibDep}.
 *
 * ### Example
 *
 * ```ts
 * // For apps
 * const random = createRandom();
 * random.next();
 *
 * // For tests
 * const random = createRandomWithSeed("test");
 * random.next();
 * ```
 */
export interface Random {
  /** Returns a floating point number in [0, 1). Just like Math.random(). */
  next: () => RandomNumber;
}

export interface RandomDep {
  random: Random;
}

/** Creates a {@link Random} using Math.random(). */
export const createRandom = (): Random => ({
  next: () => Math.random() as RandomNumber,
});

/** Creates a seeded {@link Random} for deterministic tests. Default seed "evolu". */
export const testCreateRandom = (seed = "evolu"): Random =>
  createRandomWithSeed(seed);

/**
 * Creates {@link Random} using {@link RandomLibDep} with a seed which is useful
 * for tests.
 */
export const createRandomWithSeed = (seed: string): Random => {
  const random = new Arc4Rng(seed);
  return {
    next: () => random.next() as RandomNumber,
  };
};

/**
 * Seeded pseudo-random utility used by test helpers.
 */
export interface RandomLibDep {
  randomLib: RandomLib;
}

export interface RandomLib {
  readonly next: () => number;
  readonly int: (min?: number, max?: number) => number;
  readonly integer: (min?: number, max?: number) => number;
  readonly shuffle: <T>(array: ReadonlyArray<T>) => Array<T>;
  readonly bool: () => boolean;
  readonly clone: () => RandomLib;
}

class Arc4RandomLib implements RandomLib {
  private readonly rng: Arc4Rng;

  constructor(seedOrRng: string | number | Arc4Rng = createDefaultSeed()) {
    this.rng =
      seedOrRng instanceof Arc4Rng ? seedOrRng : new Arc4Rng(seedOrRng);
  }

  next = (): number => this.rng.next();

  int = (min?: number, max?: number): number => {
    if (max === undefined) {
      max = min === undefined ? 1 : min;
      min = 0;
    }

    let lowerBound = min ?? 0;
    let upperBound = max;

    if (lowerBound > upperBound) {
      [lowerBound, upperBound] = [upperBound, lowerBound];
    }

    return Math.floor(this.next() * (upperBound - lowerBound + 1) + lowerBound);
  };

  integer = (min?: number, max?: number): number => this.int(min, max);

  bool = (): boolean => this.next() >= 0.5;

  shuffle = <T>(array: ReadonlyArray<T>): Array<T> => {
    const copy = [...array];
    shuffleInPlace(copy, this.next);
    return copy;
  };

  clone = (): RandomLib => new Arc4RandomLib(this.rng.clone());
}

/** Creates seeded random utilities used by test fixtures and fuzz helpers. */
export const createRandomLib = (): RandomLib => new Arc4RandomLib();

/** Creates deterministic `RandomLib` for tests. Default seed "evolu". */
export const testCreateRandomLib = (seed = "evolu"): RandomLib =>
  new Arc4RandomLib(seed);
