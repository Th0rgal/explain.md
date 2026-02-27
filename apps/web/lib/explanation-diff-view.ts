import type { DiffResponse } from "./api-client";

type DiffChangeRecord = DiffResponse["report"]["changes"][number];

export interface DiffStatementDelta {
  prefix: string;
  beforeChanged: string;
  afterChanged: string;
  suffix: string;
}

export interface ExplanationDiffChangeView {
  key: string;
  type: DiffChangeRecord["type"];
  kind: DiffChangeRecord["kind"];
  supportLeafIds: string[];
  supportLeafCount: number;
  statementBefore?: string;
  statementAfter?: string;
  statementDelta?: DiffStatementDelta;
}

export interface ExplanationDiffPanelView {
  totalChanges: number;
  renderedChanges: number;
  truncatedChangeCount: number;
  changed: ExplanationDiffChangeView[];
  added: ExplanationDiffChangeView[];
  removed: ExplanationDiffChangeView[];
}

export function buildExplanationDiffPanelView(
  report: DiffResponse["report"],
  options?: { maxChanges?: number },
): ExplanationDiffPanelView {
  const maxChanges = sanitizeMaxChanges(options?.maxChanges);
  const visibleChanges = report.changes.slice(0, maxChanges);

  const view: ExplanationDiffPanelView = {
    totalChanges: report.changes.length,
    renderedChanges: visibleChanges.length,
    truncatedChangeCount: Math.max(0, report.changes.length - visibleChanges.length),
    changed: [],
    added: [],
    removed: [],
  };

  for (const change of visibleChanges) {
    const base: ExplanationDiffChangeView = {
      key: change.key,
      type: change.type,
      kind: change.kind,
      supportLeafIds: change.supportLeafIds,
      supportLeafCount: change.supportLeafIds.length,
      statementBefore: change.baselineStatement,
      statementAfter: change.candidateStatement,
    };

    if (change.type === "changed") {
      view.changed.push({
        ...base,
        statementDelta: computeStatementDelta(change.baselineStatement ?? "", change.candidateStatement ?? ""),
      });
      continue;
    }

    if (change.type === "added") {
      view.added.push(base);
      continue;
    }

    view.removed.push(base);
  }

  return view;
}

export function computeStatementDelta(before: string, after: string): DiffStatementDelta {
  const prefixLength = computeCommonPrefixLength(before, after);
  const suffixLength = computeCommonSuffixLength(before, after, prefixLength);

  return {
    prefix: before.slice(0, prefixLength),
    beforeChanged: before.slice(prefixLength, before.length - suffixLength),
    afterChanged: after.slice(prefixLength, after.length - suffixLength),
    suffix: before.slice(before.length - suffixLength),
  };
}

function computeCommonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function computeCommonSuffixLength(left: string, right: string, consumedPrefixLength: number): number {
  const leftRemaining = left.length - consumedPrefixLength;
  const rightRemaining = right.length - consumedPrefixLength;
  const limit = Math.min(leftRemaining, rightRemaining);
  let length = 0;

  while (
    length < limit &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  ) {
    length += 1;
  }

  return length;
}

function sanitizeMaxChanges(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 24;
  }

  const integerValue = Math.floor(value as number);
  if (integerValue < 1) {
    return 1;
  }
  if (integerValue > 200) {
    return 200;
  }

  return integerValue;
}
