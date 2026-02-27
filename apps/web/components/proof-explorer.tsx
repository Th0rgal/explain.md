"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  fetchConfigProfiles,
  fetchDiff,
  fetchLeafDetail,
  fetchLeafVerificationJobs,
  fetchPolicyReport,
  fetchNodeChildren,
  fetchNodePath,
  fetchRoot,
  fetchVerificationJob,
  removeConfigProfile,
  saveConfigProfile,
  verifyLeaf,
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
import { formatPolicyThresholdFailure } from "../lib/policy-thresholds";
import {
  formatTreeKeyboardAnnouncement,
  resolveTreeKeyboardIntent,
  type TreeKeyboardRow,
} from "../lib/tree-keyboard-navigation";
import { planTreeRenderWindow, resolveTreeRenderSettings } from "../lib/tree-render-window";
import {
  planTreeVirtualizationWindow,
  resolveTreeVirtualizationSettings,
  resolveVirtualScrollTopForRowIndex,
} from "../lib/tree-virtualization";
import { buildTreeAccessibilityMetadata } from "../lib/tree-accessibility";
import {
  buildExplanationDiffPanelView,
  resolveExplanationDiffPanelSettings,
} from "../lib/explanation-diff-view";

export const DEFAULT_CONFIG: ProofConfigInput = {
  abstractionLevel: 3,
  complexityLevel: 3,
  maxChildrenPerParent: 3,
  audienceLevel: "intermediate",
  language: "en",
  readingLevelTarget: "high_school",
  complexityBandWidth: 1,
  termIntroductionBudget: 2,
  proofDetailMode: "balanced",
  entailmentMode: "calibrated",
};

const DEFAULT_PROFILE_USER_ID = "local-user";
export const ENTAILMENT_MODE_OPTIONS: Array<{ value: NonNullable<ProofConfigInput["entailmentMode"]>; label: string }> = [
  { value: "calibrated", label: "Calibrated" },
  { value: "strict", label: "Strict" },
];
export const TREE_RENDER_SETTINGS = resolveTreeRenderSettings(process.env);
export const TREE_VIRTUALIZATION_SETTINGS = resolveTreeVirtualizationSettings(process.env);
export const DIFF_PANEL_SETTINGS = resolveExplanationDiffPanelSettings(process.env);

interface ProofExplorerProps {
  proofId: string;
}

export function ProofExplorer(props: ProofExplorerProps) {
  const treeListRef = useRef<HTMLUListElement | null>(null);
  const [config, setConfig] = useState<ProofConfigInput>(DEFAULT_CONFIG);
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
  const [activeTreeNodeId, setActiveTreeNodeId] = useState<string | null>(null);
  const [treeA11yAnnouncement, setTreeA11yAnnouncement] = useState<string>("");
  const [renderAnchorRowIndex, setRenderAnchorRowIndex] = useState<number>(0);
  const [treeScrollTopPx, setTreeScrollTopPx] = useState<number>(0);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [policyReport, setPolicyReport] = useState<PolicyReportResponse | null>(null);
  const [pathResult, setPathResult] = useState<NodePathResponse | null>(null);
  const [selectedLeafId, setSelectedLeafId] = useState<string | null>(null);
  const [leafDetail, setLeafDetail] = useState<LeafDetailResponse | null>(null);
  const [verificationJobs, setVerificationJobs] = useState<VerificationJobsResponse | null>(null);
  const [selectedVerificationJobId, setSelectedVerificationJobId] = useState<string | null>(null);
  const [selectedVerificationJob, setSelectedVerificationJob] = useState<VerificationJobResponse | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const profileProjectId = useMemo(() => props.proofId, [props.proofId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      setProfileError(null);
      setPathResult(null);
      try {
        const [rootData, diffData, policyData] = await Promise.all([
          fetchRoot(props.proofId, config),
          fetchDiff({
            proofId: props.proofId,
            baselineConfig: DEFAULT_CONFIG,
            candidateConfig: config,
          }),
          fetchPolicyReport(props.proofId, config),
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
        setActiveTreeNodeId(rootNode.id);
        setDiff(diffData);
        setPolicyReport(policyData);
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

  const renderWindow = useMemo(
    () =>
      planTreeRenderWindow({
        totalRowCount: visibleRows.length,
        anchorRowIndex: renderAnchorRowIndex,
        maxVisibleRows: TREE_RENDER_SETTINGS.maxVisibleRows,
        overscanRows: TREE_RENDER_SETTINGS.overscanRows,
      }),
    [renderAnchorRowIndex, visibleRows.length],
  );

  const keyboardRows = useMemo<TreeKeyboardRow[]>(
    () =>
      visibleRows.map((row) => ({
        nodeId: row.node.id,
        parentId: row.parentId,
        kind: row.node.kind,
        isExpanded: row.node.kind === "parent" && expandedNodeIds.includes(row.node.id),
      })),
    [expandedNodeIds, visibleRows],
  );

  const treeAccessibility = useMemo(
    () =>
      buildTreeAccessibilityMetadata(
        visibleRows.map((row) => ({
          nodeId: row.node.id,
          parentId: row.parentId,
          depthFromRoot: row.depthFromRoot,
        })),
        {
          orderedChildIdsByParentId: Object.fromEntries(
            Object.entries(childrenByParentId).map(([parentId, state]) => [parentId, state.childIds]),
          ),
          totalChildrenByParentId: Object.fromEntries(
            Object.entries(childrenByParentId).map(([parentId, state]) => [parentId, state.totalChildren]),
          ),
        },
      ),
    [childrenByParentId, visibleRows],
  );

  const renderedRows = useMemo(
    () =>
      renderWindow.endIndex >= renderWindow.startIndex
        ? visibleRows.slice(renderWindow.startIndex, renderWindow.endIndex + 1)
        : [],
    [renderWindow.endIndex, renderWindow.startIndex, visibleRows],
  );

  const virtualizationPlan = useMemo(
    () =>
      planTreeVirtualizationWindow({
        totalRowCount: visibleRows.length,
        scrollTopPx: treeScrollTopPx,
        settings: TREE_VIRTUALIZATION_SETTINGS,
      }),
    [treeScrollTopPx, visibleRows.length],
  );

  const isVirtualizedTree = virtualizationPlan.mode === "virtualized";

  const displayedRows = useMemo(() => {
    if (isVirtualizedTree) {
      if (virtualizationPlan.endIndex < virtualizationPlan.startIndex) {
        return [] as typeof visibleRows;
      }
      return visibleRows.slice(virtualizationPlan.startIndex, virtualizationPlan.endIndex + 1);
    }
    return renderedRows;
  }, [isVirtualizedTree, renderedRows, virtualizationPlan.endIndex, virtualizationPlan.startIndex, visibleRows]);

  const diffPanelView = useMemo(
    () => (diff ? buildExplanationDiffPanelView(diff.report, { maxChanges: DIFF_PANEL_SETTINGS.maxChanges }) : null),
    [diff],
  );

  useEffect(() => {
    const maxIndex = Math.max(0, visibleRows.length - 1);
    setRenderAnchorRowIndex((current) => Math.max(0, Math.min(current, maxIndex)));
  }, [visibleRows.length]);

  useEffect(() => {
    setTreeScrollTopPx((current) => Math.max(0, Math.min(current, virtualizationPlan.maxScrollTopPx)));
  }, [virtualizationPlan.maxScrollTopPx]);

  useEffect(() => {
    if (!isVirtualizedTree || !treeListRef.current) {
      return;
    }
    if (treeListRef.current.scrollTop !== treeScrollTopPx) {
      treeListRef.current.scrollTop = treeScrollTopPx;
    }
  }, [isVirtualizedTree, treeScrollTopPx]);

  useEffect(() => {
    if (visibleRows.length === 0) {
      setActiveTreeNodeId(null);
      return;
    }
    const hasCurrent = activeTreeNodeId ? visibleRows.some((row) => row.node.id === activeTreeNodeId) : false;
    if (!hasCurrent) {
      setActiveTreeNodeId(visibleRows[0]?.node.id ?? null);
    }
  }, [activeTreeNodeId, visibleRows]);

  useEffect(() => {
    if (!selectedLeafId) {
      return;
    }
    const selectedIndex = visibleRows.findIndex((row) => row.node.id === selectedLeafId);
    if (selectedIndex >= 0) {
      setRenderAnchorRowIndex(selectedIndex);
    }
  }, [selectedLeafId, visibleRows]);

  useEffect(() => {
    if (!isVirtualizedTree || !activeTreeNodeId) {
      return;
    }
    const activeIndex = visibleRows.findIndex((row) => row.node.id === activeTreeNodeId);
    if (activeIndex < 0) {
      return;
    }
    const nextScrollTop = resolveVirtualScrollTopForRowIndex(
      treeScrollTopPx,
      activeIndex,
      visibleRows.length,
      TREE_VIRTUALIZATION_SETTINGS,
    );
    if (nextScrollTop !== treeScrollTopPx) {
      setTreeScrollTopPx(nextScrollTop);
    }
  }, [activeTreeNodeId, isVirtualizedTree, treeScrollTopPx, visibleRows]);

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

  async function handleTreeKeyDown(event: KeyboardEvent<HTMLUListElement>): Promise<void> {
    if (visibleRows.length === 0) {
      return;
    }

    const currentIndex = Math.max(
      0,
      visibleRows.findIndex((row) => row.node.id === activeTreeNodeId),
    );
    const intent = resolveTreeKeyboardIntent({
      currentIndex,
      totalRows: visibleRows.length,
      key: event.key,
      pageSize: TREE_RENDER_SETTINGS.maxVisibleRows,
      rows: keyboardRows,
    });

    if (intent !== null) {
      event.preventDefault();
      const activeRow = visibleRows[intent.index];
      if (!activeRow) {
        return;
      }

      if (intent.kind === "set-active-index") {
        setActiveTreeNodeId(activeRow.node.id);
        setRenderAnchorRowIndex(intent.index);
        setTreeA11yAnnouncement(
          formatTreeKeyboardAnnouncement({
            action: "active",
            statement: activeRow.node.statement,
            depthFromRoot: activeRow.depthFromRoot,
          }),
        );
        return;
      }

      if (intent.kind === "expand" && activeRow.node.kind === "parent") {
        toggleExpansion(activeRow.node.id);
        setActiveTreeNodeId(activeRow.node.id);
        setRenderAnchorRowIndex(intent.index);
        setTreeA11yAnnouncement(
          formatTreeKeyboardAnnouncement({
            action: "expand",
            statement: activeRow.node.statement,
            depthFromRoot: activeRow.depthFromRoot,
            childCount: childrenByParentId[activeRow.node.id]?.childIds.length ?? 0,
          }),
        );
        return;
      }

      if (intent.kind === "collapse" && activeRow.node.kind === "parent") {
        toggleExpansion(activeRow.node.id);
        setActiveTreeNodeId(activeRow.node.id);
        setRenderAnchorRowIndex(intent.index);
        setTreeA11yAnnouncement(
          formatTreeKeyboardAnnouncement({
            action: "collapse",
            statement: activeRow.node.statement,
            depthFromRoot: activeRow.depthFromRoot,
          }),
        );
      }
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    const activeRow = visibleRows[currentIndex];
    if (!activeRow) {
      return;
    }

    setActiveTreeNodeId(activeRow.node.id);
    if (activeRow.node.kind === "parent") {
      setTreeA11yAnnouncement(
        formatTreeKeyboardAnnouncement({
          action: expandedNodeIds.includes(activeRow.node.id) ? "collapse" : "expand",
          statement: activeRow.node.statement,
          depthFromRoot: activeRow.depthFromRoot,
          childCount: childrenByParentId[activeRow.node.id]?.childIds.length ?? 0,
        }),
      );
      toggleExpansion(activeRow.node.id);
      return;
    }
    setTreeA11yAnnouncement(
      formatTreeKeyboardAnnouncement({
        action: "active",
        statement: activeRow.node.statement,
        depthFromRoot: activeRow.depthFromRoot,
      }),
    );
    await selectLeaf(activeRow.node.id);
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
          Entailment mode
          <select
            value={config.entailmentMode}
            onChange={(event) => updateConfig("entailmentMode", event.target.value as "calibrated" | "strict")}
          >
            {ENTAILMENT_MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
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

      <section
        className="panel tree"
        aria-label="Root-first explanation tree"
        data-tree-render-mode={isVirtualizedTree ? "virtualized" : renderWindow.mode}
        data-tree-total-rows={visibleRows.length}
        data-tree-rendered-rows={isVirtualizedTree ? virtualizationPlan.renderedRowCount : renderWindow.renderedRowCount}
        data-tree-hidden-above={isVirtualizedTree ? virtualizationPlan.hiddenAboveCount : renderWindow.hiddenAboveCount}
        data-tree-hidden-below={isVirtualizedTree ? virtualizationPlan.hiddenBelowCount : renderWindow.hiddenBelowCount}
        data-tree-active-node-id={activeTreeNodeId ?? "none"}
        data-tree-active-row-index={visibleRows.findIndex((row) => row.node.id === activeTreeNodeId)}
        data-tree-live-message={treeA11yAnnouncement || "none"}
        data-tree-virtual-start-index={isVirtualizedTree ? virtualizationPlan.startIndex : -1}
        data-tree-virtual-end-index={isVirtualizedTree ? virtualizationPlan.endIndex : -1}
      >
        <h2>Tree</h2>
        <p className="meta">Config hash: {treeConfigHash || root?.configHash || "unavailable"}</p>
        <p className="meta">Snapshot hash: {treeSnapshotHash || root?.snapshotHash || "unavailable"}</p>
        {isVirtualizedTree ? (
          <div className="tree-row">
            <span className="meta">
              Virtualized {virtualizationPlan.renderedRowCount}/{visibleRows.length} rows (hidden above{" "}
              {virtualizationPlan.hiddenAboveCount}, below {virtualizationPlan.hiddenBelowCount})
            </span>
          </div>
        ) : null}
        {!isVirtualizedTree && renderWindow.mode === "windowed" ? (
          <div className="tree-row">
            <button
              type="button"
              onClick={() =>
                setRenderAnchorRowIndex(Math.max(0, renderWindow.startIndex - TREE_RENDER_SETTINGS.maxVisibleRows))
              }
              disabled={renderWindow.hiddenAboveCount === 0}
            >
              Show previous rows
            </button>
            <button
              type="button"
              onClick={() =>
                setRenderAnchorRowIndex(
                  Math.min(
                    Math.max(0, visibleRows.length - 1),
                    renderWindow.endIndex + TREE_RENDER_SETTINGS.maxVisibleRows,
                  ),
                )
              }
              disabled={renderWindow.hiddenBelowCount === 0}
            >
              Show next rows
            </button>
            <span className="meta">
              Rendering {renderWindow.renderedRowCount}/{visibleRows.length} rows (hidden above {renderWindow.hiddenAboveCount}, below{" "}
              {renderWindow.hiddenBelowCount})
            </span>
          </div>
        ) : null}
        <ul
          ref={treeListRef}
          className="tree-list"
          role="tree"
          tabIndex={0}
          aria-label="Explanation tree"
          aria-describedby="tree-keyboard-help tree-live-status"
          aria-activedescendant={activeTreeNodeId ? `treeitem-${activeTreeNodeId}` : undefined}
          onScroll={(event) => {
            if (!isVirtualizedTree) {
              return;
            }
            setTreeScrollTopPx(event.currentTarget.scrollTop);
          }}
          style={
            isVirtualizedTree
              ? {
                  maxHeight: `${virtualizationPlan.viewportHeightPx}px`,
                  overflowY: "auto",
                }
              : undefined
          }
          onKeyDown={(event) => {
            void handleTreeKeyDown(event);
          }}
        >
          {isVirtualizedTree && virtualizationPlan.topSpacerHeightPx > 0 ? (
            <li
              role="presentation"
              aria-hidden="true"
              style={{
                height: `${virtualizationPlan.topSpacerHeightPx}px`,
              }}
            />
          ) : null}
          {displayedRows.map((row) => {
            const { node } = row;
            const childrenState = childrenByParentId[node.id];
            const isExpanded = expandedNodeIds.includes(node.id);
            const indentStyle = { paddingLeft: `${row.depthFromRoot * 1.25}rem` };
            const isSelectedLeaf = node.kind === "leaf" && selectedLeafId === node.id;
            const isActiveRow = node.id === activeTreeNodeId;
            const rowAccessibility = treeAccessibility.byNodeId[node.id];
            return (
              <li
                key={node.id}
                id={`treeitem-${node.id}`}
                role="treeitem"
                aria-expanded={node.kind === "parent" ? isExpanded : undefined}
                aria-selected={isSelectedLeaf}
                aria-current={isActiveRow ? "true" : undefined}
                aria-level={rowAccessibility?.level}
                aria-posinset={rowAccessibility?.posInSet}
                aria-setsize={rowAccessibility?.setSize}
                className={`tree-item${isActiveRow ? " tree-item-active" : ""}${isSelectedLeaf ? " tree-item-selected" : ""}`}
                style={isVirtualizedTree ? { minHeight: `${TREE_VIRTUALIZATION_SETTINGS.rowHeightPx}px` } : undefined}
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
                    aria-pressed={isSelectedLeaf}
                    onClick={() => {
                      setActiveTreeNodeId(node.id);
                      if (node.kind === "leaf") {
                        void selectLeaf(node.id);
                      } else {
                        setSelectedLeafId(null);
                      }
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
                    <button type="button" onClick={() => loadChildrenPage(node.id)} disabled={childrenState.loading}>
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
                {node.kind === "leaf" && pathResult?.path.path.some((pathNode) => pathNode.id === node.id) ? (
                  <div className="tree-row" style={{ paddingLeft: `${(row.depthFromRoot + 1) * 1.25}rem` }}>
                    <span className="meta">Included in selected ancestry path</span>
                  </div>
                ) : null}
                {node.kind === "parent" && isExpanded && !childrenState ? (
                  <div className="tree-row" style={{ paddingLeft: `${(row.depthFromRoot + 1) * 1.25}rem` }}>
                    <span className="meta">Loading children...</span>
                  </div>
                ) : null}
                {node.kind === "parent" && isExpanded && childrenState && childrenState.totalChildren === 0 ? (
                  <div className="tree-row" style={{ paddingLeft: `${(row.depthFromRoot + 1) * 1.25}rem` }}>
                    <span className="meta">No children</span>
                  </div>
                ) : null}
                {node.kind === "parent" && isExpanded && childrenState && !childrenState.hasMore && childrenState.totalChildren > 0 ? (
                  <div className="tree-row" style={{ paddingLeft: `${(row.depthFromRoot + 1) * 1.25}rem` }}>
                    <span className="meta">All children loaded</span>
                  </div>
                ) : null}
              </li>
            );
          })}
          {isVirtualizedTree && virtualizationPlan.bottomSpacerHeightPx > 0 ? (
            <li
              role="presentation"
              aria-hidden="true"
              style={{
                height: `${virtualizationPlan.bottomSpacerHeightPx}px`,
              }}
            />
          ) : null}
        </ul>
        <p id="tree-keyboard-help" className="sr-only">
          Keyboard: Up and Down move rows, Left and Right collapse or expand parent rows, Home and End jump, Enter or
          Space activates the active row.
        </p>
        <p
          id="tree-live-status"
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {treeA11yAnnouncement}
        </p>
      </section>

      <section className="panel diff" aria-label="Explanation diff">
        <h2>Diff</h2>
        <p className="meta">Diff hash: {diff?.diffHash ?? "unavailable"}</p>
        <p className="meta">
          Changed statements: {diff?.report.summary.changed ?? 0} | Added: {diff?.report.summary.added ?? 0} | Removed:{" "}
          {diff?.report.summary.removed ?? 0}
        </p>
        <p
          className="meta"
          data-diff-total-changes={diffPanelView?.totalChanges ?? 0}
          data-diff-rendered-changes={diffPanelView?.renderedChanges ?? 0}
          data-diff-truncated-changes={diffPanelView?.truncatedChangeCount ?? 0}
        >
          Showing {diffPanelView?.renderedChanges ?? 0}/{diffPanelView?.totalChanges ?? 0} changes
          {diffPanelView && diffPanelView.truncatedChangeCount > 0
            ? ` (truncated ${diffPanelView.truncatedChangeCount} by deterministic max=${DIFF_PANEL_SETTINGS.maxChanges})`
            : ""}
        </p>
        {diffPanelView?.changed.length ? (
          <>
            <h3>Changed</h3>
            <ul className="diff-list">
              {diffPanelView.changed.map((change) => (
                <li key={change.key} className="diff-change diff-change-changed">
                  <p className="meta">
                    <strong>{change.kind}</strong> {change.key} | support leaves: {change.supportLeafIds.join(", ") || "none"}
                  </p>
                  <p className="meta">
                    Before: {change.statementDelta?.prefix}
                    <mark className="diff-mark-removed">{change.statementDelta?.beforeChanged || "(empty)"}</mark>
                    {change.statementDelta?.suffix}
                  </p>
                  <p className="meta">
                    After: {change.statementDelta?.prefix}
                    <mark className="diff-mark-added">{change.statementDelta?.afterChanged || "(empty)"}</mark>
                    {change.statementDelta?.suffix}
                  </p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {diffPanelView?.added.length ? (
          <>
            <h3>Added</h3>
            <ul className="diff-list">
              {diffPanelView.added.map((change) => (
                <li key={change.key} className="diff-change diff-change-added">
                  <p className="meta">
                    <strong>{change.kind}</strong> {change.key} | support leaves: {change.supportLeafIds.join(", ") || "none"}
                  </p>
                  <p>{change.statementAfter ?? "(missing candidate statement)"}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {diffPanelView?.removed.length ? (
          <>
            <h3>Removed</h3>
            <ul className="diff-list">
              {diffPanelView.removed.map((change) => (
                <li key={change.key} className="diff-change diff-change-removed">
                  <p className="meta">
                    <strong>{change.kind}</strong> {change.key} | support leaves: {change.supportLeafIds.join(", ") || "none"}
                  </p>
                  <p>{change.statementBefore ?? "(missing baseline statement)"}</p>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <section className="panel diff" aria-label="Policy calibration report">
        <h2>Policy</h2>
        <p className="meta">Report hash: {policyReport?.reportHash ?? "unavailable"}</p>
        <p className="meta">
          Threshold pass: {policyReport ? (policyReport.report.thresholdPass ? "yes" : "no") : "unavailable"}
        </p>
        <p className="meta">
          Parent count: {policyReport?.report.metrics.parentCount ?? 0} | violation rate:{" "}
          {policyReport?.report.metrics.policyViolationRate ?? 0}
        </p>
        <p className="meta">
          Repartition events: {policyReport?.report.repartitionMetrics.eventCount ?? 0} (pre=
          {policyReport?.report.repartitionMetrics.preSummaryEventCount ?? 0}, post=
          {policyReport?.report.repartitionMetrics.postSummaryEventCount ?? 0}, max round=
          {policyReport?.report.repartitionMetrics.maxRound ?? 0})
        </p>
        <ul>
          {(policyReport?.report.repartitionMetrics.depthMetrics ?? []).slice(0, 6).map((entry) => (
            <li key={`repartition-depth-${entry.depth}`}>
              depth {entry.depth}: {entry.eventCount} events (pre {entry.preSummaryEventCount}, post{" "}
              {entry.postSummaryEventCount}), max round {entry.maxRound}
            </li>
          ))}
        </ul>
        <ul>
          {(policyReport?.report.thresholdFailures ?? []).slice(0, 6).map((failure) => (
            <li key={failure.code}>
              {formatPolicyThresholdFailure(failure)} [{failure.code}]
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
                <p className="meta">Reproducibility hash: {selectedVerificationJob.jobReplay.reproducibilityHash}</p>
                <p className="meta">Source revision: {selectedVerificationJob.job.reproducibility.sourceRevision}</p>
                <p className="meta">
                  Toolchain: Lean {selectedVerificationJob.job.reproducibility.toolchain.leanVersion}
                  {selectedVerificationJob.job.reproducibility.toolchain.lakeVersion
                    ? ` / Lake ${selectedVerificationJob.job.reproducibility.toolchain.lakeVersion}`
                    : ""}
                </p>
                <p className="meta">Exit code: {selectedVerificationJob.job.result?.exitCode ?? "none"}</p>
                <p className="meta">Duration: {selectedVerificationJob.job.result?.durationMs ?? "none"}ms</p>
                <p className="meta">Replay command: {selectedVerificationJob.jobReplay.replayCommand}</p>
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
