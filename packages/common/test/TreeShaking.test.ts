import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, test } from "vitest";
import webpack, { type Stats } from "webpack";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesSourceDir = resolve(
  __dirname,
  "../test/__fixtures__/tree-shaking",
);
const distDir = resolve(__dirname, "../dist/src/index.js");
const tmpDir = resolve(__dirname, "../test/tmp/tree-shaking");
const fixturesDir = join(tmpDir, "fixtures");

interface BundleSize {
  readonly raw: number;
  readonly gzip: number;
}

type TreeShakingFixture = "result-all" | "task-example" | "type-object";
const isCompatLaneEnabled = process.env.EVOLU_TREE_SHAKING_COMPAT === "1";
const isBunLaneEnabled = process.env.EVOLU_TREE_SHAKING_BUN === "1";
const isBunRuntime = Boolean((process.versions as { bun?: string }).bun);

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
const { pathToFileURL } = require("node:url");
(async () => {
  const fileUrl = pathToFileURL(process.argv[1]).href;
  await import(fileUrl);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
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
        try {
          if (err) {
            reject(err);
            return;
          }
          if (stats?.hasErrors()) {
            reject(new Error(stats.toString()));
            return;
          }
          const bundlePath = join(outputDir, "bundle.js");
          const bundle = readFileSync(bundlePath);
          resolve({
            raw: bundle.byteLength,
            gzip: gzipSync(bundle).byteLength,
          });
        } catch (error) {
          reject(error);
        }
      });
    });
  });
};

const bundleWithBun = (fixturePath: string, outputDir: string): string => {
  if (!isBunRuntime) {
    throw new Error("Bun tree-shaking lane requires Bun runtime.");
  }

  const entrySource = readFileSync(fixturePath, "utf8").replace(
    /(["'])@evolu\/common\1/g,
    JSON.stringify(distDir.replaceAll("\\", "/")),
  );
  const entryPath = join(outputDir, "entry.js");
  writeFileSync(entryPath, entrySource);

  const bundlePath = join(outputDir, "bundle.js");
  const result = spawnSync(
    process.execPath,
    [
      "build",
      entryPath,
      "--outfile",
      bundlePath,
      "--target",
      "browser",
      "--minify",
    ],
    {
      encoding: "utf8",
      timeout: 30000,
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `bun build failed (status ${result.status}): ${result.stderr || result.stdout}`,
    );
  }

  if (!existsSync(bundlePath)) {
    throw new Error("bun build did not create bundle.js");
  }

  return bundlePath;
};

/**
 * Compiles TypeScript fixtures to JavaScript in a temp directory and returns
 * compiled fixture file paths.
 */
const getFixtures = (): ReadonlyArray<string> => {
  if (existsSync(fixturesDir)) {
    rmSync(fixturesDir, { recursive: true });
  }
  mkdirSync(fixturesDir, { recursive: true });

  const files = readdirSync(fixturesSourceDir)
    .filter((file) => file.endsWith(".ts"))
    .sort();

  for (const file of files) {
    const sourcePath = join(fixturesSourceDir, file);
    const source = readFileSync(sourcePath, "utf8");
    const { outputText } = transpileModule(source, {
      compilerOptions: {
        module: ModuleKind.ESNext,
        target: ScriptTarget.ES2020,
      },
      fileName: sourcePath,
    });

    const outputPath = join(fixturesDir, file.replace(/\.ts$/, ".js"));
    writeFileSync(outputPath, outputText);
  }

  return files.map((file) => join(fixturesDir, file.replace(/\.ts$/, ".js")));
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
  test("bundle sizes (fast lane)", async () => {
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
  }, 90000);

  const compatTest = isCompatLaneEnabled ? test : test.skip;

  compatTest(
    "bundle runtime compatibility (compat lane)",
    async () => {
      const fixtures = getFixtures();
      for (const fixture of fixtures) {
        const fixtureName = basename(fixture, ".js");
        const bundleDir = join(tmpDir, `${fixtureName}-compat`);

        if (existsSync(bundleDir)) {
          rmSync(bundleDir, { recursive: true });
        }
        mkdirSync(bundleDir, { recursive: true });

        const compiler = webpack({
          mode: "production",
          entry: fixture,
          output: {
            path: bundleDir,
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

        await new Promise<void>((resolve, reject) => {
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

              try {
                runBundle(join(bundleDir, "bundle.js"));
                resolve();
              } catch (error) {
                reject(error);
              }
            });
          });
        });
      }
    },
    120000,
  );

  const bunLaneTest =
    isBunLaneEnabled && isBunRuntime && process.platform !== "win32"
      ? test
      : test.skip;

  bunLaneTest(
    "bundle runtime compatibility (bun lane)",
    async () => {
      const fixtures = getFixtures();
      for (const fixture of fixtures) {
        const fixtureName = basename(fixture, ".js");
        const bundleDir = join(tmpDir, `${fixtureName}-bun`);

        if (existsSync(bundleDir)) {
          rmSync(bundleDir, { recursive: true });
        }
        mkdirSync(bundleDir, { recursive: true });

        const bundlePath = bundleWithBun(fixture, bundleDir);
        runBundle(bundlePath);
      }
    },
    120000,
  );
});
