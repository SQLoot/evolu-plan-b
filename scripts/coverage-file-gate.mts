#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Threshold = {
  readonly statements: number;
  readonly branches: number;
};

type CoverageStats = {
  readonly statements: { readonly pct: number };
  readonly branches: { readonly pct: number };
};

const parseArgs = (args: ReadonlyArray<string>) => {
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

const parseThresholds = (raw: string): Map<string, Threshold> => {
  const parsed = JSON.parse(raw) as Record<
    string,
    { statements: number; branches: number }
  >;

  return new Map(
    Object.entries(parsed).map(([file, threshold]) => [
      file,
      {
        statements: threshold.statements,
        branches: threshold.branches,
      } as const,
    ]),
  );
};

const toPercent = (value: number): string => `${value.toFixed(2)}%`;

const resolveCoverageEntry = (
  coverageJson: Record<string, CoverageStats>,
  file: string,
): CoverageStats | null => {
  const absolute = resolve(file);
  const byAbsolute = coverageJson[absolute];
  if (byAbsolute) return byAbsolute;

  const normalized = file.replaceAll("\\", "/");
  for (const [key, value] of Object.entries(coverageJson)) {
    if (key.replaceAll("\\", "/").endsWith(normalized)) return value;
  }

  return null;
};

const main = (): void => {
  const args = parseArgs(process.argv.slice(2));
  const coveragePath = args.get("coverage");
  const thresholdsRaw = args.get("thresholds");

  if (!coveragePath || !thresholdsRaw) {
    throw new Error("Usage: --coverage <path> --thresholds <json>");
  }

  const coverageJson = JSON.parse(
    readFileSync(resolve(coveragePath), "utf8"),
  ) as Record<string, CoverageStats>;

  const thresholds = parseThresholds(thresholdsRaw);
  const failures: Array<string> = [];

  for (const [file, expected] of thresholds) {
    const actual = resolveCoverageEntry(coverageJson, file);
    if (!actual) {
      failures.push(`Missing coverage entry for ${file}`);
      continue;
    }

    if (actual.statements.pct < expected.statements) {
      failures.push(
        `${file}: statements ${toPercent(actual.statements.pct)} < ${toPercent(expected.statements)}`,
      );
    }

    if (actual.branches.pct < expected.branches) {
      failures.push(
        `${file}: branches ${toPercent(actual.branches.pct)} < ${toPercent(expected.branches)}`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Coverage gate failed (${failures.length}):\n${failures
        .map((line) => `- ${line}`)
        .join("\n")}`,
    );
  }

  console.log(`Coverage gate passed for ${thresholds.size} files.`);
};

main();
