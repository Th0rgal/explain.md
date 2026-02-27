import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildRecursiveExplanationTree,
  buildDeclarationDependencyGraph,
  computeTreeQualityReportHash,
  computeDependencyGraphHash,
  computeLeanIngestionHash,
  evaluateExplanationTreeQuality,
  getDirectDependencies,
  getDirectDependents,
  getSupportingDeclarations,
  ingestLeanSources,
  mapLeanIngestionToTheoremLeaves,
  mapTheoremLeavesToTreeLeaves,
  normalizeConfig,
  evaluatePreSummaryPolicy,
  evaluatePostSummaryPolicy,
  generateParentSummary,
  SummaryValidationError,
  TreeFrontierPartitionError,
  TreePolicyError,
  validateExplanationTree,
  type DependencyGraph,
  type ExplanationTree,
  type ExplanationConfig,
  type ExplanationConfigInput,
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
  process.env.EXPLAIN_MD_LEAN_FIXTURE_SOURCE_BASE_URL?.trim() ||
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
    | "cache_semantic_hit"
    | "cache_incremental_subtree_rebuild"
    | "cache_incremental_topology_rebuild"
    | "cache_incremental_rebuild"
    | "cache_miss"
    | "cache_write_failed"
    | "cache_read_failed"
    | "cache_entry_invalid"
    | "cache_dependency_hash_mismatch"
    | "cache_snapshot_hash_mismatch";
  message: string;
  details?: Record<string, unknown>;
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
    sourceBaseUrl: resolveProofSourceBaseUrl(request.proofId),
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
    sourceBaseUrl: resolveProofSourceBaseUrl(request.proofId),
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

function resolveProofSourceBaseUrl(proofId: string): string | undefined {
  if (proofId === LEAN_FIXTURE_PROOF_ID) {
    return LEAN_FIXTURE_SOURCE_BASE_URL;
  }
  return undefined;
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
  let rebuiltIngestion:
    | {
        ingestionHash: string;
        theoremLeaves: TheoremLeafRecord[];
        dependencyGraph: DependencyGraph;
        dependencyGraphHash: string;
      }
    | undefined;

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
      cacheDiagnostics.push({
        code: "cache_miss",
        message: "Cached dataset source fingerprint mismatch; evaluating theorem-level deltas.",
        details: {
          cachePath,
          expectedSourceFingerprint: cached.entry.sourceFingerprint,
          actualSourceFingerprint: sourceFingerprint,
        },
      });

      rebuiltIngestion = ingestFixtureTreeInputs(fixtureProjectRoot, sources);
      const delta = computeTheoremLeafDelta(cached.entry.snapshot.leafRecords, rebuiltIngestion.theoremLeaves);
      if (delta.changedLeafCount === 0 && rebuiltIngestion.dependencyGraphHash === cached.entry.dependencyGraphHash) {
        const imported = importTreeStorageSnapshot(cached.entry.snapshot);
        const hasImportErrors = imported.diagnostics.some((diagnostic) => diagnostic.severity === "error");
        const snapshotHash = computeTreeStorageSnapshotHash(cached.entry.snapshot);
        if (!hasImportErrors && imported.tree && snapshotHash === cached.entry.snapshotHash) {
          const rebasedSnapshot = exportTreeStorageSnapshot(imported.tree, {
            proofId,
            leaves: rebuiltIngestion.theoremLeaves,
            config,
          });
          const rebasedEntry: ProofDatasetCacheEntry = {
            ...cached.entry,
            sourceFingerprint,
            ingestionHash: rebuiltIngestion.ingestionHash,
            dependencyGraphHash: rebuiltIngestion.dependencyGraphHash,
            snapshot: rebasedSnapshot,
            snapshotHash: computeTreeStorageSnapshotHash(rebasedSnapshot),
          };
          const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, rebasedEntry);
          if (cacheWriteError) {
            cacheDiagnostics.push({
              code: "cache_write_failed",
              message: "Failed rebasing persistent cache entry after theorem-level semantic hit.",
              details: { cachePath, error: cacheWriteError },
            });
          }
          cacheDiagnostics.push({
            code: "cache_semantic_hit",
            message:
              "Reused cached snapshot after source fingerprint mismatch because theorem-level canonical leaves were unchanged.",
            details: {
              cachePath,
              previousSourceFingerprint: cached.entry.sourceFingerprint,
              sourceFingerprint,
              unchangedLeafCount: delta.unchangedLeafCount,
            },
          });

          return {
            dataset: {
              proofId,
              title: `Lean Verity fixture (${rebuiltIngestion.theoremLeaves.length} declarations, ingestion=${rebuiltIngestion.ingestionHash.slice(0, 8)}, depgraph=${rebuiltIngestion.dependencyGraphHash.slice(0, 8)})`,
              config,
              configHash,
              tree: imported.tree,
              leaves: rebuiltIngestion.theoremLeaves,
              dependencyGraph: rebuiltIngestion.dependencyGraph,
              dependencyGraphHash: rebuiltIngestion.dependencyGraphHash,
            },
            queryApi: createTreeQueryApi(rebasedSnapshot),
            cache: {
              layer: "persistent",
              status: "hit",
              cacheKey,
              sourceFingerprint,
              cachePath,
              snapshotHash: rebasedEntry.snapshotHash,
              cacheEntryHash: computeProofDatasetCacheEntryHash(rebasedEntry),
              diagnostics: cacheDiagnostics,
            },
          };
        }
      }

      if (rebuiltIngestion.dependencyGraphHash === cached.entry.dependencyGraphHash) {
        const incrementalSnapshot = await rebuildSnapshotForChangedLeaves({
          snapshot: cached.entry.snapshot,
          proofId,
          leaves: rebuiltIngestion.theoremLeaves,
          changedLeafIds: delta.changedLeafIds,
          config,
        });

        if (incrementalSnapshot) {
          const incrementalEntry: ProofDatasetCacheEntry = {
            ...cached.entry,
            sourceFingerprint,
            ingestionHash: rebuiltIngestion.ingestionHash,
            dependencyGraphHash: rebuiltIngestion.dependencyGraphHash,
            snapshot: incrementalSnapshot.snapshot,
            snapshotHash: incrementalSnapshot.snapshotHash,
          };
          const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, incrementalEntry);
          if (cacheWriteError) {
            cacheDiagnostics.push({
              code: "cache_write_failed",
              message: "Failed writing persistent cache entry after incremental subtree rebuild.",
              details: { cachePath, error: cacheWriteError },
            });
          }
          cacheDiagnostics.push({
            code: "cache_incremental_subtree_rebuild",
            message:
              "Detected theorem-level statement delta with stable topology; rebuilt affected parent subtrees only.",
            details: {
              cachePath,
              changedLeafCount: delta.changedLeafCount,
              changedLeafIds: delta.changedLeafIds.slice(0, 16),
              affectedParentCount: incrementalSnapshot.affectedParentCount,
              reusedNodeCount: incrementalSnapshot.reusedNodeCount,
            },
          });

          return {
            dataset: {
              proofId,
              title: `Lean Verity fixture (${rebuiltIngestion.theoremLeaves.length} declarations, ingestion=${rebuiltIngestion.ingestionHash.slice(0, 8)}, depgraph=${rebuiltIngestion.dependencyGraphHash.slice(0, 8)})`,
              config,
              configHash,
              tree: incrementalSnapshot.tree,
              leaves: rebuiltIngestion.theoremLeaves,
              dependencyGraph: rebuiltIngestion.dependencyGraph,
              dependencyGraphHash: rebuiltIngestion.dependencyGraphHash,
            },
            queryApi: createTreeQueryApi(incrementalSnapshot.snapshot),
            cache: {
              layer: "persistent",
              status: "hit",
              cacheKey,
              sourceFingerprint,
              cachePath,
              snapshotHash: incrementalEntry.snapshotHash,
              cacheEntryHash: computeProofDatasetCacheEntryHash(incrementalEntry),
              diagnostics: cacheDiagnostics,
            },
          };
        }
      }

      const topologyRebuild = await rebuildSnapshotWithParentSummaryReuse({
        previousSnapshot: cached.entry.snapshot,
        proofId,
        leaves: rebuiltIngestion.theoremLeaves,
        changedLeafIds: delta.changedLeafIds,
        config,
      });
      if (topologyRebuild) {
        const topologyEntry: ProofDatasetCacheEntry = {
          ...cached.entry,
          sourceFingerprint,
          ingestionHash: rebuiltIngestion.ingestionHash,
          dependencyGraphHash: rebuiltIngestion.dependencyGraphHash,
          snapshot: topologyRebuild.snapshot,
          snapshotHash: topologyRebuild.snapshotHash,
        };
        const cacheWriteError = await writeProofDatasetCacheEntry(cachePath, topologyEntry);
        if (cacheWriteError) {
          cacheDiagnostics.push({
            code: "cache_write_failed",
            message: "Failed writing persistent cache entry after topology-aware rebuild.",
            details: { cachePath, error: cacheWriteError },
          });
        }
        cacheDiagnostics.push({
          code: "cache_incremental_topology_rebuild",
          message: "Detected theorem topology/structure delta; rebuilt tree with deterministic parent-summary reuse.",
          details: {
            cachePath,
            changedLeafCount: delta.changedLeafCount,
            addedLeafCount: delta.addedLeafCount,
            removedLeafCount: delta.removedLeafCount,
            changedLeafIds: delta.changedLeafIds.slice(0, 16),
            reusedParentSummaryCount: topologyRebuild.reusedParentSummaryCount,
            generatedParentSummaryCount: topologyRebuild.generatedParentSummaryCount,
            reusedParentNodeCount: topologyRebuild.reusedParentNodeCount,
            generatedParentNodeCount: topologyRebuild.generatedParentNodeCount,
            reusedParentByStableIdCount: topologyRebuild.reusedParentByStableIdCount,
            reusedParentByChildHashCount: topologyRebuild.reusedParentByChildHashCount,
            reusedParentByChildStatementHashCount: topologyRebuild.reusedParentByChildStatementHashCount,
            reusedParentByFrontierChildHashCount: topologyRebuild.reusedParentByFrontierChildHashCount,
            reusedParentByFrontierChildStatementHashCount: topologyRebuild.reusedParentByFrontierChildStatementHashCount,
            skippedAmbiguousChildHashReuseCount: topologyRebuild.skippedAmbiguousChildHashReuseCount,
            skippedAmbiguousChildStatementHashReuseCount: topologyRebuild.skippedAmbiguousChildStatementHashReuseCount,
            frontierPartitionLeafCount: topologyRebuild.frontierPartitionLeafCount,
            frontierPartitionBlockedGroupCount: topologyRebuild.frontierPartitionBlockedGroupCount,
            frontierPartitionRecoveredLeafCount: topologyRebuild.frontierPartitionRecoveredLeafCount,
            frontierPartitionRecoveredSummaryCount: topologyRebuild.frontierPartitionRecoveredSummaryCount,
            frontierPartitionRecoveryPassCount: topologyRebuild.frontierPartitionRecoveryPassCount,
            frontierPartitionRecoveryScheduledGroupCount: topologyRebuild.frontierPartitionRecoveryScheduledGroupCount,
            frontierPartitionRecoveryStrategy: topologyRebuild.frontierPartitionRecoveryStrategy,
            frontierPartitionFallbackUsed: topologyRebuild.frontierPartitionFallbackUsed,
            previousParentCount: topologyRebuild.previousParentCount,
            nextParentCount: topologyRebuild.nextParentCount,
          },
        });

        return {
          dataset: {
            proofId,
            title: `Lean Verity fixture (${rebuiltIngestion.theoremLeaves.length} declarations, ingestion=${rebuiltIngestion.ingestionHash.slice(0, 8)}, depgraph=${rebuiltIngestion.dependencyGraphHash.slice(0, 8)})`,
            config,
            configHash,
            tree: topologyRebuild.tree,
            leaves: rebuiltIngestion.theoremLeaves,
            dependencyGraph: rebuiltIngestion.dependencyGraph,
            dependencyGraphHash: rebuiltIngestion.dependencyGraphHash,
          },
          queryApi: createTreeQueryApi(topologyRebuild.snapshot),
          cache: {
            layer: "persistent",
            status: "hit",
            cacheKey,
            sourceFingerprint,
            cachePath,
            snapshotHash: topologyEntry.snapshotHash,
            cacheEntryHash: computeProofDatasetCacheEntryHash(topologyEntry),
            diagnostics: cacheDiagnostics,
          },
        };
      }

      cacheDiagnostics.push({
        code: "cache_incremental_rebuild",
        message: "Detected theorem-level delta; rebuilding explanation tree from updated leaves.",
        details: {
          cachePath,
          changedLeafCount: delta.changedLeafCount,
          addedLeafCount: delta.addedLeafCount,
          removedLeafCount: delta.removedLeafCount,
          unchangedLeafCount: delta.unchangedLeafCount,
          changedLeafIds: delta.changedLeafIds.slice(0, 16),
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

  const rebuilt = rebuiltIngestion ?? ingestFixtureTreeInputs(fixtureProjectRoot, sources);
  const ingestionHash = rebuilt.ingestionHash;
  const theoremLeaves = rebuilt.theoremLeaves;
  const dependencyGraph = rebuilt.dependencyGraph;
  const dependencyGraphHash = rebuilt.dependencyGraphHash;

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

function ingestFixtureTreeInputs(
  fixtureProjectRoot: string,
  sources: Array<{ relativePath: string; filePath: string; content: string }>,
): {
  ingestionHash: string;
  theoremLeaves: TheoremLeafRecord[];
  dependencyGraph: DependencyGraph;
  dependencyGraphHash: string;
} {
  const ingestion = ingestLeanSources(fixtureProjectRoot, sources, {
    sourceBaseUrl: LEAN_FIXTURE_SOURCE_BASE_URL,
  });
  const theoremLeaves = mapLeanIngestionToTheoremLeaves(ingestion);
  const dependencyGraph = buildDeclarationDependencyGraph(
    theoremLeaves.map((leaf) => ({ id: leaf.id, dependencyIds: leaf.dependencyIds })),
  );

  return {
    ingestionHash: computeLeanIngestionHash(ingestion),
    theoremLeaves,
    dependencyGraph,
    dependencyGraphHash: computeDependencyGraphHash(dependencyGraph),
  };
}

function computeTheoremLeafDelta(
  previousLeaves: TheoremLeafRecord[],
  nextLeaves: TheoremLeafRecord[],
): {
  changedLeafCount: number;
  unchangedLeafCount: number;
  addedLeafCount: number;
  removedLeafCount: number;
  changedLeafIds: string[];
} {
  const previousById = new Map(previousLeaves.map((leaf) => [leaf.id, computeTheoremLeafSemanticHash(leaf)]));
  const nextById = new Map(nextLeaves.map((leaf) => [leaf.id, computeTheoremLeafSemanticHash(leaf)]));
  const changedLeafIds = new Set<string>();
  let unchangedLeafCount = 0;
  let addedLeafCount = 0;
  let removedLeafCount = 0;

  for (const [leafId, nextHash] of nextById) {
    const previousHash = previousById.get(leafId);
    if (previousHash === undefined) {
      addedLeafCount += 1;
      changedLeafIds.add(leafId);
      continue;
    }
    if (previousHash === nextHash) {
      unchangedLeafCount += 1;
    } else {
      changedLeafIds.add(leafId);
    }
  }

  for (const leafId of previousById.keys()) {
    if (!nextById.has(leafId)) {
      removedLeafCount += 1;
      changedLeafIds.add(leafId);
    }
  }

  return {
    changedLeafCount: changedLeafIds.size,
    unchangedLeafCount,
    addedLeafCount,
    removedLeafCount,
    changedLeafIds: Array.from(changedLeafIds).sort((left, right) => left.localeCompare(right)),
  };
}

function computeTheoremLeafSemanticHash(leaf: TheoremLeafRecord): string {
  return computeCanonicalRequestHash({
    id: leaf.id,
    declarationId: leaf.declarationId,
    modulePath: leaf.modulePath,
    declarationName: leaf.declarationName,
    theoremKind: leaf.theoremKind,
    statementText: leaf.statementText,
    prettyStatement: leaf.prettyStatement,
    tags: leaf.tags,
    dependencyIds: leaf.dependencyIds,
  });
}

function computeTheoremLeafStructureHash(leaf: TheoremLeafRecord): string {
  return computeCanonicalRequestHash({
    id: leaf.id,
    declarationId: leaf.declarationId,
    modulePath: leaf.modulePath,
    declarationName: leaf.declarationName,
    theoremKind: leaf.theoremKind,
    dependencyIds: leaf.dependencyIds,
  });
}

async function rebuildSnapshotForChangedLeaves(input: {
  snapshot: TreeStorageSnapshot;
  proofId: string;
  leaves: TheoremLeafRecord[];
  changedLeafIds: string[];
  config: ExplanationConfig;
}): Promise<
  | {
      tree: ExplanationTree;
      snapshot: TreeStorageSnapshot;
      snapshotHash: string;
      affectedParentCount: number;
      reusedNodeCount: number;
    }
  | undefined
> {
  if (input.changedLeafIds.length === 0) {
    return undefined;
  }

  const previousLeafById = new Map(input.snapshot.leafRecords.map((leaf) => [leaf.id, leaf]));
  const nextLeafById = new Map(input.leaves.map((leaf) => [leaf.id, leaf]));
  if (previousLeafById.size !== nextLeafById.size) {
    return undefined;
  }

  for (const [leafId, previousLeaf] of previousLeafById) {
    const nextLeaf = nextLeafById.get(leafId);
    if (!nextLeaf) {
      return undefined;
    }
    if (computeTheoremLeafStructureHash(previousLeaf) !== computeTheoremLeafStructureHash(nextLeaf)) {
      return undefined;
    }
  }

  const imported = importTreeStorageSnapshot(input.snapshot);
  const hasImportErrors = imported.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (hasImportErrors || !imported.tree) {
    return undefined;
  }

  const treeNodes: Record<string, ExplanationTree["nodes"][string]> = {};
  for (const node of Object.values(imported.tree.nodes)) {
    treeNodes[node.id] = {
      ...node,
      childIds: node.childIds.slice(),
      evidenceRefs: node.evidenceRefs.slice(),
      newTermsIntroduced: node.newTermsIntroduced?.slice(),
      policyDiagnostics: node.policyDiagnostics
        ? {
            depth: node.policyDiagnostics.depth,
            groupIndex: node.policyDiagnostics.groupIndex,
            retriesUsed: node.policyDiagnostics.retriesUsed,
            preSummary: {
              ...node.policyDiagnostics.preSummary,
              violations: node.policyDiagnostics.preSummary.violations.map((violation) => ({ ...violation })),
              metrics: { ...node.policyDiagnostics.preSummary.metrics },
            },
            postSummary: {
              ...node.policyDiagnostics.postSummary,
              violations: node.policyDiagnostics.postSummary.violations.map((violation) => ({ ...violation })),
              metrics: { ...node.policyDiagnostics.postSummary.metrics },
            },
          }
        : undefined,
    };
  }

  const parentByChildId = new Map<string, string>();
  for (const node of Object.values(treeNodes)) {
    for (const childId of node.childIds) {
      parentByChildId.set(childId, node.id);
    }
  }

  for (const leafId of input.changedLeafIds) {
    const node = treeNodes[leafId];
    const leaf = nextLeafById.get(leafId);
    if (!node || node.kind !== "leaf" || !leaf) {
      return undefined;
    }
    node.statement = leaf.prettyStatement;
    node.evidenceRefs = [leaf.id];
  }

  const affectedParents = collectAncestorParents(input.changedLeafIds, parentByChildId, treeNodes);
  if (affectedParents.length === 0) {
    return undefined;
  }

  const leafById = new Map(
    input.leaves.map((leaf) => [
      leaf.id,
      {
        prerequisiteIds: leaf.dependencyIds,
      },
    ]),
  );
  const provider = createDeterministicSummaryProvider();
  const policyDiagnosticsByParent: ExplanationTree["policyDiagnosticsByParent"] = {
    ...imported.tree.policyDiagnosticsByParent,
  };

  for (const parentId of affectedParents) {
    const parentNode = treeNodes[parentId];
    if (!parentNode || parentNode.kind !== "parent") {
      return undefined;
    }
    const groupIndex = parentNode.policyDiagnostics?.groupIndex ?? parseParentGroupIndex(parentNode.id);
    const children = parentNode.childIds.map((childId) => {
      const child = treeNodes[childId];
      if (!child) {
        throw new Error(`Missing child node '${childId}' while rebuilding parent '${parentId}'.`);
      }
      return {
        id: child.id,
        statement: child.statement,
        complexity: child.complexityScore,
        prerequisiteIds: child.kind === "leaf" ? leafById.get(child.id)?.prerequisiteIds : [],
      };
    });
    const preSummaryDecision = evaluatePreSummaryPolicy(children, input.config);
    if (!preSummaryDecision.ok) {
      throw new TreePolicyError("Pre-summary pedagogical policy failed during incremental subtree rebuild.", {
        depth: parentNode.depth,
        groupIndex,
        retriesUsed: 0,
        preSummary: preSummaryDecision,
        postSummary: {
          ok: true,
          violations: [],
          metrics: {
            complexitySpread: 0,
            prerequisiteOrderViolations: 0,
            introducedTermCount: 0,
            evidenceCoverageRatio: 1,
            vocabularyContinuityRatio: 1,
            vocabularyContinuityFloor: 1,
          },
        },
      });
    }
    const parentSummary = await generatePolicyCompliantParentSummary(
      provider,
      children,
      input.config,
      parentNode.depth,
      groupIndex,
      preSummaryDecision,
    );
    parentNode.statement = parentSummary.summary.parent_statement;
    parentNode.complexityScore = parentSummary.summary.complexity_score;
    parentNode.abstractionScore = parentSummary.summary.abstraction_score;
    parentNode.confidence = parentSummary.summary.confidence;
    parentNode.whyTrueFromChildren = parentSummary.summary.why_true_from_children;
    parentNode.newTermsIntroduced = parentSummary.summary.new_terms_introduced.slice();
    parentNode.evidenceRefs = parentSummary.summary.evidence_refs.slice();
    parentNode.policyDiagnostics = parentSummary.policyDiagnostics;
    policyDiagnosticsByParent[parentId] = parentSummary.policyDiagnostics;
  }

  const tree: ExplanationTree = {
    rootId: imported.tree.rootId,
    leafIds: imported.tree.leafIds.slice(),
    nodes: treeNodes,
    configHash: computeConfigHash(input.config),
    groupPlan: imported.tree.groupPlan.slice(),
    groupingDiagnostics: imported.tree.groupingDiagnostics.slice(),
    policyDiagnosticsByParent,
    maxDepth: imported.tree.maxDepth,
  };
  const validation = validateExplanationTree(tree, input.config.maxChildrenPerParent);
  if (!validation.ok) {
    throw new Error(
      `Incremental subtree rebuild validation failed: ${validation.issues.map((issue) => issue.code).join(", ")}`,
    );
  }

  const snapshot = exportTreeStorageSnapshot(tree, {
    proofId: input.proofId,
    leaves: input.leaves,
    config: input.config,
  });
  return {
    tree,
    snapshot,
    snapshotHash: computeTreeStorageSnapshotHash(snapshot),
    affectedParentCount: affectedParents.length,
    reusedNodeCount: Object.keys(treeNodes).length - affectedParents.length,
  };
}

interface ParentSummaryRecord {
  childStatementHash: string;
  childStatementTextHash?: string;
  frontierLeafIdHash?: string;
  frontierLeafStatementHash?: string;
  summary: {
    parent_statement: string;
    why_true_from_children: string;
    new_terms_introduced: string[];
    complexity_score: number;
    abstraction_score: number;
    evidence_refs: string[];
    confidence: number;
  };
  policyDiagnostics?: ExplanationTree["policyDiagnosticsByParent"][string];
}

async function rebuildSnapshotWithParentSummaryReuse(input: {
  previousSnapshot: TreeStorageSnapshot;
  proofId: string;
  leaves: TheoremLeafRecord[];
  changedLeafIds: string[];
  config: ExplanationConfig;
}): Promise<
  | {
      tree: ExplanationTree;
      snapshot: TreeStorageSnapshot;
      snapshotHash: string;
      reusedParentSummaryCount: number;
      generatedParentSummaryCount: number;
      reusedParentNodeCount: number;
      generatedParentNodeCount: number;
      reusedParentByStableIdCount: number;
      reusedParentByChildHashCount: number;
      reusedParentByChildStatementHashCount: number;
      reusedParentByFrontierChildHashCount: number;
      reusedParentByFrontierChildStatementHashCount: number;
      skippedAmbiguousChildHashReuseCount: number;
      skippedAmbiguousChildStatementHashReuseCount: number;
      frontierPartitionLeafCount: number;
      frontierPartitionBlockedGroupCount: number;
      frontierPartitionRecoveredLeafCount: number;
      frontierPartitionRecoveredSummaryCount: number;
      frontierPartitionRecoveryPassCount: number;
      frontierPartitionRecoveryScheduledGroupCount: number;
      frontierPartitionRecoveryStrategy: "minimal_hitting_set_greedy";
      frontierPartitionFallbackUsed: boolean;
      previousParentCount: number;
      nextParentCount: number;
    }
  | undefined
> {
  const imported = importTreeStorageSnapshot(input.previousSnapshot);
  const hasImportErrors = imported.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  if (hasImportErrors || !imported.tree) {
    return undefined;
  }

  const reusableParentSummaries = buildReusableParentSummaryMap(imported.tree);
  const nextLeafIdSet = new Set(input.leaves.map((leaf) => leaf.id));
  const changedFrontierLeafIds = input.changedLeafIds
    .filter((leafId) => nextLeafIdSet.has(leafId))
    .sort((left, right) => left.localeCompare(right));
  let frontierPartitionFallbackUsed = false;
  let frontierPartitionBlockedGroupCount = 0;
  let frontierPartitionRecoveredLeafCount = 0;
  let frontierPartitionRecoveredSummaryCount = 0;
  let frontierPartitionRecoveryPassCount = 0;
  let frontierPartitionRecoveryScheduledGroupCount = 0;
  let recoveryReusableParentSummaries = { ...reusableParentSummaries };

  let tree: ExplanationTree | undefined;
  const nextLeafIdSetForRecovery = new Set(input.leaves.map((leaf) => leaf.id));
  let frontierLeafIds = changedFrontierLeafIds.slice();
  if (frontierLeafIds.length > 0) {
    for (;;) {
      try {
        tree = await buildRecursiveExplanationTree(createDeterministicSummaryProvider(), {
          leaves: mapTheoremLeavesToTreeLeaves(input.leaves),
          config: input.config,
          reusableParentSummaries: recoveryReusableParentSummaries,
          generationFrontierLeafIds: frontierLeafIds,
        });
        break;
      } catch (error) {
        if (!(error instanceof TreeFrontierPartitionError)) {
          throw error;
        }
        frontierPartitionRecoveredSummaryCount += mergeRecoveryReusableSummaries(
          recoveryReusableParentSummaries,
          error.reusableParentSummaries,
        );
        frontierPartitionBlockedGroupCount += error.blockedGroups.length;
        const scheduledExpansion = selectMinimalBlockedFrontierExpansion({
          blockedGroups: error.blockedGroups,
          frontierLeafIdSet: new Set(frontierLeafIds),
          availableLeafIdSet: nextLeafIdSetForRecovery,
        });
        if (!scheduledExpansion) {
          frontierPartitionFallbackUsed = true;
          break;
        }
        frontierPartitionRecoveryScheduledGroupCount += scheduledExpansion.scheduledGroupCount;
        frontierPartitionRecoveryPassCount += 1;
        frontierPartitionRecoveredLeafCount += scheduledExpansion.expandedLeafIds.length;
        frontierLeafIds = scheduledExpansion.nextFrontierLeafIds;
      }
    }
  }
  if (!tree) {
    tree = await buildRecursiveExplanationTree(createDeterministicSummaryProvider(), {
      leaves: mapTheoremLeavesToTreeLeaves(input.leaves),
      config: input.config,
      reusableParentSummaries: recoveryReusableParentSummaries,
    });
  }
  if (!tree) {
    throw new Error("Topology-aware rebuild failed to produce a tree.");
  }
  const builtTree = tree;
  const validation = validateExplanationTree(builtTree, input.config.maxChildrenPerParent);
  if (!validation.ok) {
    throw new Error(
      `Topology-aware rebuild validation failed: ${validation.issues.map((issue) => issue.code).join(", ")}`,
    );
  }

  const snapshot = exportTreeStorageSnapshot(builtTree, {
    proofId: input.proofId,
    leaves: input.leaves,
    config: input.config,
  });
  const reuseStats = summarizeTreeSummaryReuse(builtTree.groupingDiagnostics);
  return {
    tree: builtTree,
    snapshot,
    snapshotHash: computeTreeStorageSnapshotHash(snapshot),
    reusedParentSummaryCount: reuseStats.reusedGroupCount,
    generatedParentSummaryCount: reuseStats.generatedGroupCount,
    reusedParentNodeCount: reuseStats.reusedGroupCount,
    generatedParentNodeCount: reuseStats.generatedGroupCount,
    reusedParentByStableIdCount: reuseStats.reusedByParentIdGroupCount,
    reusedParentByChildHashCount: reuseStats.reusedByChildHashGroupCount,
    reusedParentByChildStatementHashCount: reuseStats.reusedByChildStatementHashGroupCount,
    reusedParentByFrontierChildHashCount: reuseStats.reusedByFrontierChildHashGroupCount,
    reusedParentByFrontierChildStatementHashCount: reuseStats.reusedByFrontierChildStatementHashGroupCount,
    skippedAmbiguousChildHashReuseCount: reuseStats.skippedAmbiguousChildHashGroupCount,
    skippedAmbiguousChildStatementHashReuseCount: reuseStats.skippedAmbiguousChildStatementHashGroupCount,
    frontierPartitionLeafCount: changedFrontierLeafIds.length,
    frontierPartitionBlockedGroupCount,
    frontierPartitionRecoveredLeafCount,
    frontierPartitionRecoveredSummaryCount,
    frontierPartitionRecoveryPassCount,
    frontierPartitionRecoveryScheduledGroupCount,
    frontierPartitionRecoveryStrategy: "minimal_hitting_set_greedy",
    frontierPartitionFallbackUsed,
    previousParentCount: Object.values(imported.tree.nodes).filter((node) => node.kind === "parent").length,
    nextParentCount: Object.values(builtTree.nodes).filter((node) => node.kind === "parent").length,
  };
}

export function selectMinimalBlockedFrontierExpansion(input: {
  blockedGroups: TreeFrontierPartitionError["blockedGroups"];
  frontierLeafIdSet: Set<string>;
  availableLeafIdSet: Set<string>;
}):
  | {
      expandedLeafIds: string[];
      nextFrontierLeafIds: string[];
      scheduledGroupCount: number;
    }
  | undefined {
  const frontierLeafIdSet = new Set(input.frontierLeafIdSet);
  const blockedGroups = input.blockedGroups
    .map((blockedGroup) => ({
      blockedGroup,
      candidateLeafIds: blockedGroup.frontierLeafIds
        .filter((leafId) => input.availableLeafIdSet.has(leafId) && !frontierLeafIdSet.has(leafId))
        .sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => compareBlockedGroups(left.blockedGroup, right.blockedGroup));

  if (blockedGroups.length === 0) {
    return undefined;
  }

  if (blockedGroups.some((group) => group.candidateLeafIds.length === 0)) {
    return undefined;
  }

  const remaining = blockedGroups.slice();
  const expandedLeafIds = new Set<string>();
  let scheduledGroupCount = 0;

  while (remaining.length > 0) {
    const coverage = new Map<string, number>();

    for (const group of remaining) {
      for (const leafId of group.candidateLeafIds) {
        coverage.set(leafId, (coverage.get(leafId) ?? 0) + 1);
      }
    }

    const selectedLeafId = [...coverage.entries()]
      .sort((left, right) => {
        if (left[1] !== right[1]) {
          return right[1] - left[1];
        }
        return left[0].localeCompare(right[0]);
      })
      .map((entry) => entry[0])[0];

    if (!selectedLeafId) {
      return undefined;
    }

    expandedLeafIds.add(selectedLeafId);
    let nextIndex = 0;
    while (nextIndex < remaining.length) {
      if (remaining[nextIndex].candidateLeafIds.includes(selectedLeafId)) {
        remaining.splice(nextIndex, 1);
        scheduledGroupCount += 1;
      } else {
        nextIndex += 1;
      }
    }
  }

  const nextFrontier = new Set(frontierLeafIdSet);
  for (const leafId of expandedLeafIds) {
    nextFrontier.add(leafId);
  }

  return {
    expandedLeafIds: [...expandedLeafIds].sort((left, right) => left.localeCompare(right)),
    nextFrontierLeafIds: [...nextFrontier].sort((left, right) => left.localeCompare(right)),
    scheduledGroupCount,
  };
}

function compareBlockedGroups(
  left: TreeFrontierPartitionError["blockedGroups"][number],
  right: TreeFrontierPartitionError["blockedGroups"][number],
): number {
  if (left.depth !== right.depth) {
    return left.depth - right.depth;
  }
  if (left.groupIndex !== right.groupIndex) {
    return left.groupIndex - right.groupIndex;
  }
  return left.parentId.localeCompare(right.parentId);
}

function mergeRecoveryReusableSummaries(
  target: Record<string, ParentSummaryRecord>,
  injected: Record<string, ParentSummaryRecord>,
): number {
  let mergedCount = 0;
  const parentIds = Object.keys(injected).sort((left, right) => left.localeCompare(right));
  for (const parentId of parentIds) {
    const nextSummary = injected[parentId];
    const previousSummary = target[parentId];
    if (!previousSummary || !areParentSummaryRecordsEqual(previousSummary, nextSummary)) {
      target[parentId] = nextSummary;
      mergedCount += 1;
    }
  }
  return mergedCount;
}

function areParentSummaryRecordsEqual(left: ParentSummaryRecord, right: ParentSummaryRecord): boolean {
  return JSON.stringify(left, stableReplacer) === JSON.stringify(right, stableReplacer);
}

function buildReusableParentSummaryMap(tree: ExplanationTree): Record<string, ParentSummaryRecord> {
  const reusable: Record<string, ParentSummaryRecord> = {};
  const parents = Object.values(tree.nodes)
    .filter((node): node is ExplanationTree["nodes"][string] & { kind: "parent" } => node.kind === "parent")
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const parent of parents) {
    if (
      parent.whyTrueFromChildren === undefined ||
      parent.complexityScore === undefined ||
      parent.abstractionScore === undefined ||
      parent.confidence === undefined
    ) {
      continue;
    }
    const children: Array<{ id: string; statement: string }> = [];
    let missingChild = false;
    for (const childId of parent.childIds) {
      const child = tree.nodes[childId];
      if (!child) {
        missingChild = true;
        break;
      }
      children.push({ id: child.id, statement: child.statement });
    }
    if (missingChild) {
      continue;
    }
    const summary: ParentSummaryRecord = {
      childStatementHash: computeChildStatementHash(children),
      childStatementTextHash: computeChildStatementTextHash(children),
      frontierLeafIdHash: computeFrontierLeafIdHash(parent.id, tree.nodes),
      frontierLeafStatementHash: computeFrontierLeafStatementHash(parent.id, tree.nodes),
      summary: {
        parent_statement: parent.statement,
        why_true_from_children: parent.whyTrueFromChildren,
        new_terms_introduced: (parent.newTermsIntroduced ?? []).slice(),
        complexity_score: parent.complexityScore,
        abstraction_score: parent.abstractionScore,
        evidence_refs: parent.evidenceRefs.slice(),
        confidence: parent.confidence,
      },
      policyDiagnostics: parent.policyDiagnostics,
    };
    reusable[parent.id] = summary;
  }
  return reusable;
}

function computeChildStatementHash(
  children: Array<{ id: string; statement: string }>,
): string {
  return createHash("sha256")
    .update(children.map((child) => `${child.id}:${child.statement}`).join("\n"))
    .digest("hex");
}

function summarizeTreeSummaryReuse(groupingDiagnostics: ExplanationTree["groupingDiagnostics"]): {
  reusedGroupCount: number;
  generatedGroupCount: number;
  reusedByParentIdGroupCount: number;
  reusedByChildHashGroupCount: number;
  reusedByChildStatementHashGroupCount: number;
  reusedByFrontierChildHashGroupCount: number;
  reusedByFrontierChildStatementHashGroupCount: number;
  skippedAmbiguousChildHashGroupCount: number;
  skippedAmbiguousChildStatementHashGroupCount: number;
} {
  let reusedGroupCount = 0;
  let generatedGroupCount = 0;
  let reusedByParentIdGroupCount = 0;
  let reusedByChildHashGroupCount = 0;
  let reusedByChildStatementHashGroupCount = 0;
  let reusedByFrontierChildHashGroupCount = 0;
  let reusedByFrontierChildStatementHashGroupCount = 0;
  let skippedAmbiguousChildHashGroupCount = 0;
  let skippedAmbiguousChildStatementHashGroupCount = 0;
  for (const layer of groupingDiagnostics) {
    reusedGroupCount += layer.summaryReuse?.reusedGroupIndexes.length ?? 0;
    generatedGroupCount += layer.summaryReuse?.generatedGroupIndexes.length ?? 0;
    reusedByParentIdGroupCount += layer.summaryReuse?.reusedByParentIdGroupIndexes?.length ?? 0;
    reusedByChildHashGroupCount += layer.summaryReuse?.reusedByChildHashGroupIndexes?.length ?? 0;
    reusedByChildStatementHashGroupCount += layer.summaryReuse?.reusedByChildStatementHashGroupIndexes?.length ?? 0;
    reusedByFrontierChildHashGroupCount += layer.summaryReuse?.reusedByFrontierChildHashGroupIndexes?.length ?? 0;
    reusedByFrontierChildStatementHashGroupCount +=
      layer.summaryReuse?.reusedByFrontierChildStatementHashGroupIndexes?.length ?? 0;
    skippedAmbiguousChildHashGroupCount += layer.summaryReuse?.skippedAmbiguousChildHashGroupIndexes?.length ?? 0;
    skippedAmbiguousChildStatementHashGroupCount +=
      layer.summaryReuse?.skippedAmbiguousChildStatementHashGroupIndexes?.length ?? 0;
  }
  return {
    reusedGroupCount,
    generatedGroupCount,
    reusedByParentIdGroupCount,
    reusedByChildHashGroupCount,
    reusedByChildStatementHashGroupCount,
    reusedByFrontierChildHashGroupCount,
    reusedByFrontierChildStatementHashGroupCount,
    skippedAmbiguousChildHashGroupCount,
    skippedAmbiguousChildStatementHashGroupCount,
  };
}

function computeChildStatementTextHash(children: Array<{ statement: string }>): string {
  return createHash("sha256")
    .update(children.map((child, index) => `${index}:${child.statement}`).join("\n"))
    .digest("hex");
}

function computeFrontierLeafIdHash(
  nodeId: string,
  nodes: Record<string, ExplanationTree["nodes"][string]>,
): string {
  const leaves = collectFrontierLeaves(nodeId, nodes).map((leaf) => leaf.id);
  return createHash("sha256")
    .update(leaves.map((leafId, index) => `${index}:${leafId}`).join("\n"))
    .digest("hex");
}

function computeFrontierLeafStatementHash(
  nodeId: string,
  nodes: Record<string, ExplanationTree["nodes"][string]>,
): string {
  const statements = collectFrontierLeaves(nodeId, nodes).map((leaf) => leaf.statement);
  return createHash("sha256")
    .update(statements.map((statement, index) => `${index}:${statement}`).join("\n"))
    .digest("hex");
}

function collectFrontierLeaves(
  nodeId: string,
  nodes: Record<string, ExplanationTree["nodes"][string]>,
): Array<{ id: string; statement: string }> {
  const node = nodes[nodeId];
  if (!node) {
    throw new Error(`Missing node '${nodeId}' while collecting frontier leaves.`);
  }
  if (node.kind === "leaf") {
    return [{ id: node.id, statement: node.statement }];
  }
  const leaves: Array<{ id: string; statement: string }> = [];
  for (const childId of node.childIds) {
    leaves.push(...collectFrontierLeaves(childId, nodes));
  }
  return leaves;
}

function parseParentGroupIndex(parentId: string): number {
  const match = parentId.match(/^p_\d+_(\d+)_/);
  if (!match) {
    return 0;
  }
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function collectAncestorParents(
  changedLeafIds: string[],
  parentByChildId: Map<string, string>,
  nodes: Record<string, ExplanationTree["nodes"][string]>,
): string[] {
  const affected = new Set<string>();
  for (const leafId of changedLeafIds) {
    let cursor = parentByChildId.get(leafId);
    while (cursor) {
      affected.add(cursor);
      cursor = parentByChildId.get(cursor);
    }
  }
  return Array.from(affected).sort((left, right) => {
    const depthDelta = (nodes[left]?.depth ?? 0) - (nodes[right]?.depth ?? 0);
    if (depthDelta !== 0) {
      return depthDelta;
    }
    return left.localeCompare(right);
  });
}

async function generatePolicyCompliantParentSummary(
  provider: ProviderClient,
  children: Array<{ id: string; statement: string; complexity?: number; prerequisiteIds?: string[] }>,
  config: ExplanationConfig,
  depth: number,
  groupIndex: number,
  preSummaryDecision: ReturnType<typeof evaluatePreSummaryPolicy>,
): Promise<{
  summary: Awaited<ReturnType<typeof generateParentSummary>>["summary"];
  policyDiagnostics: ExplanationTree["policyDiagnosticsByParent"][string];
}> {
  const maxAttempts = 2;
  let lastPostSummary = evaluatePostSummaryPolicy(children, emptySummary(children), config);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await generateParentSummary(provider, {
        children,
        config,
        systemPrompt:
          attempt === 0
            ? undefined
            : [
                "You are a proof-grounded summarizer.",
                "Use only child-grounded vocabulary except declared new_terms_introduced.",
                "Cite every child ID in evidence_refs.",
                "Keep parent claims explicitly entailed by child statements.",
                "Output strict JSON only.",
              ].join(" "),
      });

      const postSummaryDecision = evaluatePostSummaryPolicy(children, result.summary, config);
      lastPostSummary = postSummaryDecision;
      if (postSummaryDecision.ok) {
        return {
          summary: result.summary,
          policyDiagnostics: {
            depth,
            groupIndex,
            retriesUsed: attempt,
            preSummary: preSummaryDecision,
            postSummary: postSummaryDecision,
          },
        };
      }
    } catch (error) {
      if (error instanceof SummaryValidationError) {
        lastPostSummary = {
          ok: false,
          violations: error.diagnostics.violations.map((violation) => mapCriticViolationToPolicyViolation(violation)),
          metrics: {
            complexitySpread: 0,
            prerequisiteOrderViolations: 0,
            introducedTermCount: 0,
            evidenceCoverageRatio: 0,
            vocabularyContinuityRatio: 0,
            vocabularyContinuityFloor: 1,
          },
        };
      } else {
        throw error;
      }
    }
  }

  throw new TreePolicyError("Failed to produce a policy-compliant parent summary after deterministic retries.", {
    depth,
    groupIndex,
    retriesUsed: maxAttempts - 1,
    preSummary: preSummaryDecision,
    postSummary: lastPostSummary,
  });
}

function mapCriticViolationToPolicyViolation(
  violation: SummaryValidationError["diagnostics"]["violations"][number],
): ReturnType<typeof evaluatePostSummaryPolicy>["violations"][number] {
  switch (violation.code) {
    case "term_budget":
      return { code: "term_budget", message: violation.message, details: violation.details };
    case "evidence_refs":
      return { code: "evidence_coverage", message: violation.message, details: violation.details };
    case "schema":
    case "complexity_band":
    case "unsupported_terms":
      return { code: "vocabulary_continuity", message: violation.message, details: violation.details };
    default: {
      const exhaustiveCheck: never = violation.code;
      throw new Error(`Unhandled critic violation code: ${String(exhaustiveCheck)}`);
    }
  }
}

function emptySummary(children: Array<{ id: string }>): {
  parent_statement: string;
  why_true_from_children: string;
  new_terms_introduced: string[];
  complexity_score: number;
  abstraction_score: number;
  evidence_refs: string[];
  confidence: number;
} {
  return {
    parent_statement: "",
    why_true_from_children: "",
    new_terms_introduced: [],
    complexity_score: 0,
    abstraction_score: 0,
    evidence_refs: children.map((child) => child.id),
    confidence: 0,
  };
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
