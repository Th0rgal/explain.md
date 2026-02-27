export interface ProofConfigInput {
  abstractionLevel?: number;
  complexityLevel?: number;
  maxChildrenPerParent?: number;
  audienceLevel?: "novice" | "intermediate" | "expert";
  language?: string;
  termIntroductionBudget?: number;
}

interface ApiSuccess<T> {
  ok: true;
  data: T;
}

interface ApiFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export interface ProofCatalogResponse {
  proofs: Array<{
    proofId: string;
    title: string;
    rootStatement: string;
    configHash: string;
    rootId: string;
    leafCount: number;
    maxDepth: number;
  }>;
}

export interface TreeNodeRecord {
  id: string;
  kind: "leaf" | "parent";
  statement: string;
  depth: number;
  childIds: string[];
  evidenceRefs: string[];
  complexityScore?: number;
  abstractionScore?: number;
  confidence?: number;
  whyTrueFromChildren?: string;
  newTermsIntroduced: string[];
}

interface TreeStorageDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface ProjectionResponse {
  proofId: string;
  config: Record<string, unknown>;
  configHash: string;
  requestHash: string;
  viewHash: string;
  view: {
    rootId: string;
    expandedNodeIds: string[];
    visibleNodes: Array<{
      id: string;
      kind: "leaf" | "parent";
      depthFromRoot: number;
      parentId?: string;
      statement: string;
      evidenceRefs: string[];
      isExpanded: boolean;
      isExpandable: boolean;
      childCount: number;
      visibleChildIds: string[];
      hiddenChildCount: number;
    }>;
    diagnostics: Array<{ code: string; severity: string; message: string }>;
  };
}

export interface DiffResponse {
  proofId: string;
  requestHash: string;
  diffHash: string;
  report: {
    summary: {
      total: number;
      added: number;
      removed: number;
      changed: number;
    };
    changes: Array<{
      key: string;
      type: "added" | "removed" | "changed";
      kind: "leaf" | "parent";
      supportLeafIds: string[];
      baselineStatement?: string;
      candidateStatement?: string;
    }>;
  };
}

export interface RootResponse {
  proofId: string;
  configHash: string;
  requestHash: string;
  snapshotHash: string;
  root: {
    node?: TreeNodeRecord;
    diagnostics: TreeStorageDiagnostic[];
  };
}

export interface NodeChildrenResponse {
  proofId: string;
  configHash: string;
  requestHash: string;
  snapshotHash: string;
  children: {
    parent: TreeNodeRecord;
    totalChildren: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    children: TreeNodeRecord[];
    diagnostics: TreeStorageDiagnostic[];
  };
}

export interface NodePathResponse {
  proofId: string;
  configHash: string;
  requestHash: string;
  snapshotHash: string;
  path: {
    ok: boolean;
    nodeId: string;
    path: TreeNodeRecord[];
    diagnostics: TreeStorageDiagnostic[];
  };
}

export interface LeafDetailResponse {
  ok: boolean;
  proofId: string;
  requestHash: string;
  configHash?: string;
  detailHash?: string;
  view?: {
    leaf: {
      id: string;
      declarationId: string;
      statementText: string;
      sourceUrl?: string;
    };
    shareReference: {
      compact: string;
      markdown: string;
      sourceUrl?: string;
    };
    verification: {
      summary: {
        totalJobs: number;
        latestStatus?: string;
      };
    };
  };
  diagnostics?: Array<{ code: string; severity: string; message: string }>;
}

export async function fetchProofCatalog(): Promise<ProofCatalogResponse> {
  return requestJson<ProofCatalogResponse>("/api/proofs/seed");
}

export async function fetchProjection(payload: {
  proofId: string;
  config?: ProofConfigInput;
  expandedNodeIds?: string[];
  maxChildrenPerExpandedNode?: number;
}): Promise<ProjectionResponse> {
  return requestJson<ProjectionResponse>("/api/proofs/view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchDiff(payload: {
  proofId: string;
  baselineConfig: ProofConfigInput;
  candidateConfig: ProofConfigInput;
}): Promise<DiffResponse> {
  return requestJson<DiffResponse>("/api/proofs/diff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchLeafDetail(proofId: string, leafId: string, config: ProofConfigInput): Promise<LeafDetailResponse> {
  const params = toConfigSearchParams(proofId, config);
  return requestJson<LeafDetailResponse>(`/api/proofs/leaves/${encodeURIComponent(leafId)}?${params.toString()}`);
}

export async function fetchRoot(proofId: string, config: ProofConfigInput): Promise<RootResponse> {
  const params = toConfigSearchParams(proofId, config);
  return requestJson<RootResponse>(`/api/proofs/root?${params.toString()}`);
}

export async function fetchNodeChildren(
  proofId: string,
  nodeId: string,
  config: ProofConfigInput,
  pagination: { offset?: number; limit?: number } = {},
): Promise<NodeChildrenResponse> {
  const params = toConfigSearchParams(proofId, config);
  if (pagination.offset !== undefined) {
    params.set("offset", String(pagination.offset));
  }
  if (pagination.limit !== undefined) {
    params.set("limit", String(pagination.limit));
  }
  return requestJson<NodeChildrenResponse>(`/api/proofs/nodes/${encodeURIComponent(nodeId)}/children?${params.toString()}`);
}

export async function fetchNodePath(proofId: string, nodeId: string, config: ProofConfigInput): Promise<NodePathResponse> {
  const params = toConfigSearchParams(proofId, config);
  return requestJson<NodePathResponse>(`/api/proofs/nodes/${encodeURIComponent(nodeId)}/path?${params.toString()}`);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !payload.ok) {
    const message = payload.ok ? `Request failed with status ${response.status}.` : payload.error.message;
    throw new Error(message);
  }

  return payload.data;
}

function toConfigSearchParams(proofId: string, config: ProofConfigInput): URLSearchParams {
  const params = new URLSearchParams({ proofId });
  if (config.abstractionLevel !== undefined) {
    params.set("abstractionLevel", String(config.abstractionLevel));
  }
  if (config.complexityLevel !== undefined) {
    params.set("complexityLevel", String(config.complexityLevel));
  }
  if (config.maxChildrenPerParent !== undefined) {
    params.set("maxChildrenPerParent", String(config.maxChildrenPerParent));
  }
  if (config.audienceLevel) {
    params.set("audienceLevel", config.audienceLevel);
  }
  if (config.language) {
    params.set("language", config.language);
  }
  if (config.termIntroductionBudget !== undefined) {
    params.set("termIntroductionBudget", String(config.termIntroductionBudget));
  }
  return params;
}
