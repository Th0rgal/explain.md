"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchCacheReport,
  fetchConfigProfiles,
  fetchDiff,
  fetchLeafDetail,
  fetchLeafVerificationJobs,
  fetchNodeChildren,
  fetchNodePath,
  fetchPolicyReport,
  fetchRoot,
  fetchVerificationJob,
  removeConfigProfile,
  saveConfigProfile,
  verifyLeaf,
  type CacheReportResponse,
  type ConfigProfilesResponse,
  type DiffResponse,
  type LeafDetailResponse,
  type NodeChildrenResponse,
  type NodePathResponse,
  type PolicyReportResponse,
  type ProofConfigInput,
  type RootResponse,
  type TreeNodeRecord,
  type VerificationJobResponse,
  type VerificationJobsResponse,
} from "../lib/api-client";
import { buildTreeScene, isWholeTreeLoaded } from "../lib/tree-scene";

const ProofTree3D = dynamic(() => import("./proof-tree-3d").then((module) => module.ProofTree3D), {
  ssr: false,
});

const DEFAULT_CONFIG: ProofConfigInput = {
  abstractionLevel: 3,
  complexityLevel: 3,
  maxChildrenPerParent: 3,
  audienceLevel: "intermediate",
  language: "en",
  readingLevelTarget: "high_school",
  complexityBandWidth: 1,
  termIntroductionBudget: 2,
  proofDetailMode: "balanced",
};

const DEFAULT_PROFILE_USER_ID = "local-user";

interface ProofExplorerProps {
  proofId: string;
}

type ViewMode = "list" | "tree3d";

export function ProofExplorer(props: ProofExplorerProps) {
  const [config, setConfig] = useState<ProofConfigInput>(DEFAULT_CONFIG);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [profileName, setProfileName] = useState<string>("Default profile");
  const [profileId, setProfileId] = useState<string>("default");
  const [profiles, setProfiles] = useState<ConfigProfilesResponse["profiles"]>([]);
  const [profileLedgerHash, setProfileLedgerHash] = useState<string>("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<string[]>([]);
  const [root, setRoot] = useState<RootResponse | null>(null);
  const [treeConfigHash, setTreeConfigHash] = useState<string>("");
  const [treeSnapshotHash, setTreeSnapshotHash] = useState<string>("");
  const [nodesById, setNodesById] = useState<Record<string, TreeNodeRecord>>({});
  const [childrenByParentId, setChildrenByParentId] = useState<Record<string, NodeChildrenState>>({});
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [policyReport, setPolicyReport] = useState<PolicyReportResponse | null>(null);
  const [cacheReport, setCacheReport] = useState<CacheReportResponse | null>(null);
  const [pathResult, setPathResult] = useState<NodePathResponse | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(null);
  const [leafDetail, setLeafDetail] = useState<LeafDetailResponse | null>(null);
  const [verificationJobs, setVerificationJobs] = useState<VerificationJobsResponse | null>(null);
  const [selectedVerificationJobId, setSelectedVerificationJobId] = useState<string | null>(null);
  const [selectedVerificationJob, setSelectedVerificationJob] = useState<VerificationJobResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [isHydrating3d, setIsHydrating3d] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const isHydrating3dRef = useRef<boolean>(false);
  const nodesByIdRef = useRef<Record<string, TreeNodeRecord>>({});
  const childrenByParentIdRef = useRef<Record<string, NodeChildrenState>>({});
  const profileProjectId = useMemo(() => props.proofId, [props.proofId]);

  useEffect(() => {
    nodesByIdRef.current = nodesById;
  }, [nodesById]);

  useEffect(() => {
    childrenByParentIdRef.current = childrenByParentId;
  }, [childrenByParentId]);

  useEffect(() => {
    isHydrating3dRef.current = isHydrating3d;
  }, [isHydrating3d]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      setProfileError(null);
      setPathResult(null);
      try {
        const [rootData, diffData, policyData, cacheData] = await Promise.all([
          fetchRoot(props.proofId, config),
          fetchDiff({
            proofId: props.proofId,
            baselineConfig: DEFAULT_CONFIG,
            candidateConfig: config,
          }),
          fetchPolicyReport(props.proofId, config),
          fetchCacheReport(props.proofId, config),
        ]);

        if (cancelled) {
          return;
        }

        if (!rootData.root.node) {
          throw new Error("Root query returned no root node.");
        }

        const rootNode = rootData.root.node;
        const initialChildren =
          rootNode.kind === "parent"
            ? await fetchNodeChildren(props.proofId, rootNode.id, config, {
                offset: 0,
                limit: config.maxChildrenPerParent ?? 3,
              })
            : null;

        if (cancelled) {
          return;
        }

        setRoot(rootData);
        setTreeConfigHash(rootData.configHash);
        setTreeSnapshotHash(rootData.snapshotHash);
        setNodesById(() => {
          const next: Record<string, TreeNodeRecord> = { [rootNode.id]: rootNode };
          if (initialChildren) {
            for (const child of initialChildren.children.children) {
              next[child.id] = child;
            }
          }
          return next;
        });
        setChildrenByParentId(
          initialChildren
            ? {
                [rootNode.id]: {
                  childIds: initialChildren.children.children.map((child) => child.id),
                  totalChildren: initialChildren.children.totalChildren,
                  hasMore: initialChildren.children.hasMore,
                  nextOffset: initialChildren.children.offset + initialChildren.children.children.length,
                  loading: false,
                  diagnostics: initialChildren.children.diagnostics,
                },
              }
            : {},
        );
        setExpandedNodeIds(rootNode.kind === "parent" ? [rootNode.id] : []);
        setSelectedNodeId(rootNode.id);
        setSelectedLeafId(rootNode.kind === "leaf" ? rootNode.id : null);
        setDiff(diffData);
        setPolicyReport(policyData);
        setCacheReport(cacheData);
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

    void load();
    return () => {
      cancelled = true;
    };
  }, [config, props.proofId]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfiles() {
      setProfileError(null);
      try {
        const profileData = await fetchConfigProfiles(profileProjectId, DEFAULT_PROFILE_USER_ID);
        if (cancelled) {
          return;
        }
        setProfiles(profileData.profiles);
        setProfileLedgerHash(profileData.ledgerHash);
      } catch (profileLoadError) {
        if (cancelled) {
          return;
        }
        setProfileError(profileLoadError instanceof Error ? profileLoadError.message : String(profileLoadError));
      }
    }

    void loadProfiles();
    return () => {
      cancelled = true;
    };
  }, [profileProjectId]);

  useEffect(() => {
    if (!selectedLeafId) {
      setLeafDetail(null);
      setVerificationJobs(null);
      setSelectedVerificationJobId(null);
      setSelectedVerificationJob(null);
      setVerificationError(null);
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

    void loadLeafPanel(selectedLeafId);
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

    void loadSelectedJob(selectedVerificationJobId);
    return () => {
      cancelled = true;
    };
  }, [selectedVerificationJobId]);

  const wholeTreeLoaded = useMemo(() => {
    if (!root?.root.node) {
      return false;
    }
    return isWholeTreeLoaded(root.root.node.id, nodesById, childrenByParentId);
  }, [childrenByParentId, nodesById, root]);

  useEffect(() => {
    if (viewMode !== "tree3d" || isHydrating3dRef.current || wholeTreeLoaded || !root?.root.node || root.root.node.kind !== "parent") {
      return;
    }

    const rootNode = root.root.node;

    let cancelled = false;

    async function hydrateTree() {
      setIsHydrating3d(true);
      setError(null);

      const queue: string[] = [rootNode.id];
      const visited = new Set<string>();
      const nextNodes: Record<string, TreeNodeRecord> = { ...nodesByIdRef.current };
      const nextChildren: Record<string, NodeChildrenState> = { ...childrenByParentIdRef.current };
      const limit = 100;

      try {
        while (queue.length > 0) {
          const parentId = queue.shift() as string;
          if (visited.has(parentId)) {
            continue;
          }
          visited.add(parentId);

          const parentNode = nextNodes[parentId];
          if (!parentNode || parentNode.kind !== "parent") {
            continue;
          }

          const existing = nextChildren[parentId];
          const mergedIds = [...(existing?.childIds ?? [])];
          let offset = existing?.nextOffset ?? 0;
          let hasMore = existing?.hasMore ?? true;
          let totalChildren = existing?.totalChildren ?? mergedIds.length;
          let diagnostics = existing?.diagnostics ?? [];

          while (hasMore) {
            const result = await fetchNodeChildren(props.proofId, parentId, config, { offset, limit });
            if (cancelled) {
              return;
            }

            setTreeConfigHash(result.configHash);
            setTreeSnapshotHash(result.snapshotHash);

            totalChildren = result.children.totalChildren;
            hasMore = result.children.hasMore;
            diagnostics = result.children.diagnostics;
            offset = result.children.offset + result.children.children.length;

            nextNodes[parentId] = result.children.parent;
            for (const child of result.children.children) {
              nextNodes[child.id] = child;
              if (!mergedIds.includes(child.id)) {
                mergedIds.push(child.id);
              }
            }

            if (result.children.children.length === 0) {
              break;
            }
          }

          nextChildren[parentId] = {
            childIds: mergedIds,
            totalChildren,
            hasMore: false,
            nextOffset: offset,
            loading: false,
            diagnostics,
          };

          const nestedParents = mergedIds.filter((childId) => nextNodes[childId]?.kind === "parent").sort((a, b) => a.localeCompare(b));
          for (const childParentId of nestedParents) {
            if (!visited.has(childParentId)) {
              queue.push(childParentId);
            }
          }
        }

        if (!cancelled) {
          setNodesById(nextNodes);
          setChildrenByParentId(nextChildren);
        }
      } catch (hydrateError) {
        if (!cancelled) {
          setError(hydrateError instanceof Error ? hydrateError.message : String(hydrateError));
        }
      } finally {
        if (!cancelled) {
          setIsHydrating3d(false);
        }
      }
    }

    void hydrateTree();

    return () => {
      cancelled = true;
    };
  }, [config, props.proofId, root, viewMode, wholeTreeLoaded]);

  const visibleRows = useMemo(() => {
    if (!root?.root.node) {
      return [] as Array<{ node: TreeNodeRecord; parentId?: string; depthFromRoot: number; hiddenChildCount: number }>;
    }

    const rows: Array<{ node: TreeNodeRecord; parentId?: string; depthFromRoot: number; hiddenChildCount: number }> = [];
    const stack: Array<{ nodeId: string; parentId?: string; depthFromRoot: number }> = [{ nodeId: root.root.node.id, depthFromRoot: 0 }];

    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame) {
        break;
      }
      const node = nodesById[frame.nodeId];
      if (!node) {
        continue;
      }

      const childrenState = childrenByParentId[node.id];
      const hiddenChildCount = childrenState ? Math.max(0, childrenState.totalChildren - childrenState.childIds.length) : 0;
      rows.push({
        node,
        parentId: frame.parentId,
        depthFromRoot: frame.depthFromRoot,
        hiddenChildCount,
      });

      if (node.kind === "parent" && expandedNodeIds.includes(node.id) && childrenState) {
        for (let index = childrenState.childIds.length - 1; index >= 0; index -= 1) {
          stack.push({
            nodeId: childrenState.childIds[index],
            parentId: node.id,
            depthFromRoot: frame.depthFromRoot + 1,
          });
        }
      }
    }

    return rows;
  }, [childrenByParentId, expandedNodeIds, nodesById, root]);

  const pathNodeIds = useMemo(() => {
    if (!pathResult?.path.ok) {
      return [] as string[];
    }
    return pathResult.path.path.map((entry) => entry.id);
  }, [pathResult]);

  const scene = useMemo(() => {
    const rootId = root?.root.node?.id ?? "";
    return buildTreeScene({
      rootId,
      nodesById,
      childrenByParentId,
      selectedNodeId,
      selectedLeafId,
      pathNodeIds,
      configHash: treeConfigHash || root?.configHash || "",
      snapshotHash: treeSnapshotHash || root?.snapshotHash || "",
      policyReport,
    });
  }, [childrenByParentId, nodesById, pathNodeIds, policyReport, root, selectedLeafId, selectedNodeId, treeConfigHash, treeSnapshotHash]);

  function updateConfig<Key extends keyof ProofConfigInput>(key: Key, value: ProofConfigInput[Key]): void {
    setConfig((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function toggleExpansion(nodeId: string): void {
    const node = nodesById[nodeId];
    setExpandedNodeIds((current) => {
      if (current.includes(nodeId)) {
        return current.filter((value) => value !== nodeId);
      }
      return [...current, nodeId].sort((left, right) => left.localeCompare(right));
    });
    if (node?.kind === "parent" && !childrenByParentId[nodeId]) {
      void loadChildrenPage(nodeId);
    }
  }

  async function loadChildrenPage(nodeId: string): Promise<void> {
    const existing = childrenByParentId[nodeId];
    if (existing?.loading) {
      return;
    }

    const offset = existing?.nextOffset ?? 0;
    const limit = config.maxChildrenPerParent ?? DEFAULT_CONFIG.maxChildrenPerParent ?? 3;

    setChildrenByParentId((current) => ({
      ...current,
      [nodeId]: {
        childIds: current[nodeId]?.childIds ?? [],
        totalChildren: current[nodeId]?.totalChildren ?? 0,
        hasMore: current[nodeId]?.hasMore ?? true,
        nextOffset: current[nodeId]?.nextOffset ?? 0,
        loading: true,
        diagnostics: current[nodeId]?.diagnostics ?? [],
      },
    }));

    try {
      const result = await fetchNodeChildren(props.proofId, nodeId, config, { offset, limit });
      setTreeConfigHash(result.configHash);
      setTreeSnapshotHash(result.snapshotHash);
      setNodesById((current) => {
        const next: Record<string, TreeNodeRecord> = { ...current, [result.children.parent.id]: result.children.parent };
        for (const child of result.children.children) {
          next[child.id] = child;
        }
        return next;
      });
      setChildrenByParentId((current) => {
        const prior = current[nodeId];
        const mergedIds = [...(prior?.childIds ?? [])];
        for (const child of result.children.children) {
          if (!mergedIds.includes(child.id)) {
            mergedIds.push(child.id);
          }
        }
        return {
          ...current,
          [nodeId]: {
            childIds: mergedIds,
            totalChildren: result.children.totalChildren,
            hasMore: result.children.hasMore,
            nextOffset: result.children.offset + result.children.children.length,
            loading: false,
            diagnostics: result.children.diagnostics,
          },
        };
      });
    } catch (childrenError) {
      setChildrenByParentId((current) => ({
        ...current,
        [nodeId]: {
          childIds: current[nodeId]?.childIds ?? [],
          totalChildren: current[nodeId]?.totalChildren ?? 0,
          hasMore: current[nodeId]?.hasMore ?? true,
          nextOffset: current[nodeId]?.nextOffset ?? 0,
          loading: false,
          diagnostics: current[nodeId]?.diagnostics ?? [],
        },
      }));
      setError(childrenError instanceof Error ? childrenError.message : String(childrenError));
    }
  }

  async function selectNode(nodeId: string, kind: "leaf" | "parent") {
    setSelectedNodeId(nodeId);
    if (kind === "leaf") {
      await selectLeaf(nodeId);
      return;
    }
    setSelectedLeafId(null);
  }

  async function selectLeaf(nodeId: string): Promise<void> {
    setSelectedLeafId(nodeId);
    try {
      const path = await fetchNodePath(props.proofId, nodeId, config);
      setPathResult(path);
      if (path.path.ok) {
        const expandableAncestors = path.path.path.filter((node) => node.kind === "parent").map((node) => node.id);
        setExpandedNodeIds((current) =>
          Array.from(new Set([...current, ...expandableAncestors])).sort((left, right) => left.localeCompare(right)),
        );
        for (const ancestorId of expandableAncestors) {
          if (!childrenByParentId[ancestorId]) {
            await loadChildrenPage(ancestorId);
          }
        }
      }
    } catch (pathError) {
      setPathResult(null);
      setError(pathError instanceof Error ? pathError.message : String(pathError));
    }
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

  async function refreshProfiles(): Promise<void> {
    const result = await fetchConfigProfiles(profileProjectId, DEFAULT_PROFILE_USER_ID);
    setProfiles(result.profiles);
    setProfileLedgerHash(result.ledgerHash);
  }

  async function saveCurrentProfile(): Promise<void> {
    setProfileError(null);
    try {
      const result = await saveConfigProfile({
        projectId: profileProjectId,
        userId: DEFAULT_PROFILE_USER_ID,
        profileId,
        name: profileName,
        config,
      });
      setProfileId(result.profile.profileId);
      setProfileName(result.profile.name);
      await refreshProfiles();
    } catch (saveError) {
      setProfileError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  }

  async function deleteSelectedProfile(): Promise<void> {
    setProfileError(null);
    try {
      const response = await removeConfigProfile(profileProjectId, DEFAULT_PROFILE_USER_ID, profileId);
      if (!response.deleted) {
        setProfileError(`Profile '${profileId}' was not found.`);
      }
      await refreshProfiles();
    } catch (deleteError) {
      setProfileError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  }

  function applyProfileSelection(nextProfileId: string): void {
    const selected = profiles.find((entry) => entry.profileId === nextProfileId);
    if (!selected) {
      return;
    }
    setProfileId(selected.profileId);
    setProfileName(selected.name);
    setConfig(selected.config as ProofConfigInput);
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
    <div className="layout-grid proof-layout-grid">
      <section className="panel controls" aria-label="Tree controls">
        <h2>Controls</h2>

        <label>
          View mode
          <select value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
            <option value="list">List</option>
            <option value="tree3d">3D Tree</option>
          </select>
        </label>

        <label>
          Proof detail
          <select
            value={config.proofDetailMode}
            onChange={(event) => updateConfig("proofDetailMode", event.target.value as "minimal" | "balanced" | "formal")}
          >
            <option value="minimal">Minimal</option>
            <option value="balanced">Balanced</option>
            <option value="formal">Formal</option>
          </select>
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

        <details className="advanced-controls">
          <summary>Advanced controls</summary>
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
            Reading level
            <select
              value={config.readingLevelTarget}
              onChange={(event) =>
                updateConfig(
                  "readingLevelTarget",
                  event.target.value as "elementary" | "middle_school" | "high_school" | "undergraduate" | "graduate",
                )
              }
            >
              <option value="elementary">Elementary</option>
              <option value="middle_school">Middle school</option>
              <option value="high_school">High school</option>
              <option value="undergraduate">Undergraduate</option>
              <option value="graduate">Graduate</option>
            </select>
          </label>
          <label>
            Complexity band
            <input
              type="number"
              min={0}
              max={3}
              value={config.complexityBandWidth}
              onChange={(event) => updateConfig("complexityBandWidth", Number(event.target.value))}
            />
          </label>
          <label>
            Term budget
            <input
              type="number"
              min={0}
              max={8}
              value={config.termIntroductionBudget}
              onChange={(event) => updateConfig("termIntroductionBudget", Number(event.target.value))}
            />
          </label>
          <label>
            Language
            <input type="text" value={config.language} onChange={(event) => updateConfig("language", event.target.value)} />
          </label>
        </details>

        <label>
          Saved profiles
          <select value={profileId} onChange={(event) => applyProfileSelection(event.target.value)}>
            <option value={profileId}>{profileId}</option>
            {profiles
              .filter((entry) => entry.profileId !== profileId)
              .map((entry) => (
                <option key={entry.storageKey} value={entry.profileId}>
                  {entry.profileId} ({entry.name})
                </option>
              ))}
          </select>
        </label>
        <label>
          Profile ID
          <input type="text" value={profileId} onChange={(event) => setProfileId(event.target.value)} />
        </label>
        <label>
          Profile name
          <input type="text" value={profileName} onChange={(event) => setProfileName(event.target.value)} />
        </label>

        <div className="tree-row">
          <button type="button" onClick={() => void saveCurrentProfile()}>
            Save profile
          </button>
          <button type="button" onClick={() => void deleteSelectedProfile()}>
            Delete profile
          </button>
        </div>

        <p className="meta">Profile ledger hash: {profileLedgerHash || "unavailable"}</p>
        {profileError ? <p className="meta">Profile error: {profileError}</p> : null}
      </section>

      <section className="panel tree" aria-label="Root-first explanation tree">
        <h2>{viewMode === "tree3d" ? "3D Tree" : "Tree"}</h2>
        <p className="meta">Config hash: {treeConfigHash || root?.configHash || "unavailable"}</p>
        <p className="meta">Snapshot hash: {treeSnapshotHash || root?.snapshotHash || "unavailable"}</p>

        {viewMode === "tree3d" ? (
          <ProofTree3D
            scene={scene}
            isHydrating={isHydrating3d}
            onSelectNode={(nodeId, kind) => {
              void selectNode(nodeId, kind);
            }}
          />
        ) : (
          <ul className="tree-list" role="tree">
            {visibleRows.map((row) => {
              const { node } = row;
              const childrenState = childrenByParentId[node.id];
              const isExpanded = expandedNodeIds.includes(node.id);
              const indentStyle = { paddingLeft: `${row.depthFromRoot * 1.25}rem` };
              const isSelected = selectedNodeId === node.id;
              return (
                <li
                  key={node.id}
                  role="treeitem"
                  aria-expanded={node.kind === "parent" ? isExpanded : undefined}
                  aria-selected={isSelected}
                >
                  <div className="tree-row" style={indentStyle}>
                    {node.kind === "parent" ? (
                      <button type="button" onClick={() => toggleExpansion(node.id)} aria-label={`Toggle ${node.id}`}>
                        {isExpanded ? "Collapse" : "Expand"}
                      </button>
                    ) : (
                      <span className="leaf-pill">Leaf</span>
                    )}
                    <button
                      type="button"
                      className="statement-button"
                      aria-pressed={isSelected}
                      onClick={() => {
                        void selectNode(node.id, node.kind);
                      }}
                    >
                      {node.statement}
                    </button>
                    {node.kind === "parent" && childrenState ? (
                      <span className="meta">
                        {childrenState.childIds.length}/{childrenState.totalChildren} loaded
                      </span>
                    ) : null}
                  </div>
                  {node.kind === "parent" && isExpanded && childrenState?.hasMore ? (
                    <div className="tree-row" style={{ paddingLeft: `${(row.depthFromRoot + 1) * 1.25}rem` }}>
                      <button type="button" onClick={() => void loadChildrenPage(node.id)} disabled={childrenState.loading}>
                        {childrenState.loading ? "Loading…" : "Load more"}
                      </button>
                      <span className="meta">{row.hiddenChildCount} hidden children</span>
                    </div>
                  ) : null}
                  {node.kind === "parent" && isExpanded && childrenState?.diagnostics.length ? (
                    <div className="tree-row" style={{ paddingLeft: `${(row.depthFromRoot + 1) * 1.25}rem` }}>
                      <span className="meta">{childrenState.diagnostics.map((diagnostic) => diagnostic.code).join(", ")}</span>
                    </div>
                  ) : null}
                  {node.kind === "parent" && node.policyDiagnostics ? (
                    <div className="tree-row" style={{ paddingLeft: `${(row.depthFromRoot + 1) * 1.25}rem` }}>
                      <span className="meta">
                        Policy pre/post: {node.policyDiagnostics.preSummary.ok ? "ok" : "violating"}/
                        {node.policyDiagnostics.postSummary.ok ? "ok" : "violating"} | spread=
                        {node.policyDiagnostics.preSummary.metrics.complexitySpread} | new-terms=
                        {node.policyDiagnostics.postSummary.metrics.introducedTermCount}
                      </span>
                    </div>
                  ) : null}
                  {node.kind === "leaf" && pathNodeIds.includes(node.id) ? (
                    <div className="tree-row" style={{ paddingLeft: `${(row.depthFromRoot + 1) * 1.25}rem` }}>
                      <span className="meta">Included in selected ancestry path</span>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="meta">Whole-tree loaded: {wholeTreeLoaded ? "yes" : "no"}</p>
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

      <section className="panel diff" aria-label="Policy calibration report">
        <h2>Policy</h2>
        <p className="meta">Report hash: {policyReport?.reportHash ?? "unavailable"}</p>
        <p className="meta">
          Threshold pass: {policyReport ? (policyReport.report.thresholdPass ? "yes" : "no") : "unavailable"}
        </p>
        <p className="meta">
          Parent count: {policyReport?.report.metrics.parentCount ?? 0} | violation rate: {policyReport?.report.metrics.policyViolationRate ?? 0}
        </p>
        <ul>
          {(policyReport?.report.thresholdFailures ?? []).slice(0, 6).map((failure) => (
            <li key={failure.code}>
              {failure.code}: {failure.details.actual} {failure.details.comparator} {failure.details.expected}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel diff" aria-label="Cache report">
        <h2>Cache</h2>
        <p className="meta">Layer: {cacheReport?.cache.layer ?? "unavailable"}</p>
        <p className="meta">Status: {cacheReport?.cache.status ?? "unavailable"}</p>
        <p className="meta">Snapshot hash: {cacheReport?.cache.snapshotHash ?? "unavailable"}</p>
        <ul>
          {(cacheReport?.cache.diagnostics ?? []).slice(0, 4).map((diagnostic) => (
            <li key={diagnostic.code}>
              {diagnostic.code}: {diagnostic.message}
            </li>
          ))}
        </ul>
      </section>

      <section className="panel leaf" aria-label="Leaf detail panel">
        <h2>Leaf detail</h2>
        {!selectedLeafId && <p>Select a leaf node to inspect provenance and verification metadata.</p>}
        {selectedLeafId && !leafDetail && <p>Loading leaf detail for {selectedLeafId}...</p>}
        {pathResult?.path.path.length ? <p className="meta">Ancestry: {pathResult.path.path.map((node) => node.id).join(" -> ")}</p> : null}
        {leafDetail?.view && (
          <>
            <p>
              <strong>{leafDetail.view.leaf.id}</strong>
            </p>
            <p>{leafDetail.view.leaf.statementText}</p>
            <p>Share: {leafDetail.view.shareReference.compact}</p>
            <p>Verification jobs: {leafDetail.view.verification.summary.totalJobs}</p>
            <p>Latest status: {leafDetail.view.verification.summary.latestStatus ?? "none"}</p>
            <button type="button" onClick={() => void runVerificationForSelectedLeaf()} disabled={isVerifying}>
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
                  <button
                    type="button"
                    onClick={() => setSelectedVerificationJobId(job.jobId)}
                    aria-pressed={selectedVerificationJobId === job.jobId}
                  >
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

interface NodeChildrenState {
  childIds: string[];
  totalChildren: number;
  hasMore: boolean;
  nextOffset: number;
  loading: boolean;
  diagnostics: NodeChildrenResponse["children"]["diagnostics"];
}
