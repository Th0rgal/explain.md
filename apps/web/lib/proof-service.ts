import { createHash } from "node:crypto";
import {
  computeConfigHash,
  normalizeConfig,
  type ExplanationConfig,
  type ExplanationConfigInput,
} from "../../../dist/config-contract";
import {
  buildExplanationDiffReport,
  buildProgressiveDisclosureView,
  computeExplanationDiffHash,
  computeProgressiveDisclosureHash,
} from "../../../dist/progressive-disclosure";
import { buildLeafDetailView, computeLeafDetailHash } from "../../../dist/leaf-detail";
import {
  computeTreeStorageSnapshotHash,
  createTreeQueryApi,
  exportTreeStorageSnapshot,
} from "../../../dist/tree-storage";
import type { VerificationJob } from "../../../dist/verification-flow";
import { buildConfiguredSeedTree, getSeedLeaves, seedConfig } from "./seed-proof";

export const SEED_PROOF_ID = "seed-verity";

export interface SeedDataset {
  proofId: string;
  config: ExplanationConfig;
  configHash: string;
  tree: ReturnType<typeof buildConfiguredSeedTree>;
  leaves: ReturnType<typeof getSeedLeaves>;
}

export interface ProjectionRequest {
  proofId: string;
  config?: ExplanationConfigInput;
  expandedNodeIds?: string[];
  maxChildrenPerExpandedNode?: number;
}

export interface DiffRequest {
  proofId: string;
  baselineConfig?: ExplanationConfigInput;
  candidateConfig?: ExplanationConfigInput;
}

export interface LeafDetailRequest {
  proofId: string;
  leafId: string;
  config?: ExplanationConfigInput;
  verificationJobs?: VerificationJob[];
}

export interface NodeChildrenRequest {
  proofId: string;
  nodeId: string;
  config?: ExplanationConfigInput;
  offset?: number;
  limit?: number;
}

export interface NodePathRequest {
  proofId: string;
  nodeId: string;
  config?: ExplanationConfigInput;
}

export interface SeedProofCatalogEntry {
  proofId: string;
  title: string;
  rootStatement: string;
  configHash: string;
  rootId: string;
  leafCount: number;
  maxDepth: number;
}

export function listSeedProofs(configInput: ExplanationConfigInput = {}): SeedProofCatalogEntry[] {
  const dataset = loadSeedDataset(SEED_PROOF_ID, configInput);
  const rootNode = dataset.tree.nodes[dataset.tree.rootId];
  return [
    {
      proofId: dataset.proofId,
      title: "Verity contract seed proof",
      rootStatement: rootNode?.statement ?? dataset.tree.rootId,
      configHash: dataset.configHash,
      rootId: dataset.tree.rootId,
      leafCount: dataset.tree.leafIds.length,
      maxDepth: dataset.tree.maxDepth,
    },
  ];
}

export function loadSeedDataset(proofId: string, configInput: ExplanationConfigInput = {}): SeedDataset {
  assertSupportedProof(proofId);
  const config = normalizeConfig({ ...seedConfig, ...configInput });
  const tree = buildConfiguredSeedTree(config);
  const leaves = getSeedLeaves();
  return {
    proofId,
    config,
    configHash: computeConfigHash(config),
    tree,
    leaves,
  };
}

export function buildSeedProjection(request: ProjectionRequest) {
  const dataset = loadSeedDataset(request.proofId, request.config);
  const expandedNodeIds = normalizeExpandedNodeIds(request.expandedNodeIds);
  const view = buildProgressiveDisclosureView(dataset.tree as never, {
    expandedNodeIds,
    maxChildrenPerExpandedNode: request.maxChildrenPerExpandedNode,
  });
  const viewHash = computeProgressiveDisclosureHash(view);
  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    configHash: dataset.configHash,
    expandedNodeIds,
    maxChildrenPerExpandedNode: request.maxChildrenPerExpandedNode,
  });

  return {
    proofId: dataset.proofId,
    config: dataset.config,
    configHash: dataset.configHash,
    requestHash,
    view,
    viewHash,
  };
}

export function buildSeedDiff(request: DiffRequest) {
  const baseline = loadSeedDataset(request.proofId, request.baselineConfig);
  const candidate = loadSeedDataset(request.proofId, request.candidateConfig);
  const report = buildExplanationDiffReport(baseline.tree as never, candidate.tree as never, baseline.config, candidate.config);
  const diffHash = computeExplanationDiffHash(report);
  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    baselineConfigHash: baseline.configHash,
    candidateConfigHash: candidate.configHash,
  });

  return {
    proofId: request.proofId,
    requestHash,
    baselineConfig: baseline.config,
    candidateConfig: candidate.config,
    report,
    diffHash,
  };
}

export function buildSeedLeafDetail(request: LeafDetailRequest) {
  const dataset = loadSeedDataset(request.proofId, request.config);
  const jobs = request.verificationJobs ?? sampleVerificationJobs(request.proofId, request.leafId);
  const result = buildLeafDetailView(dataset.tree as never, dataset.leaves, request.leafId, {
    verificationJobs: jobs,
  });

  if (!result.view) {
    return {
      ok: false as const,
      proofId: request.proofId,
      diagnostics: result.diagnostics,
      requestHash: computeCanonicalRequestHash({
        proofId: request.proofId,
        leafId: request.leafId,
        configHash: dataset.configHash,
      }),
    };
  }

  const detailHash = computeLeafDetailHash(result.view);
  return {
    ok: result.ok,
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash: computeCanonicalRequestHash({
      proofId: request.proofId,
      leafId: request.leafId,
      configHash: dataset.configHash,
    }),
    view: result.view,
    detailHash,
  };
}

export function buildSeedRootView(proofId: string, configInput: ExplanationConfigInput = {}) {
  const dataset = loadSeedDataset(proofId, configInput);
  const api = createSeedTreeQueryApi(dataset);
  const root = api.getRoot();
  const requestHash = computeCanonicalRequestHash({
    proofId,
    configHash: dataset.configHash,
    query: "root",
  });

  return {
    proofId,
    configHash: dataset.configHash,
    requestHash,
    snapshotHash: computeTreeStorageSnapshotHash(api.snapshot),
    root,
  };
}

export function buildSeedNodeChildrenView(request: NodeChildrenRequest) {
  const dataset = loadSeedDataset(request.proofId, request.config);
  const api = createSeedTreeQueryApi(dataset);
  const children = api.getChildren(request.nodeId, {
    offset: request.offset,
    limit: request.limit,
  });
  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    nodeId: request.nodeId,
    configHash: dataset.configHash,
    offset: request.offset,
    limit: request.limit,
    query: "children",
  });

  return {
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash,
    snapshotHash: computeTreeStorageSnapshotHash(api.snapshot),
    children,
  };
}

export function buildSeedNodePathView(request: NodePathRequest) {
  const dataset = loadSeedDataset(request.proofId, request.config);
  const api = createSeedTreeQueryApi(dataset);
  const path = api.getAncestryPath(request.nodeId);
  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    nodeId: request.nodeId,
    configHash: dataset.configHash,
    query: "path",
  });

  return {
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash,
    snapshotHash: computeTreeStorageSnapshotHash(api.snapshot),
    path,
  };
}

export function findSeedLeaf(proofId: string, leafId: string) {
  const dataset = loadSeedDataset(proofId, {});
  return dataset.leaves.find((leaf) => leaf.id === leafId);
}

function assertSupportedProof(proofId: string): void {
  if (proofId !== SEED_PROOF_ID) {
    throw new Error(`Unsupported proofId '${proofId}'. Supported proofs: ${SEED_PROOF_ID}.`);
  }
}

function normalizeExpandedNodeIds(nodeIds: string[] | undefined): string[] {
  if (!nodeIds) {
    return [];
  }

  const cleaned = nodeIds
    .map((nodeId) => nodeId.trim())
    .filter((nodeId) => nodeId.length > 0)
    .sort((left, right) => left.localeCompare(right));

  const unique: string[] = [];
  for (let index = 0; index < cleaned.length; index += 1) {
    if (index === 0 || cleaned[index] !== cleaned[index - 1]) {
      unique.push(cleaned[index]);
    }
  }

  return unique;
}

function computeCanonicalRequestHash(input: Record<string, unknown>): string {
  const canonical = JSON.stringify(input, stableReplacer);
  return createHash("sha256").update(canonical).digest("hex");
}

function stableReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  return Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((accumulator, key) => {
      accumulator[key] = record[key];
      return accumulator;
    }, {});
}

function sampleVerificationJobs(proofId: string, leafId: string): VerificationJob[] {
  const baseCreatedAt = "2026-02-27T00:00:00.000Z";
  const baseStartedAt = "2026-02-27T00:00:01.000Z";
  const baseFinishedAt = "2026-02-27T00:00:02.000Z";

  return [
    {
      schemaVersion: "1.0.0",
      jobId: `${proofId}-${leafId}-queued`,
      queueSequence: 1,
      status: "success",
      target: {
        leafId,
        declarationId: leafId,
        modulePath: "Verity.ContractSpec",
        declarationName: leafId.split(".").slice(-1)[0] ?? leafId,
        sourceSpan: {
          filePath: "Verity/ContractSpec.lean",
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 20,
        },
      },
      reproducibility: {
        sourceRevision: "seed-revision",
        workingDirectory: "/tmp/seed-proof",
        command: "lake",
        args: ["env", "lean", "Verity/ContractSpec.lean"],
        env: {},
        toolchain: {
          leanVersion: "4.12.0",
        },
      },
      timeoutMs: 120000,
      createdAt: baseCreatedAt,
      updatedAt: baseFinishedAt,
      startedAt: baseStartedAt,
      finishedAt: baseFinishedAt,
      logs: [
        { index: 0, stream: "stdout", message: "checking theorem" },
        { index: 1, stream: "stdout", message: "ok" },
      ],
      result: {
        exitCode: 0,
        signal: null,
        durationMs: 1000,
        logsTruncated: false,
        logLineCount: 2,
      },
    },
  ];
}

function createSeedTreeQueryApi(dataset: SeedDataset) {
  const snapshot = exportTreeStorageSnapshot(dataset.tree as never, {
    proofId: dataset.proofId,
    leaves: dataset.leaves,
    config: dataset.config,
  });
  return createTreeQueryApi(snapshot);
}
