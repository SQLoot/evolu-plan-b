/**
 * Test utilities for deterministic testing.
 *
 * @module
 */

import { type TestConsoleDep, testCreateConsole } from "./Console.js";
import {
  Entropy32,
  type RandomBytesDep,
  testCreateRandomBytes,
} from "./Crypto.js";
import { createAppOwner, OwnerSecret } from "./local-first/Owner.js";
import {
  type RandomDep,
  type RandomLibDep,
  testCreateRandom,
  testCreateRandomLib,
} from "./Random.js";
import { createRunner, type Runner, type RunnerConfigDep } from "./Task.js";
import { type TimeDep, testCreateTime } from "./Time.js";

/** Test deps created by {@link testCreateDeps}. */
export type TestDeps = TestConsoleDep &
  RandomBytesDep &
  RandomDep &
  RandomLibDep &
  TimeDep;

/**
 * Creates test dependencies for proper isolation.
 *
 * Each call creates fresh instances, so tests don't share state.
 *
 * ### Example
 *
 * ```ts
 * test("my test", async () => {
 *   const deps = testCreateDeps();
 *   await using run = testCreateRunner(deps);
 *
 *   const fiber = run(sleep("1s"));
 *   deps.time.advance("1s");
 *   await fiber;
 * });
 * ```
 */
export const testCreateDeps = (options?: {
  readonly seed?: string;
}): TestDeps => {
  const seed = options?.seed ?? "evolu";
  const console = testCreateConsole();
  const random = testCreateRandom(seed);
  const randomLib = testCreateRandomLib(seed);
  const randomBytes = testCreateRandomBytes({ randomLib });
  const time = testCreateTime();
  return { console, randomBytes, random, randomLib, time };
};

/**
 * Creates a test {@link Runner} with deterministic deps.
 *
 * Uses {@link TestDeps} which provides seeded random values, ensuring
 * deterministic fiber IDs, timestamps, and other generated values. This makes
 * tests reproducible and snapshot-friendly.
 *
 * Accepts partial deps - any missing deps are created with defaults. Also
 * accepts {@link RunnerConfigDep} for enabling events and custom deps.
 *
 * ### Example
 *
 * ```ts
 * // Basic usage with TestDeps
 * await using run = testCreateRunner();
 *
 * // Override specific deps
 * await using run = testCreateRunner({ time: customTime });
 *
 * // Add custom deps
 * interface HttpDep {
 *   readonly http: Http;
 * }
 * await using run = testCreateRunner({ http });
 * // run is Runner<TestDeps & HttpDep>
 * ```
 */
export function testCreateRunner(): Runner<TestDeps>;

/** With custom dependencies merged into {@link TestDeps}. */
export function testCreateRunner<D>(deps: D): Runner<TestDeps & D>;

export function testCreateRunner<D>(deps?: D): Runner<TestDeps & D> {
  const defaults = testCreateDeps();
  return createRunner<TestDeps & D>({ ...defaults, ...deps } as TestDeps & D);
}

/**
 * Backward-compatible alias for upstream naming.
 *
 * Prefer {@link testCreateRunner} in SQLoot code.
 */
export const testCreateRun: typeof testCreateRunner = testCreateRunner;

// Deterministic test values for reproducible fixtures. Keep eager test values
// here to avoid affecting tree-shaking baselines.
// Functions are ok.

export const testEntropy32 = /*#__PURE__*/ Entropy32.orThrow(
  new globalThis.Uint8Array([
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
  ]),
);

export const testOwnerSecret = /*#__PURE__*/ OwnerSecret.orThrow(testEntropy32);

export const testAppOwner = /*#__PURE__*/ createAppOwner(testOwnerSecret);
