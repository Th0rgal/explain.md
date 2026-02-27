import { createHash } from "node:crypto";
import {
  computeVerificationJobHash,
  type VerificationJob,
  type VerificationStatus,
} from "./verification-flow.js";
import {
  canonicalizeTheoremLeafRecord,
  renderTheoremLeafCanonical,
  type TheoremLeafRecord,
} from "./leaf-schema.js";
import type { ExplanationTree, ExplanationTreeNode } from "./tree-builder.js";

export type LeafDetailDiagnosticCode =
  | "leaf_not_found"
  | "leaf_not_reachable"
  | "missing_node"
  | "missing_source_url";

export interface LeafDetailDiagnostic {
  code: LeafDetailDiagnosticCode;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface ProvenancePathNode {
  id: string;
  kind: ExplanationTreeNode["kind"];
  depth: number;
  statement: string;
  evidenceRefs: string[];
  childIds: string[];
}

export interface LeafShareReference {
  compact: string;
  markdown: string;
  sourceUrl?: string;
}

export interface LeafVerificationJobSummary {
  jobId: string;
  queueSequence: number;
  status: VerificationStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  jobHash: string;
  durationMs?: number;
}

export interface LeafVerificationSummary {
  totalJobs: number;
  latestStatus?: VerificationStatus;
  latestJobId?: string;
  statusCounts: Record<VerificationStatus, number>;
}

export interface LeafDetailView {
  leaf: TheoremLeafRecord;
  rootId: string;
  provenancePath: ProvenancePathNode[];
  shareReference: LeafShareReference;
  verification: {
    jobs: LeafVerificationJobSummary[];
    summary: LeafVerificationSummary;
  };
  diagnostics: LeafDetailDiagnostic[];
}

export interface LeafDetailResult {
  ok: boolean;
  diagnostics: LeafDetailDiagnostic[];
  view?: LeafDetailView;
}

export interface BuildLeafDetailOptions {
  verificationJobs?: VerificationJob[];
}

export function buildLeafDetailView(
  tree: ExplanationTree,
  leaves: TheoremLeafRecord[],
  leafId: string,
  options: BuildLeafDetailOptions = {},
): LeafDetailResult {
  const diagnostics: LeafDetailDiagnostic[] = [];
  const normalizedLeafId = normalizeRequired(leafId, "leafId");
  const leafById = new Map<string, TheoremLeafRecord>();

  for (const leaf of leaves) {
    const canonical = canonicalizeTheoremLeafRecord(leaf);
    if (!leafById.has(canonical.id)) {
      leafById.set(canonical.id, canonical);
    }
  }

  const leaf = leafById.get(normalizedLeafId);
  if (!leaf) {
    diagnostics.push({
      code: "leaf_not_found",
      severity: "error",
      message: `Leaf '${normalizedLeafId}' was not found in provided theorem leaves.`,
    });
    return { ok: false, diagnostics };
  }

  const provenanceSearch = findProvenancePath(tree, normalizedLeafId);
  diagnostics.push(...provenanceSearch.diagnostics);
  if (!provenanceSearch.pathNodeIds) {
    diagnostics.push({
      code: "leaf_not_reachable",
      severity: "error",
      message: `Leaf '${normalizedLeafId}' is not reachable from root '${tree.rootId}'.`,
      details: { rootId: tree.rootId, leafId: normalizedLeafId },
    });
    return { ok: false, diagnostics };
  }

  if (!leaf.sourceUrl) {
    diagnostics.push({
      code: "missing_source_url",
      severity: "warning",
      message: `Leaf '${normalizedLeafId}' has no sourceUrl; source deep-link is unavailable.`,
      details: {
        filePath: leaf.sourceSpan.filePath,
        startLine: leaf.sourceSpan.startLine,
        startColumn: leaf.sourceSpan.startColumn,
      },
    });
  }

  const verificationJobs = summarizeVerificationJobs(options.verificationJobs ?? [], normalizedLeafId);
  const view: LeafDetailView = {
    leaf,
    rootId: tree.rootId,
    provenancePath: provenanceSearch.pathNodeIds
      .map((nodeId) => tree.nodes[nodeId])
      .filter((node): node is ExplanationTreeNode => Boolean(node))
      .map((node) => ({
        id: node.id,
        kind: node.kind,
        depth: node.depth,
        statement: node.statement,
        evidenceRefs: node.evidenceRefs.slice(),
        childIds: node.childIds.slice(),
      })),
    shareReference: buildShareReference(leaf),
    verification: verificationJobs,
    diagnostics: diagnostics.slice(),
  };

  return {
    ok: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics,
    view,
  };
}

export function renderLeafDetailCanonical(view: LeafDetailView): string {
  const lines = [
    "schema=leaf-detail-v1",
    `root_id=${view.rootId}`,
    `leaf_id=${view.leaf.id}`,
    "leaf_canonical_start",
    renderTheoremLeafCanonical(view.leaf),
    "leaf_canonical_end",
    `path_length=${view.provenancePath.length}`,
    ...view.provenancePath.map((node, index) =>
      [
        `path[${index}].id=${node.id}`,
        `path[${index}].kind=${node.kind}`,
        `path[${index}].depth=${node.depth}`,
        `path[${index}].statement=${JSON.stringify(node.statement)}`,
        `path[${index}].evidence_refs=${node.evidenceRefs.join(",") || "none"}`,
        `path[${index}].child_ids=${node.childIds.join(",") || "none"}`,
      ].join("\n"),
    ),
    `share.compact=${view.shareReference.compact}`,
    `share.markdown=${JSON.stringify(view.shareReference.markdown)}`,
    `share.source_url=${view.shareReference.sourceUrl ?? "none"}`,
    `verification.total_jobs=${view.verification.summary.totalJobs}`,
    `verification.latest_status=${view.verification.summary.latestStatus ?? "none"}`,
    `verification.latest_job_id=${view.verification.summary.latestJobId ?? "none"}`,
    ...(["queued", "running", "success", "failure", "timeout"] as const).map(
      (status) => `verification.count.${status}=${view.verification.summary.statusCounts[status]}`,
    ),
    ...view.verification.jobs.map((job, index) =>
      [
        `verification.jobs[${index}].job_id=${job.jobId}`,
        `verification.jobs[${index}].queue_sequence=${job.queueSequence}`,
        `verification.jobs[${index}].status=${job.status}`,
        `verification.jobs[${index}].created_at=${job.createdAt}`,
        `verification.jobs[${index}].started_at=${job.startedAt ?? "none"}`,
        `verification.jobs[${index}].finished_at=${job.finishedAt ?? "none"}`,
        `verification.jobs[${index}].duration_ms=${job.durationMs ?? "none"}`,
        `verification.jobs[${index}].hash=${job.jobHash}`,
      ].join("\n"),
    ),
    `diagnostics_count=${view.diagnostics.length}`,
    ...view.diagnostics.map((diagnostic, index) =>
      [
        `diagnostics[${index}].code=${diagnostic.code}`,
        `diagnostics[${index}].severity=${diagnostic.severity}`,
        `diagnostics[${index}].message=${JSON.stringify(diagnostic.message)}`,
        `diagnostics[${index}].details=${JSON.stringify(diagnostic.details ?? {})}`,
      ].join("\n"),
    ),
  ];

  return lines.join("\n");
}

export function computeLeafDetailHash(view: LeafDetailView): string {
  return createHash("sha256").update(renderLeafDetailCanonical(view)).digest("hex");
}

function summarizeVerificationJobs(
  jobs: VerificationJob[],
  leafId: string,
): {
  jobs: LeafVerificationJobSummary[];
  summary: LeafVerificationSummary;
} {
  const filtered = jobs
    .filter((job) => job.target.leafId === leafId)
    .slice()
    .sort((left, right) => {
      if (left.queueSequence !== right.queueSequence) {
        return left.queueSequence - right.queueSequence;
      }
      return left.jobId.localeCompare(right.jobId);
    });

  const summaries = filtered.map((job) => ({
    jobId: job.jobId,
    queueSequence: job.queueSequence,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.result?.durationMs,
    jobHash: computeVerificationJobHash(job),
  }));

  const statusCounts: Record<VerificationStatus, number> = {
    queued: 0,
    running: 0,
    success: 0,
    failure: 0,
    timeout: 0,
  };

  for (const job of summaries) {
    statusCounts[job.status] += 1;
  }

  const latest = summaries[summaries.length - 1];
  return {
    jobs: summaries,
    summary: {
      totalJobs: summaries.length,
      latestStatus: latest?.status,
      latestJobId: latest?.jobId,
      statusCounts,
    },
  };
}

function buildShareReference(leaf: TheoremLeafRecord): LeafShareReference {
  const span = `${leaf.sourceSpan.startLine}:${leaf.sourceSpan.startColumn}-${leaf.sourceSpan.endLine}:${leaf.sourceSpan.endColumn}`;
  const declaration = `${leaf.modulePath}.${leaf.declarationName}`;
  const compact = `${declaration}@${span}`;

  return {
    compact,
    markdown: leaf.sourceUrl ? `[${declaration}](${leaf.sourceUrl})` : `\`${compact}\``,
    sourceUrl: leaf.sourceUrl,
  };
}

function findProvenancePath(
  tree: ExplanationTree,
  leafId: string,
): { pathNodeIds: string[] | null; diagnostics: LeafDetailDiagnostic[] } {
  const diagnostics: LeafDetailDiagnostic[] = [];
  const root = tree.nodes[tree.rootId];
  if (!root) {
    diagnostics.push({
      code: "missing_node",
      severity: "error",
      message: `Tree root '${tree.rootId}' is missing from nodes map.`,
      details: { nodeId: tree.rootId },
    });
    return { pathNodeIds: null, diagnostics };
  }

  const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: tree.rootId, path: [tree.rootId] }];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() as { nodeId: string; path: string[] };
    if (current.nodeId === leafId) {
      return { pathNodeIds: current.path, diagnostics };
    }

    if (visited.has(current.nodeId)) {
      continue;
    }
    visited.add(current.nodeId);

    const node = tree.nodes[current.nodeId];
    if (!node) {
      diagnostics.push({
        code: "missing_node",
        severity: "error",
        message: `Node '${current.nodeId}' is missing from tree map.`,
        details: { nodeId: current.nodeId },
      });
      continue;
    }

    for (const childId of node.childIds) {
      if (!tree.nodes[childId]) {
        diagnostics.push({
          code: "missing_node",
          severity: "error",
          message: `Child node '${childId}' referenced by '${node.id}' is missing.`,
          details: { nodeId: node.id, childId },
        });
        continue;
      }
      queue.push({ nodeId: childId, path: [...current.path, childId] });
    }
  }

  return { pathNodeIds: null, diagnostics };
}

function normalizeRequired(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }
  return normalized;
}
