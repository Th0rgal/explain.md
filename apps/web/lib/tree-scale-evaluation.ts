import { createHash } from "node:crypto";
import { planTreeRenderWindow, type TreeRenderSettings } from "./tree-render-window";
import {
  planTreeVirtualizationWindow,
  resolveVirtualScrollTopForRowIndex,
  type TreeVirtualizationSettings,
} from "./tree-virtualization";

const SCHEMA_VERSION = "1.0.0";

type EffectiveRenderMode = "full" | "windowed" | "virtualized";

interface TreeScaleProfileInput {
  profileId: string;
  totalRowCount: number;
  renderSettings: TreeRenderSettings;
  virtualizationSettings: TreeVirtualizationSettings;
  activeRowSequence: number[];
}

export interface TreeScaleEvaluationSample {
  activeRowIndex: number;
  effectiveMode: EffectiveRenderMode;
  renderedRowCount: number;
  hiddenAboveCount: number;
  hiddenBelowCount: number;
  clampedScrollTopPx: number;
  maxScrollTopPx: number;
  boundedRenderCount: boolean;
}

export interface TreeScaleEvaluationProfileReport {
  profileId: string;
  totalRowCount: number;
  renderSettings: TreeRenderSettings;
  virtualizationSettings: TreeVirtualizationSettings;
  summary: {
    sampleCount: number;
    fullModeSampleCount: number;
    windowedModeSampleCount: number;
    virtualizedModeSampleCount: number;
    maxRenderedRowCount: number;
    boundedSampleCount: number;
  };
  samples: TreeScaleEvaluationSample[];
}

export interface TreeScaleEvaluationReport {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  parameters: {
    profiles: Array<{
      profileId: string;
      totalRowCount: number;
      renderSettings: TreeRenderSettings;
      virtualizationSettings: TreeVirtualizationSettings;
      activeRowSequence: number[];
    }>;
  };
  summary: {
    profileCount: number;
    totalSamples: number;
    fullModeSampleCount: number;
    windowedModeSampleCount: number;
    virtualizedModeSampleCount: number;
    maxRenderedRowCount: number;
    boundedSampleCount: number;
  };
  profileReports: TreeScaleEvaluationProfileReport[];
}

export function runTreeScaleEvaluation(): TreeScaleEvaluationReport {
  const profiles = buildProfiles();

  const requestHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    profiles,
  });

  const profileReports = profiles.map((profile) => evaluateProfile(profile));
  const summary = summarizeProfileReports(profileReports);

  const outcomeHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    summary,
    profileReports,
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    requestHash,
    outcomeHash,
    parameters: {
      profiles: profiles.map((profile) => ({
        profileId: profile.profileId,
        totalRowCount: profile.totalRowCount,
        renderSettings: profile.renderSettings,
        virtualizationSettings: profile.virtualizationSettings,
        activeRowSequence: profile.activeRowSequence,
      })),
    },
    summary,
    profileReports,
  };
}

function evaluateProfile(profile: TreeScaleProfileInput): TreeScaleEvaluationProfileReport {
  let scrollTopPx = 0;
  const samples: TreeScaleEvaluationSample[] = [];

  for (const rawActiveRowIndex of profile.activeRowSequence) {
    const activeRowIndex = clamp(Math.trunc(rawActiveRowIndex), 0, Math.max(0, profile.totalRowCount - 1));
    const renderWindowPlan = planTreeRenderWindow({
      totalRowCount: profile.totalRowCount,
      anchorRowIndex: activeRowIndex,
      maxVisibleRows: profile.renderSettings.maxVisibleRows,
      overscanRows: profile.renderSettings.overscanRows,
    });

    scrollTopPx = resolveVirtualScrollTopForRowIndex(
      scrollTopPx,
      activeRowIndex,
      profile.totalRowCount,
      profile.virtualizationSettings,
    );
    const virtualizationPlan = planTreeVirtualizationWindow({
      totalRowCount: profile.totalRowCount,
      scrollTopPx,
      settings: profile.virtualizationSettings,
    });

    const effectiveMode: EffectiveRenderMode = virtualizationPlan.mode === "virtualized" ? "virtualized" : renderWindowPlan.mode;
    const renderedRowCount =
      effectiveMode === "virtualized" ? virtualizationPlan.renderedRowCount : renderWindowPlan.renderedRowCount;
    const hiddenAboveCount = effectiveMode === "virtualized" ? virtualizationPlan.hiddenAboveCount : renderWindowPlan.hiddenAboveCount;
    const hiddenBelowCount = effectiveMode === "virtualized" ? virtualizationPlan.hiddenBelowCount : renderWindowPlan.hiddenBelowCount;
    const boundedRenderCount = renderedRowCount <= expectedMaxRenderedRows(profile.totalRowCount, effectiveMode, profile);

    samples.push({
      activeRowIndex,
      effectiveMode,
      renderedRowCount,
      hiddenAboveCount,
      hiddenBelowCount,
      clampedScrollTopPx: virtualizationPlan.clampedScrollTopPx,
      maxScrollTopPx: virtualizationPlan.maxScrollTopPx,
      boundedRenderCount,
    });
  }

  return {
    profileId: profile.profileId,
    totalRowCount: profile.totalRowCount,
    renderSettings: profile.renderSettings,
    virtualizationSettings: profile.virtualizationSettings,
    summary: {
      sampleCount: samples.length,
      fullModeSampleCount: samples.filter((sample) => sample.effectiveMode === "full").length,
      windowedModeSampleCount: samples.filter((sample) => sample.effectiveMode === "windowed").length,
      virtualizedModeSampleCount: samples.filter((sample) => sample.effectiveMode === "virtualized").length,
      maxRenderedRowCount: samples.reduce((max, sample) => Math.max(max, sample.renderedRowCount), 0),
      boundedSampleCount: samples.filter((sample) => sample.boundedRenderCount).length,
    },
    samples,
  };
}

function summarizeProfileReports(profileReports: TreeScaleEvaluationProfileReport[]): TreeScaleEvaluationReport["summary"] {
  const flatSamples = profileReports.flatMap((profile) => profile.samples);
  return {
    profileCount: profileReports.length,
    totalSamples: flatSamples.length,
    fullModeSampleCount: flatSamples.filter((sample) => sample.effectiveMode === "full").length,
    windowedModeSampleCount: flatSamples.filter((sample) => sample.effectiveMode === "windowed").length,
    virtualizedModeSampleCount: flatSamples.filter((sample) => sample.effectiveMode === "virtualized").length,
    maxRenderedRowCount: flatSamples.reduce((max, sample) => Math.max(max, sample.renderedRowCount), 0),
    boundedSampleCount: flatSamples.filter((sample) => sample.boundedRenderCount).length,
  };
}

function buildProfiles(): TreeScaleProfileInput[] {
  return [
    {
      profileId: "full-small-tree",
      totalRowCount: 72,
      renderSettings: {
        maxVisibleRows: 120,
        overscanRows: 24,
      },
      virtualizationSettings: {
        enabled: true,
        minRows: 400,
        rowHeightPx: 36,
        viewportRows: 18,
        overscanRows: 6,
      },
      activeRowSequence: [0, 5, 12, 24, 36, 48, 60, 71],
    },
    {
      profileId: "windowed-medium-tree",
      totalRowCount: 520,
      renderSettings: {
        maxVisibleRows: 80,
        overscanRows: 10,
      },
      virtualizationSettings: {
        enabled: false,
        minRows: 400,
        rowHeightPx: 36,
        viewportRows: 18,
        overscanRows: 6,
      },
      activeRowSequence: [0, 30, 79, 120, 200, 280, 360, 440, 519],
    },
    {
      profileId: "virtualized-large-tree",
      totalRowCount: 1600,
      renderSettings: {
        maxVisibleRows: 120,
        overscanRows: 24,
      },
      virtualizationSettings: {
        enabled: true,
        minRows: 400,
        rowHeightPx: 32,
        viewportRows: 20,
        overscanRows: 4,
      },
      activeRowSequence: [0, 30, 90, 200, 400, 700, 1000, 1300, 1599],
    },
  ];
}

function expectedMaxRenderedRows(
  totalRowCount: number,
  mode: EffectiveRenderMode,
  profile: Pick<TreeScaleProfileInput, "renderSettings" | "virtualizationSettings">,
): number {
  if (mode === "virtualized") {
    const bound =
      profile.virtualizationSettings.viewportRows + profile.virtualizationSettings.overscanRows * 2;
    return Math.min(totalRowCount, bound);
  }
  if (mode === "windowed") {
    const bound = profile.renderSettings.maxVisibleRows + profile.renderSettings.overscanRows * 2;
    return Math.min(totalRowCount, bound);
  }
  return totalRowCount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeHash(input: unknown): string {
  const canonical = canonicalize(input);
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(input: unknown): string {
  return JSON.stringify(sortValue(input));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
  }
  return value;
}
