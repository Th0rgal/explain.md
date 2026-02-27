import { promises as fs } from "node:fs";
import path from "node:path";
import { runObservabilitySloBenchmark } from "../lib/observability-slo-benchmark";

interface CliOptions {
  outPath?: string;
  baselinePath?: string;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const report = await runObservabilitySloBenchmark();

  if (!report.evaluation.baseline.thresholdPass) {
    throw new Error("Observability SLO benchmark baseline thresholds failed.");
  }

  if (report.evaluation.strictRegression.thresholdPass) {
    throw new Error("Observability SLO benchmark strict regression thresholds unexpectedly passed.");
  }

  if (options.baselinePath) {
    await assertBaseline(options.baselinePath, report);
  }

  if (options.outPath) {
    const resolvedPath = path.resolve(options.outPath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Wrote observability SLO benchmark report to ${resolvedPath}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

function parseCliArgs(argv: string[]): CliOptions {
  const parsed: CliOptions = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--out=")) {
      parsed.outPath = arg.slice("--out=".length).trim();
      continue;
    }
    if (arg === "--out") {
      parsed.outPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--baseline=")) {
      parsed.baselinePath = arg.slice("--baseline=".length).trim();
      continue;
    }
    if (arg === "--baseline") {
      parsed.baselinePath = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unsupported argument '${arg}'.`);
  }

  return parsed;
}

async function assertBaseline(baselinePath: string, report: Awaited<ReturnType<typeof runObservabilitySloBenchmark>>): Promise<void> {
  const resolvedPath = path.resolve(baselinePath);
  const raw = await fs.readFile(resolvedPath, "utf8");
  const baseline = JSON.parse(raw) as {
    requestHash?: string;
    outcomeHash?: string;
    evaluation?: {
      baseline?: { thresholdPass?: boolean };
      strictRegression?: { thresholdPass?: boolean };
    };
  };

  if (baseline.requestHash !== report.requestHash) {
    throw new Error(
      `Observability SLO benchmark requestHash mismatch. expected=${baseline.requestHash ?? "missing"} actual=${report.requestHash}`,
    );
  }

  if (baseline.outcomeHash !== report.outcomeHash) {
    throw new Error(
      `Observability SLO benchmark outcomeHash mismatch. expected=${baseline.outcomeHash ?? "missing"} actual=${report.outcomeHash}`,
    );
  }

  if (baseline.evaluation?.baseline?.thresholdPass !== report.evaluation.baseline.thresholdPass) {
    throw new Error("Observability SLO benchmark baseline threshold pass/fail expectation mismatched baseline artifact.");
  }

  if (baseline.evaluation?.strictRegression?.thresholdPass !== report.evaluation.strictRegression.thresholdPass) {
    throw new Error("Observability SLO benchmark strict regression threshold pass/fail expectation mismatched baseline artifact.");
  }

  const baselineProfiles = Array.isArray((baseline as { profileReports?: unknown }).profileReports)
    ? ((baseline as { profileReports?: Array<{ profileId?: string; requestHash?: string; outcomeHash?: string }> }).profileReports ?? [])
    : [];
  const reportProfiles = report.profileReports;

  if (baselineProfiles.length !== reportProfiles.length) {
    throw new Error(
      `Observability SLO benchmark profile count mismatch. expected=${baselineProfiles.length} actual=${reportProfiles.length}`,
    );
  }

  for (let index = 0; index < baselineProfiles.length; index += 1) {
    const expectedProfile = baselineProfiles[index];
    const actualProfile = reportProfiles[index];

    if ((expectedProfile?.profileId ?? "") !== actualProfile.profileId) {
      throw new Error(
        `Observability SLO benchmark profileId mismatch at index ${String(index)}. expected=${expectedProfile?.profileId ?? "missing"} actual=${actualProfile.profileId}`,
      );
    }
    if ((expectedProfile?.requestHash ?? "") !== actualProfile.requestHash) {
      throw new Error(
        `Observability SLO benchmark profile requestHash mismatch for ${actualProfile.profileId}. expected=${expectedProfile?.requestHash ?? "missing"} actual=${actualProfile.requestHash}`,
      );
    }
    if ((expectedProfile?.outcomeHash ?? "") !== actualProfile.outcomeHash) {
      throw new Error(
        `Observability SLO benchmark profile outcomeHash mismatch for ${actualProfile.profileId}. expected=${expectedProfile?.outcomeHash ?? "missing"} actual=${actualProfile.outcomeHash}`,
      );
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
