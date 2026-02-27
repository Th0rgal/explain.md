import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildRecursiveExplanationTree,
  buildDeclarationDependencyGraph,
  computeTreeQualityReportHash,
  computeDependencyGraphHash,
  computeLeanIngestionHash,
  evaluatePostSummaryPolicy,
  evaluatePreSummaryPolicy,
  evaluateExplanationTreeQuality,
  generateParentSummary,
  getDirectDependencies,
  getDirectDependents,
  getSupportingDeclarations,
  ingestLeanSources,
  mapLeanIngestionToTheoremLeaves,
  normalizeConfig,
  validateExplanationTree,
  type DependencyGraph,
  type ExplanationTree,
  type ExplanationTreeNode,
  type ExplanationConfig,
  type ExplanationConfigInput,
  type ParentPolicyDiagnostics,
  type TreeQualityThresholds,
  type ProviderClient,
  type TheoremLeafRecord,
} from "../../../dist/index";
import { resolveExplanationLanguage } from "../../../src/language-contract";
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
  importTreeStorageSnapshot,
  type TreeStorageSnapshot,
} from "../../../dist/tree-storage";
import { computeConfigHash } from "../../../dist/config-contract";
import type { VerificationJob } from "../../../dist/verification-flow";
import { buildConfiguredSeedTree, getSeedLeaves, seedConfig } from "./seed-proof";

export const SEED_PROOF_ID = "seed-verity";
export const LEAN_FIXTURE_PROOF_ID = "lean-verity-fixture";

const LEAN_FIXTURE_PROJECT_ROOT = path.resolve(process.cwd(), "tests", "fixtures", "lean-project");
const LEAN_FIXTURE_PATHS = ["Verity/Core.lean", "Verity/Loop.lean"];
const LEAN_FIXTURE_SOURCE_BASE_URL =
  "https://github.com/Th0rgal/explain.md/blob/main/tests/fixtures/lean-project";
const PROOF_DATASET_CACHE_SCHEMA_VERSION = "1.0.0";
const DEFAULT_PROOF_DATASET_CACHE_DIR = path.resolve(process.cwd(), ".explain-md", "web-proof-cache");
const PROOF_QUERY_OBSERVABILITY_SAMPLE_WINDOW = 1024;
const PROOF_QUERY_LATENCY_BUCKETS = [
  { bucket: "lte_5ms", maxInclusiveMs: 5 },
  { bucket: "lte_10ms", maxInclusiveMs: 10 },
  { bucket: "lte_25ms", maxInclusiveMs: 25 },
  { bucket: "lte_50ms", maxInclusiveMs: 50 },
  { bucket: "gt_50ms", maxInclusiveMs: null },
] as const satisfies ReadonlyArray<{
  bucket: ProofQueryLatencyHistogramBucket["bucket"];
  maxInclusiveMs: number | null;
}>;
let proofNowMs: () => number = () => Date.now();

const SUPPORTED_PROOF_IDS = [SEED_PROOF_ID, LEAN_FIXTURE_PROOF_ID] as const;

const datasetCache = new Map<string, Promise<ResolvedDataset>>();

export interface SeedDataset {
  proofId: string;
  config: ExplanationConfig;
  configHash: string;
  tree: ReturnType<typeof buildConfiguredSeedTree>;
  leaves: ReturnType<typeof getSeedLeaves>;
}

interface ProofDataset {
  proofId: string;
  title: string;
  config: ExplanationConfig;
  configHash: string;
  tree: ExplanationTree;
  leaves: TheoremLeafRecord[];
  dependencyGraph: DependencyGraph;
  dependencyGraphHash: string;
}

interface ResolvedDataset {
  dataset: ProofDataset;
  queryApi: ReturnType<typeof createTreeQueryApi>;
  cache: ProofDatasetCacheMetadata;
}

type ProofDatasetCacheStatus = "hit" | "miss";
type ProofDatasetCacheLayer = "persistent" | "ephemeral";
export type ProofObservabilityQuery =
  | "view"
  | "diff"
  | "leaf-detail"
  | "root"
  | "children"
  | "path"
  | "dependency-graph"
  | "policy-report"
  | "cache-report";

interface ProofQueryObservabilityEvent {
  query: ProofObservabilityQuery;
  traceId: string;
  requestId: string;
  latencyMs: number;
  cacheLayer: ProofDatasetCacheLayer;
  cacheStatus: ProofDatasetCacheStatus;
  leafCount: number;
  parentCount: number;
  nodeCount: number;
  maxDepth: number;
}

const proofQueryObservabilityEvents: ProofQueryObservabilityEvent[] = [];

export interface ProofDatasetCacheDiagnostic {
  code:
    | "cache_hit"
    | "cache_topology_recovery_hit"
    | "cache_blocked_subtree_rebuild_hit"
    | "cache_topology_removal_subtree_rebuild_hit"
    | "cache_topology_addition_subtree_insertion_rebuild_hit"
    | "cache_topology_addition_subtree_regeneration_rebuild_hit"
    | "cache_topology_mixed_subtree_regeneration_rebuild_hit"
    | "cache_topology_regeneration_rebuild_hit"
    | "cache_blocked_subtree_full_rebuild"
    | "cache_miss"
    | "cache_write_failed"
    | "cache_read_failed"
    | "cache_entry_invalid"
    | "cache_dependency_hash_mismatch"
    | "cache_snapshot_hash_mismatch";
  message: string;
  details?: Record<string, unknown>;
}

export interface ProofDatasetBlockedSubtreePlan {
  schemaVersion: "1.0.0";
  reason: "source_fingerprint_mismatch";
  changedDeclarationIds: string[];
  addedDeclarationIds: string[];
  removedDeclarationIds: string[];
  topologyShapeChanged: boolean;
  blockedDeclarationIds: string[];
  blockedLeafIds: string[];
  unaffectedLeafIds: string[];
  executionBatches: string[][];
  cyclicBatchCount: number;
  fullRebuildRequired: boolean;
  planHash: string;
}

export interface ProofDatasetCacheMetadata {
  layer: ProofDatasetCacheLayer;
  status: ProofDatasetCacheStatus;
  cacheKey: string;
  sourceFingerprint: string;
  cachePath?: string;
  snapshotHash: string;
  cacheEntryHash: string;
  diagnostics: ProofDatasetCacheDiagnostic[];
  blockedSubtreePlan?: ProofDatasetBlockedSubtreePlan;
}

interface ProofDatasetCacheEntry {
  schemaVersion: string;
  proofId: string;
  configHash: string;
  sourceFingerprint: string;
  ingestionHash: string;
  dependencyGraphHash: string;
  snapshotHash: string;
  snapshot: TreeStorageSnapshot;
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

export interface DependencyGraphRequest {
  proofId: string;
  declarationId?: string;
  config?: ExplanationConfigInput;
  includeExternalSupport?: boolean;
}

export interface PolicyReportRequest {
  proofId: string;
  config?: ExplanationConfigInput;
  thresholds?: Partial<TreeQualityThresholds>;
}

export interface ProofCacheReportRequest {
  proofId: string;
  config?: ExplanationConfigInput;
}

export interface ProofCatalogEntry {
  proofId: string;
  title: string;
  rootStatement: string;
  configHash: string;
  rootId: string;
  leafCount: number;
  maxDepth: number;
}

export interface DependencyGraphQueryDiagnostic {
  code: "declaration_not_found";
  severity: "error";
  message: string;
  details: Record<string, unknown>;
}

export interface DependencyGraphView {
  proofId: string;
  configHash: string;
  requestHash: string;
  dependencyGraphHash: string;
  graph: {
    schemaVersion: string;
    nodeCount: number;
    edgeCount: number;
    indexedNodeCount: number;
    externalNodeCount: number;
    missingDependencyRefs: Array<{ declarationId: string; dependencyId: string }>;
    sccCount: number;
    cyclicSccCount: number;
    cyclicSccs: string[][];
  };
  declaration?: {
    declarationId: string;
    directDependencies: string[];
    directDependents: string[];
    supportingDeclarations: string[];
    stronglyConnectedComponent: string[];
    inCycle: boolean;
  };
  diagnostics: DependencyGraphQueryDiagnostic[];
  observability: ProofQueryObservability;
}

export interface PolicyReportView {
  proofId: string;
  configHash: string;
  requestHash: string;
  reportHash: string;
  report: ReturnType<typeof evaluateExplanationTreeQuality>;
  observability: ProofQueryObservability;
}

export interface ProofCacheReportView {
  proofId: string;
  configHash: string;
  requestHash: string;
  cache: ProofDatasetCacheMetadata;
  observability: ProofQueryObservability;
}

export interface ProofQueryObservability {
  requestId: string;
  traceId: string;
  query: ProofObservabilityQuery;
  spans: Array<{
    spanId: string;
    name: "dataset_load" | "query_compute" | "response_materialization";
    attributes: Record<string, boolean | number | string>;
  }>;
  metrics: {
    latencyMs: number;
    cacheLayer: ProofDatasetCacheLayer;
    cacheStatus: ProofDatasetCacheStatus;
    leafCount: number;
    parentCount: number;
    nodeCount: number;
    maxDepth: number;
  };
}

export interface ProofQueryObservabilityMetricsSnapshot {
  schemaVersion: "1.0.0";
  requestCount: number;
  uniqueRequestCount: number;
  uniqueTraceCount: number;
  cache: {
    hitCount: number;
    missCount: number;
    hitRate: number;
  };
  latencyHistogram: ProofQueryLatencyHistogramBucket[];
  queries: Array<{
    query: ProofObservabilityQuery;
    requestCount: number;
    cacheHitCount: number;
    cacheMissCount: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    meanLatencyMs: number;
    p95LatencyMs: number;
    latencyHistogram: ProofQueryLatencyHistogramBucket[];
    meanLeafCount: number;
    meanParentCount: number;
    meanNodeCount: number;
    maxDepth: number;
  }>;
  generatedAt: string;
  snapshotHash: string;
}

export interface ProofQueryLatencyHistogramBucket {
  bucket: "lte_5ms" | "lte_10ms" | "lte_25ms" | "lte_50ms" | "gt_50ms";
  maxInclusiveMs: number | null;
  count: number;
}

export function getSupportedProofIds(): string[] {
  return [...SUPPORTED_PROOF_IDS];
}

export function isSupportedProofId(proofId: string): boolean {
  return SUPPORTED_PROOF_IDS.includes(proofId as (typeof SUPPORTED_PROOF_IDS)[number]);
}

export async function listProofs(configInput: ExplanationConfigInput = {}): Promise<ProofCatalogEntry[]> {
  const entries = await Promise.all(
    SUPPORTED_PROOF_IDS.map(async (proofId) => {
      const { dataset } = await loadProofDataset(proofId, configInput);
      const rootNode = dataset.tree.nodes[dataset.tree.rootId];
      return {
        proofId: dataset.proofId,
        title: dataset.title,
        rootStatement: rootNode?.statement ?? dataset.tree.rootId,
        configHash: dataset.configHash,
        rootId: dataset.tree.rootId,
        leafCount: dataset.tree.leafIds.length,
        maxDepth: dataset.tree.maxDepth,
      };
    }),
  );
  return entries.sort((left, right) => left.proofId.localeCompare(right.proofId));
}

export function listSeedProofs(configInput: ExplanationConfigInput = {}): ProofCatalogEntry[] {
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
  assertSeedProof(proofId);
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
  const startedAt = proofNowMs();
  const dataset = loadSeedDataset(request.proofId, request.config);
  const snapshot = exportTreeStorageSnapshot(dataset.tree as never, {
    proofId: dataset.proofId,
    leaves: dataset.leaves,
    config: dataset.config,
  });
  const cache = buildSeedCacheMetadata(dataset, computeTreeStorageSnapshotHash(snapshot));
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
  const observability = buildProofQueryObservability({
    proofId: dataset.proofId,
    configHash: dataset.configHash,
    requestHash,
    query: "view",
    tree: dataset.tree as ExplanationTree,
    cache,
    latencyMs: elapsedMs(startedAt),
  });

  return {
    proofId: dataset.proofId,
    config: dataset.config,
    configHash: dataset.configHash,
    requestHash,
    view,
    viewHash,
    observability,
  };
}

export async function buildProofProjection(request: ProjectionRequest) {
  const startedAt = proofNowMs();
  const { dataset, cache } = await loadProofDataset(request.proofId, request.config);
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
  const observability = buildProofQueryObservability({
    proofId: dataset.proofId,
    configHash: dataset.configHash,
    requestHash,
    query: "view",
    tree: dataset.tree,
    cache,
    latencyMs: elapsedMs(startedAt),
  });

  return {
    proofId: dataset.proofId,
    config: dataset.config,
    configHash: dataset.configHash,
    requestHash,
    view,
    viewHash,
    observability,
  };
}

export function buildSeedDiff(request: DiffRequest) {
  const startedAt = proofNowMs();
  const baseline = loadSeedDataset(request.proofId, request.baselineConfig);
  const candidate = loadSeedDataset(request.proofId, request.candidateConfig);
  const snapshot = exportTreeStorageSnapshot(candidate.tree as never, {
    proofId: candidate.proofId,
    leaves: candidate.leaves,
    config: candidate.config,
  });
  const cache = buildSeedCacheMetadata(candidate, computeTreeStorageSnapshotHash(snapshot));
  const report = buildExplanationDiffReport(baseline.tree as never, candidate.tree as never, baseline.config, candidate.config);
  const diffHash = computeExplanationDiffHash(report);
  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    baselineConfigHash: baseline.configHash,
    candidateConfigHash: candidate.configHash,
  });
  const observability = buildProofQueryObservability({
    proofId: request.proofId,
    configHash: candidate.configHash,
    requestHash,
    query: "diff",
    tree: candidate.tree as ExplanationTree,
    cache,
    latencyMs: elapsedMs(startedAt),
    extraMetrics: {
      baselineLeafCount: baseline.tree.leafIds.length,
      baselineNodeCount: Object.keys(baseline.tree.nodes).length,
      changeCount: report.summary.total,
    },
  });

  return {
    proofId: request.proofId,
    requestHash,
    baselineConfig: baseline.config,
    candidateConfig: candidate.config,
    report,
    diffHash,
    observability,
  };
}

export async function buildProofDiff(request: DiffRequest) {
  const startedAt = proofNowMs();
  const [baseline, candidate] = await Promise.all([
    loadProofDataset(request.proofId, request.baselineConfig),
    loadProofDataset(request.proofId, request.candidateConfig),
  ]);
  const report = buildExplanationDiffReport(
    baseline.dataset.tree as never,
    candidate.dataset.tree as never,
    baseline.dataset.config,
    candidate.dataset.config,
  );
  const diffHash = computeExplanationDiffHash(report);
  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    baselineConfigHash: baseline.dataset.configHash,
    candidateConfigHash: candidate.dataset.configHash,
  });
  const observability = buildProofQueryObservability({
    proofId: request.proofId,
    configHash: candidate.dataset.configHash,
    requestHash,
    query: "diff",
    tree: candidate.dataset.tree,
    cache: candidate.cache,
    latencyMs: elapsedMs(startedAt),
    extraMetrics: {
      baselineCacheStatus: baseline.cache.status,
      baselineCacheLayer: baseline.cache.layer,
      baselineLeafCount: baseline.dataset.tree.leafIds.length,
      baselineNodeCount: Object.keys(baseline.dataset.tree.nodes).length,
      changeCount: report.summary.total,
    },
  });

  return {
    proofId: request.proofId,
    requestHash,
    baselineConfig: baseline.dataset.config,
    candidateConfig: candidate.dataset.config,
    report,
    diffHash,
    observability,
  };
}

export async function buildProofLeafDetail(request: LeafDetailRequest) {
  const startedAt = proofNowMs();
  const { dataset, cache } = await loadProofDataset(request.proofId, request.config);
  const jobs = request.verificationJobs ?? sampleVerificationJobs(request.proofId, request.leafId);
  const result = buildLeafDetailView(dataset.tree as never, dataset.leaves, request.leafId, {
    verificationJobs: jobs,
  });

  if (!result.view) {
    const requestHash = computeCanonicalRequestHash({
      proofId: request.proofId,
      leafId: request.leafId,
      configHash: dataset.configHash,
    });
    return {
      ok: false as const,
      proofId: request.proofId,
      diagnostics: result.diagnostics,
      requestHash,
      observability: buildProofQueryObservability({
        proofId: request.proofId,
        configHash: dataset.configHash,
        requestHash,
        query: "leaf-detail",
        tree: dataset.tree,
        cache,
        latencyMs: elapsedMs(startedAt),
        extraMetrics: {
          leafFound: false,
        },
      }),
    };
  }

  const detailHash = computeLeafDetailHash(result.view);
  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    leafId: request.leafId,
    configHash: dataset.configHash,
  });
  return {
    ok: result.ok,
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash,
    view: result.view,
    detailHash,
    observability: buildProofQueryObservability({
      proofId: request.proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "leaf-detail",
      tree: dataset.tree,
      cache,
      latencyMs: elapsedMs(startedAt),
      extraMetrics: {
        leafFound: true,
        verificationJobCount: jobs.length,
      },
    }),
  };
}

export function buildSeedLeafDetail(request: LeafDetailRequest) {
  const startedAt = proofNowMs();
  const dataset = loadSeedDataset(request.proofId, request.config);
  const snapshot = exportTreeStorageSnapshot(dataset.tree as never, {
    proofId: dataset.proofId,
    leaves: dataset.leaves,
    config: dataset.config,
  });
  const cache = buildSeedCacheMetadata(dataset, computeTreeStorageSnapshotHash(snapshot));
  const jobs = request.verificationJobs ?? sampleVerificationJobs(request.proofId, request.leafId);
  const result = buildLeafDetailView(dataset.tree as never, dataset.leaves, request.leafId, {
    verificationJobs: jobs,
  });

  if (!result.view) {
    const requestHash = computeCanonicalRequestHash({
      proofId: request.proofId,
      leafId: request.leafId,
      configHash: dataset.configHash,
    });
    return {
      ok: false as const,
      proofId: request.proofId,
      diagnostics: result.diagnostics,
      requestHash,
      observability: buildProofQueryObservability({
        proofId: request.proofId,
        configHash: dataset.configHash,
        requestHash,
        query: "leaf-detail",
        tree: dataset.tree as ExplanationTree,
        cache,
        latencyMs: elapsedMs(startedAt),
        extraMetrics: { leafFound: false },
      }),
    };
  }

  const detailHash = computeLeafDetailHash(result.view);
  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    leafId: request.leafId,
    configHash: dataset.configHash,
  });
  return {
    ok: result.ok,
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash,
    view: result.view,
    detailHash,
    observability: buildProofQueryObservability({
      proofId: request.proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "leaf-detail",
      tree: dataset.tree as ExplanationTree,
      cache,
      latencyMs: elapsedMs(startedAt),
      extraMetrics: {
        leafFound: true,
        verificationJobCount: jobs.length,
      },
    }),
  };
}

export async function buildProofRootView(proofId: string, configInput: ExplanationConfigInput = {}) {
  const startedAt = proofNowMs();
  const { dataset, queryApi, cache } = await loadProofDataset(proofId, configInput);
  const root = queryApi.getRoot();
  const requestHash = computeCanonicalRequestHash({
    proofId,
    configHash: dataset.configHash,
    query: "root",
  });

  return {
    proofId,
    configHash: dataset.configHash,
    requestHash,
    snapshotHash: computeTreeStorageSnapshotHash(queryApi.snapshot),
    root,
    observability: buildProofQueryObservability({
      proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "root",
      tree: dataset.tree,
      cache,
      latencyMs: elapsedMs(startedAt),
    }),
  };
}

export function buildSeedRootView(proofId: string, configInput: ExplanationConfigInput = {}) {
  const startedAt = proofNowMs();
  const dataset = loadSeedDataset(proofId, configInput);
  const api = createSeedTreeQueryApi(dataset);
  const cache = buildSeedCacheMetadata(dataset, computeTreeStorageSnapshotHash(api.snapshot));
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
    observability: buildProofQueryObservability({
      proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "root",
      tree: dataset.tree as ExplanationTree,
      cache,
      latencyMs: elapsedMs(startedAt),
    }),
  };
}

export async function buildProofNodeChildrenView(request: NodeChildrenRequest) {
  const startedAt = proofNowMs();
  const { dataset, queryApi, cache } = await loadProofDataset(request.proofId, request.config);
  const children = queryApi.getChildren(request.nodeId, {
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
    snapshotHash: computeTreeStorageSnapshotHash(queryApi.snapshot),
    children,
    observability: buildProofQueryObservability({
      proofId: request.proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "children",
      tree: dataset.tree,
      cache,
      latencyMs: elapsedMs(startedAt),
      extraMetrics: {
        requestedNodeId: request.nodeId,
        pageOffset: children.offset,
        pageLimit: children.limit,
        returnedChildren: children.children.length,
        totalChildren: children.totalChildren,
      },
    }),
  };
}

export function buildSeedNodeChildrenView(request: NodeChildrenRequest) {
  const startedAt = proofNowMs();
  const dataset = loadSeedDataset(request.proofId, request.config);
  const api = createSeedTreeQueryApi(dataset);
  const cache = buildSeedCacheMetadata(dataset, computeTreeStorageSnapshotHash(api.snapshot));
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
    observability: buildProofQueryObservability({
      proofId: request.proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "children",
      tree: dataset.tree as ExplanationTree,
      cache,
      latencyMs: elapsedMs(startedAt),
      extraMetrics: {
        requestedNodeId: request.nodeId,
        pageOffset: children.offset,
        pageLimit: children.limit,
        returnedChildren: children.children.length,
        totalChildren: children.totalChildren,
      },
    }),
  };
}

export async function buildProofNodePathView(request: NodePathRequest) {
  const startedAt = proofNowMs();
  const { dataset, queryApi, cache } = await loadProofDataset(request.proofId, request.config);
  const pathResult = queryApi.getAncestryPath(request.nodeId);
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
    snapshotHash: computeTreeStorageSnapshotHash(queryApi.snapshot),
    path: pathResult,
    observability: buildProofQueryObservability({
      proofId: request.proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "path",
      tree: dataset.tree,
      cache,
      latencyMs: elapsedMs(startedAt),
      extraMetrics: {
        requestedNodeId: request.nodeId,
        pathLength: pathResult.path.length,
        pathOk: pathResult.ok,
      },
    }),
  };
}

export async function buildProofDependencyGraphView(request: DependencyGraphRequest): Promise<DependencyGraphView> {
  const startedAt = proofNowMs();
  const { dataset, cache } = await loadProofDataset(request.proofId, request.config);
  const declarationId = normalizeOptionalDeclarationId(request.declarationId);
  const includeExternalSupport = request.includeExternalSupport ?? true;
  const diagnostics: DependencyGraphQueryDiagnostic[] = [];

  let declaration: DependencyGraphView["declaration"];
  if (declarationId) {
    const node = dataset.dependencyGraph.nodes[declarationId];
    if (!node) {
      diagnostics.push({
        code: "declaration_not_found",
        severity: "error",
        message: `Declaration '${declarationId}' is not present in dependency graph.`,
        details: { declarationId },
      });
    } else {
      const stronglyConnectedComponent =
        dataset.dependencyGraph.sccs.find((component) => component.includes(declarationId))?.slice() ?? [declarationId];
      declaration = {
        declarationId,
        directDependencies: getDirectDependencies(dataset.dependencyGraph, declarationId),
        directDependents: getDirectDependents(dataset.dependencyGraph, declarationId),
        supportingDeclarations: getSupportingDeclarations(dataset.dependencyGraph, declarationId, {
          includeExternal: includeExternalSupport,
        }),
        stronglyConnectedComponent,
        inCycle: dataset.dependencyGraph.cyclicSccs.some((component) => component.includes(declarationId)),
      };
    }
  }

  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    declarationId,
    configHash: dataset.configHash,
    includeExternalSupport,
    query: "dependency-graph",
  });
  return {
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash,
    dependencyGraphHash: dataset.dependencyGraphHash,
    graph: {
      schemaVersion: dataset.dependencyGraph.schemaVersion,
      nodeCount: dataset.dependencyGraph.nodeIds.length,
      edgeCount: dataset.dependencyGraph.edgeCount,
      indexedNodeCount: dataset.dependencyGraph.indexedNodeCount,
      externalNodeCount: dataset.dependencyGraph.externalNodeCount,
      missingDependencyRefs: dataset.dependencyGraph.missingDependencyRefs.map((ref) => ({ ...ref })),
      sccCount: dataset.dependencyGraph.sccs.length,
      cyclicSccCount: dataset.dependencyGraph.cyclicSccs.length,
      cyclicSccs: dataset.dependencyGraph.cyclicSccs.map((component) => component.slice()),
    },
    declaration,
    diagnostics,
    observability: buildProofQueryObservability({
      proofId: request.proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "dependency-graph",
      tree: dataset.tree,
      cache,
      latencyMs: elapsedMs(startedAt),
      extraMetrics: {
        declarationRequested: declarationId ?? "none",
        includeExternalSupport,
        graphNodeCount: dataset.dependencyGraph.nodeIds.length,
        graphEdgeCount: dataset.dependencyGraph.edgeCount,
        graphCyclicSccCount: dataset.dependencyGraph.cyclicSccs.length,
      },
    }),
  };
}

export async function buildProofPolicyReportView(request: PolicyReportRequest): Promise<PolicyReportView> {
  const startedAt = proofNowMs();
  const { dataset, cache } = await loadProofDataset(request.proofId, request.config);
  const report = evaluateExplanationTreeQuality(dataset.tree, dataset.config, {
    thresholds: request.thresholds,
  });

  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    configHash: dataset.configHash,
    thresholds: request.thresholds ?? {},
    query: "policy-report",
  });
  return {
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash,
    reportHash: computeTreeQualityReportHash(report),
    report,
    observability: buildProofQueryObservability({
      proofId: request.proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "policy-report",
      tree: dataset.tree,
      cache,
      latencyMs: elapsedMs(startedAt),
      extraMetrics: {
        thresholdPass: report.thresholdPass,
        thresholdFailureCount: report.thresholdFailures.length,
        repartitionEventCount: report.repartitionMetrics.eventCount,
      },
    }),
  };
}

export async function buildProofCacheReportView(request: ProofCacheReportRequest): Promise<ProofCacheReportView> {
  const startedAt = proofNowMs();
  const resolved = await loadProofDataset(request.proofId, request.config);
  const requestHash = computeCanonicalRequestHash({
    proofId: request.proofId,
    configHash: resolved.dataset.configHash,
    query: "cache-report",
  });
  return {
    proofId: request.proofId,
    configHash: resolved.dataset.configHash,
    requestHash,
    cache: resolved.cache,
    observability: buildProofQueryObservability({
      proofId: request.proofId,
      configHash: resolved.dataset.configHash,
      requestHash,
      query: "cache-report",
      tree: resolved.dataset.tree,
      cache: resolved.cache,
      latencyMs: elapsedMs(startedAt),
      extraMetrics: {
        cacheDiagnosticCount: resolved.cache.diagnostics.length,
        hasBlockedSubtreePlan: Boolean(resolved.cache.blockedSubtreePlan),
      },
    }),
  };
}

export function buildSeedNodePathView(request: NodePathRequest) {
  const startedAt = proofNowMs();
  const dataset = loadSeedDataset(request.proofId, request.config);
  const api = createSeedTreeQueryApi(dataset);
  const cache = buildSeedCacheMetadata(dataset, computeTreeStorageSnapshotHash(api.snapshot));
  const pathResult = api.getAncestryPath(request.nodeId);
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
    path: pathResult,
    observability: buildProofQueryObservability({
      proofId: request.proofId,
      configHash: dataset.configHash,
      requestHash,
      query: "path",
      tree: dataset.tree as ExplanationTree,
      cache,
      latencyMs: elapsedMs(startedAt),
      extraMetrics: {
        requestedNodeId: request.nodeId,
        pathLength: pathResult.path.length,
        pathOk: pathResult.ok,
      },
    }),
  };
}

export async function findProofLeaf(proofId: string, leafId: string): Promise<TheoremLeafRecord | undefined> {
  const { dataset } = await loadProofDataset(proofId, {});
  return dataset.leaves.find((leaf) => leaf.id === leafId);
}

export function clearProofDatasetCacheForTests(): void {
  datasetCache.clear();
}

async function loadProofDataset(proofId: string, configInput: ExplanationConfigInput = {}): Promise<ResolvedDataset> {
  assertSupportedProof(proofId);
  const config = normalizeConfig(
    proofId === SEED_PROOF_ID
      ? { ...seedConfig, ...configInput }
      : {
          ...configInput,
        },
  );
  const configHash = computeConfigHash(config);
  const cacheKey = `${proofId}:${configHash}`;

  const existing = datasetCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const created = buildDataset(proofId, config, configHash);
  datasetCache.set(cacheKey, created);

  try {
    return await created;
  } catch (error) {
    datasetCache.delete(cacheKey);
    throw error;
  }
}

async function buildDataset(proofId: string, config: ExplanationConfig, configHash: string): Promise<ResolvedDataset> {
  if (proofId === SEED_PROOF_ID) {
    const seed = loadSeedDataset(proofId, config);
    const dependencyGraph = buildDeclarationDependencyGraph(
      seed.leaves.map((leaf) => ({ id: leaf.id, dependencyIds: leaf.dependencyIds })),
    );
    const dependencyGraphHash = computeDependencyGraphHash(dependencyGraph);
    const snapshot = exportTreeStorageSnapshot(seed.tree as never, {
      proofId: seed.proofId,
      leaves: seed.leaves,
      config: seed.config,
    });
    return {
      dataset: {
        proofId: seed.proofId,
        title: "Verity contract seed proof",
        config: seed.config,
        configHash: seed.configHash,
        tree: seed.tree as ExplanationTree,
        leaves: seed.leaves,
        dependencyGraph,
        dependencyGraphHash,
      },
      queryApi: createTreeQueryApi(snapshot),
      cache: {
        layer: "ephemeral",
        status: "miss",
        cacheKey: `${seed.proofId}:${seed.configHash}`,
        sourceFingerprint: "seed",
        snapshotHash: computeTreeStorageSnapshotHash(snapshot),
        cacheEntryHash: computeCanonicalRequestHash({
          proofId: seed.proofId,
          configHash: seed.configHash,
          snapshotHash: computeTreeStorageSnapshotHash(snapshot),
        }),
        diagnostics: [
          {
            code: "cache_miss",
            message: "Seed dataset is rebuilt deterministically per request (ephemeral cache only).",
          },
        ],
      },
    };
  }

  const fixtureProjectRoot = await resolveLeanFixtureProjectRoot();
  const sources = await Promise.all(
    LEAN_FIXTURE_PATHS.map(async (relativePath) => {
      const absolutePath = path.join(fixtureProjectRoot, relativePath);
      const content = await fs.readFile(absolutePath, "utf8");
      return {
        relativePath,
        filePath: absolutePath,
        content,
      };
    }),
  );
  const sourceFingerprint = computeSourceFingerprint(sources);
  const cachePath = buildProofDatasetCachePath(proofId, configHash);
  const cacheKey = `${proofId}:${configHash}:${sourceFingerprint}`;
  const cached = await readProofDatasetCacheEntry(cachePath);
  const cacheDiagnostics: ProofDatasetCacheDiagnostic[] = [];
  let cachedLeavesForTopologyRecovery: TheoremLeafRecord[] | undefined;
  let cachedTreeForTopologyRecovery: ExplanationTree | undefined;

  if (cached.entry) {
    if (cached.entry.sourceFingerprint === sourceFingerprint) {
      const imported = importTreeStorageSnapshot(cached.entry.snapshot);
      const hasImportErrors = imported.diagnostics.some((diagnostic) => diagnostic.severity === "error");
      if (!hasImportErrors && imported.tree) {
        const dependencyGraph = buildDeclarationDependencyGraph(
          imported.leaves.map((leaf) => ({ id: leaf.id, dependencyIds: leaf.dependencyIds })),
        );
        const dependencyGraphHash = computeDependencyGraphHash(dependencyGraph);
        const snapshotHash = computeTreeStorageSnapshotHash(cached.entry.snapshot);

        if (dependencyGraphHash === cached.entry.dependencyGraphHash && snapshotHash === cached.entry.snapshotHash) {
          cacheDiagnostics.push({
            code: "cache_hit",
            message: "Loaded deterministic Lean fixture dataset from persistent cache.",
            details: {
              cachePath,
              cacheEntryHash: cached.cacheEntryHash,
            },
          });
          return {
            dataset: {
              proofId,
              title: `Lean Verity fixture (${imported.leaves.length} declarations, ingestion=${cached.entry.ingestionHash.slice(0, 8)}, depgraph=${dependencyGraphHash.slice(0, 8)})`,
              config,
              configHash,
              tree: imported.tree,
              leaves: imported.leaves,
              dependencyGraph,
              dependencyGraphHash,
            },
            queryApi: createTreeQueryApi(cached.entry.snapshot),
            cache: {
              layer: "persistent",
              status: "hit",
              cacheKey,
              sourceFingerprint,
              cachePath,
              snapshotHash: cached.entry.snapshotHash,
              cacheEntryHash: cached.cacheEntryHash,
              diagnostics: cacheDiagnostics,
            },
          };
        }

        cacheDiagnostics.push({
          code: dependencyGraphHash !== cached.entry.dependencyGraphHash ? "cache_dependency_hash_mismatch" : "cache_snapshot_hash_mismatch",
          message:
            dependencyGraphHash !== cached.entry.dependencyGraphHash
              ? "Cached dependency graph hash mismatch detected; rebuilding dataset."
              : "Cached snapshot hash mismatch detected; rebuilding dataset.",
          details: {
            cachePath,
            expectedDependencyGraphHash: cached.entry.dependencyGraphHash,
            actualDependencyGraphHash: dependencyGraphHash,
            expectedSnapshotHash: cached.entry.snapshotHash,
            actualSnapshotHash: snapshotHash,
          },
        });
      } else {
        cacheDiagnostics.push({
          code: "cache_entry_invalid",
          message: "Cached snapshot failed validation; rebuilding dataset.",
          details: {
            cachePath,
            diagnostics: imported.diagnostics,
          },
        });
      }
    } else {
      const imported = importTreeStorageSnapshot(cached.entry.snapshot);
      const hasImportErrors = imported.diagnostics.some((diagnostic) => diagnostic.severity === "error");
      if (!hasImportErrors && imported.tree) {
        cachedLeavesForTopologyRecovery = imported.leaves;
        cachedTreeForTopologyRecovery = imported.tree;
      } else {
        cacheDiagnostics.push({
          code: "cache_entry_invalid",
          message: "Cached snapshot failed validation before topology recovery; rebuilding dataset.",
          details: {
            cachePath,
            diagnostics: imported.diagnostics,
          },
        });
      }
      cacheDiagnostics.push({
        code: "cache_miss",
        message: "Cached dataset source fingerprint mismatch; rebuilding dataset.",
        details: {
          cachePath,
          expectedSourceFingerprint: cached.entry.sourceFingerprint,
          actualSourceFingerprint: sourceFingerprint,
        },
      });
    }
  } else {
    if (cached.readError) {
      cacheDiagnostics.push({
        code: "cache_read_failed",
        message: "Persistent cache read failed; rebuilding dataset.",
        details: { cachePath, error: cached.readError },
      });
    } else {
      cacheDiagnostics.push({
        code: "cache_miss",
        message: "No persisted cache entry found for requested proof/config.",
        details: { cachePath },
      });
    }
  }

  const ingestion = ingestLeanSources(fixtureProjectRoot, sources, {
    sourceBaseUrl: LEAN_FIXTURE_SOURCE_BASE_URL,
  });
  const ingestionHash = computeLeanIngestionHash(ingestion);
  const theoremLeaves = mapLeanIngestionToTheoremLeaves(ingestion);
  const dependencyGraph = buildDeclarationDependencyGraph(
    theoremLeaves.map((leaf) => ({ id: leaf.id, dependencyIds: leaf.dependencyIds })),
  );
  const dependencyGraphHash = computeDependencyGraphHash(dependencyGraph);
  let blockedSubtreePlan: ProofDatasetBlockedSubtreePlan | undefined;

  if (cached.entry && cachedLeavesForTopologyRecovery && cachedTreeForTopologyRecovery) {
    blockedSubtreePlan = buildBlockedSubtreePlan(cachedLeavesForTopologyRecovery, theoremLeaves);

    const topologyIsStable =
      !blockedSubtreePlan.fullRebuildRequired && dependencyGraphHash === cached.entry.dependencyGraphHash;

    if (topologyIsStable) {
      const recoveredSnapshot = exportTreeStorageSnapshot(cachedTreeForTopologyRecovery, {
        proofId,
        leaves: theoremLeaves,
        config,
      });
      const recoveredSnapshotHash = computeTreeStorageSnapshotHash(recoveredSnapshot);
      const recoveredCacheEntry: ProofDatasetCacheEntry = {
        schemaVersion: PROOF_DATASET_CACHE_SCHEMA_VERSION,
        proofId,
        configHash,
        sourceFingerprint,
        ingestionHash,
        dependencyGraphHash: cached.entry.dependencyGraphHash,
        snapshotHash: recoveredSnapshotHash,
        snapshot: recoveredSnapshot,
      };
      const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, recoveredCacheEntry);
      if (cacheWriteError) {
        cacheDiagnostics.push({
          code: "cache_write_failed",
          message: "Failed writing topology recovery cache entry; continuing with recovered cached dataset.",
          details: { cachePath, error: cacheWriteError },
        });
      }
      cacheDiagnostics.push({
        code: "cache_topology_recovery_hit",
        message: "Recovered cached dataset via deterministic topology plan (no blocked declarations).",
        details: {
          cachePath,
          planHash: blockedSubtreePlan.planHash,
          rebasedSnapshotHash: recoveredSnapshotHash,
        },
      });

      return {
        dataset: {
          proofId,
          title: `Lean Verity fixture (${theoremLeaves.length} declarations, ingestion=${ingestionHash.slice(0, 8)}, depgraph=${dependencyGraphHash.slice(0, 8)})`,
          config,
          configHash,
          tree: cachedTreeForTopologyRecovery,
          leaves: theoremLeaves,
          dependencyGraph,
          dependencyGraphHash,
        },
        queryApi: createTreeQueryApi(recoveredSnapshot),
        cache: {
          layer: "persistent",
          status: "hit",
          cacheKey,
          sourceFingerprint,
          cachePath,
          snapshotHash: recoveredSnapshotHash,
          cacheEntryHash: computeProofDatasetCacheEntryHash(recoveredCacheEntry),
          diagnostics: cacheDiagnostics,
          blockedSubtreePlan,
        },
      };
    }

    const blockedSubtreeRecovery = await attemptBlockedSubtreeRecovery({
      proofId,
      config,
      configHash,
      sourceFingerprint,
      ingestionHash,
      dependencyGraphHash,
      cachePath,
      blockedSubtreePlan,
      cachedTree: cachedTreeForTopologyRecovery,
      currentLeaves: theoremLeaves,
      provider: createDeterministicSummaryProvider(),
    });

    if (blockedSubtreeRecovery) {
      const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, blockedSubtreeRecovery.cacheEntry);
      if (cacheWriteError) {
        cacheDiagnostics.push({
          code: "cache_write_failed",
          message: "Failed writing blocked-subtree recovery cache entry; continuing with recovered dataset.",
          details: { cachePath, error: cacheWriteError },
        });
      }

      cacheDiagnostics.push({
        code: "cache_blocked_subtree_rebuild_hit",
        message: "Recovered cached dataset by recomputing blocked-subtree ancestor parents on cached topology.",
        details: {
          cachePath,
          planHash: blockedSubtreePlan.planHash,
          recomputedLeafCount: blockedSubtreeRecovery.recomputedLeafIds.length,
          recomputedParentCount: blockedSubtreeRecovery.recomputedParentIds.length,
          recomputeHash: blockedSubtreeRecovery.recomputeHash,
        },
      });

      return {
        dataset: {
          proofId,
          title: `Lean Verity fixture (${theoremLeaves.length} declarations, ingestion=${ingestionHash.slice(0, 8)}, depgraph=${dependencyGraphHash.slice(0, 8)})`,
          config,
          configHash,
          tree: blockedSubtreeRecovery.tree,
          leaves: theoremLeaves,
          dependencyGraph,
          dependencyGraphHash,
        },
        queryApi: createTreeQueryApi(blockedSubtreeRecovery.cacheEntry.snapshot),
        cache: {
          layer: "persistent",
          status: "hit",
          cacheKey,
          sourceFingerprint,
          cachePath,
          snapshotHash: blockedSubtreeRecovery.cacheEntry.snapshotHash,
          cacheEntryHash: computeProofDatasetCacheEntryHash(blockedSubtreeRecovery.cacheEntry),
          diagnostics: cacheDiagnostics,
          blockedSubtreePlan,
        },
      };
    }

    const topologyRemovalRecovery = await attemptTopologyRemovalRecovery({
      proofId,
      config,
      configHash,
      sourceFingerprint,
      ingestionHash,
      dependencyGraphHash,
      blockedSubtreePlan,
      cachedTree: cachedTreeForTopologyRecovery,
      cachedLeaves: cachedLeavesForTopologyRecovery,
      currentLeaves: theoremLeaves,
      provider: createDeterministicSummaryProvider(),
    });

    if (topologyRemovalRecovery) {
      const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, topologyRemovalRecovery.cacheEntry);
      if (cacheWriteError) {
        cacheDiagnostics.push({
          code: "cache_write_failed",
          message: "Failed writing topology-removal recovery cache entry; continuing with recovered dataset.",
          details: { cachePath, error: cacheWriteError },
        });
      }

      cacheDiagnostics.push({
        code: "cache_topology_removal_subtree_rebuild_hit",
        message: "Recovered cached dataset by deterministic topology-removal subtree recompute on cached topology.",
        details: {
          cachePath,
          planHash: blockedSubtreePlan.planHash,
          removedLeafCount: topologyRemovalRecovery.removedLeafIds.length,
          touchedParentCount: topologyRemovalRecovery.touchedParentCount,
          recomputedParentCount: topologyRemovalRecovery.recomputedParentIds.length,
          collapsedParentCount: topologyRemovalRecovery.collapsedParentIds.length,
          droppedParentCount: topologyRemovalRecovery.droppedParentIds.length,
          recoveryHash: topologyRemovalRecovery.recoveryHash,
        },
      });

      return {
        dataset: {
          proofId,
          title: `Lean Verity fixture (${theoremLeaves.length} declarations, ingestion=${ingestionHash.slice(0, 8)}, depgraph=${dependencyGraphHash.slice(0, 8)})`,
          config,
          configHash,
          tree: topologyRemovalRecovery.tree,
          leaves: theoremLeaves,
          dependencyGraph,
          dependencyGraphHash,
        },
        queryApi: createTreeQueryApi(topologyRemovalRecovery.cacheEntry.snapshot),
        cache: {
          layer: "persistent",
          status: "hit",
          cacheKey,
          sourceFingerprint,
          cachePath,
          snapshotHash: topologyRemovalRecovery.cacheEntry.snapshotHash,
          cacheEntryHash: computeProofDatasetCacheEntryHash(topologyRemovalRecovery.cacheEntry),
          diagnostics: cacheDiagnostics,
          blockedSubtreePlan,
        },
      };
    }

    const topologyAdditionRecovery = await attemptTopologyAdditionRecovery({
      proofId,
      config,
      configHash,
      sourceFingerprint,
      ingestionHash,
      dependencyGraphHash,
      blockedSubtreePlan,
      cachedTree: cachedTreeForTopologyRecovery,
      currentLeaves: theoremLeaves,
    });

    if (topologyAdditionRecovery) {
      const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, topologyAdditionRecovery.cacheEntry);
      if (cacheWriteError) {
        cacheDiagnostics.push({
          code: "cache_write_failed",
          message: "Failed writing topology-addition recovery cache entry; continuing with recovered dataset.",
          details: { cachePath, error: cacheWriteError },
        });
      }

      cacheDiagnostics.push({
        code:
          topologyAdditionRecovery.recoveryMode === "insertion"
            ? "cache_topology_addition_subtree_insertion_rebuild_hit"
            : "cache_topology_addition_subtree_regeneration_rebuild_hit",
        message:
          topologyAdditionRecovery.recoveryMode === "insertion"
            ? "Recovered cached dataset by deterministic addition-only subtree insertion on cached topology."
            : "Recovered cached dataset by deterministic addition-only recovery (targeted addition evidence + topology regeneration).",
        details: {
          cachePath,
          planHash: blockedSubtreePlan.planHash,
          recoveryMode: topologyAdditionRecovery.recoveryMode,
          addedLeafCount: topologyAdditionRecovery.addedLeafIds.length,
          insertionFrontierCount: topologyAdditionRecovery.insertionFrontierCount,
          insertionAnchorCount: topologyAdditionRecovery.insertionAnchorCount,
          insertionMergeParentCount: topologyAdditionRecovery.insertionMergeParentCount,
          insertedParentCount: topologyAdditionRecovery.insertedParentCount,
          insertionScheduledAttachmentCount: topologyAdditionRecovery.insertionScheduledAttachmentCount,
          insertionRecomputedAncestorCount: topologyAdditionRecovery.insertionRecomputedAncestorCount,
          insertionStrategy: topologyAdditionRecovery.insertionStrategy,
          reusableParentSummaryCount: topologyAdditionRecovery.reusableParentSummaryCount,
          reusedParentSummaryCount: topologyAdditionRecovery.reusedParentSummaryCount,
          reusedParentSummaryByGroundingCount: topologyAdditionRecovery.reusedParentSummaryByGroundingCount,
          reusedParentSummaryByStatementSignatureCount:
            topologyAdditionRecovery.reusedParentSummaryByStatementSignatureCount,
          generatedParentSummaryCount: topologyAdditionRecovery.generatedParentSummaryCount,
          skippedAmbiguousStatementSignatureReuseCount:
            topologyAdditionRecovery.skippedAmbiguousStatementSignatureReuseCount,
          skippedUnrebasableStatementSignatureReuseCount:
            topologyAdditionRecovery.skippedUnrebasableStatementSignatureReuseCount,
          regenerationHash: topologyAdditionRecovery.regenerationHash,
          additionRecoveryHash: topologyAdditionRecovery.additionRecoveryHash,
        },
      });

      return {
        dataset: {
          proofId,
          title: `Lean Verity fixture (${theoremLeaves.length} declarations, ingestion=${ingestionHash.slice(0, 8)}, depgraph=${dependencyGraphHash.slice(0, 8)})`,
          config,
          configHash,
          tree: topologyAdditionRecovery.tree,
          leaves: theoremLeaves,
          dependencyGraph,
          dependencyGraphHash,
        },
        queryApi: createTreeQueryApi(topologyAdditionRecovery.cacheEntry.snapshot),
        cache: {
          layer: "persistent",
          status: "hit",
          cacheKey,
          sourceFingerprint,
          cachePath,
          snapshotHash: topologyAdditionRecovery.cacheEntry.snapshotHash,
          cacheEntryHash: computeProofDatasetCacheEntryHash(topologyAdditionRecovery.cacheEntry),
          diagnostics: cacheDiagnostics,
          blockedSubtreePlan,
        },
      };
    }

    const topologyMixedRecovery = await attemptTopologyMixedRecovery({
      proofId,
      config,
      configHash,
      sourceFingerprint,
      ingestionHash,
      dependencyGraphHash,
      blockedSubtreePlan,
      cachedTree: cachedTreeForTopologyRecovery,
      cachedLeaves: cachedLeavesForTopologyRecovery,
      currentLeaves: theoremLeaves,
      provider: createDeterministicSummaryProvider(),
    });

    if (topologyMixedRecovery) {
      const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, topologyMixedRecovery.cacheEntry);
      if (cacheWriteError) {
        cacheDiagnostics.push({
          code: "cache_write_failed",
          message: "Failed writing topology-mixed recovery cache entry; continuing with recovered dataset.",
          details: { cachePath, error: cacheWriteError },
        });
      }

      cacheDiagnostics.push({
        code: "cache_topology_mixed_subtree_regeneration_rebuild_hit",
        message:
          "Recovered cached dataset by deterministic mixed-shape recovery (removal-subtree prune + topology regeneration).",
        details: {
          cachePath,
          planHash: blockedSubtreePlan.planHash,
          removedLeafCount: topologyMixedRecovery.removedLeafIds.length,
          touchedParentCount: topologyMixedRecovery.touchedParentCount,
          recomputedParentCount: topologyMixedRecovery.recomputedParentIds.length,
          collapsedParentCount: topologyMixedRecovery.collapsedParentIds.length,
          droppedParentCount: topologyMixedRecovery.droppedParentIds.length,
          reusableParentSummaryCount: topologyMixedRecovery.reusableParentSummaryCount,
          reusedParentSummaryCount: topologyMixedRecovery.reusedParentSummaryCount,
          reusedParentSummaryByGroundingCount: topologyMixedRecovery.reusedParentSummaryByGroundingCount,
          reusedParentSummaryByStatementSignatureCount:
            topologyMixedRecovery.reusedParentSummaryByStatementSignatureCount,
          generatedParentSummaryCount: topologyMixedRecovery.generatedParentSummaryCount,
          skippedAmbiguousStatementSignatureReuseCount:
            topologyMixedRecovery.skippedAmbiguousStatementSignatureReuseCount,
          skippedUnrebasableStatementSignatureReuseCount:
            topologyMixedRecovery.skippedUnrebasableStatementSignatureReuseCount,
          removalRecoveryHash: topologyMixedRecovery.removalRecoveryHash,
          regenerationHash: topologyMixedRecovery.regenerationHash,
          mixedRecoveryHash: topologyMixedRecovery.mixedRecoveryHash,
        },
      });

      return {
        dataset: {
          proofId,
          title: `Lean Verity fixture (${theoremLeaves.length} declarations, ingestion=${ingestionHash.slice(0, 8)}, depgraph=${dependencyGraphHash.slice(0, 8)})`,
          config,
          configHash,
          tree: topologyMixedRecovery.tree,
          leaves: theoremLeaves,
          dependencyGraph,
          dependencyGraphHash,
        },
        queryApi: createTreeQueryApi(topologyMixedRecovery.cacheEntry.snapshot),
        cache: {
          layer: "persistent",
          status: "hit",
          cacheKey,
          sourceFingerprint,
          cachePath,
          snapshotHash: topologyMixedRecovery.cacheEntry.snapshotHash,
          cacheEntryHash: computeProofDatasetCacheEntryHash(topologyMixedRecovery.cacheEntry),
          diagnostics: cacheDiagnostics,
          blockedSubtreePlan,
        },
      };
    }

    const topologyRegenerationRecovery = await attemptTopologyRegenerationRecovery({
      proofId,
      config,
      configHash,
      sourceFingerprint,
      ingestionHash,
      dependencyGraphHash,
      cachedTree: cachedTreeForTopologyRecovery,
      currentLeaves: theoremLeaves,
    });

    if (topologyRegenerationRecovery) {
      const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, topologyRegenerationRecovery.cacheEntry);
      if (cacheWriteError) {
        cacheDiagnostics.push({
          code: "cache_write_failed",
          message: "Failed writing topology-regeneration recovery cache entry; continuing with recovered dataset.",
          details: { cachePath, error: cacheWriteError },
        });
      }

      cacheDiagnostics.push({
        code: "cache_topology_regeneration_rebuild_hit",
        message: "Recovered cached dataset by deterministic topology regeneration with reusable parent summaries.",
        details: {
          cachePath,
          planHash: blockedSubtreePlan.planHash,
          reusableParentSummaryCount: topologyRegenerationRecovery.reusableParentSummaryCount,
          reusedParentSummaryCount: topologyRegenerationRecovery.reusedParentSummaryCount,
          reusedParentSummaryByGroundingCount: topologyRegenerationRecovery.reusedParentSummaryByGroundingCount,
          reusedParentSummaryByStatementSignatureCount:
            topologyRegenerationRecovery.reusedParentSummaryByStatementSignatureCount,
          generatedParentSummaryCount: topologyRegenerationRecovery.generatedParentSummaryCount,
          skippedAmbiguousStatementSignatureReuseCount:
            topologyRegenerationRecovery.skippedAmbiguousStatementSignatureReuseCount,
          skippedUnrebasableStatementSignatureReuseCount:
            topologyRegenerationRecovery.skippedUnrebasableStatementSignatureReuseCount,
          regenerationHash: topologyRegenerationRecovery.regenerationHash,
        },
      });

      return {
        dataset: {
          proofId,
          title: `Lean Verity fixture (${theoremLeaves.length} declarations, ingestion=${ingestionHash.slice(0, 8)}, depgraph=${dependencyGraphHash.slice(0, 8)})`,
          config,
          configHash,
          tree: topologyRegenerationRecovery.tree,
          leaves: theoremLeaves,
          dependencyGraph,
          dependencyGraphHash,
        },
        queryApi: createTreeQueryApi(topologyRegenerationRecovery.cacheEntry.snapshot),
        cache: {
          layer: "persistent",
          status: "hit",
          cacheKey,
          sourceFingerprint,
          cachePath,
          snapshotHash: topologyRegenerationRecovery.cacheEntry.snapshotHash,
          cacheEntryHash: computeProofDatasetCacheEntryHash(topologyRegenerationRecovery.cacheEntry),
          diagnostics: cacheDiagnostics,
          blockedSubtreePlan,
        },
      };
    }

    if (blockedSubtreePlan.fullRebuildRequired) {
      cacheDiagnostics.push({
        code: "cache_blocked_subtree_full_rebuild",
        message: "Blocked-subtree recovery unavailable; rebuilding full dataset deterministically.",
        details: {
          cachePath,
          planHash: blockedSubtreePlan.planHash,
          reason: classifyBlockedSubtreeFullRebuildReason(blockedSubtreePlan, {
            cachedDependencyGraphHash: cached.entry.dependencyGraphHash,
            currentDependencyGraphHash: dependencyGraphHash,
          }),
          topologyShapeChanged: blockedSubtreePlan.topologyShapeChanged,
          blockedDeclarationCount: blockedSubtreePlan.blockedDeclarationIds.length,
          addedDeclarationCount: blockedSubtreePlan.addedDeclarationIds.length,
          removedDeclarationCount: blockedSubtreePlan.removedDeclarationIds.length,
          cyclicBatchCount: blockedSubtreePlan.cyclicBatchCount,
        },
      });
    }
  }

  const tree = await buildRecursiveExplanationTree(createDeterministicSummaryProvider(), {
    leaves: mapTheoremLeavesToLocalizedTreeLeaves(theoremLeaves, config.language),
    config,
  });

  const validation = validateExplanationTree(tree, config.maxChildrenPerParent);
  if (!validation.ok) {
    throw new Error(`Lean fixture tree validation failed: ${validation.issues.map((issue) => issue.code).join(", ")}`);
  }

  const snapshot = exportTreeStorageSnapshot(tree, {
    proofId,
    leaves: theoremLeaves,
    config,
  });
  const snapshotHash = computeTreeStorageSnapshotHash(snapshot);
  const cacheEntry: ProofDatasetCacheEntry = {
    schemaVersion: PROOF_DATASET_CACHE_SCHEMA_VERSION,
    proofId,
    configHash,
    sourceFingerprint,
    ingestionHash,
    dependencyGraphHash,
    snapshotHash,
    snapshot,
  };
  const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, cacheEntry);
  if (cacheWriteError) {
    cacheDiagnostics.push({
      code: "cache_write_failed",
      message: "Failed writing persistent cache entry; continuing with rebuilt dataset.",
      details: { cachePath, error: cacheWriteError },
    });
  }

  const dataset: ProofDataset = {
    proofId,
    title: `Lean Verity fixture (${theoremLeaves.length} declarations, ingestion=${ingestionHash.slice(0, 8)}, depgraph=${dependencyGraphHash.slice(0, 8)})`,
    config,
    configHash,
    tree,
    leaves: theoremLeaves,
    dependencyGraph,
    dependencyGraphHash,
  };

  return {
    dataset,
    queryApi: createTreeQueryApi(snapshot),
    cache: {
      layer: "persistent",
      status: "miss",
      cacheKey,
      sourceFingerprint,
      cachePath,
      snapshotHash,
      cacheEntryHash: computeProofDatasetCacheEntryHash(cacheEntry),
      diagnostics: cacheDiagnostics,
      blockedSubtreePlan,
    },
  };
}

async function resolveLeanFixtureProjectRoot(): Promise<string> {
  const envOverride = process.env.EXPLAIN_MD_LEAN_FIXTURE_PROJECT_ROOT;
  const candidates = [
    ...(envOverride ? [path.resolve(envOverride)] : []),
    LEAN_FIXTURE_PROJECT_ROOT,
    path.resolve(process.cwd(), "..", "tests", "fixtures", "lean-project"),
    path.resolve(process.cwd(), "..", "..", "tests", "fixtures", "lean-project"),
  ];

  for (const candidate of candidates) {
    const probe = path.join(candidate, LEAN_FIXTURE_PATHS[0] ?? "");
    try {
      await fs.access(probe);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    `Lean fixture project root not found. Tried: ${candidates.join(", ")}.`,
  );
}

function buildProofDatasetCachePath(proofId: string, configHash: string): string {
  const safeProofId = proofId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(resolveProofDatasetCacheDir(), safeProofId, `${configHash}.json`);
}

function resolveProofDatasetCacheDir(): string {
  return path.resolve(process.env.EXPLAIN_MD_WEB_PROOF_CACHE_DIR ?? DEFAULT_PROOF_DATASET_CACHE_DIR);
}

async function readProofDatasetCacheEntry(
  cachePath: string,
): Promise<{ entry?: ProofDatasetCacheEntry; cacheEntryHash: string; readError?: string }> {
  let raw: string;
  try {
    raw = await fs.readFile(cachePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("ENOENT")) {
      return {
        cacheEntryHash: computeCanonicalRequestHash({ cachePath, status: "missing" }),
      };
    }
    return {
      cacheEntryHash: computeCanonicalRequestHash({ cachePath, status: "read_error", message }),
      readError: message,
    };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ProofDatasetCacheEntry>;
    if (
      parsed.schemaVersion !== PROOF_DATASET_CACHE_SCHEMA_VERSION ||
      typeof parsed.proofId !== "string" ||
      typeof parsed.configHash !== "string" ||
      typeof parsed.sourceFingerprint !== "string" ||
      typeof parsed.ingestionHash !== "string" ||
      typeof parsed.dependencyGraphHash !== "string" ||
      typeof parsed.snapshotHash !== "string" ||
      !parsed.snapshot
    ) {
      return {
        cacheEntryHash: computeCanonicalRequestHash({ cachePath, status: "invalid_entry" }),
        readError: "Cache entry schema validation failed.",
      };
    }

    const entry: ProofDatasetCacheEntry = {
      schemaVersion: parsed.schemaVersion,
      proofId: parsed.proofId,
      configHash: parsed.configHash,
      sourceFingerprint: parsed.sourceFingerprint,
      ingestionHash: parsed.ingestionHash,
      dependencyGraphHash: parsed.dependencyGraphHash,
      snapshotHash: parsed.snapshotHash,
      snapshot: parsed.snapshot as TreeStorageSnapshot,
    };

    return {
      entry,
      cacheEntryHash: computeProofDatasetCacheEntryHash(entry),
    };
  } catch (error) {
    return {
      cacheEntryHash: computeCanonicalRequestHash({ cachePath, status: "parse_error" }),
      readError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeProofDatasetCacheEntry(cachePath: string, entry: ProofDatasetCacheEntry): Promise<string | undefined> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function computeProofDatasetCacheEntryHash(entry: ProofDatasetCacheEntry): string {
  return computeCanonicalRequestHash({
    schemaVersion: entry.schemaVersion,
    proofId: entry.proofId,
    configHash: entry.configHash,
    sourceFingerprint: entry.sourceFingerprint,
    ingestionHash: entry.ingestionHash,
    dependencyGraphHash: entry.dependencyGraphHash,
    snapshotHash: entry.snapshotHash,
    snapshot: entry.snapshot,
  });
}

function computeSourceFingerprint(sources: Array<{ relativePath: string; filePath: string; content: string }>): string {
  return computeCanonicalRequestHash({
    files: sources
      .map((source) => ({
        relativePath: source.relativePath,
        contentHash: createHash("sha256").update(source.content).digest("hex"),
      }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  });
}

function buildBlockedSubtreePlan(
  cachedLeaves: TheoremLeafRecord[],
  currentLeaves: TheoremLeafRecord[],
): ProofDatasetBlockedSubtreePlan {
  const cachedByDeclarationId = new Map(cachedLeaves.map((leaf) => [leaf.declarationId, leaf]));
  const currentByDeclarationId = new Map(currentLeaves.map((leaf) => [leaf.declarationId, leaf]));

  const declarationIds = [...new Set([...cachedByDeclarationId.keys(), ...currentByDeclarationId.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  const addedDeclarationIds = declarationIds
    .filter((declarationId) => !cachedByDeclarationId.has(declarationId) && currentByDeclarationId.has(declarationId))
    .sort((a, b) => a.localeCompare(b));
  const removedDeclarationIds = declarationIds
    .filter((declarationId) => cachedByDeclarationId.has(declarationId) && !currentByDeclarationId.has(declarationId))
    .sort((a, b) => a.localeCompare(b));
  const topologyShapeChanged = addedDeclarationIds.length > 0 || removedDeclarationIds.length > 0;

  const changedDeclarationIds = declarationIds.filter((declarationId) => {
    const cached = cachedByDeclarationId.get(declarationId);
    const current = currentByDeclarationId.get(declarationId);
    if (!cached || !current) {
      return true;
    }
    return computeLeafSemanticFingerprint(cached) !== computeLeafSemanticFingerprint(current);
  });

  const currentDependentsByDeclaration = buildDependentsByDeclaration(currentLeaves);
  const blockedDeclarationSet = new Set<string>();
  const queue = [...changedDeclarationIds];
  while (queue.length > 0) {
    const next = queue.shift() as string;
    if (blockedDeclarationSet.has(next)) {
      continue;
    }
    blockedDeclarationSet.add(next);
    for (const dependentId of currentDependentsByDeclaration.get(next) ?? []) {
      if (!blockedDeclarationSet.has(dependentId)) {
        queue.push(dependentId);
      }
    }
  }

  const blockedDeclarationIds = [...blockedDeclarationSet]
    .filter((declarationId) => currentByDeclarationId.has(declarationId))
    .sort((a, b) => a.localeCompare(b));
  const blockedLeafIds = blockedDeclarationIds
    .map((declarationId) => (currentByDeclarationId.get(declarationId) as TheoremLeafRecord).id)
    .sort((a, b) => a.localeCompare(b));
  const unaffectedLeafIds = currentLeaves
    .filter((leaf) => !blockedDeclarationSet.has(leaf.declarationId))
    .map((leaf) => leaf.id)
    .sort((a, b) => a.localeCompare(b));

  const executionPlan = buildExecutionBatches(blockedDeclarationIds, currentByDeclarationId);
  const planWithoutHash = {
    schemaVersion: "1.0.0" as const,
    reason: "source_fingerprint_mismatch" as const,
    changedDeclarationIds,
    addedDeclarationIds,
    removedDeclarationIds,
    topologyShapeChanged,
    blockedDeclarationIds,
    blockedLeafIds,
    unaffectedLeafIds,
    executionBatches: executionPlan.executionBatches,
    cyclicBatchCount: executionPlan.cyclicBatchCount,
    fullRebuildRequired:
      blockedDeclarationIds.length > 0 || changedDeclarationIds.some((declarationId) => !currentByDeclarationId.has(declarationId)),
  };

  return {
    ...planWithoutHash,
    planHash: computeCanonicalRequestHash(planWithoutHash),
  };
}

function classifyBlockedSubtreeFullRebuildReason(
  plan: ProofDatasetBlockedSubtreePlan,
  options: {
    cachedDependencyGraphHash: string;
    currentDependencyGraphHash: string;
  },
): "topology_shape_changed" | "cyclic_blocked_subtree" | "dependency_graph_changed" | "recovery_preconditions_failed" {
  if (plan.topologyShapeChanged) {
    return "topology_shape_changed";
  }
  if (plan.cyclicBatchCount > 0) {
    return "cyclic_blocked_subtree";
  }
  if (options.cachedDependencyGraphHash !== options.currentDependencyGraphHash) {
    return "dependency_graph_changed";
  }
  return "recovery_preconditions_failed";
}

function computeLeafSemanticFingerprint(leaf: TheoremLeafRecord): string {
  return computeCanonicalRequestHash({
    id: leaf.id,
    declarationId: leaf.declarationId,
    theoremKind: leaf.theoremKind,
    modulePath: leaf.modulePath,
    declarationName: leaf.declarationName,
    statementText: leaf.statementText,
    prettyStatement: leaf.prettyStatement,
    dependencyIds: [...leaf.dependencyIds].sort((a, b) => a.localeCompare(b)),
    tags: [...leaf.tags].sort((a, b) => a.localeCompare(b)),
  });
}

interface BlockedSubtreeRecoveryRequest {
  proofId: string;
  config: ExplanationConfig;
  configHash: string;
  sourceFingerprint: string;
  ingestionHash: string;
  dependencyGraphHash: string;
  cachePath: string;
  blockedSubtreePlan: ProofDatasetBlockedSubtreePlan;
  cachedTree: ExplanationTree;
  currentLeaves: TheoremLeafRecord[];
  provider: ProviderClient;
}

interface BlockedSubtreeRecoveryResult {
  tree: ExplanationTree;
  cacheEntry: ProofDatasetCacheEntry;
  recomputedLeafIds: string[];
  recomputedParentIds: string[];
  recomputeHash: string;
}

interface TopologyRegenerationRecoveryResult {
  tree: ExplanationTree;
  cacheEntry: ProofDatasetCacheEntry;
  reusableParentSummaryCount: number;
  reusedParentSummaryCount: number;
  reusedParentSummaryByGroundingCount: number;
  reusedParentSummaryByStatementSignatureCount: number;
  generatedParentSummaryCount: number;
  skippedAmbiguousStatementSignatureReuseCount: number;
  skippedUnrebasableStatementSignatureReuseCount: number;
  regenerationHash: string;
}

interface TopologyRemovalRecoveryRequest {
  proofId: string;
  config: ExplanationConfig;
  configHash: string;
  sourceFingerprint: string;
  ingestionHash: string;
  dependencyGraphHash: string;
  blockedSubtreePlan: ProofDatasetBlockedSubtreePlan;
  cachedTree: ExplanationTree;
  cachedLeaves: TheoremLeafRecord[];
  currentLeaves: TheoremLeafRecord[];
  provider: ProviderClient;
}

interface TopologyRemovalRecoveryResult {
  tree: ExplanationTree;
  cacheEntry: ProofDatasetCacheEntry;
  removedLeafIds: string[];
  touchedParentCount: number;
  recomputedParentIds: string[];
  collapsedParentIds: string[];
  droppedParentIds: string[];
  recoveryHash: string;
}

interface TopologyMixedRecoveryRequest {
  proofId: string;
  config: ExplanationConfig;
  configHash: string;
  sourceFingerprint: string;
  ingestionHash: string;
  dependencyGraphHash: string;
  blockedSubtreePlan: ProofDatasetBlockedSubtreePlan;
  cachedTree: ExplanationTree;
  cachedLeaves: TheoremLeafRecord[];
  currentLeaves: TheoremLeafRecord[];
  provider: ProviderClient;
}

interface TopologyMixedRecoveryResult {
  tree: ExplanationTree;
  cacheEntry: ProofDatasetCacheEntry;
  removedLeafIds: string[];
  touchedParentCount: number;
  recomputedParentIds: string[];
  collapsedParentIds: string[];
  droppedParentIds: string[];
  reusableParentSummaryCount: number;
  reusedParentSummaryCount: number;
  reusedParentSummaryByGroundingCount: number;
  reusedParentSummaryByStatementSignatureCount: number;
  generatedParentSummaryCount: number;
  skippedAmbiguousStatementSignatureReuseCount: number;
  skippedUnrebasableStatementSignatureReuseCount: number;
  removalRecoveryHash: string;
  regenerationHash: string;
  mixedRecoveryHash: string;
}

interface TopologyAdditionRecoveryRequest {
  proofId: string;
  config: ExplanationConfig;
  configHash: string;
  sourceFingerprint: string;
  ingestionHash: string;
  dependencyGraphHash: string;
  blockedSubtreePlan: ProofDatasetBlockedSubtreePlan;
  cachedTree: ExplanationTree;
  currentLeaves: TheoremLeafRecord[];
}

interface TopologyAdditionRecoveryResult {
  tree: ExplanationTree;
  cacheEntry: ProofDatasetCacheEntry;
  recoveryMode: "insertion" | "regeneration";
  addedLeafIds: string[];
  insertionFrontierCount: number;
  insertionAnchorCount: number;
  insertionMergeParentCount: number;
  insertedParentCount: number;
  insertionScheduledAttachmentCount: number;
  insertionRecomputedAncestorCount: number;
  insertionStrategy: "anchor_grouped_connector_ancestor_recompute" | "regeneration";
  reusableParentSummaryCount: number;
  reusedParentSummaryCount: number;
  reusedParentSummaryByGroundingCount: number;
  reusedParentSummaryByStatementSignatureCount: number;
  generatedParentSummaryCount: number;
  skippedAmbiguousStatementSignatureReuseCount: number;
  skippedUnrebasableStatementSignatureReuseCount: number;
  regenerationHash: string;
  additionRecoveryHash: string;
}

interface TopologyRegenerationRecoveryRequest {
  proofId: string;
  config: ExplanationConfig;
  configHash: string;
  sourceFingerprint: string;
  ingestionHash: string;
  dependencyGraphHash: string;
  cachedTree: ExplanationTree;
  currentLeaves: TheoremLeafRecord[];
}

interface ReusableParentSummary {
  parentId: string;
  children: Array<{ id: string; statement: string }>;
  summary: {
    parent_statement: string;
    why_true_from_children: string;
    new_terms_introduced: string[];
    complexity_score: number;
    abstraction_score: number;
    evidence_refs: string[];
    confidence: number;
  };
}

async function attemptBlockedSubtreeRecovery(
  request: BlockedSubtreeRecoveryRequest,
): Promise<BlockedSubtreeRecoveryResult | undefined> {
  if (!request.blockedSubtreePlan.fullRebuildRequired) {
    return undefined;
  }
  if (request.blockedSubtreePlan.cyclicBatchCount > 0) {
    return undefined;
  }
  if (request.blockedSubtreePlan.executionBatches.length === 0) {
    return undefined;
  }

  const currentLeafByDeclarationId = new Map(request.currentLeaves.map((leaf) => [leaf.declarationId, leaf]));
  const currentLeafById = new Map(request.currentLeaves.map((leaf) => [leaf.id, leaf]));
  const cachedLeafIdSet = new Set(request.cachedTree.leafIds);
  if (cachedLeafIdSet.size !== request.currentLeaves.length) {
    return undefined;
  }
  for (const leaf of request.currentLeaves) {
    if (!cachedLeafIdSet.has(leaf.id)) {
      return undefined;
    }
  }

  const recomputeLeafIds: string[] = [];
  for (const batch of request.blockedSubtreePlan.executionBatches) {
    for (const declarationId of batch) {
      const leaf = currentLeafByDeclarationId.get(declarationId);
      if (!leaf) {
        return undefined;
      }
      if (!recomputeLeafIds.includes(leaf.id)) {
        recomputeLeafIds.push(leaf.id);
      }
    }
  }
  if (recomputeLeafIds.length === 0) {
    return undefined;
  }

  const nextNodes: Record<string, ExplanationTreeNode> = {};
  for (const [nodeId, node] of Object.entries(request.cachedTree.nodes)) {
    nextNodes[nodeId] = {
      ...node,
      childIds: node.childIds.slice(),
      evidenceRefs: node.evidenceRefs.slice(),
      newTermsIntroduced: node.newTermsIntroduced ? node.newTermsIntroduced.slice() : undefined,
      policyDiagnostics: node.policyDiagnostics
        ? {
            depth: node.policyDiagnostics.depth,
            groupIndex: node.policyDiagnostics.groupIndex,
            retriesUsed: node.policyDiagnostics.retriesUsed,
            preSummary: {
              ok: node.policyDiagnostics.preSummary.ok,
              violations: node.policyDiagnostics.preSummary.violations.map((violation) => ({ ...violation })),
              metrics: { ...node.policyDiagnostics.preSummary.metrics },
            },
            postSummary: {
              ok: node.policyDiagnostics.postSummary.ok,
              violations: node.policyDiagnostics.postSummary.violations.map((violation) => ({ ...violation })),
              metrics: { ...node.policyDiagnostics.postSummary.metrics },
            },
          }
        : undefined,
    };
  }

  for (const [leafId, leaf] of currentLeafById.entries()) {
    const existing = nextNodes[leafId];
    if (!existing || existing.kind !== "leaf") {
      return undefined;
    }
    nextNodes[leafId] = {
      ...existing,
      statement: renderLocalizedTreeLeafStatement(leaf, request.config.language),
      evidenceRefs: [leaf.id],
    };
  }

  const parentsByChildId = buildParentsByChildId(nextNodes);
  const recomputeParentSet = new Set<string>();
  const stack = recomputeLeafIds.slice();
  while (stack.length > 0) {
    const nodeId = stack.pop() as string;
    for (const parentId of parentsByChildId.get(nodeId) ?? []) {
      if (recomputeParentSet.has(parentId)) {
        continue;
      }
      recomputeParentSet.add(parentId);
      stack.push(parentId);
    }
  }

  const recomputeParentIds = [...recomputeParentSet].sort((left, right) => {
    const depthDelta = (nextNodes[left]?.depth ?? 0) - (nextNodes[right]?.depth ?? 0);
    if (depthDelta !== 0) {
      return depthDelta;
    }
    return left.localeCompare(right);
  });

  const policyDiagnosticsByParent: Record<string, ParentPolicyDiagnostics> = {};
  for (const [parentId, diagnostics] of Object.entries(request.cachedTree.policyDiagnosticsByParent)) {
    policyDiagnosticsByParent[parentId] = {
      depth: diagnostics.depth,
      groupIndex: diagnostics.groupIndex,
      retriesUsed: diagnostics.retriesUsed,
      preSummary: {
        ok: diagnostics.preSummary.ok,
        violations: diagnostics.preSummary.violations.map((violation) => ({ ...violation })),
        metrics: { ...diagnostics.preSummary.metrics },
      },
      postSummary: {
        ok: diagnostics.postSummary.ok,
        violations: diagnostics.postSummary.violations.map((violation) => ({ ...violation })),
        metrics: { ...diagnostics.postSummary.metrics },
      },
    };
  }

  for (const parentId of recomputeParentIds) {
    const parentNode = nextNodes[parentId];
    if (!parentNode || parentNode.kind !== "parent") {
      return undefined;
    }
    const children = parentNode.childIds.map((childId) => {
      const childNode = nextNodes[childId];
      if (!childNode) {
        return undefined;
      }
      return {
        id: childNode.id,
        statement: childNode.statement,
        complexity: childNode.complexityScore,
        prerequisiteIds: childNode.kind === "leaf" ? currentLeafById.get(childNode.id)?.dependencyIds : undefined,
      };
    });
    if (children.some((child) => child === undefined)) {
      return undefined;
    }
    const resolvedChildren = children as Array<{
      id: string;
      statement: string;
      complexity?: number;
      prerequisiteIds?: string[];
    }>;
    const preSummaryDecision = evaluatePreSummaryPolicy(resolvedChildren, request.config);
    if (!preSummaryDecision.ok) {
      return undefined;
    }

    const summaryResult = await generateParentSummary(request.provider, {
      children: resolvedChildren,
      config: request.config,
    });
    const postSummaryDecision = evaluatePostSummaryPolicy(resolvedChildren, summaryResult.summary, request.config);
    if (!postSummaryDecision.ok) {
      return undefined;
    }

    const nextPolicyDiagnostics: ParentPolicyDiagnostics = {
      depth: parentNode.depth,
      groupIndex: parentNode.policyDiagnostics?.groupIndex ?? 0,
      retriesUsed: 0,
      preSummary: preSummaryDecision,
      postSummary: postSummaryDecision,
    };
    policyDiagnosticsByParent[parentId] = nextPolicyDiagnostics;
    nextNodes[parentId] = {
      ...parentNode,
      statement: summaryResult.summary.parent_statement,
      complexityScore: summaryResult.summary.complexity_score,
      abstractionScore: summaryResult.summary.abstraction_score,
      confidence: summaryResult.summary.confidence,
      whyTrueFromChildren: summaryResult.summary.why_true_from_children,
      newTermsIntroduced: summaryResult.summary.new_terms_introduced,
      evidenceRefs: summaryResult.summary.evidence_refs,
      policyDiagnostics: nextPolicyDiagnostics,
    };
  }

  const recoveredTree: ExplanationTree = {
    rootId: request.cachedTree.rootId,
    leafIds: request.cachedTree.leafIds.slice(),
    nodes: nextNodes,
    configHash: computeConfigHash(request.config),
    groupPlan: request.cachedTree.groupPlan.map((entry) => ({
      depth: entry.depth,
      index: entry.index,
      inputNodeIds: entry.inputNodeIds.slice(),
      outputNodeId: entry.outputNodeId,
      complexitySpread: entry.complexitySpread,
    })),
    groupingDiagnostics: request.cachedTree.groupingDiagnostics.map((entry) => ({
      depth: entry.depth,
      orderedNodeIds: entry.orderedNodeIds.slice(),
      complexitySpreadByGroup: entry.complexitySpreadByGroup.slice(),
      warnings: entry.warnings.map((warning) => ({ ...warning })),
      repartitionEvents: entry.repartitionEvents?.map((event) => ({
        depth: event.depth,
        groupIndex: event.groupIndex,
        round: event.round,
        reason: event.reason,
        inputNodeIds: event.inputNodeIds.slice(),
        outputGroups: event.outputGroups.map((group) => group.slice()),
        violationCodes: event.violationCodes.slice(),
      })),
    })),
    policyDiagnosticsByParent,
    maxDepth: request.cachedTree.maxDepth,
  };

  const validation = validateExplanationTree(recoveredTree, request.config.maxChildrenPerParent);
  if (!validation.ok) {
    return undefined;
  }

  const recoveredSnapshot = exportTreeStorageSnapshot(recoveredTree, {
    proofId: request.proofId,
    leaves: request.currentLeaves,
    config: request.config,
  });
  const recoveredSnapshotHash = computeTreeStorageSnapshotHash(recoveredSnapshot);
  const cacheEntry: ProofDatasetCacheEntry = {
    schemaVersion: PROOF_DATASET_CACHE_SCHEMA_VERSION,
    proofId: request.proofId,
    configHash: request.configHash,
    sourceFingerprint: request.sourceFingerprint,
    ingestionHash: request.ingestionHash,
    dependencyGraphHash: request.dependencyGraphHash,
    snapshotHash: recoveredSnapshotHash,
    snapshot: recoveredSnapshot,
  };

  return {
    tree: recoveredTree,
    cacheEntry,
    recomputedLeafIds: recomputeLeafIds.slice().sort((left, right) => left.localeCompare(right)),
    recomputedParentIds: recomputeParentIds.slice(),
    recomputeHash: computeCanonicalRequestHash({
      planHash: request.blockedSubtreePlan.planHash,
      recomputedLeafIds: recomputeLeafIds.slice().sort((left, right) => left.localeCompare(right)),
      recomputedParentIds: recomputeParentIds,
      dependencyGraphHash: request.dependencyGraphHash,
    }),
  };
}

async function attemptTopologyRemovalRecovery(
  request: TopologyRemovalRecoveryRequest,
): Promise<TopologyRemovalRecoveryResult | undefined> {
  if (!request.blockedSubtreePlan.topologyShapeChanged) {
    return undefined;
  }
  if (request.blockedSubtreePlan.addedDeclarationIds.length > 0 || request.blockedSubtreePlan.removedDeclarationIds.length === 0) {
    return undefined;
  }
  const removedDeclarationSet = new Set(request.blockedSubtreePlan.removedDeclarationIds);
  if (request.blockedSubtreePlan.changedDeclarationIds.some((declarationId) => !removedDeclarationSet.has(declarationId))) {
    return undefined;
  }

  const cachedLeafByDeclarationId = new Map(request.cachedLeaves.map((leaf) => [leaf.declarationId, leaf]));
  const currentLeafById = new Map(request.currentLeaves.map((leaf) => [leaf.id, leaf]));

  const removedLeafIds = request.blockedSubtreePlan.removedDeclarationIds
    .map((declarationId) => cachedLeafByDeclarationId.get(declarationId)?.id)
    .filter((leafId): leafId is string => typeof leafId === "string")
    .sort((left, right) => left.localeCompare(right));
  if (removedLeafIds.length !== request.blockedSubtreePlan.removedDeclarationIds.length) {
    return undefined;
  }

  const expectedLeafIds = [...currentLeafById.keys()].sort((left, right) => left.localeCompare(right));
  const cachedLeafIdsWithoutRemoved = request.cachedTree.leafIds
    .filter((leafId) => !removedLeafIds.includes(leafId))
    .sort((left, right) => left.localeCompare(right));
  if (cachedLeafIdsWithoutRemoved.length !== expectedLeafIds.length) {
    return undefined;
  }
  for (let index = 0; index < expectedLeafIds.length; index += 1) {
    if (expectedLeafIds[index] !== cachedLeafIdsWithoutRemoved[index]) {
      return undefined;
    }
  }

  const nextNodes: Record<string, ExplanationTreeNode> = {};
  for (const [nodeId, node] of Object.entries(request.cachedTree.nodes)) {
    nextNodes[nodeId] = {
      ...node,
      childIds: node.childIds.slice(),
      evidenceRefs: node.evidenceRefs.slice(),
      newTermsIntroduced: node.newTermsIntroduced ? node.newTermsIntroduced.slice() : undefined,
      policyDiagnostics: node.policyDiagnostics
        ? {
            depth: node.policyDiagnostics.depth,
            groupIndex: node.policyDiagnostics.groupIndex,
            retriesUsed: node.policyDiagnostics.retriesUsed,
            preSummary: {
              ok: node.policyDiagnostics.preSummary.ok,
              violations: node.policyDiagnostics.preSummary.violations.map((violation) => ({ ...violation })),
              metrics: { ...node.policyDiagnostics.preSummary.metrics },
            },
            postSummary: {
              ok: node.policyDiagnostics.postSummary.ok,
              violations: node.policyDiagnostics.postSummary.violations.map((violation) => ({ ...violation })),
              metrics: { ...node.policyDiagnostics.postSummary.metrics },
            },
          }
        : undefined,
    };
  }
  for (const leafId of removedLeafIds) {
    delete nextNodes[leafId];
  }
  for (const leaf of request.currentLeaves) {
    const node = nextNodes[leaf.id];
    if (!node || node.kind !== "leaf") {
      return undefined;
    }
    nextNodes[leaf.id] = {
      ...node,
      statement: renderLocalizedTreeLeafStatement(leaf, request.config.language),
      evidenceRefs: [leaf.id],
    };
  }

  const policyDiagnosticsByParent: Record<string, ParentPolicyDiagnostics> = {};
  for (const [parentId, diagnostics] of Object.entries(request.cachedTree.policyDiagnosticsByParent)) {
    policyDiagnosticsByParent[parentId] = {
      depth: diagnostics.depth,
      groupIndex: diagnostics.groupIndex,
      retriesUsed: diagnostics.retriesUsed,
      preSummary: {
        ok: diagnostics.preSummary.ok,
        violations: diagnostics.preSummary.violations.map((violation) => ({ ...violation })),
        metrics: { ...diagnostics.preSummary.metrics },
      },
      postSummary: {
        ok: diagnostics.postSummary.ok,
        violations: diagnostics.postSummary.violations.map((violation) => ({ ...violation })),
        metrics: { ...diagnostics.postSummary.metrics },
      },
    };
  }

  let rootId = request.cachedTree.rootId;
  const touchedParentIds = new Set<string>();
  const recomputedParentIds = new Set<string>();
  const collapsedParentIds = new Set<string>();
  const droppedParentIds = new Set<string>();
  const pendingParentIds = new Set<string>();
  const initialParents = buildParentsByChildId(request.cachedTree.nodes);
  for (const removedLeafId of removedLeafIds) {
    for (const parentId of initialParents.get(removedLeafId) ?? []) {
      pendingParentIds.add(parentId);
    }
  }

  while (pendingParentIds.size > 0) {
    const parentId = [...pendingParentIds].sort((left, right) => {
      const depthDelta = (nextNodes[left]?.depth ?? 0) - (nextNodes[right]?.depth ?? 0);
      if (depthDelta !== 0) {
        return depthDelta;
      }
      return left.localeCompare(right);
    })[0];
    pendingParentIds.delete(parentId);
    touchedParentIds.add(parentId);
    const parentNode = nextNodes[parentId];
    if (!parentNode || parentNode.kind !== "parent") {
      continue;
    }

    const parentsByChildId = buildParentsByChildId(nextNodes);
    const parentParents = parentsByChildId.get(parentId) ?? [];
    const filteredChildIds = dedupeOrdered(parentNode.childIds.filter((childId) => childId in nextNodes));
    if (filteredChildIds.length === 0) {
      delete nextNodes[parentId];
      delete policyDiagnosticsByParent[parentId];
      droppedParentIds.add(parentId);
      if (rootId === parentId) {
        return undefined;
      }
      for (const grandParentId of parentParents) {
        pendingParentIds.add(grandParentId);
      }
      continue;
    }

    if (filteredChildIds.length === 1) {
      const passthroughChildId = filteredChildIds[0];
      for (const grandParentId of parentParents) {
        const grandParentNode = nextNodes[grandParentId];
        if (!grandParentNode || grandParentNode.kind !== "parent") {
          continue;
        }
        grandParentNode.childIds = dedupeOrdered(
          grandParentNode.childIds.flatMap((childId) => (childId === parentId ? [passthroughChildId] : [childId])),
        );
        pendingParentIds.add(grandParentId);
      }
      if (rootId === parentId) {
        rootId = passthroughChildId;
      }
      delete nextNodes[parentId];
      delete policyDiagnosticsByParent[parentId];
      collapsedParentIds.add(parentId);
      continue;
    }

    const children = filteredChildIds.map((childId) => {
      const childNode = nextNodes[childId];
      if (!childNode) {
        return undefined;
      }
      return {
        id: childNode.id,
        statement: childNode.statement,
        complexity: childNode.complexityScore,
        prerequisiteIds: childNode.kind === "leaf" ? currentLeafById.get(childNode.id)?.dependencyIds : undefined,
      };
    });
    if (children.some((child) => child === undefined)) {
      return undefined;
    }
    const resolvedChildren = children as Array<{
      id: string;
      statement: string;
      complexity?: number;
      prerequisiteIds?: string[];
    }>;
    const preSummaryDecision = evaluatePreSummaryPolicy(resolvedChildren, request.config);
    if (!preSummaryDecision.ok) {
      return undefined;
    }
    const summaryResult = await generateParentSummary(request.provider, {
      children: resolvedChildren,
      config: request.config,
    });
    const postSummaryDecision = evaluatePostSummaryPolicy(resolvedChildren, summaryResult.summary, request.config);
    if (!postSummaryDecision.ok) {
      return undefined;
    }

    const nextPolicyDiagnostics: ParentPolicyDiagnostics = {
      depth: parentNode.depth,
      groupIndex: parentNode.policyDiagnostics?.groupIndex ?? 0,
      retriesUsed: 0,
      preSummary: preSummaryDecision,
      postSummary: postSummaryDecision,
    };
    policyDiagnosticsByParent[parentId] = nextPolicyDiagnostics;
    nextNodes[parentId] = {
      ...parentNode,
      childIds: filteredChildIds,
      statement: summaryResult.summary.parent_statement,
      complexityScore: summaryResult.summary.complexity_score,
      abstractionScore: summaryResult.summary.abstraction_score,
      confidence: summaryResult.summary.confidence,
      whyTrueFromChildren: summaryResult.summary.why_true_from_children,
      newTermsIntroduced: summaryResult.summary.new_terms_introduced,
      evidenceRefs: summaryResult.summary.evidence_refs,
      policyDiagnostics: nextPolicyDiagnostics,
    };
    recomputedParentIds.add(parentId);
    for (const grandParentId of parentParents) {
      pendingParentIds.add(grandParentId);
    }
  }

  if (!(rootId in nextNodes)) {
    return undefined;
  }

  const reachableNodeIds = collectReachableNodeIds(rootId, nextNodes);
  for (const nodeId of Object.keys(nextNodes)) {
    if (!reachableNodeIds.has(nodeId)) {
      delete nextNodes[nodeId];
      if (nodeId in policyDiagnosticsByParent) {
        delete policyDiagnosticsByParent[nodeId];
      }
      droppedParentIds.add(nodeId);
    }
  }

  recomputeNodeDepths(rootId, nextNodes);

  const recoveredTree: ExplanationTree = {
    rootId,
    leafIds: expectedLeafIds,
    nodes: nextNodes,
    configHash: computeConfigHash(request.config),
    groupPlan: request.cachedTree.groupPlan
      .filter(
        (entry) =>
          entry.outputNodeId in nextNodes &&
          entry.inputNodeIds.every((nodeId) => nodeId in nextNodes) &&
          nextNodes[entry.outputNodeId]?.kind === "parent",
      )
      .map((entry) => ({
        depth: entry.depth,
        index: entry.index,
        inputNodeIds: entry.inputNodeIds.slice(),
        outputNodeId: entry.outputNodeId,
        complexitySpread: entry.complexitySpread,
      })),
    groupingDiagnostics: request.cachedTree.groupingDiagnostics
      .map((entry) => ({
        depth: entry.depth,
        orderedNodeIds: entry.orderedNodeIds.filter((nodeId) => nodeId in nextNodes),
        complexitySpreadByGroup: entry.complexitySpreadByGroup.slice(),
        warnings: entry.warnings.map((warning) => ({ ...warning })),
        repartitionEvents: entry.repartitionEvents
          ?.map((event) => ({
            depth: event.depth,
            groupIndex: event.groupIndex,
            round: event.round,
            reason: event.reason,
            inputNodeIds: event.inputNodeIds.slice(),
            outputGroups: event.outputGroups.map((group) => group.slice()),
            violationCodes: event.violationCodes.slice(),
          }))
          .filter(
            (event) =>
              event.inputNodeIds.every((nodeId) => nodeId in nextNodes) &&
              event.outputGroups.flat().every((nodeId) => nodeId in nextNodes),
          ),
      }))
      .filter((entry) => entry.orderedNodeIds.length > 0),
    policyDiagnosticsByParent,
    maxDepth: Math.max(0, ...Object.values(nextNodes).map((node) => node.depth)),
  };

  const validation = validateExplanationTree(recoveredTree, request.config.maxChildrenPerParent);
  if (!validation.ok) {
    return undefined;
  }

  const recoveredSnapshot = exportTreeStorageSnapshot(recoveredTree, {
    proofId: request.proofId,
    leaves: request.currentLeaves,
    config: request.config,
  });
  const recoveredSnapshotHash = computeTreeStorageSnapshotHash(recoveredSnapshot);
  const cacheEntry: ProofDatasetCacheEntry = {
    schemaVersion: PROOF_DATASET_CACHE_SCHEMA_VERSION,
    proofId: request.proofId,
    configHash: request.configHash,
    sourceFingerprint: request.sourceFingerprint,
    ingestionHash: request.ingestionHash,
    dependencyGraphHash: request.dependencyGraphHash,
    snapshotHash: recoveredSnapshotHash,
    snapshot: recoveredSnapshot,
  };

  return {
    tree: recoveredTree,
    cacheEntry,
    removedLeafIds,
    touchedParentCount: touchedParentIds.size,
    recomputedParentIds: [...recomputedParentIds].sort((left, right) => left.localeCompare(right)),
    collapsedParentIds: [...collapsedParentIds].sort((left, right) => left.localeCompare(right)),
    droppedParentIds: [...droppedParentIds].sort((left, right) => left.localeCompare(right)),
    recoveryHash: computeCanonicalRequestHash({
      planHash: request.blockedSubtreePlan.planHash,
      removedLeafIds,
      touchedParentIds: [...touchedParentIds].sort((left, right) => left.localeCompare(right)),
      recomputedParentIds: [...recomputedParentIds].sort((left, right) => left.localeCompare(right)),
      collapsedParentIds: [...collapsedParentIds].sort((left, right) => left.localeCompare(right)),
      droppedParentIds: [...droppedParentIds].sort((left, right) => left.localeCompare(right)),
      dependencyGraphHash: request.dependencyGraphHash,
    }),
  };
}

async function attemptTopologyMixedRecovery(
  request: TopologyMixedRecoveryRequest,
): Promise<TopologyMixedRecoveryResult | undefined> {
  if (!request.blockedSubtreePlan.topologyShapeChanged) {
    return undefined;
  }
  if (request.blockedSubtreePlan.addedDeclarationIds.length === 0 || request.blockedSubtreePlan.removedDeclarationIds.length === 0) {
    return undefined;
  }

  const addedDeclarationSet = new Set(request.blockedSubtreePlan.addedDeclarationIds);
  const currentLeavesWithoutAdded = request.currentLeaves.filter((leaf) => !addedDeclarationSet.has(leaf.declarationId));
  if (currentLeavesWithoutAdded.length === request.currentLeaves.length) {
    return undefined;
  }
  const currentLeafByDeclarationId = new Map(currentLeavesWithoutAdded.map((leaf) => [leaf.declarationId, leaf]));

  const removalSubplanWithoutHash: Omit<ProofDatasetBlockedSubtreePlan, "planHash"> = {
    schemaVersion: "1.0.0",
    reason: "source_fingerprint_mismatch",
    changedDeclarationIds: request.blockedSubtreePlan.removedDeclarationIds.slice(),
    addedDeclarationIds: [],
    removedDeclarationIds: request.blockedSubtreePlan.removedDeclarationIds.slice(),
    topologyShapeChanged: request.blockedSubtreePlan.removedDeclarationIds.length > 0,
    blockedDeclarationIds: request.blockedSubtreePlan.blockedDeclarationIds.filter(
      (declarationId) => !addedDeclarationSet.has(declarationId),
    ),
    blockedLeafIds: request.blockedSubtreePlan.blockedDeclarationIds
      .filter((declarationId) => !addedDeclarationSet.has(declarationId))
      .map((declarationId) => currentLeafByDeclarationId.get(declarationId)?.id)
      .filter((leafId): leafId is string => typeof leafId === "string")
      .sort((left, right) => left.localeCompare(right)),
    unaffectedLeafIds: currentLeavesWithoutAdded
      .filter((leaf) => !request.blockedSubtreePlan.removedDeclarationIds.includes(leaf.declarationId))
      .map((leaf) => leaf.id)
      .sort((left, right) => left.localeCompare(right)),
    executionBatches: [],
    cyclicBatchCount: 0,
    fullRebuildRequired: true,
  };
  const removalSubplan: ProofDatasetBlockedSubtreePlan = {
    ...removalSubplanWithoutHash,
    planHash: computeCanonicalRequestHash(removalSubplanWithoutHash),
  };

  const removalRecovery = await attemptTopologyRemovalRecovery({
    proofId: request.proofId,
    config: request.config,
    configHash: request.configHash,
    sourceFingerprint: request.sourceFingerprint,
    ingestionHash: request.ingestionHash,
    dependencyGraphHash: request.dependencyGraphHash,
    blockedSubtreePlan: removalSubplan,
    cachedTree: request.cachedTree,
    cachedLeaves: request.cachedLeaves,
    currentLeaves: currentLeavesWithoutAdded,
    provider: request.provider,
  });
  if (!removalRecovery) {
    return undefined;
  }

  const regenerationRecovery = await attemptTopologyRegenerationRecovery({
    proofId: request.proofId,
    config: request.config,
    configHash: request.configHash,
    sourceFingerprint: request.sourceFingerprint,
    ingestionHash: request.ingestionHash,
    dependencyGraphHash: request.dependencyGraphHash,
    cachedTree: removalRecovery.tree,
    currentLeaves: request.currentLeaves,
  });
  if (!regenerationRecovery) {
    return undefined;
  }

  return {
    tree: regenerationRecovery.tree,
    cacheEntry: regenerationRecovery.cacheEntry,
    removedLeafIds: removalRecovery.removedLeafIds,
    touchedParentCount: removalRecovery.touchedParentCount,
    recomputedParentIds: removalRecovery.recomputedParentIds,
    collapsedParentIds: removalRecovery.collapsedParentIds,
    droppedParentIds: removalRecovery.droppedParentIds,
    reusableParentSummaryCount: regenerationRecovery.reusableParentSummaryCount,
    reusedParentSummaryCount: regenerationRecovery.reusedParentSummaryCount,
    reusedParentSummaryByGroundingCount: regenerationRecovery.reusedParentSummaryByGroundingCount,
    reusedParentSummaryByStatementSignatureCount: regenerationRecovery.reusedParentSummaryByStatementSignatureCount,
    generatedParentSummaryCount: regenerationRecovery.generatedParentSummaryCount,
    skippedAmbiguousStatementSignatureReuseCount: regenerationRecovery.skippedAmbiguousStatementSignatureReuseCount,
    skippedUnrebasableStatementSignatureReuseCount: regenerationRecovery.skippedUnrebasableStatementSignatureReuseCount,
    removalRecoveryHash: removalRecovery.recoveryHash,
    regenerationHash: regenerationRecovery.regenerationHash,
    mixedRecoveryHash: computeCanonicalRequestHash({
      removalPlanHash: removalSubplan.planHash,
      removalRecoveryHash: removalRecovery.recoveryHash,
      regenerationHash: regenerationRecovery.regenerationHash,
      dependencyGraphHash: request.dependencyGraphHash,
      configHash: request.configHash,
    }),
  };
}

async function attemptTopologyAdditionRecovery(
  request: TopologyAdditionRecoveryRequest,
): Promise<TopologyAdditionRecoveryResult | undefined> {
  if (!request.blockedSubtreePlan.topologyShapeChanged) {
    return undefined;
  }
  if (request.blockedSubtreePlan.addedDeclarationIds.length === 0 || request.blockedSubtreePlan.removedDeclarationIds.length > 0) {
    return undefined;
  }
  const addedDeclarationSet = new Set(request.blockedSubtreePlan.addedDeclarationIds);
  if (request.blockedSubtreePlan.changedDeclarationIds.some((declarationId) => !addedDeclarationSet.has(declarationId))) {
    return undefined;
  }

  const addedLeafIds = request.currentLeaves
    .filter((leaf) => addedDeclarationSet.has(leaf.declarationId))
    .map((leaf) => leaf.id)
    .sort((left, right) => left.localeCompare(right));
  if (addedLeafIds.length !== request.blockedSubtreePlan.addedDeclarationIds.length) {
    return undefined;
  }

  const insertionRecovery = await attemptTopologyAdditionSubtreeInsertionRecovery({
    ...request,
    addedLeafIds,
    addedDeclarationSet,
  });
  if (insertionRecovery) {
    return insertionRecovery;
  }

  const regenerationRecovery = await attemptTopologyRegenerationRecovery({
    proofId: request.proofId,
    config: request.config,
    configHash: request.configHash,
    sourceFingerprint: request.sourceFingerprint,
    ingestionHash: request.ingestionHash,
    dependencyGraphHash: request.dependencyGraphHash,
    cachedTree: request.cachedTree,
    currentLeaves: request.currentLeaves,
  });
  if (!regenerationRecovery) {
    return undefined;
  }

  return {
    tree: regenerationRecovery.tree,
    cacheEntry: regenerationRecovery.cacheEntry,
    recoveryMode: "regeneration",
    addedLeafIds,
    insertionFrontierCount: 0,
    insertionAnchorCount: 0,
    insertionMergeParentCount: 0,
    insertedParentCount: 0,
    insertionScheduledAttachmentCount: 0,
    insertionRecomputedAncestorCount: 0,
    insertionStrategy: "regeneration",
    reusableParentSummaryCount: regenerationRecovery.reusableParentSummaryCount,
    reusedParentSummaryCount: regenerationRecovery.reusedParentSummaryCount,
    reusedParentSummaryByGroundingCount: regenerationRecovery.reusedParentSummaryByGroundingCount,
    reusedParentSummaryByStatementSignatureCount: regenerationRecovery.reusedParentSummaryByStatementSignatureCount,
    generatedParentSummaryCount: regenerationRecovery.generatedParentSummaryCount,
    skippedAmbiguousStatementSignatureReuseCount: regenerationRecovery.skippedAmbiguousStatementSignatureReuseCount,
    skippedUnrebasableStatementSignatureReuseCount: regenerationRecovery.skippedUnrebasableStatementSignatureReuseCount,
    regenerationHash: regenerationRecovery.regenerationHash,
    additionRecoveryHash: computeCanonicalRequestHash({
      planHash: request.blockedSubtreePlan.planHash,
      addedLeafIds,
      regenerationHash: regenerationRecovery.regenerationHash,
      dependencyGraphHash: request.dependencyGraphHash,
      configHash: request.configHash,
    }),
  };
}

async function attemptTopologyAdditionSubtreeInsertionRecovery(
  request: TopologyAdditionRecoveryRequest & {
    addedLeafIds: string[];
    addedDeclarationSet: Set<string>;
  },
): Promise<TopologyAdditionRecoveryResult | undefined> {
  const addedLeaves = request.currentLeaves.filter((leaf) => request.addedDeclarationSet.has(leaf.declarationId));
  if (addedLeaves.length !== request.addedLeafIds.length) {
    return undefined;
  }
  const unchangedLeaves = request.currentLeaves.filter((leaf) => !request.addedDeclarationSet.has(leaf.declarationId));
  const unchangedLeafIds = unchangedLeaves.map((leaf) => leaf.id).sort((left, right) => left.localeCompare(right));
  const cachedLeafIds = request.cachedTree.leafIds.slice().sort((left, right) => left.localeCompare(right));
  if (unchangedLeafIds.length !== cachedLeafIds.length) {
    return undefined;
  }
  for (let index = 0; index < unchangedLeafIds.length; index += 1) {
    if (unchangedLeafIds[index] !== cachedLeafIds[index]) {
      return undefined;
    }
  }

  const unchangedLeafIdSet = new Set(unchangedLeafIds);
  const addedLeafById = new Map(addedLeaves.map((leaf) => [leaf.id, leaf]));
  const addedLeafIds = addedLeaves.map((leaf) => leaf.id).sort((left, right) => left.localeCompare(right));
  const addedAdjacency = new Map<string, Set<string>>();
  for (const leafId of addedLeafIds) {
    addedAdjacency.set(leafId, new Set());
  }
  for (const leaf of addedLeaves) {
    const neighbors = addedAdjacency.get(leaf.id);
    if (!neighbors) {
      return undefined;
    }
    for (const dependencyId of leaf.dependencyIds) {
      if (!addedLeafById.has(dependencyId)) {
        continue;
      }
      neighbors.add(dependencyId);
      addedAdjacency.get(dependencyId)?.add(leaf.id);
    }
  }
  const insertionFrontiers: Array<{ frontierKey: string; frontierLeafIds: string[]; leaves: TheoremLeafRecord[] }> = [];
  const visitedAddedLeafIds = new Set<string>();
  for (const leafId of addedLeafIds) {
    if (visitedAddedLeafIds.has(leafId)) {
      continue;
    }
    const componentLeafIds: string[] = [];
    const queue: string[] = [leafId];
    while (queue.length > 0) {
      const currentLeafId = queue.shift() as string;
      if (visitedAddedLeafIds.has(currentLeafId)) {
        continue;
      }
      visitedAddedLeafIds.add(currentLeafId);
      componentLeafIds.push(currentLeafId);
      const neighbors = [...(addedAdjacency.get(currentLeafId) ?? [])].sort((left, right) => left.localeCompare(right));
      for (const neighbor of neighbors) {
        if (!visitedAddedLeafIds.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    componentLeafIds.sort((left, right) => left.localeCompare(right));
    const componentLeaves = componentLeafIds
      .map((componentLeafId) => addedLeafById.get(componentLeafId))
      .filter((leaf): leaf is TheoremLeafRecord => Boolean(leaf));
    if (componentLeaves.length !== componentLeafIds.length) {
      return undefined;
    }
    const frontierLeafIds = dedupeOrdered(
      componentLeaves
        .flatMap((leaf) => leaf.dependencyIds)
        .filter((dependencyId) => unchangedLeafIdSet.has(dependencyId))
        .sort((left, right) => left.localeCompare(right)),
    );
    const frontierKey =
      frontierLeafIds.length > 0
        ? `deps:${frontierLeafIds.join("|")}::component:${componentLeafIds.join("|")}`
        : `component:${componentLeafIds.join("|")}`;
    insertionFrontiers.push({
      frontierKey,
      frontierLeafIds,
      leaves: componentLeaves,
    });
  }
  insertionFrontiers.sort((left, right) => left.frontierKey.localeCompare(right.frontierKey));
  if (insertionFrontiers.length === 0) {
    return undefined;
  }

  const currentLeafById = new Map(request.currentLeaves.map((leaf) => [leaf.id, leaf]));
  const mergedNodes: Record<string, ExplanationTreeNode> = {};
  for (const [nodeId, node] of Object.entries(request.cachedTree.nodes)) {
    mergedNodes[nodeId] = {
      ...node,
      childIds: node.childIds.slice(),
      evidenceRefs: node.evidenceRefs.slice(),
      newTermsIntroduced: node.newTermsIntroduced ? node.newTermsIntroduced.slice() : undefined,
      policyDiagnostics: node.policyDiagnostics
        ? {
            depth: node.policyDiagnostics.depth,
            groupIndex: node.policyDiagnostics.groupIndex,
            retriesUsed: node.policyDiagnostics.retriesUsed,
            preSummary: {
              ok: node.policyDiagnostics.preSummary.ok,
              violations: node.policyDiagnostics.preSummary.violations.map((violation) => ({ ...violation })),
              metrics: { ...node.policyDiagnostics.preSummary.metrics },
            },
            postSummary: {
              ok: node.policyDiagnostics.postSummary.ok,
              violations: node.policyDiagnostics.postSummary.violations.map((violation) => ({ ...violation })),
              metrics: { ...node.policyDiagnostics.postSummary.metrics },
            },
          }
        : undefined,
    };
  }

  const policyDiagnosticsByParent: Record<string, ParentPolicyDiagnostics> = {};
  for (const [parentId, diagnostics] of Object.entries(request.cachedTree.policyDiagnosticsByParent)) {
    policyDiagnosticsByParent[parentId] = {
      depth: diagnostics.depth,
      groupIndex: diagnostics.groupIndex,
      retriesUsed: diagnostics.retriesUsed,
      preSummary: {
        ok: diagnostics.preSummary.ok,
        violations: diagnostics.preSummary.violations.map((violation) => ({ ...violation })),
        metrics: { ...diagnostics.preSummary.metrics },
      },
      postSummary: {
        ok: diagnostics.postSummary.ok,
        violations: diagnostics.postSummary.violations.map((violation) => ({ ...violation })),
        metrics: { ...diagnostics.postSummary.metrics },
      },
    };
  }

  const insertionProvider = createDeterministicSummaryProvider();
  const frontierSubtreeRootIds: string[] = [];
  const addedGroupPlanEntries: ExplanationTree["groupPlan"] = [];
  const addedGroupingDiagnosticEntries: ExplanationTree["groupingDiagnostics"] = [];
  let addedSubtreeParentCount = 0;
  for (const frontier of insertionFrontiers) {
    let addedSubtree: ExplanationTree;
    try {
      addedSubtree = await buildRecursiveExplanationTree(insertionProvider, {
        leaves: mapTheoremLeavesToLocalizedTreeLeaves(frontier.leaves, request.config.language),
        config: request.config,
      });
    } catch {
      return undefined;
    }
    frontierSubtreeRootIds.push(addedSubtree.rootId);
    addedSubtreeParentCount += Object.values(addedSubtree.nodes).filter((node) => node.kind === "parent").length;

    for (const [nodeId, node] of Object.entries(addedSubtree.nodes)) {
      if (nodeId in mergedNodes) {
        return undefined;
      }
      mergedNodes[nodeId] = {
        ...node,
        childIds: node.childIds.slice(),
        evidenceRefs: node.evidenceRefs.slice(),
        newTermsIntroduced: node.newTermsIntroduced ? node.newTermsIntroduced.slice() : undefined,
        policyDiagnostics: node.policyDiagnostics
          ? {
              depth: node.policyDiagnostics.depth,
              groupIndex: node.policyDiagnostics.groupIndex,
              retriesUsed: node.policyDiagnostics.retriesUsed,
              preSummary: {
                ok: node.policyDiagnostics.preSummary.ok,
                violations: node.policyDiagnostics.preSummary.violations.map((violation) => ({ ...violation })),
                metrics: { ...node.policyDiagnostics.preSummary.metrics },
              },
              postSummary: {
                ok: node.policyDiagnostics.postSummary.ok,
                violations: node.policyDiagnostics.postSummary.violations.map((violation) => ({ ...violation })),
                metrics: { ...node.policyDiagnostics.postSummary.metrics },
              },
            }
          : undefined,
      };
      if (node.kind === "parent" && node.policyDiagnostics) {
        policyDiagnosticsByParent[node.id] = {
          depth: node.policyDiagnostics.depth,
          groupIndex: node.policyDiagnostics.groupIndex,
          retriesUsed: node.policyDiagnostics.retriesUsed,
          preSummary: {
            ok: node.policyDiagnostics.preSummary.ok,
            violations: node.policyDiagnostics.preSummary.violations.map((violation) => ({ ...violation })),
            metrics: { ...node.policyDiagnostics.preSummary.metrics },
          },
          postSummary: {
            ok: node.policyDiagnostics.postSummary.ok,
            violations: node.policyDiagnostics.postSummary.violations.map((violation) => ({ ...violation })),
            metrics: { ...node.policyDiagnostics.postSummary.metrics },
          },
        };
      }
    }
    addedGroupPlanEntries.push(
      ...addedSubtree.groupPlan
        .filter(
          (entry) =>
            entry.outputNodeId in addedSubtree.nodes &&
            entry.inputNodeIds.every((nodeId) => nodeId in addedSubtree.nodes) &&
            addedSubtree.nodes[entry.outputNodeId]?.kind === "parent",
        )
        .map((entry) => ({
          depth: entry.depth,
          index: entry.index,
          inputNodeIds: entry.inputNodeIds.slice(),
          outputNodeId: entry.outputNodeId,
          complexitySpread: entry.complexitySpread,
        })),
    );
    addedGroupingDiagnosticEntries.push(
      ...addedSubtree.groupingDiagnostics
        .map((entry) => ({
          depth: entry.depth,
          orderedNodeIds: entry.orderedNodeIds.slice(),
          complexitySpreadByGroup: entry.complexitySpreadByGroup.slice(),
          warnings: entry.warnings.map((warning) => ({ ...warning })),
          repartitionEvents: entry.repartitionEvents?.map((event) => ({
            depth: event.depth,
            groupIndex: event.groupIndex,
            round: event.round,
            reason: event.reason,
            inputNodeIds: event.inputNodeIds.slice(),
            outputGroups: event.outputGroups.map((group) => group.slice()),
            violationCodes: event.violationCodes.slice(),
          })),
        }))
        .filter((entry) => entry.orderedNodeIds.length > 0),
    );
  }

  for (const leaf of request.currentLeaves) {
    const existing = mergedNodes[leaf.id];
    if (!existing || existing.kind !== "leaf") {
      return undefined;
    }
    mergedNodes[leaf.id] = {
      ...existing,
      statement: renderLocalizedTreeLeafStatement(leaf, request.config.language),
      evidenceRefs: [leaf.id],
    };
  }

  let mergedRootId = request.cachedTree.rootId;
  const insertionParentIds: string[] = [];
  const insertionPlanEntries: Array<{ outputNodeId: string; index: number; inputNodeIds: string[]; complexitySpread: number }> =
    [];
  const insertionGroupingEntries: Array<{ outputNodeId: string; orderedNodeIds: string[]; complexitySpread: number }> = [];
  const pendingRecomputeParentIds = new Set<string>();
  const recomputedAncestorIds = new Set<string>();
  const parentsByChildIdBeforeInsertion = buildParentsByChildId(mergedNodes);
  const frontierAssignments = insertionFrontiers
    .map((frontier, frontierIndex) => {
      const frontierRootId = frontierSubtreeRootIds[frontierIndex];
      if (!frontierRootId || !(frontierRootId in mergedNodes)) {
        return undefined;
      }
      const anchorNodeId = resolveInsertionAnchorNodeId({
        rootId: request.cachedTree.rootId,
        frontierLeafIds: frontier.frontierLeafIds,
        parentsByChildId: parentsByChildIdBeforeInsertion,
      });
      if (!anchorNodeId || !(anchorNodeId in mergedNodes)) {
        return undefined;
      }
      return {
        frontierIndex,
        frontierKey: frontier.frontierKey,
        frontierRootId,
        anchorNodeId,
      };
    })
    .filter(
      (
        assignment,
      ): assignment is {
        frontierIndex: number;
        frontierKey: string;
        frontierRootId: string;
        anchorNodeId: string;
      } => Boolean(assignment),
    );
  if (frontierAssignments.length !== insertionFrontiers.length) {
    return undefined;
  }

  const anchorGroupsById = new Map<
    string,
    Array<{
      frontierIndex: number;
      frontierKey: string;
      frontierRootId: string;
    }>
  >();
  for (const assignment of frontierAssignments) {
    const group = anchorGroupsById.get(assignment.anchorNodeId) ?? [];
    group.push({
      frontierIndex: assignment.frontierIndex,
      frontierKey: assignment.frontierKey,
      frontierRootId: assignment.frontierRootId,
    });
    anchorGroupsById.set(assignment.anchorNodeId, group);
  }

  const sortedAnchorNodeIds = [...anchorGroupsById.keys()].sort((left, right) => left.localeCompare(right));
  const insertionAnchorCount = sortedAnchorNodeIds.length;
  let insertionScheduledAttachmentCount = 0;
  let insertionMergeParentCount = 0;

  const createInsertionParentNode = async (requestInput: {
    childIds: string[];
    groupIndex: number;
    seed: Record<string, unknown>;
  }): Promise<{ parentId: string; complexitySpread: number } | undefined> => {
    const insertionChildren = requestInput.childIds.map((childId) => {
      const childNode = mergedNodes[childId];
      if (!childNode) {
        return undefined;
      }
      return {
        id: childNode.id,
        statement: childNode.statement,
        complexity: childNode.complexityScore,
        prerequisiteIds: childNode.kind === "leaf" ? currentLeafById.get(childNode.id)?.dependencyIds : undefined,
      };
    });
    if (insertionChildren.some((child) => child === undefined)) {
      return undefined;
    }
    const resolvedInsertionChildren = insertionChildren as Array<{
      id: string;
      statement: string;
      complexity?: number;
      prerequisiteIds?: string[];
    }>;
    const preSummaryDecision = evaluatePreSummaryPolicy(resolvedInsertionChildren, request.config);
    if (!preSummaryDecision.ok) {
      return undefined;
    }
    const insertionSummary = await generateParentSummary(insertionProvider, {
      children: resolvedInsertionChildren,
      config: request.config,
    });
    const postSummaryDecision = evaluatePostSummaryPolicy(
      resolvedInsertionChildren,
      insertionSummary.summary,
      request.config,
    );
    if (!postSummaryDecision.ok) {
      return undefined;
    }
    const insertionParentId = `p_addition_${computeCanonicalRequestHash({
      planHash: request.blockedSubtreePlan.planHash,
      ...requestInput.seed,
      childIds: requestInput.childIds.slice(),
    }).slice(0, 16)}`;
    if (insertionParentId in mergedNodes) {
      return undefined;
    }
    const insertionPolicyDiagnostics: ParentPolicyDiagnostics = {
      depth: 0,
      groupIndex: requestInput.groupIndex,
      retriesUsed: 0,
      preSummary: preSummaryDecision,
      postSummary: postSummaryDecision,
    };
    mergedNodes[insertionParentId] = {
      id: insertionParentId,
      kind: "parent",
      statement: insertionSummary.summary.parent_statement,
      childIds: requestInput.childIds.slice(),
      depth: 0,
      complexityScore: insertionSummary.summary.complexity_score,
      abstractionScore: insertionSummary.summary.abstraction_score,
      confidence: insertionSummary.summary.confidence,
      whyTrueFromChildren: insertionSummary.summary.why_true_from_children,
      newTermsIntroduced: insertionSummary.summary.new_terms_introduced,
      evidenceRefs: insertionSummary.summary.evidence_refs,
      policyDiagnostics: insertionPolicyDiagnostics,
    };
    policyDiagnosticsByParent[insertionParentId] = insertionPolicyDiagnostics;
    insertionParentIds.push(insertionParentId);
    insertionPlanEntries.push({
      outputNodeId: insertionParentId,
      index: insertionPlanEntries.length,
      inputNodeIds: requestInput.childIds.slice(),
      complexitySpread: preSummaryDecision.metrics.complexitySpread,
    });
    insertionGroupingEntries.push({
      outputNodeId: insertionParentId,
      orderedNodeIds: requestInput.childIds.slice(),
      complexitySpread: preSummaryDecision.metrics.complexitySpread,
    });
    return {
      parentId: insertionParentId,
      complexitySpread: preSummaryDecision.metrics.complexitySpread,
    };
  };

  const composeFrontierRootsByAnchor = async (requestInput: {
    anchorNodeId: string;
    anchorGroupIndex: number;
    frontierRootIds: string[];
    frontierKeys: string[];
  }): Promise<string | undefined> => {
    let levelNodeIds = requestInput.frontierRootIds.slice();
    let level = 0;
    while (levelNodeIds.length > 1) {
      const nextLevelNodeIds: string[] = [];
      for (let index = 0; index < levelNodeIds.length; index += request.config.maxChildrenPerParent) {
        const chunkNodeIds = levelNodeIds.slice(index, index + request.config.maxChildrenPerParent);
        if (chunkNodeIds.length === 1) {
          nextLevelNodeIds.push(chunkNodeIds[0] as string);
          continue;
        }
        const mergedParent = await createInsertionParentNode({
          childIds: chunkNodeIds,
          groupIndex: requestInput.anchorGroupIndex,
          seed: {
            mode: "frontier_merge",
            anchorNodeId: requestInput.anchorNodeId,
            anchorGroupIndex: requestInput.anchorGroupIndex,
            frontierKeys: requestInput.frontierKeys.slice(),
            mergeLevel: level,
            mergeChunkIndex: index / request.config.maxChildrenPerParent,
          },
        });
        if (!mergedParent) {
          return undefined;
        }
        insertionMergeParentCount += 1;
        nextLevelNodeIds.push(mergedParent.parentId);
      }
      levelNodeIds = nextLevelNodeIds;
      level += 1;
    }
    return levelNodeIds[0];
  };

  for (let anchorGroupIndex = 0; anchorGroupIndex < sortedAnchorNodeIds.length; anchorGroupIndex += 1) {
    const anchorNodeId = sortedAnchorNodeIds[anchorGroupIndex] as string;
    const anchorGroup = (anchorGroupsById.get(anchorNodeId) ?? [])
      .slice()
      .sort((left, right) => {
        const keyComparison = left.frontierKey.localeCompare(right.frontierKey);
        if (keyComparison !== 0) {
          return keyComparison;
        }
        return left.frontierIndex - right.frontierIndex;
      });
    if (anchorGroup.length === 0) {
      continue;
    }

    const frontierRootIds = anchorGroup.map((entry) => entry.frontierRootId);
    const frontierKeys = anchorGroup.map((entry) => entry.frontierKey);
    const frontierCompositeRootId = await composeFrontierRootsByAnchor({
      anchorNodeId,
      anchorGroupIndex,
      frontierRootIds,
      frontierKeys,
    });
    if (!frontierCompositeRootId || !(frontierCompositeRootId in mergedNodes)) {
      return undefined;
    }

    const connectorChildIds = dedupeOrdered([anchorNodeId, frontierCompositeRootId]);
    if (connectorChildIds.length < 2) {
      return undefined;
    }
    const connectorParent = await createInsertionParentNode({
      childIds: connectorChildIds,
      groupIndex: anchorGroupIndex,
      seed: {
        mode: "anchor_attachment",
        anchorNodeId,
        anchorGroupIndex,
        frontierKeys: frontierKeys.slice(),
      },
    });
    if (!connectorParent) {
      return undefined;
    }
    insertionScheduledAttachmentCount += 1;
    const insertionParentId = connectorParent.parentId;
    const anchorParentIds = (parentsByChildIdBeforeInsertion.get(anchorNodeId) ?? [])
      .slice()
      .sort((left, right) => left.localeCompare(right));
    if (anchorParentIds.length === 0) {
      mergedRootId = insertionParentId;
      continue;
    }
    for (const parentId of anchorParentIds) {
      const parentNode = mergedNodes[parentId];
      if (!parentNode || parentNode.kind !== "parent") {
        continue;
      }
      parentNode.childIds = dedupeOrdered(
        parentNode.childIds.flatMap((childId) => (childId === anchorNodeId ? [insertionParentId] : [childId])),
      );
      pendingRecomputeParentIds.add(parentId);
    }
  }

  while (pendingRecomputeParentIds.size > 0) {
    const parentId = [...pendingRecomputeParentIds].sort((left, right) => {
      const depthDelta = (mergedNodes[right]?.depth ?? 0) - (mergedNodes[left]?.depth ?? 0);
      if (depthDelta !== 0) {
        return depthDelta;
      }
      return left.localeCompare(right);
    })[0];
    pendingRecomputeParentIds.delete(parentId);
    const parentNode = mergedNodes[parentId];
    if (!parentNode || parentNode.kind !== "parent") {
      continue;
    }
    const filteredChildIds = dedupeOrdered(parentNode.childIds.filter((childId) => childId in mergedNodes));
    if (filteredChildIds.length < 2) {
      return undefined;
    }
    const children = filteredChildIds.map((childId) => {
      const childNode = mergedNodes[childId];
      if (!childNode) {
        return undefined;
      }
      return {
        id: childNode.id,
        statement: childNode.statement,
        complexity: childNode.complexityScore,
        prerequisiteIds: childNode.kind === "leaf" ? currentLeafById.get(childNode.id)?.dependencyIds : undefined,
      };
    });
    if (children.some((child) => child === undefined)) {
      return undefined;
    }
    const resolvedChildren = children as Array<{
      id: string;
      statement: string;
      complexity?: number;
      prerequisiteIds?: string[];
    }>;
    const preSummaryDecision = evaluatePreSummaryPolicy(resolvedChildren, request.config);
    if (!preSummaryDecision.ok) {
      return undefined;
    }
    const summaryResult = await generateParentSummary(insertionProvider, {
      children: resolvedChildren,
      config: request.config,
    });
    const postSummaryDecision = evaluatePostSummaryPolicy(resolvedChildren, summaryResult.summary, request.config);
    if (!postSummaryDecision.ok) {
      return undefined;
    }
    const nextPolicyDiagnostics: ParentPolicyDiagnostics = {
      depth: parentNode.depth,
      groupIndex: parentNode.policyDiagnostics?.groupIndex ?? 0,
      retriesUsed: 0,
      preSummary: preSummaryDecision,
      postSummary: postSummaryDecision,
    };
    policyDiagnosticsByParent[parentId] = nextPolicyDiagnostics;
    mergedNodes[parentId] = {
      ...parentNode,
      childIds: filteredChildIds,
      statement: summaryResult.summary.parent_statement,
      complexityScore: summaryResult.summary.complexity_score,
      abstractionScore: summaryResult.summary.abstraction_score,
      confidence: summaryResult.summary.confidence,
      whyTrueFromChildren: summaryResult.summary.why_true_from_children,
      newTermsIntroduced: summaryResult.summary.new_terms_introduced,
      evidenceRefs: summaryResult.summary.evidence_refs,
      policyDiagnostics: nextPolicyDiagnostics,
    };
    recomputedAncestorIds.add(parentId);
    const parentsByChildId = buildParentsByChildId(mergedNodes);
    for (const grandParentId of parentsByChildId.get(parentId) ?? []) {
      pendingRecomputeParentIds.add(grandParentId);
    }
  }

  recomputeNodeDepths(mergedRootId, mergedNodes);
  const computeComplexitySpread = (childIds: string[]): number => {
    const complexities = childIds
      .map((childId) => mergedNodes[childId]?.complexityScore)
      .filter((value): value is number => typeof value === "number");
    if (complexities.length === 0) {
      return 0;
    }
    return Math.max(...complexities) - Math.min(...complexities);
  };

  const mergedGroupPlan = [
    ...request.cachedTree.groupPlan
      .filter(
        (entry) =>
          entry.outputNodeId in mergedNodes &&
          entry.inputNodeIds.every((nodeId) => nodeId in mergedNodes) &&
          mergedNodes[entry.outputNodeId]?.kind === "parent",
      )
      .map((entry) => ({
        depth: mergedNodes[entry.outputNodeId]?.depth ?? entry.depth,
        index: entry.index,
        inputNodeIds: mergedNodes[entry.outputNodeId]?.kind === "parent" ? mergedNodes[entry.outputNodeId].childIds.slice() : [],
        outputNodeId: entry.outputNodeId,
        complexitySpread:
          mergedNodes[entry.outputNodeId]?.kind === "parent"
            ? computeComplexitySpread(mergedNodes[entry.outputNodeId].childIds)
            : entry.complexitySpread,
      })),
    ...addedGroupPlanEntries
      .filter(
        (entry) =>
          entry.outputNodeId in mergedNodes &&
          mergedNodes[entry.outputNodeId]?.kind === "parent" &&
          mergedNodes[entry.outputNodeId]?.kind === "parent",
      )
      .map((entry) => ({
        depth: mergedNodes[entry.outputNodeId]?.depth ?? entry.depth,
        index: entry.index,
        inputNodeIds: mergedNodes[entry.outputNodeId]?.kind === "parent" ? mergedNodes[entry.outputNodeId].childIds.slice() : [],
        outputNodeId: entry.outputNodeId,
        complexitySpread:
          mergedNodes[entry.outputNodeId]?.kind === "parent"
            ? computeComplexitySpread(mergedNodes[entry.outputNodeId].childIds)
            : entry.complexitySpread,
      })),
    ...insertionPlanEntries.map((entry) => ({
      depth: mergedNodes[entry.outputNodeId]?.depth ?? 0,
      index: entry.index,
      inputNodeIds: entry.inputNodeIds.slice(),
      outputNodeId: entry.outputNodeId,
      complexitySpread: entry.complexitySpread,
    })),
  ];

  const mergedGroupingDiagnostics = [
    ...request.cachedTree.groupingDiagnostics
      .map((entry) => ({
        depth: entry.depth,
        orderedNodeIds: entry.orderedNodeIds.filter((nodeId) => nodeId in mergedNodes),
        complexitySpreadByGroup: entry.complexitySpreadByGroup.slice(),
        warnings: entry.warnings.map((warning) => ({ ...warning })),
        repartitionEvents: entry.repartitionEvents
          ?.map((event) => ({
            depth: event.depth,
            groupIndex: event.groupIndex,
            round: event.round,
            reason: event.reason,
            inputNodeIds: event.inputNodeIds.slice(),
            outputGroups: event.outputGroups.map((group) => group.slice()),
            violationCodes: event.violationCodes.slice(),
          }))
          .filter(
            (event) =>
              event.inputNodeIds.every((nodeId) => nodeId in mergedNodes) &&
              event.outputGroups.flat().every((nodeId) => nodeId in mergedNodes),
          ),
      }))
      .filter((entry) => entry.orderedNodeIds.length > 0),
    ...addedGroupingDiagnosticEntries
      .map((entry) => ({
        depth: entry.depth,
        orderedNodeIds: entry.orderedNodeIds.filter((nodeId) => nodeId in mergedNodes),
        complexitySpreadByGroup: entry.complexitySpreadByGroup.slice(),
        warnings: entry.warnings.map((warning) => ({ ...warning })),
        repartitionEvents: entry.repartitionEvents
          ?.map((event) => ({
            depth: event.depth,
            groupIndex: event.groupIndex,
            round: event.round,
            reason: event.reason,
            inputNodeIds: event.inputNodeIds.slice(),
            outputGroups: event.outputGroups.map((group) => group.slice()),
            violationCodes: event.violationCodes.slice(),
          }))
          .filter(
            (event) =>
              event.inputNodeIds.every((nodeId) => nodeId in mergedNodes) &&
              event.outputGroups.flat().every((nodeId) => nodeId in mergedNodes),
          ),
      }))
      .filter((entry) => entry.orderedNodeIds.length > 0),
    ...insertionGroupingEntries.map((entry) => ({
      depth: mergedNodes[entry.outputNodeId]?.depth ?? 0,
      orderedNodeIds: entry.orderedNodeIds.slice(),
      complexitySpreadByGroup: [entry.complexitySpread],
      warnings: [],
      repartitionEvents: [],
    })),
  ];

  const recoveredTree: ExplanationTree = {
    rootId: mergedRootId,
    leafIds: request.currentLeaves.map((leaf) => leaf.id).sort((left, right) => left.localeCompare(right)),
    nodes: mergedNodes,
    configHash: computeConfigHash(request.config),
    groupPlan: mergedGroupPlan,
    groupingDiagnostics: mergedGroupingDiagnostics,
    policyDiagnosticsByParent,
    maxDepth: Math.max(0, ...Object.values(mergedNodes).map((node) => node.depth)),
  };
  const validation = validateExplanationTree(recoveredTree, request.config.maxChildrenPerParent);
  if (!validation.ok) {
    return undefined;
  }

  const recoveredSnapshot = exportTreeStorageSnapshot(recoveredTree, {
    proofId: request.proofId,
    leaves: request.currentLeaves,
    config: request.config,
  });
  const recoveredSnapshotHash = computeTreeStorageSnapshotHash(recoveredSnapshot);
  const cacheEntry: ProofDatasetCacheEntry = {
    schemaVersion: PROOF_DATASET_CACHE_SCHEMA_VERSION,
    proofId: request.proofId,
    configHash: request.configHash,
    sourceFingerprint: request.sourceFingerprint,
    ingestionHash: request.ingestionHash,
    dependencyGraphHash: request.dependencyGraphHash,
    snapshotHash: recoveredSnapshotHash,
    snapshot: recoveredSnapshot,
  };

  const insertedParentCount = addedSubtreeParentCount + insertionParentIds.length;
  const insertionRecomputedAncestorCount = recomputedAncestorIds.size;
  const insertionStrategy = "anchor_grouped_connector_ancestor_recompute" as const;
  const generatedParentSummaryCount = insertedParentCount + insertionRecomputedAncestorCount;
  const insertionHash = computeCanonicalRequestHash({
    planHash: request.blockedSubtreePlan.planHash,
    addedLeafIds: request.addedLeafIds.slice(),
    insertionFrontierCount: insertionFrontiers.length,
    insertionAnchorCount,
    insertionFrontierKeys: insertionFrontiers.map((frontier) => frontier.frontierKey),
    insertionFrontierLeafIds: insertionFrontiers.map((frontier) => frontier.frontierLeafIds),
    frontierAnchorAssignments: frontierAssignments.map((assignment) => ({
      frontierIndex: assignment.frontierIndex,
      frontierKey: assignment.frontierKey,
      frontierRootId: assignment.frontierRootId,
      anchorNodeId: assignment.anchorNodeId,
    })),
    sortedAnchorNodeIds: sortedAnchorNodeIds.slice(),
    frontierSubtreeRootIds: frontierSubtreeRootIds.slice(),
    insertionParentIds: insertionParentIds.slice(),
    insertionRecomputedAncestorIds: [...recomputedAncestorIds].sort((left, right) => left.localeCompare(right)),
    mergedRootId,
    insertionStrategy,
    insertionMergeParentCount,
    insertionScheduledAttachmentCount,
    insertedParentCount,
    insertionRecomputedAncestorCount,
    generatedParentSummaryCount,
    dependencyGraphHash: request.dependencyGraphHash,
    configHash: request.configHash,
  });

  return {
    tree: recoveredTree,
    cacheEntry,
    recoveryMode: "insertion",
    addedLeafIds: request.addedLeafIds.slice(),
    insertionFrontierCount: insertionFrontiers.length,
    insertionAnchorCount,
    insertionMergeParentCount,
    insertedParentCount,
    insertionScheduledAttachmentCount,
    insertionRecomputedAncestorCount,
    insertionStrategy,
    reusableParentSummaryCount: 0,
    reusedParentSummaryCount: 0,
    reusedParentSummaryByGroundingCount: 0,
    reusedParentSummaryByStatementSignatureCount: 0,
    generatedParentSummaryCount,
    skippedAmbiguousStatementSignatureReuseCount: 0,
    skippedUnrebasableStatementSignatureReuseCount: 0,
    regenerationHash: insertionHash,
    additionRecoveryHash: computeCanonicalRequestHash({
      planHash: request.blockedSubtreePlan.planHash,
      addedLeafIds: request.addedLeafIds.slice(),
      insertionFrontierCount: insertionFrontiers.length,
      insertionAnchorCount,
      insertionMergeParentCount,
      insertedParentCount,
      insertionScheduledAttachmentCount,
      insertionRecomputedAncestorCount,
      insertionStrategy,
      generatedParentSummaryCount,
      insertionHash,
      dependencyGraphHash: request.dependencyGraphHash,
      configHash: request.configHash,
    }),
  };
}

function resolveInsertionAnchorNodeId(request: {
  rootId: string;
  frontierLeafIds: string[];
  parentsByChildId: Map<string, string[]>;
}): string | undefined {
  if (request.frontierLeafIds.length === 0) {
    return request.rootId;
  }
  const sortedLeafIds = request.frontierLeafIds.slice().sort((left, right) => left.localeCompare(right));
  const ancestorPathByLeafId = new Map<string, string[]>();
  for (const leafId of sortedLeafIds) {
    const ancestorPath = collectPrimaryAncestorPathToRoot({
      nodeId: leafId,
      rootId: request.rootId,
      parentsByChildId: request.parentsByChildId,
    });
    if (!ancestorPath) {
      return undefined;
    }
    ancestorPathByLeafId.set(leafId, ancestorPath);
  }
  const firstPath = ancestorPathByLeafId.get(sortedLeafIds[0]);
  if (!firstPath) {
    return undefined;
  }
  const ancestorSets = new Map<string, Set<string>>();
  for (const leafId of sortedLeafIds) {
    ancestorSets.set(leafId, new Set(ancestorPathByLeafId.get(leafId) ?? []));
  }
  for (const candidateId of firstPath) {
    const supportedByAllLeaves = sortedLeafIds.every((leafId) => ancestorSets.get(leafId)?.has(candidateId));
    if (supportedByAllLeaves) {
      return candidateId;
    }
  }
  return request.rootId;
}

function collectPrimaryAncestorPathToRoot(request: {
  nodeId: string;
  rootId: string;
  parentsByChildId: Map<string, string[]>;
}): string[] | undefined {
  const path: string[] = [request.nodeId];
  const visited = new Set<string>([request.nodeId]);
  let currentId = request.nodeId;
  while (currentId !== request.rootId) {
    const sortedParents = (request.parentsByChildId.get(currentId) ?? [])
      .slice()
      .sort((left, right) => left.localeCompare(right));
    if (sortedParents.length === 0) {
      return undefined;
    }
    const parentId = sortedParents[0];
    if (visited.has(parentId)) {
      return undefined;
    }
    path.push(parentId);
    visited.add(parentId);
    currentId = parentId;
  }
  return path;
}

async function attemptTopologyRegenerationRecovery(
  request: TopologyRegenerationRecoveryRequest,
): Promise<TopologyRegenerationRecoveryResult | undefined> {
  const reusableSummaryByGroundingKey = buildReusableParentSummaryByGroundingKey(request.cachedTree);
  const reusableSummaryByStatementSignatureKey = buildReusableParentSummaryByStatementSignatureKey(request.cachedTree);
  if (reusableSummaryByGroundingKey.size === 0 && reusableSummaryByStatementSignatureKey.size === 0) {
    return undefined;
  }

  const baseProvider = createDeterministicSummaryProvider();
  let generatedParentSummaryCount = 0;
  let skippedAmbiguousStatementSignatureReuseCount = 0;
  let skippedUnrebasableStatementSignatureReuseCount = 0;
  const reusedParentIdsByGrounding = new Set<string>();
  const reusedParentIdsByStatementSignature = new Set<string>();
  const provider: ProviderClient = {
    generate: async (generateRequest) => {
      const prompt = generateRequest.messages[1]?.content;
      const parsedChildren = prompt ? parseChildrenFromPrompt(prompt) : [];
      if (parsedChildren.length > 0) {
        const groundingKey = buildParentReuseKey(parsedChildren);
        const reusableByGrounding = reusableSummaryByGroundingKey.get(groundingKey);
        if (reusableByGrounding) {
          reusedParentIdsByGrounding.add(reusableByGrounding.parentId);
          return {
            text: JSON.stringify(reusableByGrounding.summary),
            model: "mock-deterministic-reuse",
            finishReason: "stop",
            raw: {
              source: "cache_parent_summary_reuse",
              reuseMode: "grounding",
              parentId: reusableByGrounding.parentId,
            },
          };
        }

        const statementSignatureKey = buildParentStatementSignatureKey(parsedChildren);
        const statementCandidates = reusableSummaryByStatementSignatureKey.get(statementSignatureKey) ?? [];
        if (statementCandidates.length === 1) {
          const reusableByStatementSignature = statementCandidates[0];
          const rebasedEvidenceRefs = rebaseEvidenceRefsToCurrentChildren(
            reusableByStatementSignature.summary.evidence_refs,
            reusableByStatementSignature.children,
            parsedChildren,
          );
          if (rebasedEvidenceRefs) {
            reusedParentIdsByStatementSignature.add(reusableByStatementSignature.parentId);
            return {
              text: JSON.stringify({
                ...reusableByStatementSignature.summary,
                evidence_refs: rebasedEvidenceRefs,
              }),
              model: "mock-deterministic-reuse",
              finishReason: "stop",
              raw: {
                source: "cache_parent_summary_reuse",
                reuseMode: "statement_signature",
                parentId: reusableByStatementSignature.parentId,
              },
            };
          }
          skippedUnrebasableStatementSignatureReuseCount += 1;
        } else if (statementCandidates.length > 1) {
          skippedAmbiguousStatementSignatureReuseCount += 1;
        }
      }
      generatedParentSummaryCount += 1;
      return baseProvider.generate(generateRequest);
    },
    stream: baseProvider.stream,
  };

  let tree: ExplanationTree;
  try {
    tree = await buildRecursiveExplanationTree(provider, {
      leaves: mapTheoremLeavesToLocalizedTreeLeaves(request.currentLeaves, request.config.language),
      config: request.config,
    });
  } catch {
    return undefined;
  }

  const validation = validateExplanationTree(tree, request.config.maxChildrenPerParent);
  if (!validation.ok) {
    return undefined;
  }

  const snapshot = exportTreeStorageSnapshot(tree, {
    proofId: request.proofId,
    leaves: request.currentLeaves,
    config: request.config,
  });
  const snapshotHash = computeTreeStorageSnapshotHash(snapshot);
  const cacheEntry: ProofDatasetCacheEntry = {
    schemaVersion: PROOF_DATASET_CACHE_SCHEMA_VERSION,
    proofId: request.proofId,
    configHash: request.configHash,
    sourceFingerprint: request.sourceFingerprint,
    ingestionHash: request.ingestionHash,
    dependencyGraphHash: request.dependencyGraphHash,
    snapshotHash,
    snapshot,
  };

  const reusedParentSummaryByGroundingCount = reusedParentIdsByGrounding.size;
  const reusedParentSummaryByStatementSignatureCount = reusedParentIdsByStatementSignature.size;
  const reusedParentSummaryCount = reusedParentSummaryByGroundingCount + reusedParentSummaryByStatementSignatureCount;

  return {
    tree,
    cacheEntry,
    reusableParentSummaryCount: reusableSummaryByGroundingKey.size,
    reusedParentSummaryCount,
    reusedParentSummaryByGroundingCount,
    reusedParentSummaryByStatementSignatureCount,
    generatedParentSummaryCount,
    skippedAmbiguousStatementSignatureReuseCount,
    skippedUnrebasableStatementSignatureReuseCount,
    regenerationHash: computeCanonicalRequestHash({
      reusableParentSummaryCount: reusableSummaryByGroundingKey.size,
      reusedParentIdsByGrounding: [...reusedParentIdsByGrounding].sort((left, right) => left.localeCompare(right)),
      reusedParentIdsByStatementSignature: [...reusedParentIdsByStatementSignature].sort((left, right) =>
        left.localeCompare(right),
      ),
      generatedParentSummaryCount,
      skippedAmbiguousStatementSignatureReuseCount,
      skippedUnrebasableStatementSignatureReuseCount,
      dependencyGraphHash: request.dependencyGraphHash,
      configHash: request.configHash,
    }),
  };
}

function buildReusableParentSummaryByGroundingKey(tree: ExplanationTree): Map<string, ReusableParentSummary> {
  const reusable = new Map<string, ReusableParentSummary>();
  const parentNodes = Object.values(tree.nodes)
    .filter((node) => node.kind === "parent")
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const parentNode of parentNodes) {
    const children = parentNode.childIds
      .map((childId) => tree.nodes[childId])
      .filter((node): node is ExplanationTreeNode => node !== undefined)
      .map((node) => ({ id: node.id, statement: node.statement }));
    if (children.length !== parentNode.childIds.length) {
      continue;
    }

    if (
      typeof parentNode.statement !== "string" ||
      parentNode.statement.length === 0 ||
      typeof parentNode.whyTrueFromChildren !== "string" ||
      parentNode.whyTrueFromChildren.length === 0 ||
      !Array.isArray(parentNode.evidenceRefs) ||
      parentNode.evidenceRefs.length === 0
    ) {
      continue;
    }

    const key = buildParentReuseKey(children);
    const nextValue: ReusableParentSummary = {
      parentId: parentNode.id,
      children,
      summary: {
        parent_statement: parentNode.statement,
        why_true_from_children: parentNode.whyTrueFromChildren,
        new_terms_introduced: parentNode.newTermsIntroduced ? parentNode.newTermsIntroduced.slice() : [],
        complexity_score: parentNode.complexityScore ?? 3,
        abstraction_score: parentNode.abstractionScore ?? 3,
        evidence_refs: parentNode.evidenceRefs.slice(),
        confidence: parentNode.confidence ?? 1,
      },
    };
    const existing = reusable.get(key);
    if (!existing || nextValue.parentId.localeCompare(existing.parentId) < 0) {
      reusable.set(key, nextValue);
    }
  }

  return reusable;
}

function buildReusableParentSummaryByStatementSignatureKey(tree: ExplanationTree): Map<string, ReusableParentSummary[]> {
  const bySignature = new Map<string, ReusableParentSummary[]>();
  const reusableByGrounding = buildReusableParentSummaryByGroundingKey(tree);
  const values = [...reusableByGrounding.values()].sort((left, right) => left.parentId.localeCompare(right.parentId));
  for (const reusable of values) {
    const key = buildParentStatementSignatureKey(reusable.children);
    const existing = bySignature.get(key) ?? [];
    existing.push(reusable);
    bySignature.set(key, existing);
  }
  return bySignature;
}

function buildParentReuseKey(children: Array<{ id: string; statement: string }>): string {
  return computeCanonicalRequestHash({
    children: children
      .map((child) => ({ id: child.id, statement: child.statement }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function buildParentStatementSignatureKey(children: Array<{ statement: string }>): string {
  return computeCanonicalRequestHash({
    statements: children.map((child) => child.statement).sort((left, right) => left.localeCompare(right)),
  });
}

function rebaseEvidenceRefsToCurrentChildren(
  priorEvidenceRefs: string[],
  priorChildren: Array<{ id: string; statement: string }>,
  currentChildren: Array<{ id: string; statement: string }>,
): string[] | undefined {
  const priorStatementById = new Map(priorChildren.map((child) => [child.id, child.statement]));
  const availableCurrentIdsByStatement = new Map<string, string[]>();
  for (const child of currentChildren) {
    const existing = availableCurrentIdsByStatement.get(child.statement) ?? [];
    existing.push(child.id);
    availableCurrentIdsByStatement.set(child.statement, existing);
  }
  for (const [statement, childIds] of availableCurrentIdsByStatement.entries()) {
    childIds.sort((left, right) => left.localeCompare(right));
    availableCurrentIdsByStatement.set(statement, childIds);
  }

  const rebased: string[] = [];
  const consumedIds = new Set<string>();
  for (const evidenceRef of priorEvidenceRefs) {
    const statement = priorStatementById.get(evidenceRef);
    if (!statement) {
      return undefined;
    }
    const candidates = availableCurrentIdsByStatement.get(statement) ?? [];
    const next = candidates.find((candidate) => !consumedIds.has(candidate));
    if (!next) {
      return undefined;
    }
    consumedIds.add(next);
    rebased.push(next);
  }

  return rebased;
}

function buildParentsByChildId(nodes: Record<string, ExplanationTreeNode>): Map<string, string[]> {
  const parents = new Map<string, string[]>();
  for (const node of Object.values(nodes)) {
    if (node.kind !== "parent") {
      continue;
    }
    for (const childId of node.childIds) {
      const existing = parents.get(childId) ?? [];
      existing.push(node.id);
      parents.set(childId, existing);
    }
  }

  for (const [childId, parentIds] of parents.entries()) {
    parentIds.sort((left, right) => left.localeCompare(right));
    parents.set(childId, parentIds);
  }
  return parents;
}

function dedupeOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

function collectReachableNodeIds(rootId: string, nodes: Record<string, ExplanationTreeNode>): Set<string> {
  const reachable = new Set<string>();
  const stack: string[] = [rootId];
  while (stack.length > 0) {
    const nodeId = stack.pop() as string;
    if (reachable.has(nodeId)) {
      continue;
    }
    const node = nodes[nodeId];
    if (!node) {
      continue;
    }
    reachable.add(nodeId);
    for (const childId of node.childIds) {
      stack.push(childId);
    }
  }
  return reachable;
}

function recomputeNodeDepths(rootId: string, nodes: Record<string, ExplanationTreeNode>): void {
  const queue: string[] = [rootId];
  const visited = new Set<string>();
  const levelByNode = new Map<string, number>([[rootId, 0]]);

  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    if (visited.has(nodeId)) {
      continue;
    }
    visited.add(nodeId);
    const node = nodes[nodeId];
    if (!node) {
      continue;
    }
    const level = levelByNode.get(nodeId) ?? 0;
    for (const childId of node.childIds) {
      if (!nodes[childId]) {
        continue;
      }
      levelByNode.set(childId, level + 1);
      queue.push(childId);
    }
  }

  const maxLevel = Math.max(0, ...[...levelByNode.values()]);
  for (const [nodeId, level] of levelByNode.entries()) {
    const node = nodes[nodeId];
    if (!node) {
      continue;
    }
    node.depth = maxLevel - level;
  }
}

function buildDependentsByDeclaration(leaves: TheoremLeafRecord[]): Map<string, string[]> {
  const dependents = new Map<string, Set<string>>();
  for (const leaf of leaves) {
    if (!dependents.has(leaf.declarationId)) {
      dependents.set(leaf.declarationId, new Set());
    }
  }
  for (const leaf of leaves) {
    for (const dependencyId of leaf.dependencyIds) {
      if (!dependents.has(dependencyId)) {
        dependents.set(dependencyId, new Set());
      }
      dependents.get(dependencyId)?.add(leaf.declarationId);
    }
  }
  return new Map(
    [...dependents.entries()].map(([declarationId, ids]) => [declarationId, [...ids].sort((a, b) => a.localeCompare(b))]),
  );
}

function buildExecutionBatches(
  blockedDeclarationIds: string[],
  leavesByDeclarationId: Map<string, TheoremLeafRecord>,
): { executionBatches: string[][]; cyclicBatchCount: number } {
  if (blockedDeclarationIds.length === 0) {
    return { executionBatches: [], cyclicBatchCount: 0 };
  }

  const blocked = new Set(blockedDeclarationIds);
  const dependents = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();

  for (const declarationId of blockedDeclarationIds) {
    dependents.set(declarationId, new Set());
    indegree.set(declarationId, 0);
  }

  for (const declarationId of blockedDeclarationIds) {
    const leaf = leavesByDeclarationId.get(declarationId);
    if (!leaf) {
      continue;
    }
    const internalDependencies = leaf.dependencyIds.filter((dependencyId) => blocked.has(dependencyId));
    indegree.set(declarationId, internalDependencies.length);
    for (const dependencyId of internalDependencies) {
      dependents.get(dependencyId)?.add(declarationId);
    }
  }

  const remaining = new Set(blockedDeclarationIds);
  const executionBatches: string[][] = [];
  let cyclicBatchCount = 0;

  while (remaining.size > 0) {
    const batch = [...remaining]
      .filter((declarationId) => (indegree.get(declarationId) ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b));

    if (batch.length === 0) {
      const cycleBatch = [...remaining].sort((a, b) => a.localeCompare(b));
      executionBatches.push(cycleBatch);
      cyclicBatchCount += 1;
      break;
    }

    executionBatches.push(batch);
    for (const declarationId of batch) {
      remaining.delete(declarationId);
      for (const dependentId of dependents.get(declarationId) ?? []) {
        indegree.set(dependentId, Math.max(0, (indegree.get(dependentId) ?? 0) - 1));
      }
    }
  }

  return { executionBatches, cyclicBatchCount };
}

function createDeterministicSummaryProvider(): ProviderClient {
  return {
    generate: async (request) => {
      const prompt = request.messages[1]?.content ?? "";
      const children = parseChildrenFromPrompt(prompt);
      const language = parsePromptLanguageConstraint(prompt);
      const targetComplexity = parsePromptNumericConstraint(prompt, "target_complexity", 3, 1, 5);
      const targetAbstraction = parsePromptNumericConstraint(prompt, "target_abstraction", 3, 1, 5);
      const evidenceRefs = children.map((child) => child.id);
      const composed = children.map((child) => child.statement).join(language === "fr" ? " et " : " and ");
      const parentStatement = composed.length > 0 ? composed : language === "fr" ? "Aucun enonce enfant fourni." : "No child statements provided.";

      return {
        text: JSON.stringify({
          parent_statement: parentStatement,
          why_true_from_children: parentStatement,
          new_terms_introduced: [],
          complexity_score: targetComplexity,
          abstraction_score: targetAbstraction,
          evidence_refs: evidenceRefs,
          confidence: 1,
        }),
        model: "mock-deterministic",
        finishReason: "stop",
        raw: {},
      };
    },
    stream: async function* () {
      return;
    },
  };
}

function parseChildrenFromPrompt(prompt: string): Array<{ id: string; statement: string }> {
  const matches = [...prompt.matchAll(/^- id=([^\s]+)(?:\s+complexity=\d+)?\s+statement=(.+)$/gm)];
  const children = matches.map((match) => {
    const id = match[1];
    const rawStatement = match[2];
    try {
      return { id, statement: JSON.parse(rawStatement) as string };
    } catch {
      return { id, statement: rawStatement };
    }
  });
  children.sort((left, right) => left.id.localeCompare(right.id));
  return children;
}

function parsePromptNumericConstraint(
  prompt: string,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const match = prompt.match(new RegExp(`${key}=(\\d+)`));
  const parsed = Number(match?.[1] ?? fallback);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function parsePromptLanguageConstraint(prompt: string): "en" | "fr" {
  const match = prompt.match(/language=([^\s]+)/);
  const requested = match?.[1] ?? "en";
  return resolveExplanationLanguage(requested).effective;
}

function renderLocalizedTreeLeafStatement(
  leaf: TheoremLeafRecord,
  language: "en" | "fr",
): string {
  if (language === "fr") {
    return `Enonce ${leaf.declarationName}: ${leaf.prettyStatement}`;
  }
  return leaf.prettyStatement;
}

function mapTheoremLeavesToLocalizedTreeLeaves(
  leaves: TheoremLeafRecord[],
  language: "en" | "fr",
): Array<{ id: string; statement: string; prerequisiteIds: string[] }> {
  return leaves
    .map((leaf) => ({
      id: leaf.id,
      statement: renderLocalizedTreeLeafStatement(leaf, language),
      prerequisiteIds: leaf.dependencyIds,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function assertSeedProof(proofId: string): void {
  if (proofId !== SEED_PROOF_ID) {
    throw new Error(`Unsupported proofId '${proofId}'. Supported proofs: ${SEED_PROOF_ID}.`);
  }
}

function assertSupportedProof(proofId: string): void {
  if (!isSupportedProofId(proofId)) {
    throw new Error(`Unsupported proofId '${proofId}'. Supported proofs: ${SUPPORTED_PROOF_IDS.join(", ")}.`);
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

function buildSeedCacheMetadata(dataset: SeedDataset, snapshotHash: string): ProofDatasetCacheMetadata {
  return {
    layer: "ephemeral",
    status: "miss",
    cacheKey: `${dataset.proofId}:${dataset.configHash}`,
    sourceFingerprint: "seed",
    snapshotHash,
    cacheEntryHash: computeCanonicalRequestHash({
      proofId: dataset.proofId,
      configHash: dataset.configHash,
      snapshotHash,
    }),
    diagnostics: [
      {
        code: "cache_miss",
        message: "Seed dataset is rebuilt deterministically per request (ephemeral cache only).",
      },
    ],
  };
}

function buildProofQueryObservability(input: {
  proofId: string;
  configHash: string;
  requestHash: string;
  query: ProofObservabilityQuery;
  tree: ExplanationTree;
  cache: ProofDatasetCacheMetadata;
  latencyMs: number;
  extraMetrics?: Record<string, boolean | number | string>;
}): ProofQueryObservability {
  const base = {
    proofId: input.proofId,
    configHash: input.configHash,
    requestId: input.requestHash,
    query: input.query,
    cacheLayer: input.cache.layer,
    cacheStatus: input.cache.status,
  };
  const traceId = computeCanonicalRequestHash(base);
  const metrics: ProofQueryObservability["metrics"] = {
    latencyMs: normalizeLatencyMs(input.latencyMs),
    cacheLayer: input.cache.layer,
    cacheStatus: input.cache.status,
    leafCount: input.tree.leafIds.length,
    parentCount: Object.values(input.tree.nodes).filter((node) => node.kind === "parent").length,
    nodeCount: Object.keys(input.tree.nodes).length,
    maxDepth: input.tree.maxDepth,
  };
  const attributes = {
    ...metrics,
    ...(input.extraMetrics ?? {}),
  };
  const spanNames: Array<ProofQueryObservability["spans"][number]["name"]> = [
    "dataset_load",
    "query_compute",
    "response_materialization",
  ];
  const spans: ProofQueryObservability["spans"] = spanNames.map((name) => ({
    spanId: computeCanonicalRequestHash({ traceId, name }),
    name,
    attributes: {
      ...attributes,
      query: input.query,
      proofId: input.proofId,
      configHash: input.configHash,
    },
  }));
  recordProofQueryObservabilityEvent({
    query: input.query,
    traceId,
    requestId: input.requestHash,
    latencyMs: metrics.latencyMs,
    cacheLayer: input.cache.layer,
    cacheStatus: input.cache.status,
    leafCount: metrics.leafCount,
    parentCount: metrics.parentCount,
    nodeCount: metrics.nodeCount,
    maxDepth: metrics.maxDepth,
  });
  return {
    requestId: input.requestHash,
    traceId,
    query: input.query,
    spans,
    metrics,
  };
}

export function exportProofQueryObservabilityMetrics(options: { generatedAt?: string } = {}): ProofQueryObservabilityMetricsSnapshot {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const requestCount = proofQueryObservabilityEvents.length;
  const uniqueRequestCount = new Set(proofQueryObservabilityEvents.map((event) => event.requestId)).size;
  const uniqueTraceCount = new Set(proofQueryObservabilityEvents.map((event) => event.traceId)).size;
  const hitCount = proofQueryObservabilityEvents.filter((event) => event.cacheStatus === "hit").length;
  const missCount = requestCount - hitCount;
  const latencyHistogram = buildProofLatencyHistogram(proofQueryObservabilityEvents.map((event) => event.latencyMs));
  const queryOrder: ProofObservabilityQuery[] = [
    "view",
    "diff",
    "leaf-detail",
    "root",
    "children",
    "path",
    "dependency-graph",
    "policy-report",
    "cache-report",
  ];
  const queries = queryOrder.map((query) => {
    const events = proofQueryObservabilityEvents.filter((event) => event.query === query);
    const requestCountForQuery = events.length;
    const latencies = events.map((event) => event.latencyMs).sort((left, right) => left - right);
    const cacheHitCount = events.filter((event) => event.cacheStatus === "hit").length;
    const cacheMissCount = requestCountForQuery - cacheHitCount;
    const minLatencyMs = requestCountForQuery === 0 ? 0 : latencies[0] ?? 0;
    const maxLatencyMs = requestCountForQuery === 0 ? 0 : latencies[latencies.length - 1] ?? 0;
    const meanLatencyMs = requestCountForQuery === 0 ? 0 : sum(latencies) / requestCountForQuery;
    const p95LatencyMs = requestCountForQuery === 0 ? 0 : percentile(latencies, 0.95);
    const meanLeafCount = requestCountForQuery === 0 ? 0 : sum(events.map((event) => event.leafCount)) / requestCountForQuery;
    const meanParentCount = requestCountForQuery === 0 ? 0 : sum(events.map((event) => event.parentCount)) / requestCountForQuery;
    const meanNodeCount = requestCountForQuery === 0 ? 0 : sum(events.map((event) => event.nodeCount)) / requestCountForQuery;
    const maxDepth = requestCountForQuery === 0 ? 0 : Math.max(...events.map((event) => event.maxDepth));
    return {
      query,
      requestCount: requestCountForQuery,
      cacheHitCount,
      cacheMissCount,
      minLatencyMs,
      maxLatencyMs,
      meanLatencyMs,
      p95LatencyMs,
      latencyHistogram: buildProofLatencyHistogram(latencies),
      meanLeafCount,
      meanParentCount,
      meanNodeCount,
      maxDepth,
    };
  });

  const snapshotWithoutHash = {
    schemaVersion: "1.0.0" as const,
    requestCount,
    uniqueRequestCount,
    uniqueTraceCount,
    cache: {
      hitCount,
      missCount,
      hitRate: requestCount === 0 ? 0 : hitCount / requestCount,
    },
    latencyHistogram,
    queries,
    generatedAt,
  };

  return {
    ...snapshotWithoutHash,
    snapshotHash: computeCanonicalRequestHash(snapshotWithoutHash),
  };
}

export function clearProofQueryObservabilityMetricsForTests(): void {
  proofQueryObservabilityEvents.length = 0;
}

export function configureProofQueryObservabilityClockForTests(nowMs: () => number): void {
  proofNowMs = nowMs;
}

export function resetProofQueryObservabilityClockForTests(): void {
  proofNowMs = () => Date.now();
}

function recordProofQueryObservabilityEvent(event: ProofQueryObservabilityEvent): void {
  proofQueryObservabilityEvents.push(event);
  if (proofQueryObservabilityEvents.length > PROOF_QUERY_OBSERVABILITY_SAMPLE_WINDOW) {
    proofQueryObservabilityEvents.splice(0, proofQueryObservabilityEvents.length - PROOF_QUERY_OBSERVABILITY_SAMPLE_WINDOW);
  }
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

function buildProofLatencyHistogram(latencies: number[]): ProofQueryLatencyHistogramBucket[] {
  const buckets = PROOF_QUERY_LATENCY_BUCKETS.map((definition) => ({
    bucket: definition.bucket,
    maxInclusiveMs: definition.maxInclusiveMs,
    count: 0,
  }));
  for (const rawLatency of latencies) {
    const latencyMs = normalizeLatencyMs(rawLatency);
    const bucket = buckets.find((entry) => entry.maxInclusiveMs === null || latencyMs <= entry.maxInclusiveMs);
    if (bucket) {
      bucket.count += 1;
    }
  }
  return buckets;
}

function sum(values: number[]): number {
  return values.reduce((accumulator, value) => accumulator + value, 0);
}

function percentile(sortedValues: number[], quantile: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const clampedQuantile = Math.min(1, Math.max(0, quantile));
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * clampedQuantile) - 1));
  return sortedValues[index] ?? 0;
}

function elapsedMs(startedAtMs: number): number {
  return normalizeLatencyMs(proofNowMs() - startedAtMs);
}

function normalizeLatencyMs(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.round(value));
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

function normalizeOptionalDeclarationId(input: string | undefined): string | undefined {
  if (input === undefined) {
    return undefined;
  }
  const normalized = input.trim();
  if (normalized.length === 0) {
    throw new Error("Expected declarationId to be non-empty when provided.");
  }
  return normalized;
}
