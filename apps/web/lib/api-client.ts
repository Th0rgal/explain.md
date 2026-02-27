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
  entailmentMode?: "calibrated" | "strict";
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
  policyDiagnostics?: {
    depth: number;
    groupIndex: number;
    retriesUsed: number;
    preSummary: {
      ok: boolean;
      violations: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
      metrics: {
        complexitySpread: number;
        prerequisiteOrderViolations: number;
        introducedTermCount: number;
        evidenceCoverageRatio: number;
        vocabularyContinuityRatio: number;
        vocabularyContinuityFloor: number;
      };
    };
    postSummary: {
      ok: boolean;
      violations: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
      metrics: {
        complexitySpread: number;
        prerequisiteOrderViolations: number;
        introducedTermCount: number;
        evidenceCoverageRatio: number;
        vocabularyContinuityRatio: number;
        vocabularyContinuityFloor: number;
      };
    };
  };
}

interface TreeStorageDiagnostic {
  code: string;
  severity: "error" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

export interface ProofQueryObservability {
  requestId: string;
  traceId: string;
  query: "view" | "diff" | "leaf-detail" | "root" | "children" | "path" | "dependency-graph" | "policy-report" | "cache-report";
  spans: Array<{
    spanId: string;
    name: "dataset_load" | "query_compute" | "response_materialization";
    attributes: Record<string, boolean | number | string>;
  }>;
  metrics: {
    cacheLayer: "persistent" | "ephemeral";
    cacheStatus: "hit" | "miss";
    leafCount: number;
    parentCount: number;
    nodeCount: number;
    maxDepth: number;
  };
}

export interface ProofQueryObservabilityMetricsResponse {
  schemaVersion: "1.0.0";
  requestCount: number;
  uniqueRequestCount: number;
  uniqueTraceCount: number;
  cache: {
    hitCount: number;
    missCount: number;
    hitRate: number;
  };
  queries: Array<{
    query: "view" | "diff" | "leaf-detail" | "root" | "children" | "path" | "dependency-graph" | "policy-report" | "cache-report";
    requestCount: number;
    cacheHitCount: number;
    cacheMissCount: number;
    meanLeafCount: number;
    meanParentCount: number;
    meanNodeCount: number;
    maxDepth: number;
  }>;
  generatedAt: string;
  snapshotHash: string;
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
  observability?: ProofQueryObservability;
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
  observability?: ProofQueryObservability;
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
  observability?: ProofQueryObservability;
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
  observability?: ProofQueryObservability;
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
  observability?: ProofQueryObservability;
}

export interface DependencyGraphResponse {
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
  diagnostics: Array<{
    code: "declaration_not_found";
    severity: "error";
    message: string;
    details: Record<string, unknown>;
  }>;
  observability?: ProofQueryObservability;
}

export interface PolicyReportResponse {
  proofId: string;
  configHash: string;
  requestHash: string;
  reportHash: string;
  report: {
    rootId: string;
    configHash: string;
    generatedAt: string;
    metrics: {
      parentCount: number;
      unsupportedParentCount: number;
      prerequisiteViolationParentCount: number;
      policyViolationParentCount: number;
      introducedTermOverflowParentCount: number;
      unsupportedParentRate: number;
      prerequisiteViolationRate: number;
      policyViolationRate: number;
      meanComplexitySpread: number;
      maxComplexitySpread: number;
      meanEvidenceCoverage: number;
      meanVocabularyContinuity: number;
      meanTermJumpRate: number;
      supportCoverageFloor: number;
    };
    thresholds: {
      maxUnsupportedParentRate: number;
      maxPrerequisiteViolationRate: number;
      maxPolicyViolationRate: number;
      maxTermJumpRate: number;
      maxComplexitySpreadMean: number;
      minEvidenceCoverageMean: number;
      minVocabularyContinuityMean: number;
      minRepartitionEventRate: number;
      maxRepartitionEventRate: number;
      maxRepartitionMaxRound: number;
    };
    thresholdPass: boolean;
    thresholdFailures: PolicyThresholdFailure[];
    parentSamples: Array<{
      parentId: string;
      depth: number;
      childCount: number;
      complexitySpread: number;
      prerequisiteOrderViolations: number;
      evidenceCoverageRatio: number;
      vocabularyContinuityRatio: number;
      supportedClaimRatio: number;
      introducedTermCount: number;
      introducedTermRate: number;
      policyViolationCount: number;
    }>;
    depthMetrics: Array<{
      depth: number;
      parentCount: number;
      unsupportedParentRate: number;
      prerequisiteViolationRate: number;
      policyViolationRate: number;
      meanComplexitySpread: number;
      meanEvidenceCoverage: number;
      meanVocabularyContinuity: number;
      meanTermJumpRate: number;
    }>;
    repartitionMetrics: {
      eventCount: number;
      preSummaryEventCount: number;
      postSummaryEventCount: number;
      maxRound: number;
      depthMetrics: Array<{
        depth: number;
        eventCount: number;
        preSummaryEventCount: number;
        postSummaryEventCount: number;
        maxRound: number;
      }>;
    };
  };
  observability?: ProofQueryObservability;
}

export interface PolicyThresholdFailure {
  code: string;
  message: string;
  details: {
    actual: number;
    expected: number;
    comparator: "<=" | ">=";
  };
}

export interface CacheReportResponse {
  proofId: string;
  configHash: string;
  requestHash: string;
  cache: {
    layer: "persistent" | "ephemeral";
    status: "hit" | "miss";
    cacheKey: string;
    sourceFingerprint: string;
    cachePath?: string;
    snapshotHash: string;
    cacheEntryHash: string;
    diagnostics: Array<{
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
    }>;
    blockedSubtreePlan?: {
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
    };
  };
  observability?: ProofQueryObservability;
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
      sourceUrlOrigin: "leaf" | "source_span" | "missing";
    };
    verification: {
      summary: {
        totalJobs: number;
        latestStatus?: string;
        latestJobId?: string;
        statusCounts: Record<"queued" | "running" | "success" | "failure" | "timeout", number>;
      };
      jobs: Array<{
        jobId: string;
        queueSequence: number;
        status: "queued" | "running" | "success" | "failure" | "timeout";
        createdAt: string;
        startedAt?: string;
        finishedAt?: string;
        durationMs?: number;
        jobHash: string;
      }>;
    };
  };
  diagnostics?: Array<{ code: string; severity: string; message: string }>;
  observability?: ProofQueryObservability;
}

export interface VerificationJobsResponse {
  proofId: string;
  leafId: string;
  requestHash: string;
  jobs: Array<{
    jobId: string;
    queueSequence: number;
    status: "queued" | "running" | "success" | "failure" | "timeout";
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    result?: {
      exitCode: number | null;
      signal: string | null;
      durationMs: number;
      logsTruncated: boolean;
      logLineCount: number;
    };
    logs: Array<{
      index: number;
      stream: "stdout" | "stderr" | "system";
      message: string;
    }>;
    reproducibility: {
      sourceRevision: string;
      workingDirectory: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      toolchain: {
        leanVersion: string;
        lakeVersion?: string;
      };
    };
  }>;
  jobHashes: Array<{ jobId: string; hash: string }>;
  jobReplays: Array<{
    jobId: string;
    jobHash: string;
    reproducibilityHash: string;
    replayCommand: string;
  }>;
  observability?: VerificationQueryObservability;
}

export interface VerifyLeafResponse {
  requestHash: string;
  queuedJob: VerificationJobsResponse["jobs"][number];
  queuedJobHash: string;
  queuedJobReplay: VerificationJobsResponse["jobReplays"][number];
  finalJob: VerificationJobsResponse["jobs"][number];
  finalJobHash: string;
  finalJobReplay: VerificationJobsResponse["jobReplays"][number];
  observability?: VerificationQueryObservability;
}

export interface VerificationJobResponse {
  requestHash: string;
  job: VerificationJobsResponse["jobs"][number];
  jobHash: string;
  jobReplay: VerificationJobsResponse["jobReplays"][number];
  observability?: VerificationQueryObservability;
}

export interface VerificationQueryObservability {
  requestId: string;
  traceId: string;
  query: "verify_leaf" | "list_leaf_jobs" | "get_job";
  parentTraceId?: string;
  spans: Array<{
    spanId: string;
    name: "request_parse" | "workflow_execute" | "response_materialization";
    attributes: Record<string, boolean | number | string>;
  }>;
  metrics: {
    latencyMs: number;
    totalJobs: number;
    queueDepth: number;
    queuedJobs: number;
    runningJobs: number;
    successJobs: number;
    failureJobs: number;
    timeoutJobs: number;
    returnedJobCount: number;
    autoRun: boolean;
  };
}

export interface VerificationObservabilityMetricsResponse {
  schemaVersion: "1.0.0";
  requestCount: number;
  failureCount: number;
  correlation: {
    parentTraceProvidedCount: number;
    parentTraceProvidedRate: number;
  };
  queries: Array<{
    query: "verify_leaf" | "list_leaf_jobs" | "get_job";
    requestCount: number;
    failureCount: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    meanLatencyMs: number;
    p95LatencyMs: number;
  }>;
  generatedAt: string;
  snapshotHash: string;
}

export interface UiInteractionObservabilityMetricsResponse {
  schemaVersion: "1.0.0";
  requestCount: number;
  successCount: number;
  failureCount: number;
  uniqueTraceCount: number;
  correlation: {
    parentTraceProvidedCount: number;
    parentTraceProvidedRate: number;
  };
  interactions: Array<{
    interaction:
      | "config_update"
      | "tree_expand_toggle"
      | "tree_load_more"
      | "tree_select_leaf"
      | "tree_keyboard"
      | "verification_run"
      | "verification_job_select"
      | "profile_save"
      | "profile_delete"
      | "profile_apply";
    requestCount: number;
    successRate: number;
    meanDurationMs: number;
    p95DurationMs: number;
  }>;
  generatedAt: string;
  snapshotHash: string;
}

export interface ObservabilitySloThresholdsInput {
  minProofRequestCount?: number;
  minVerificationRequestCount?: number;
  minProofCacheHitRate?: number;
  minProofUniqueTraceRate?: number;
  maxVerificationFailureRate?: number;
  maxVerificationP95LatencyMs?: number;
  maxVerificationMeanLatencyMs?: number;
  minVerificationParentTraceRate?: number;
  minUiInteractionRequestCount?: number;
  minUiInteractionSuccessRate?: number;
  minUiInteractionParentTraceRate?: number;
  maxUiInteractionP95DurationMs?: number;
}

export interface ObservabilitySloReportResponse {
  schemaVersion: "1.0.0";
  thresholds: {
    minProofRequestCount: number;
    minVerificationRequestCount: number;
    minProofCacheHitRate: number;
    minProofUniqueTraceRate: number;
    maxVerificationFailureRate: number;
    maxVerificationP95LatencyMs: number;
    maxVerificationMeanLatencyMs: number;
    minVerificationParentTraceRate: number;
    minUiInteractionRequestCount: number;
    minUiInteractionSuccessRate: number;
    minUiInteractionParentTraceRate: number;
    maxUiInteractionP95DurationMs: number;
  };
  metrics: {
    proof: {
      requestCount: number;
      cacheHitRate: number;
      uniqueTraceRate: number;
    };
    verification: {
      requestCount: number;
      failureRate: number;
      maxP95LatencyMs: number;
      maxMeanLatencyMs: number;
      parentTraceProvidedRate: number;
    };
    uiInteraction: {
      requestCount: number;
      successRate: number;
      parentTraceProvidedRate: number;
      maxP95DurationMs: number;
    };
  };
  thresholdPass: boolean;
  thresholdFailures: Array<{
    code:
      | "proof_request_count_below_min"
      | "verification_request_count_below_min"
      | "proof_cache_hit_rate_below_min"
      | "proof_unique_trace_rate_below_min"
      | "verification_failure_rate_above_max"
      | "verification_p95_latency_above_max"
      | "verification_mean_latency_above_max"
      | "verification_parent_trace_rate_below_min"
      | "ui_interaction_request_count_below_min"
      | "ui_interaction_success_rate_below_min"
      | "ui_interaction_parent_trace_rate_below_min"
      | "ui_interaction_p95_duration_above_max";
    message: string;
    details: {
      metric: string;
      actual: number;
      expected: number;
      comparator: ">=" | "<=";
    };
  }>;
  proofSnapshotHash: string;
  verificationSnapshotHash: string;
  uiInteractionSnapshotHash: string;
  generatedAt: string;
  snapshotHash: string;
}

export interface ConfigProfilesResponse {
  projectId: string;
  userId: string;
  requestHash: string;
  ledgerHash: string;
  profiles: Array<{
    storageKey: string;
    profileId: string;
    projectId: string;
    userId: string;
    name: string;
    config: Record<string, unknown>;
    configHash: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface UpsertConfigProfileResponse {
  projectId: string;
  userId: string;
  profileId: string;
  requestHash: string;
  ledgerHash: string;
  profile: ConfigProfilesResponse["profiles"][number];
  regenerationPlan: {
    scope: "none" | "partial" | "full";
    changedFields: string[];
    reason: string;
  };
}

export interface DeleteConfigProfileResponse {
  projectId: string;
  userId: string;
  profileId: string;
  requestHash: string;
  ledgerHash: string;
  deleted: boolean;
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

export async function fetchDependencyGraph(
  proofId: string,
  config: ProofConfigInput,
  options: {
    declarationId?: string;
    includeExternalSupport?: boolean;
  } = {},
): Promise<DependencyGraphResponse> {
  const params = toConfigSearchParams(proofId, config);
  if (options.declarationId !== undefined) {
    params.set("declarationId", options.declarationId);
  }
  if (options.includeExternalSupport !== undefined) {
    params.set("includeExternalSupport", String(options.includeExternalSupport));
  }
  return requestJson<DependencyGraphResponse>(`/api/proofs/dependency-graph?${params.toString()}`);
}

export async function fetchPolicyReport(
  proofId: string,
  config: ProofConfigInput,
  thresholds: Partial<PolicyReportResponse["report"]["thresholds"]> = {},
): Promise<PolicyReportResponse> {
  const params = toConfigSearchParams(proofId, config);
  for (const [key, value] of Object.entries(thresholds)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return requestJson<PolicyReportResponse>(`/api/proofs/policy-report?${params.toString()}`);
}

export async function fetchCacheReport(proofId: string, config: ProofConfigInput): Promise<CacheReportResponse> {
  const params = toConfigSearchParams(proofId, config);
  return requestJson<CacheReportResponse>(`/api/proofs/cache-report?${params.toString()}`);
}

export async function verifyLeaf(
  proofId: string,
  leafId: string,
  autoRun = true,
  options: { parentTraceId?: string } = {},
): Promise<VerifyLeafResponse> {
  return requestJson<VerifyLeafResponse>(`/api/proofs/leaves/${encodeURIComponent(leafId)}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      proofId,
      autoRun,
      parentTraceId: options.parentTraceId,
    }),
  });
}

export async function fetchLeafVerificationJobs(
  proofId: string,
  leafId: string,
  options: { parentTraceId?: string } = {},
): Promise<VerificationJobsResponse> {
  const params = new URLSearchParams({ proofId });
  if (options.parentTraceId) {
    params.set("parentTraceId", options.parentTraceId);
  }
  return requestJson<VerificationJobsResponse>(
    `/api/proofs/leaves/${encodeURIComponent(leafId)}/verification-jobs?${params.toString()}`,
  );
}

export async function fetchVerificationJob(
  jobId: string,
  options: { parentTraceId?: string } = {},
): Promise<VerificationJobResponse> {
  const params = new URLSearchParams();
  if (options.parentTraceId) {
    params.set("parentTraceId", options.parentTraceId);
  }
  const query = params.toString();
  return requestJson<VerificationJobResponse>(
    `/api/verification/jobs/${encodeURIComponent(jobId)}${query.length > 0 ? `?${query}` : ""}`,
  );
}

export async function fetchVerificationObservabilityMetrics(): Promise<VerificationObservabilityMetricsResponse> {
  return requestJson<VerificationObservabilityMetricsResponse>("/api/observability/verification-metrics");
}

export async function fetchProofQueryObservabilityMetrics(): Promise<ProofQueryObservabilityMetricsResponse> {
  return requestJson<ProofQueryObservabilityMetricsResponse>("/api/observability/proof-query-metrics");
}

export async function fetchUiInteractionObservabilityMetrics(): Promise<UiInteractionObservabilityMetricsResponse> {
  return requestJson<UiInteractionObservabilityMetricsResponse>("/api/observability/ui-interaction-metrics");
}

export async function postUiInteractionObservabilityEvent(payload: {
  proofId: string;
  interaction:
    | "config_update"
    | "tree_expand_toggle"
    | "tree_load_more"
    | "tree_select_leaf"
    | "tree_keyboard"
    | "verification_run"
    | "verification_job_select"
    | "profile_save"
    | "profile_delete"
    | "profile_apply";
  source: "mouse" | "keyboard" | "programmatic";
  success?: boolean;
  parentTraceId?: string;
  durationMs?: number;
}): Promise<{
  schemaVersion: "1.0.0";
  requestId: string;
  traceId: string;
}> {
  return requestJson<{
    schemaVersion: "1.0.0";
    requestId: string;
    traceId: string;
  }>("/api/observability/ui-interactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchObservabilitySloReport(
  thresholds: ObservabilitySloThresholdsInput = {},
): Promise<ObservabilitySloReportResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(thresholds)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const query = params.toString();
  return requestJson<ObservabilitySloReportResponse>(
    `/api/observability/slo-report${query.length > 0 ? `?${query}` : ""}`,
  );
}

export async function fetchConfigProfiles(projectId: string, userId: string): Promise<ConfigProfilesResponse> {
  const params = new URLSearchParams({
    projectId,
    userId,
  });
  return requestJson<ConfigProfilesResponse>(`/api/proofs/config-profiles?${params.toString()}`);
}

export async function saveConfigProfile(payload: {
  projectId: string;
  userId: string;
  profileId: string;
  name: string;
  config: ProofConfigInput;
}): Promise<UpsertConfigProfileResponse> {
  return requestJson<UpsertConfigProfileResponse>("/api/proofs/config-profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function removeConfigProfile(projectId: string, userId: string, profileId: string): Promise<DeleteConfigProfileResponse> {
  const params = new URLSearchParams({
    projectId,
    userId,
  });
  return requestJson<DeleteConfigProfileResponse>(`/api/proofs/config-profiles/${encodeURIComponent(profileId)}?${params.toString()}`, {
    method: "DELETE",
  });
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
  if (config.entailmentMode) {
    params.set("entailmentMode", config.entailmentMode);
  }
  return params;
}
