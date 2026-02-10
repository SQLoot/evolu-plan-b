import { spawnSync } from "node:child_process";

type Severity = "error" | "warn";

interface BranchIssue {
  readonly ref: string;
  readonly tip: string;
}

interface DanglingIssue {
  readonly severity: Severity;
  readonly sha: string;
  readonly dateIso: string;
  readonly subject: string;
  readonly reason: string;
}

interface GuardOptions {
  readonly mainRef: string;
  readonly upstreamRef: string;
  readonly days: number;
  readonly maxCommitsForPatchMap: number;
  readonly strict: boolean;
  readonly json: boolean;
}

interface GuardReport {
  readonly options: GuardOptions;
  readonly branchIssues: ReadonlyArray<BranchIssue>;
  readonly danglingIssues: ReadonlyArray<DanglingIssue>;
}

const parseOptions = (): GuardOptions => {
  const args = process.argv.slice(2);

  let strict = false;
  let json = false;
  let days = Number(process.env.SYNC_GUARD_DAYS ?? "7");

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--days") {
      const next = args[i + 1];
      if (!next) throw new Error("Missing value for --days");
      days = Number(next);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid --days value: ${String(days)}`);
  }

  return {
    mainRef: process.env.SYNC_GUARD_MAIN_REF ?? "main",
    upstreamRef: process.env.SYNC_GUARD_UPSTREAM_REF ?? "upstream/common-v8",
    days,
    maxCommitsForPatchMap: Number(
      process.env.SYNC_GUARD_PATCH_MAP_DEPTH ?? "900",
    ),
    strict,
    json,
  };
};

const runGit = (
  args: ReadonlyArray<string>,
  options?: {
    readonly allowFailure?: boolean;
    readonly stdin?: string;
  },
): string => {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    input: options?.stdin,
  });

  if (result.status === 0) return result.stdout;
  if (options?.allowFailure) return "";

  const stderr = result.stderr.trim();
  throw new Error(
    `git ${args.join(" ")} failed${
      stderr ? `: ${stderr}` : ""
    }`,
  );
};

const runGitLines = (
  args: ReadonlyArray<string>,
  options?: {
    readonly allowFailure?: boolean;
    readonly stdin?: string;
  },
): ReadonlyArray<string> =>
  runGit(args, options)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const isAncestor = (candidateRef: string, targetRef: string): boolean => {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", candidateRef, targetRef], {
    encoding: "utf8",
  });
  return result.status === 0;
};

const commitPatchId = (sha: string): string | null => {
  const patch = runGit(["show", sha, "--pretty=format:"], { allowFailure: true });
  if (!patch.trim()) return null;

  const patchIdOutput = runGit(["patch-id", "--stable"], {
    stdin: patch,
    allowFailure: true,
  });
  const patchId = patchIdOutput.trim().split(/\s+/)[0];
  return patchId?.length ? patchId : null;
};

const buildPatchMap = (
  ref: string,
  maxCount: number,
): ReadonlyMap<string, string> => {
  const commits = runGitLines(["rev-list", `--max-count=${String(maxCount)}`, ref], {
    allowFailure: true,
  });
  const map = new Map<string, string>();
  for (const sha of commits) {
    const patchId = commitPatchId(sha);
    if (!patchId) continue;
    if (!map.has(patchId)) map.set(patchId, sha);
  }
  return map;
};

const getCommonV8BranchIssues = (mainRef: string): ReadonlyArray<BranchIssue> => {
  const refs = runGitLines([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads",
    "refs/remotes/origin",
  ]);

  const candidates = refs.filter((ref) => {
    if (!ref.includes("common-v8")) return false;
    if (ref === "origin/main" || ref === "main") return false;
    if (ref.endsWith("/HEAD")) return false;
    return true;
  });

  return candidates
    .filter((ref) => !isAncestor(ref, mainRef))
    .map((ref) => ({
      ref,
      tip: runGit(["show", "-s", "--format=%h %cs %s", ref]).trim(),
    }));
};

const getUnreachableCommits = (): ReadonlyArray<string> =>
  runGitLines(["fsck", "--full", "--no-reflogs", "--unreachable"], {
    allowFailure: true,
  })
    .map((line) => {
      const match = line.match(/^unreachable commit ([0-9a-f]{40})$/);
      return match?.[1] ?? null;
    })
    .filter((sha): sha is string => sha !== null);

const getDanglingIssues = (options: GuardOptions): ReadonlyArray<DanglingIssue> => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const minTimestamp = nowSeconds - options.days * 24 * 60 * 60;
  const unreachableCommits = getUnreachableCommits();
  if (unreachableCommits.length === 0) return [];

  const mainPatchMap = buildPatchMap(options.mainRef, options.maxCommitsForPatchMap);
  const upstreamPatchMap = buildPatchMap(
    options.upstreamRef,
    options.maxCommitsForPatchMap,
  );

  const syncLabel = /common-v8|upstream\/common-v8|cherry-pick/i;
  const issues: Array<DanglingIssue> = [];

  for (const sha of unreachableCommits) {
    const timestamp = Number(runGit(["show", "-s", "--format=%ct", sha]));
    if (!Number.isFinite(timestamp) || timestamp < minTimestamp) continue;

    const dateIso = runGit(["show", "-s", "--format=%cI", sha]).trim();
    const subject = runGit(["show", "-s", "--format=%s", sha]).trim();
    const body = runGit(["show", "-s", "--format=%b", sha]).trim();

    const patchId = commitPatchId(sha);
    const inMain = patchId ? mainPatchMap.get(patchId) : undefined;
    const inUpstream = patchId ? upstreamPatchMap.get(patchId) : undefined;
    const hasSyncLabel = syncLabel.test(`${subject}\n${body}`);

    if (!inUpstream && !hasSyncLabel) {
      continue;
    }

    if (inMain) {
      issues.push({
        severity: "warn",
        sha,
        dateIso,
        subject,
        reason: `dangling commit already represented in ${options.mainRef} as ${inMain.slice(
          0,
          8,
        )}`,
      });
      continue;
    }

    if (inUpstream) {
      issues.push({
        severity: "error",
        sha,
        dateIso,
        subject,
        reason: `dangling commit matches upstream patch ${inUpstream.slice(0, 8)} but is not in ${options.mainRef}`,
      });
      continue;
    }

    issues.push({
      severity: "error",
      sha,
      dateIso,
      subject,
      reason: "dangling commit is labeled as common-v8/cherry-pick and is not in main",
    });
  }

  return issues.sort((a, b) => b.dateIso.localeCompare(a.dateIso));
};

const renderHuman = (report: GuardReport): string => {
  const lines: Array<string> = [];
  const { options, branchIssues, danglingIssues } = report;
  const errorDangling = danglingIssues.filter((issue) => issue.severity === "error");
  const warnDangling = danglingIssues.filter((issue) => issue.severity === "warn");

  lines.push(
    `[sync-guard] main=${options.mainRef} upstream=${options.upstreamRef} window=${String(options.days)}d strict=${String(options.strict)}`,
  );

  if (branchIssues.length === 0) {
    lines.push("[sync-guard] branch check: OK");
  } else {
    lines.push(
      `[sync-guard] branch check: ${String(branchIssues.length)} branch(es) with 'common-v8' are not merged into ${options.mainRef}`,
    );
    for (const issue of branchIssues) {
      lines.push(`  ERROR ${issue.ref} -> ${issue.tip}`);
    }
  }

  if (danglingIssues.length === 0) {
    lines.push("[sync-guard] dangling check: OK");
  } else {
    lines.push(
      `[sync-guard] dangling check: ${String(errorDangling.length)} error(s), ${String(warnDangling.length)} warning(s)`,
    );
    for (const issue of danglingIssues) {
      lines.push(
        `  ${issue.severity.toUpperCase()} ${issue.sha.slice(0, 8)} ${issue.dateIso} ${issue.subject}`,
      );
      lines.push(`    ${issue.reason}`);
    }
  }

  const hasErrors =
    branchIssues.length > 0 || (options.strict ? danglingIssues.length > 0 : errorDangling.length > 0);
  lines.push(`[sync-guard] result: ${hasErrors ? "FAIL" : "OK"}`);
  return lines.join("\n");
};

const main = (): number => {
  const options = parseOptions();
  const branchIssues = getCommonV8BranchIssues(options.mainRef);
  const danglingIssues = getDanglingIssues(options);
  const report: GuardReport = {
    options,
    branchIssues,
    danglingIssues,
  };

  const errorDangling = danglingIssues.filter((issue) => issue.severity === "error");
  const hasErrors =
    branchIssues.length > 0 || (options.strict ? danglingIssues.length > 0 : errorDangling.length > 0);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderHuman(report)}\n`);
  }

  return hasErrors ? 1 : 0;
};

process.exitCode = main();
