export interface ProofConfigInput {
  abstractionLevel?: number;
  complexityLevel?: number;
  maxChildrenPerParent?: number;
  audienceLevel?: "novice" | "intermediate" | "expert";
  language?: string;
  readingLevelTarget?: "elementary" | "middle_school" | "high_school" | "undergraduate" | "graduate";
  complexityBandWidth?: number;
  termIntroductionBudget?: number;
  proofDetailMode?: "minimal" | "balanced" | "formal";
  modelProvider?: {
    provider?: string;
    endpoint?: string;
    model?: string;
    apiKeyEnvVar?: string;
    timeoutMs?: number;
    maxRetries?: number;
    retryBaseDelayMs?: number;
    temperature?: number;
    maxOutputTokens?: number;
  };
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
    details?: unknown;
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
  if (config.readingLevelTarget) {
    params.set("readingLevelTarget", config.readingLevelTarget);
  }
  if (config.complexityBandWidth !== undefined) {
    params.set("complexityBandWidth", String(config.complexityBandWidth));
  }
  if (config.termIntroductionBudget !== undefined) {
    params.set("termIntroductionBudget", String(config.termIntroductionBudget));
  }
  if (config.proofDetailMode) {
    params.set("proofDetailMode", config.proofDetailMode);
  }
  if (config.modelProvider?.provider) {
    params.set("modelProvider.provider", config.modelProvider.provider);
  }
  if (config.modelProvider?.endpoint) {
    params.set("modelProvider.endpoint", config.modelProvider.endpoint);
  }
  if (config.modelProvider?.model) {
    params.set("modelProvider.model", config.modelProvider.model);
  }
  if (config.modelProvider?.apiKeyEnvVar) {
    params.set("modelProvider.apiKeyEnvVar", config.modelProvider.apiKeyEnvVar);
  }
  if (config.modelProvider?.timeoutMs !== undefined) {
    params.set("modelProvider.timeoutMs", String(config.modelProvider.timeoutMs));
  }
  if (config.modelProvider?.maxRetries !== undefined) {
    params.set("modelProvider.maxRetries", String(config.modelProvider.maxRetries));
  }
  if (config.modelProvider?.retryBaseDelayMs !== undefined) {
    params.set("modelProvider.retryBaseDelayMs", String(config.modelProvider.retryBaseDelayMs));
  }
  if (config.modelProvider?.temperature !== undefined) {
    params.set("modelProvider.temperature", String(config.modelProvider.temperature));
  }
  if (config.modelProvider?.maxOutputTokens !== undefined) {
    params.set("modelProvider.maxOutputTokens", String(config.modelProvider.maxOutputTokens));
  }

  return requestJson<LeafDetailResponse>(`/api/proofs/leaves/${encodeURIComponent(leafId)}?${params.toString()}`);
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
