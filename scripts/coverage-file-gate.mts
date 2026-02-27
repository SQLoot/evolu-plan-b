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
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "Invalid thresholds JSON: expected an object keyed by file path.",
    );
  }

  const thresholds = new Map<string, Threshold>();
  for (const [file, threshold] of Object.entries(parsed)) {
    if (!threshold || typeof threshold !== "object" || Array.isArray(threshold))
      throw new Error(
        `Invalid threshold for '${file}': expected object with numeric statements and branches.`,
      );

    const statements = (threshold as { statements?: unknown }).statements;
    const branches = (threshold as { branches?: unknown }).branches;

    if (
      typeof statements !== "number" ||
      !Number.isFinite(statements) ||
      typeof branches !== "number" ||
      !Number.isFinite(branches)
    ) {
      throw new Error(
        `Invalid threshold for '${file}': statements and branches must be finite numbers.`,
      );
    }

    thresholds.set(file, { statements, branches });
  }

  return thresholds;
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
    const keyNormalized = key.replaceAll("\\", "/");
    if (
      keyNormalized === normalized ||
      keyNormalized.endsWith(`/${normalized}`)
    ) {
      return value;
    }
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
