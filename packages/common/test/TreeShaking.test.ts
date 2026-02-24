import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import webpack, { type Stats } from "webpack";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(
  __dirname,
  "../dist/test/__fixtures__/tree-shaking",
);
const distDir = resolve(__dirname, "../dist/src/index.js");
const tmpDir = resolve(__dirname, "../test/tmp/tree-shaking");

interface BundleSize {
  readonly raw: number;
  readonly gzip: number;
}

type TreeShakingFixture = "result-all" | "task-example" | "type-object";

const runBundle = (bundlePath: string): void => {
  const bootstrap = `
if (!Promise.try) {
  Promise.try = (callback, ...args) =>
    new Promise((resolve, reject) => {
      try {
        resolve(callback(...args));
      } catch (error) {
        reject(error);
      }
    });
}
require(process.argv[1]);
`;

  const result = spawnSync(process.execPath, ["-e", bootstrap, bundlePath], {
    stdio: "inherit",
    timeout: 15000,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const signal = result.signal ?? "unknown";
    throw new Error(
      `Bundle execution failed: status ${result.status} (signal: ${signal})`,
    );
  }
};

/**
 * Bundles a fixture file using webpack in production mode and returns the
 * minified bundle size in bytes (raw and gzipped). Uses compiled dist output
 * for realistic tree-shaking measurement. Output is kept in tmp/tree-shaking
 * for inspection.
 *
 * The webpack configuration mirrors Next.js production builds. Results were
 * manually compared with Chrome DevTools network stats to ensure accuracy.
 */
const bundleSize = async (fixturePath: string): Promise<BundleSize> => {
  const fixtureName = basename(fixturePath, ".js");
  const outputDir = join(tmpDir, fixtureName);

  // Clean and recreate output directory
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true });
  }
  mkdirSync(outputDir, { recursive: true });

  const compiler = webpack({
    mode: "production",
    entry: fixturePath,
    output: {
      path: outputDir,
      filename: "bundle.js",
    },
    resolve: {
      extensions: [".js"],
      alias: {
        "@evolu/common": distDir,
      },
    },
    optimization: {
      usedExports: true,
      sideEffects: true,
      minimize: true,
    },
    stats: "errors-only",
  });

  return await new Promise((resolve, reject) => {
    compiler.run((err: Error | null, stats: Stats | undefined) => {
      compiler.close(() => {
        if (err) {
          reject(err);
          return;
        }
        if (stats?.hasErrors()) {
          reject(new Error(stats.toString()));
          return;
        }
        const bundlePath = join(outputDir, "bundle.js");
        runBundle(bundlePath);
        const bundle = readFileSync(bundlePath);
        resolve({
          raw: bundle.byteLength,
          gzip: gzipSync(bundle).byteLength,
        });
      });
    });
  });
};

/**
 * Gets all fixture files from the tree-shaking fixtures directory (compiled
 * JS).
 */
const getFixtures = (): ReadonlyArray<string> => {
  const files = readdirSync(fixturesDir);
  return files
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(fixturesDir, f))
    .sort();
};

/**
 * Normalizes bundle sizes to handle environmental fluctuation.
 *
 * Webpack bundle size varies across Bun/Node and environment versions due to
 * minifier differences. Normalize known fixture ranges to stable midpoints
 * for snapshot stability.
 */
const normalizeBundleSize = (
  fixture: TreeShakingFixture,
  size: BundleSize,
): BundleSize => {
  let { gzip, raw } = size;

  if (fixture === "result-all") {
    if (gzip >= 670 && gzip <= 710) gzip = 689;
    if (raw >= 1550 && raw <= 1650) raw = 1602;
  }

  if (fixture === "task-example") {
    if (gzip >= 5600 && gzip <= 5725) gzip = 5668;
    if (raw >= 15050 && raw <= 15250) raw = 15192;
  }

  if (fixture === "type-object") {
    if (gzip >= 1480 && gzip <= 1620) gzip = 1549;
    if (raw >= 4600 && raw <= 4850) raw = 4747;
  }

  return { gzip, raw };
};

describe("tree-shaking", () => {
  test("bundle sizes", async () => {
    const fixtures = getFixtures();
    const results: Record<string, BundleSize> = {};

    for (const fixture of fixtures) {
      const name = basename(fixture, ".js") as TreeShakingFixture;
      results[name] = normalizeBundleSize(name, await bundleSize(fixture));
    }

    expect(results).toMatchInlineSnapshot(`
      {
        "result-all": {
          "gzip": 689,
          "raw": 1602,
        },
        "task-example": {
          "gzip": 5668,
          "raw": 15192,
        },
        "type-object": {
          "gzip": 1549,
          "raw": 4747,
        },
      }
    `);
  }, 120000);
});
