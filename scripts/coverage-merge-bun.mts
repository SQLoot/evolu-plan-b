#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

type Counter = {
  total: number;
  covered: number;
};

type CoverageMetric = Counter & {
  skipped: number;
  pct: number;
};

type CoverageEntry = {
  lines: CoverageMetric;
  functions: CoverageMetric;
  statements: CoverageMetric;
  branches: CoverageMetric;
};

type CoverageSummary = Record<string, CoverageEntry>;

type LcovRecord = {
  file: string;
  lines: Counter;
  functions: Counter;
  branches: Counter;
};

const toMetric = ({ total, covered }: Counter): CoverageMetric => ({
  total,
  covered,
  skipped: 0,
  pct: total === 0 ? 100 : (covered / total) * 100,
});

const parseArgs = (args: ReadonlyArray<string>): Map<string, string> => {
  const config = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error(
        `Invalid arguments. Expected --key value pairs, got: ${args.join(" ")}`,
      );
    }
    config.set(key.slice(2), value);
  }
  return config;
};

const parseLcov = (lcovContent: string): Array<LcovRecord> => {
  const lines = lcovContent.split(/\r?\n/);
  const records: Array<LcovRecord> = [];
  let current: LcovRecord | null = null;

  const pushCurrent = (): void => {
    if (current?.file) records.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("SF:")) {
      pushCurrent();
      current = {
        file: line.slice(3),
        lines: { total: 0, covered: 0 },
        functions: { total: 0, covered: 0 },
        branches: { total: 0, covered: 0 },
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("LF:")) {
      current.lines.total = Number(line.slice(3));
      continue;
    }
    if (line.startsWith("LH:")) {
      current.lines.covered = Number(line.slice(3));
      continue;
    }
    if (line.startsWith("FNF:")) {
      current.functions.total = Number(line.slice(4));
      continue;
    }
    if (line.startsWith("FNH:")) {
      current.functions.covered = Number(line.slice(4));
      continue;
    }
    if (line.startsWith("BRF:")) {
      current.branches.total = Number(line.slice(4));
      continue;
    }
    if (line.startsWith("BRH:")) {
      current.branches.covered = Number(line.slice(4));
      continue;
    }
    if (line === "end_of_record") {
      pushCurrent();
    }
  }

  pushCurrent();
  return records;
};

const normalizeSlashes = (value: string): string => value.replaceAll("\\", "/");

const resolveCoverageKey = (
  summary: CoverageSummary,
  sourcePath: string,
): string => {
  const normalizedSourcePath = normalizeSlashes(sourcePath);
  if (summary[sourcePath]) return sourcePath;

  for (const key of Object.keys(summary)) {
    const normalizedKey = normalizeSlashes(key);
    if (normalizedKey.endsWith(normalizedSourcePath)) return key;
    if (normalizedSourcePath.endsWith(normalizedKey)) return key;
  }

  return sourcePath;
};

const toAbsolutePath = (pathLike: string): string =>
  isAbsolute(pathLike) ? resolve(pathLike) : resolve(pathLike);

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  const vitestSummaryPath = resolve(
    args.get("vitest") ?? "coverage/coverage-summary.json",
  );
  const bunLcovPath = resolve(args.get("bun") ?? "coverage/bun/lcov.info");
  const outputPath = resolve(
    args.get("out") ?? "coverage/coverage-summary.json",
  );

  if (!existsSync(vitestSummaryPath)) {
    throw new Error(`Vitest coverage summary not found: ${vitestSummaryPath}`);
  }
  if (!existsSync(bunLcovPath)) {
    throw new Error(`Bun coverage lcov not found: ${bunLcovPath}`);
  }

  const summary = JSON.parse(
    readFileSync(vitestSummaryPath, "utf8"),
  ) as CoverageSummary;
  const lcov = readFileSync(bunLcovPath, "utf8");
  const records = parseLcov(lcov);

  let mergedFiles = 0;
  for (const record of records) {
    // Merge only Bun runtime source files.
    if (!normalizeSlashes(record.file).includes("packages/bun/src/")) continue;

    const absoluteFile = toAbsolutePath(record.file);
    const key = resolveCoverageKey(summary, absoluteFile);

    const lines = toMetric(record.lines);
    const functions = toMetric(record.functions);
    const branches = toMetric(record.branches);

    summary[key] = {
      lines,
      functions,
      // lcov has no statements metric; use line counters for pragmatic merge.
      statements: lines,
      branches,
    };
    mergedFiles++;
  }

  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    `Merged Bun coverage into summary: ${mergedFiles} file(s) -> ${outputPath}`,
  );
};

main();
