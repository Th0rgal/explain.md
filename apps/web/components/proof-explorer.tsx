"use client";

import { useEffect, useMemo, useState } from "react";
import {
  fetchDiff,
  fetchLeafDetail,
  fetchLeafVerificationJobs,
  fetchProjection,
  fetchVerificationJob,
  verifyLeaf,
  type DiffResponse,
  type LeafDetailResponse,
  type ProofConfigInput,
  type ProjectionResponse,
  type VerificationJobResponse,
  type VerificationJobsResponse,
} from "../lib/api-client";

const DEFAULT_CONFIG: ProofConfigInput = {
  abstractionLevel: 3,
  complexityLevel: 3,
  maxChildrenPerParent: 3,
  audienceLevel: "intermediate",
  language: "en",
  termIntroductionBudget: 2,
};

interface ProofExplorerProps {
  proofId: string;
}

export function ProofExplorer(props: ProofExplorerProps) {
  const [config, setConfig] = useState<ProofConfigInput>(DEFAULT_CONFIG);
  const [expandedNodeIds, setExpandedNodeIds] = useState<string[]>([]);
  const [projection, setProjection] = useState<ProjectionResponse | null>(null);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(null);
  const [leafDetail, setLeafDetail] = useState<LeafDetailResponse | null>(null);
  const [verificationJobs, setVerificationJobs] = useState<VerificationJobsResponse | null>(null);
  const [selectedVerificationJobId, setSelectedVerificationJobId] = useState<string | null>(null);
  const [selectedVerificationJob, setSelectedVerificationJob] = useState<VerificationJobResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [projectionData, diffData] = await Promise.all([
          fetchProjection({
            proofId: props.proofId,
            config,
            expandedNodeIds,
            maxChildrenPerExpandedNode: config.maxChildrenPerParent,
          }),
          fetchDiff({
            proofId: props.proofId,
            baselineConfig: DEFAULT_CONFIG,
            candidateConfig: config,
          }),
        ]);

        if (cancelled) {
          return;
        }

        setProjection(projectionData);
        setDiff(diffData);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [props.proofId, config, expandedNodeIds]);

  useEffect(() => {
    if (!selectedLeafId) {
      setLeafDetail(null);
      setVerificationJobs(null);
      setSelectedVerificationJobId(null);
      setSelectedVerificationJob(null);
      return;
    }

    let cancelled = false;

    async function loadLeafPanel(leafId: string) {
      try {
        const [leafResult, jobsResult] = await Promise.all([
          fetchLeafDetail(props.proofId, leafId, config),
          fetchLeafVerificationJobs(props.proofId, leafId),
        ]);

        if (cancelled) {
          return;
        }

        setLeafDetail(leafResult);
        setVerificationJobs(jobsResult);
        setSelectedVerificationJobId(jobsResult.jobs[jobsResult.jobs.length - 1]?.jobId ?? null);
      } catch (leafError) {
        if (!cancelled) {
          setLeafDetail({
            ok: false,
            proofId: props.proofId,
            requestHash: "",
            diagnostics: [
              {
                code: "leaf_fetch_failed",
                severity: "error",
                message: leafError instanceof Error ? leafError.message : String(leafError),
              },
            ],
          });
          setVerificationJobs(null);
        }
      }
    }

    loadLeafPanel(selectedLeafId);
    return () => {
      cancelled = true;
    };
  }, [config, props.proofId, selectedLeafId]);

  useEffect(() => {
    if (!selectedVerificationJobId) {
      setSelectedVerificationJob(null);
      return;
    }

    let cancelled = false;

    async function loadSelectedJob(jobId: string) {
      try {
        const result = await fetchVerificationJob(jobId);
        if (!cancelled) {
          setSelectedVerificationJob(result);
        }
      } catch (jobError) {
        if (!cancelled) {
          setSelectedVerificationJob(null);
          setVerificationError(jobError instanceof Error ? jobError.message : String(jobError));
        }
      }
    }

    loadSelectedJob(selectedVerificationJobId);
    return () => {
      cancelled = true;
    };
  }, [selectedVerificationJobId]);

  const visibleNodes = useMemo(() => projection?.view.visibleNodes ?? [], [projection]);

  function updateConfig<Key extends keyof ProofConfigInput>(key: Key, value: ProofConfigInput[Key]): void {
    setConfig((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function toggleExpansion(nodeId: string): void {
    setExpandedNodeIds((current) => {
      if (current.includes(nodeId)) {
        return current.filter((value) => value !== nodeId);
      }
      return [...current, nodeId].sort((left, right) => left.localeCompare(right));
    });
  }

  async function runVerificationForSelectedLeaf() {
    if (!selectedLeafId) {
      return;
    }

    setVerificationError(null);
    setIsVerifying(true);

    try {
      await verifyLeaf(props.proofId, selectedLeafId, true);
      const [leafResult, jobsResult] = await Promise.all([
        fetchLeafDetail(props.proofId, selectedLeafId, config),
        fetchLeafVerificationJobs(props.proofId, selectedLeafId),
      ]);
      setLeafDetail(leafResult);
      setVerificationJobs(jobsResult);
      setSelectedVerificationJobId(jobsResult.jobs[jobsResult.jobs.length - 1]?.jobId ?? null);
    } catch (runError) {
      setVerificationError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsVerifying(false);
    }
  }

  if (isLoading) {
    return <div className="panel">Loading seeded explanation tree...</div>;
  }

  if (error) {
    return (
      <div className="panel" role="alert">
        Failed to load explorer: {error}
      </div>
    );
  }

  return (
    <div className="layout-grid">
      <section className="panel controls" aria-label="Tree controls">
        <h2>Controls</h2>
        <label>
          Abstraction
          <input
            type="range"
            min={1}
            max={5}
            value={config.abstractionLevel}
            onChange={(event) => updateConfig("abstractionLevel", Number(event.target.value))}
          />
        </label>
        <label>
          Complexity
          <input
            type="range"
            min={1}
            max={5}
            value={config.complexityLevel}
            onChange={(event) => updateConfig("complexityLevel", Number(event.target.value))}
          />
        </label>
        <label>
          Max children
          <input
            type="number"
            min={2}
            max={12}
            value={config.maxChildrenPerParent}
            onChange={(event) => updateConfig("maxChildrenPerParent", Number(event.target.value))}
          />
        </label>
        <label>
          Audience
          <select
            value={config.audienceLevel}
            onChange={(event) => updateConfig("audienceLevel", event.target.value as "novice" | "intermediate" | "expert")}
          >
            <option value="novice">Novice</option>
            <option value="intermediate">Intermediate</option>
            <option value="expert">Expert</option>
          </select>
        </label>
      </section>

      <section className="panel tree" aria-label="Root-first explanation tree">
        <h2>Tree</h2>
        <p className="meta">Config hash: {projection?.configHash}</p>
        <ul className="tree-list" role="tree">
          {visibleNodes.map((node) => {
            const indentStyle = { paddingLeft: `${node.depthFromRoot * 1.25}rem` };
            const isSelected = node.kind === "leaf" && selectedLeafId === node.id;
            return (
              <li
                key={node.id}
                role="treeitem"
                aria-expanded={node.isExpandable ? node.isExpanded : undefined}
                aria-selected={isSelected}
              >
                <div className="tree-row" style={indentStyle}>
                  {node.isExpandable ? (
                    <button type="button" onClick={() => toggleExpansion(node.id)} aria-label={`Toggle ${node.id}`}>
                      {node.isExpanded ? "Collapse" : "Expand"}
                    </button>
                  ) : (
                    <span className="leaf-pill">Leaf</span>
                  )}
                  <button
                    type="button"
                    className="statement-button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedLeafId(node.kind === "leaf" ? node.id : null)}
                  >
                    {node.statement}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="panel diff" aria-label="Explanation diff">
        <h2>Diff</h2>
        <p className="meta">Diff hash: {diff?.diffHash ?? "unavailable"}</p>
        <p className="meta">Changed statements: {diff?.report.summary.changed ?? 0}</p>
        <ul>
          {(diff?.report.changes ?? []).slice(0, 8).map((change) => (
            <li key={change.key}>
              <strong>{change.type}</strong> {change.kind} ({change.supportLeafIds.join(", ")})
            </li>
          ))}
        </ul>
      </section>

      <section className="panel leaf" aria-label="Leaf detail panel">
        <h2>Leaf detail</h2>
        {!selectedLeafId && <p>Select a leaf node to inspect provenance and verification metadata.</p>}
        {selectedLeafId && !leafDetail && <p>Loading leaf detail for {selectedLeafId}...</p>}
        {leafDetail?.view && (
          <>
            <p>
              <strong>{leafDetail.view.leaf.id}</strong>
            </p>
            <p>{leafDetail.view.leaf.statementText}</p>
            <p>Share: {leafDetail.view.shareReference.compact}</p>
            <p>Verification jobs: {leafDetail.view.verification.summary.totalJobs}</p>
            <p>Latest status: {leafDetail.view.verification.summary.latestStatus ?? "none"}</p>
            <button type="button" onClick={runVerificationForSelectedLeaf} disabled={isVerifying}>
              {isVerifying ? "Running verification..." : "Verify leaf proof"}
            </button>
            {verificationError && (
              <p role="alert" className="meta">
                Verification error: {verificationError}
              </p>
            )}
            <ul>
              {(verificationJobs?.jobs ?? []).map((job) => (
                <li key={job.jobId}>
                  <button type="button" onClick={() => setSelectedVerificationJobId(job.jobId)} aria-pressed={selectedVerificationJobId === job.jobId}>
                    {job.jobId} - {job.status}
                  </button>
                </li>
              ))}
            </ul>
            {selectedVerificationJob && (
              <div>
                <p className="meta">Selected job hash: {selectedVerificationJob.jobHash}</p>
                <p className="meta">Exit code: {selectedVerificationJob.job.result?.exitCode ?? "none"}</p>
                <p className="meta">Duration: {selectedVerificationJob.job.result?.durationMs ?? "none"}ms</p>
                <ul>
                  {selectedVerificationJob.job.logs.slice(0, 6).map((logLine) => (
                    <li key={`${selectedVerificationJob.job.jobId}:${logLine.index}`}>
                      [{logLine.stream}] {logLine.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
        {leafDetail && !leafDetail.ok && (
          <ul>
            {(leafDetail.diagnostics ?? []).map((diagnostic) => (
              <li key={diagnostic.code}>{diagnostic.message}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
