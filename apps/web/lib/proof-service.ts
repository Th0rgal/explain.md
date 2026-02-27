import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  buildRecursiveExplanationTree,
  buildDeclarationDependencyGraph,
  computeDependencyGraphHash,
  computeLeanIngestionHash,
  ingestLeanSources,
  mapLeanIngestionToTheoremLeaves,
  mapTheoremLeavesToTreeLeaves,
  normalizeConfig,
  validateExplanationTree,
  type ExplanationTree,
  type ExplanationConfig,
  type ExplanationConfigInput,
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
}

interface ResolvedDataset {
  dataset: ProofDataset;
  queryApi: ReturnType<typeof createTreeQueryApi>;
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

export interface ProofCatalogEntry {
  proofId: string;
  title: string;
  rootStatement: string;
  configHash: string;
  rootId: string;
  leafCount: number;
  maxDepth: number;
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

export function findSeedLeaf(proofId: string, leafId: string) {
  const dataset = loadSeedDataset(proofId, {});
  return dataset.leaves.find((leaf) => leaf.id === leafId);
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
      },
      queryApi: createTreeQueryApi(snapshot),
    };
  }

  const fixtureProjectRoot = await resolveLeanFixtureProjectRoot();
  const sources = await Promise.all(
    LEAN_FIXTURE_PATHS.map(async (relativePath) => {
      const absolutePath = path.join(fixtureProjectRoot, relativePath);
      const content = await fs.readFile(absolutePath, "utf8");
      return {
        filePath: absolutePath,
        content,
      };
    }),
  );

  const ingestion = ingestLeanSources(fixtureProjectRoot, sources, {
    sourceBaseUrl: LEAN_FIXTURE_SOURCE_BASE_URL,
  });
  const ingestionHash = computeLeanIngestionHash(ingestion);
  const theoremLeaves = mapLeanIngestionToTheoremLeaves(ingestion);
  const dependencyGraph = buildDeclarationDependencyGraph(
    theoremLeaves.map((leaf) => ({ id: leaf.id, dependencyIds: leaf.dependencyIds })),
  );
  const dependencyGraphHash = computeDependencyGraphHash(dependencyGraph);

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

  const dataset: ProofDataset = {
    proofId,
    title: `Lean Verity fixture (${theoremLeaves.length} declarations, ingestion=${ingestionHash.slice(0, 8)}, depgraph=${dependencyGraphHash.slice(0, 8)})`,
    config,
    configHash,
    tree,
    leaves: theoremLeaves,
  };

  return {
    dataset,
    queryApi: createTreeQueryApi(snapshot),
  };
}

async function resolveLeanFixtureProjectRoot(): Promise<string> {
  const candidates = [
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
