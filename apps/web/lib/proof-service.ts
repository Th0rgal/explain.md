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
  mapTheoremLeavesToTreeLeaves,
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

export interface ProofDatasetCacheDiagnostic {
  code:
    | "cache_hit"
    | "cache_topology_recovery_hit"
    | "cache_blocked_subtree_rebuild_hit"
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
}

export interface PolicyReportView {
  proofId: string;
  configHash: string;
  requestHash: string;
  reportHash: string;
  report: ReturnType<typeof evaluateExplanationTreeQuality>;
}

export interface ProofCacheReportView {
  proofId: string;
  configHash: string;
  requestHash: string;
  cache: ProofDatasetCacheMetadata;
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

export async function buildProofProjection(request: ProjectionRequest) {
  const { dataset } = await loadProofDataset(request.proofId, request.config);
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

export async function buildProofDiff(request: DiffRequest) {
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

  return {
    proofId: request.proofId,
    requestHash,
    baselineConfig: baseline.dataset.config,
    candidateConfig: candidate.dataset.config,
    report,
    diffHash,
  };
}

export async function buildProofLeafDetail(request: LeafDetailRequest) {
  const { dataset } = await loadProofDataset(request.proofId, request.config);
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

export async function buildProofRootView(proofId: string, configInput: ExplanationConfigInput = {}) {
  const { dataset, queryApi } = await loadProofDataset(proofId, configInput);
  const root = queryApi.getRoot();

  return {
    proofId,
    configHash: dataset.configHash,
    requestHash: computeCanonicalRequestHash({
      proofId,
      configHash: dataset.configHash,
      query: "root",
    }),
    snapshotHash: computeTreeStorageSnapshotHash(queryApi.snapshot),
    root,
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

export async function buildProofNodeChildrenView(request: NodeChildrenRequest) {
  const { dataset, queryApi } = await loadProofDataset(request.proofId, request.config);
  const children = queryApi.getChildren(request.nodeId, {
    offset: request.offset,
    limit: request.limit,
  });

  return {
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash: computeCanonicalRequestHash({
      proofId: request.proofId,
      nodeId: request.nodeId,
      configHash: dataset.configHash,
      offset: request.offset,
      limit: request.limit,
      query: "children",
    }),
    snapshotHash: computeTreeStorageSnapshotHash(queryApi.snapshot),
    children,
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

export async function buildProofNodePathView(request: NodePathRequest) {
  const { dataset, queryApi } = await loadProofDataset(request.proofId, request.config);
  const pathResult = queryApi.getAncestryPath(request.nodeId);

  return {
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash: computeCanonicalRequestHash({
      proofId: request.proofId,
      nodeId: request.nodeId,
      configHash: dataset.configHash,
      query: "path",
    }),
    snapshotHash: computeTreeStorageSnapshotHash(queryApi.snapshot),
    path: pathResult,
  };
}

export async function buildProofDependencyGraphView(request: DependencyGraphRequest): Promise<DependencyGraphView> {
  const { dataset } = await loadProofDataset(request.proofId, request.config);
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

  return {
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash: computeCanonicalRequestHash({
      proofId: request.proofId,
      declarationId,
      configHash: dataset.configHash,
      includeExternalSupport,
      query: "dependency-graph",
    }),
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
  };
}

export async function buildProofPolicyReportView(request: PolicyReportRequest): Promise<PolicyReportView> {
  const { dataset } = await loadProofDataset(request.proofId, request.config);
  const report = evaluateExplanationTreeQuality(dataset.tree, dataset.config, {
    thresholds: request.thresholds,
  });

  return {
    proofId: request.proofId,
    configHash: dataset.configHash,
    requestHash: computeCanonicalRequestHash({
      proofId: request.proofId,
      configHash: dataset.configHash,
      thresholds: request.thresholds ?? {},
      query: "policy-report",
    }),
    reportHash: computeTreeQualityReportHash(report),
    report,
  };
}

export async function buildProofCacheReportView(request: ProofCacheReportRequest): Promise<ProofCacheReportView> {
  const resolved = await loadProofDataset(request.proofId, request.config);
  return {
    proofId: request.proofId,
    configHash: resolved.dataset.configHash,
    requestHash: computeCanonicalRequestHash({
      proofId: request.proofId,
      configHash: resolved.dataset.configHash,
      query: "cache-report",
    }),
    cache: resolved.cache,
  };
}

export function buildSeedNodePathView(request: NodePathRequest) {
  const dataset = loadSeedDataset(request.proofId, request.config);
  const api = createSeedTreeQueryApi(dataset);
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
  }

  const tree = await buildRecursiveExplanationTree(createDeterministicSummaryProvider(), {
    leaves: mapTheoremLeavesToTreeLeaves(theoremLeaves),
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
      statement: leaf.prettyStatement,
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
      const targetComplexity = parsePromptNumericConstraint(prompt, "target_complexity", 3, 1, 5);
      const targetAbstraction = parsePromptNumericConstraint(prompt, "target_abstraction", 3, 1, 5);
      const evidenceRefs = children.map((child) => child.id);
      const composed = children.map((child) => child.statement).join(" and ");
      const parentStatement = composed.length > 0 ? composed : "No child statements provided.";

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
