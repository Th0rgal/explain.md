import { createHash } from "node:crypto";
import { buildTreeAccessibilityMetadata } from "./tree-accessibility";
import { formatTreeKeyboardAnnouncement, resolveTreeKeyboardIntent, type TreeKeyboardKey, type TreeKeyboardRow } from "./tree-keyboard-navigation";
import { planTreeRenderWindow, type TreeRenderSettings } from "./tree-render-window";
import {
  planTreeVirtualizationWindow,
  resolveTreeVirtualizationSettings,
  resolveVirtualScrollTopForRowIndex,
  type TreeVirtualizationSettings,
} from "./tree-virtualization";

const SCHEMA_VERSION = "1.0.0";

export interface TreeA11yEvaluationNode {
  id: string;
  kind: "leaf" | "parent";
  statement: string;
}

export interface TreeA11yEvaluationStep {
  key: string;
  intentKind: "set-active-index" | "expand" | "collapse" | "noop" | "unsupported";
  activeNodeId: string;
  activeRowIndex: number;
  announcement: string;
  ariaActivedescendant: string;
  ariaLevel: number;
  ariaPosInSet: number;
  ariaSetSize: number;
  renderMode: "full" | "windowed" | "virtualized";
  renderedRowCount: number;
  hiddenAboveCount: number;
  hiddenBelowCount: number;
  visibleRowCount: number;
  displayedStartIndex: number;
  displayedEndIndex: number;
}

export interface TreeA11yEvaluationReport {
  schemaVersion: string;
  requestHash: string;
  outcomeHash: string;
  parameters: {
    keySequence: string[];
    renderSettings: TreeRenderSettings;
    virtualizationSettings: TreeVirtualizationSettings;
  };
  summary: {
    totalSteps: number;
    expandActionCount: number;
    collapseActionCount: number;
    activeAnnouncementCount: number;
    virtualizedStepCount: number;
    windowedStepCount: number;
  };
  initialState: {
    activeNodeId: string;
    expandedNodeIds: string[];
  };
  finalState: {
    activeNodeId: string;
    expandedNodeIds: string[];
    finalScrollTopPx: number;
  };
  steps: TreeA11yEvaluationStep[];
}

interface EvaluationFixture {
  rootId: string;
  nodesById: Record<string, TreeA11yEvaluationNode>;
  childIdsByParentId: Record<string, string[]>;
  totalChildrenByParentId: Record<string, number>;
  initialExpandedNodeIds: string[];
  initialActiveNodeId: string;
}

interface VisibleRow {
  node: TreeA11yEvaluationNode;
  parentId?: string;
  depthFromRoot: number;
}

interface TreeState {
  activeNodeId: string;
  expandedNodeIds: string[];
  scrollTopPx: number;
}

export function runTreeA11yEvaluation(): TreeA11yEvaluationReport {
  const fixture = buildEvaluationFixture();
  const keySequence = buildEvaluationKeySequence();
  const renderSettings: TreeRenderSettings = {
    maxVisibleRows: 6,
    overscanRows: 1,
  };
  const virtualizationSettings = resolveTreeVirtualizationSettings({
    NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_ENABLED: "true",
    NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_MIN_ROWS: "4",
    NEXT_PUBLIC_EXPLAIN_MD_TREE_ROW_HEIGHT_PX: "20",
    NEXT_PUBLIC_EXPLAIN_MD_TREE_VIEWPORT_ROWS: "3",
    NEXT_PUBLIC_EXPLAIN_MD_TREE_VIRTUALIZATION_OVERSCAN_ROWS: "1",
  });

  const requestHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    fixture,
    keySequence,
    renderSettings,
    virtualizationSettings,
  });

  const steps: TreeA11yEvaluationStep[] = [];
  const state: TreeState = {
    activeNodeId: fixture.initialActiveNodeId,
    expandedNodeIds: fixture.initialExpandedNodeIds.slice().sort((left, right) => left.localeCompare(right)),
    scrollTopPx: 0,
  };

  for (const key of keySequence) {
    const visibleRowsBefore = buildVisibleRows(fixture, state.expandedNodeIds);
    const currentIndex = Math.max(0, visibleRowsBefore.findIndex((row) => row.node.id === state.activeNodeId));
    const keyboardRows = buildKeyboardRows(visibleRowsBefore, state.expandedNodeIds);
    const intent = resolveTreeKeyboardIntent({
      currentIndex,
      totalRows: visibleRowsBefore.length,
      key,
      pageSize: renderSettings.maxVisibleRows,
      rows: keyboardRows,
    });

    let announcement = "";
    let intentKind: TreeA11yEvaluationStep["intentKind"] = "unsupported";

    if (intent !== null) {
      const focusedRow = visibleRowsBefore[intent.index];
      if (focusedRow) {
        intentKind = intent.kind;

        if (intent.kind === "set-active-index") {
          state.activeNodeId = focusedRow.node.id;
          announcement = formatTreeKeyboardAnnouncement({
            action: "active",
            statement: focusedRow.node.statement,
            depthFromRoot: focusedRow.depthFromRoot,
          });
        } else if (intent.kind === "expand" && focusedRow.node.kind === "parent") {
          state.activeNodeId = focusedRow.node.id;
          state.expandedNodeIds = updateExpandedNodeIds(state.expandedNodeIds, focusedRow.node.id);
          announcement = formatTreeKeyboardAnnouncement({
            action: "expand",
            statement: focusedRow.node.statement,
            depthFromRoot: focusedRow.depthFromRoot,
            childCount: fixture.childIdsByParentId[focusedRow.node.id]?.length ?? 0,
          });
        } else if (intent.kind === "collapse" && focusedRow.node.kind === "parent") {
          state.activeNodeId = focusedRow.node.id;
          state.expandedNodeIds = updateExpandedNodeIds(state.expandedNodeIds, focusedRow.node.id);
          announcement = formatTreeKeyboardAnnouncement({
            action: "collapse",
            statement: focusedRow.node.statement,
            depthFromRoot: focusedRow.depthFromRoot,
          });
        }
      }
    }

    const visibleRows = buildVisibleRows(fixture, state.expandedNodeIds);
    const activeRowIndex = Math.max(0, visibleRows.findIndex((row) => row.node.id === state.activeNodeId));
    state.activeNodeId = visibleRows[activeRowIndex]?.node.id ?? fixture.rootId;

    const renderWindow = planTreeRenderWindow({
      totalRowCount: visibleRows.length,
      anchorRowIndex: activeRowIndex,
      maxVisibleRows: renderSettings.maxVisibleRows,
      overscanRows: renderSettings.overscanRows,
    });

    state.scrollTopPx = resolveVirtualScrollTopForRowIndex(
      state.scrollTopPx,
      activeRowIndex,
      visibleRows.length,
      virtualizationSettings,
    );

    const virtualizationPlan = planTreeVirtualizationWindow({
      totalRowCount: visibleRows.length,
      scrollTopPx: state.scrollTopPx,
      settings: virtualizationSettings,
    });

    const isVirtualized = virtualizationPlan.mode === "virtualized";
    const displayedStartIndex = isVirtualized ? virtualizationPlan.startIndex : renderWindow.startIndex;
    const displayedEndIndex = isVirtualized ? virtualizationPlan.endIndex : renderWindow.endIndex;

    const accessibility = buildTreeAccessibilityMetadata(
      visibleRows.map((row) => ({
        nodeId: row.node.id,
        parentId: row.parentId,
        depthFromRoot: row.depthFromRoot,
      })),
      {
        orderedChildIdsByParentId: fixture.childIdsByParentId,
        totalChildrenByParentId: fixture.totalChildrenByParentId,
      },
    );

    const activeRow = visibleRows[activeRowIndex] ?? visibleRows[0];
    if (!activeRow) {
      continue;
    }
    const activeMetadata = accessibility.byNodeId[activeRow.node.id];

    steps.push({
      key,
      intentKind,
      activeNodeId: activeRow.node.id,
      activeRowIndex,
      announcement,
      ariaActivedescendant: `treeitem-${activeRow.node.id}`,
      ariaLevel: activeMetadata.level,
      ariaPosInSet: activeMetadata.posInSet,
      ariaSetSize: activeMetadata.setSize,
      renderMode: isVirtualized ? "virtualized" : renderWindow.mode,
      renderedRowCount: isVirtualized ? virtualizationPlan.renderedRowCount : renderWindow.renderedRowCount,
      hiddenAboveCount: isVirtualized ? virtualizationPlan.hiddenAboveCount : renderWindow.hiddenAboveCount,
      hiddenBelowCount: isVirtualized ? virtualizationPlan.hiddenBelowCount : renderWindow.hiddenBelowCount,
      visibleRowCount: visibleRows.length,
      displayedStartIndex,
      displayedEndIndex,
    });
  }

  const outcomeHash = computeHash({
    schemaVersion: SCHEMA_VERSION,
    summary: summarizeSteps(steps),
    finalState: {
      activeNodeId: state.activeNodeId,
      expandedNodeIds: state.expandedNodeIds,
      finalScrollTopPx: state.scrollTopPx,
    },
    steps: steps.map((step) => ({
      key: step.key,
      intentKind: step.intentKind,
      activeNodeId: step.activeNodeId,
      activeRowIndex: step.activeRowIndex,
      announcement: step.announcement,
      ariaActivedescendant: step.ariaActivedescendant,
      ariaLevel: step.ariaLevel,
      ariaPosInSet: step.ariaPosInSet,
      ariaSetSize: step.ariaSetSize,
      renderMode: step.renderMode,
      renderedRowCount: step.renderedRowCount,
      hiddenAboveCount: step.hiddenAboveCount,
      hiddenBelowCount: step.hiddenBelowCount,
      visibleRowCount: step.visibleRowCount,
      displayedStartIndex: step.displayedStartIndex,
      displayedEndIndex: step.displayedEndIndex,
    })),
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    requestHash,
    outcomeHash,
    parameters: {
      keySequence,
      renderSettings,
      virtualizationSettings,
    },
    summary: summarizeSteps(steps),
    initialState: {
      activeNodeId: fixture.initialActiveNodeId,
      expandedNodeIds: fixture.initialExpandedNodeIds.slice().sort((left, right) => left.localeCompare(right)),
    },
    finalState: {
      activeNodeId: state.activeNodeId,
      expandedNodeIds: state.expandedNodeIds,
      finalScrollTopPx: state.scrollTopPx,
    },
    steps,
  };
}

function buildEvaluationFixture(): EvaluationFixture {
  const nodes: TreeA11yEvaluationNode[] = [
    { id: "root", kind: "parent", statement: "Root theorem" },
    { id: "defs", kind: "parent", statement: "Definitions" },
    { id: "lemma-a", kind: "leaf", statement: "Lemma A" },
    { id: "lemma-b", kind: "leaf", statement: "Lemma B" },
    { id: "arith", kind: "parent", statement: "Arithmetic lemmas" },
    { id: "arith-1", kind: "leaf", statement: "Arithmetic step 1" },
    { id: "arith-2", kind: "leaf", statement: "Arithmetic step 2" },
    { id: "arith-3", kind: "leaf", statement: "Arithmetic step 3" },
    { id: "loop", kind: "parent", statement: "Loop invariants" },
    { id: "loop-1", kind: "leaf", statement: "Loop base case" },
    { id: "loop-2", kind: "leaf", statement: "Loop induction step" },
  ];

  const childIdsByParentId: Record<string, string[]> = {
    root: ["defs", "arith", "loop"],
    defs: ["lemma-a", "lemma-b"],
    arith: ["arith-1", "arith-2", "arith-3"],
    loop: ["loop-1", "loop-2"],
  };

  return {
    rootId: "root",
    nodesById: Object.fromEntries(nodes.map((node) => [node.id, node])),
    childIdsByParentId,
    totalChildrenByParentId: {
      root: 3,
      defs: 2,
      arith: 3,
      loop: 2,
    },
    initialExpandedNodeIds: ["root", "defs"],
    initialActiveNodeId: "root",
  };
}

function buildEvaluationKeySequence(): TreeKeyboardKey[] {
  return [
    "ArrowDown",
    "ArrowDown",
    "ArrowDown",
    "ArrowDown",
    "ArrowRight",
    "ArrowDown",
    "ArrowDown",
    "ArrowLeft",
    "ArrowLeft",
    "ArrowDown",
    "ArrowRight",
    "ArrowDown",
    "PageDown",
    "ArrowUp",
    "End",
    "Home",
  ];
}

function buildVisibleRows(fixture: EvaluationFixture, expandedNodeIds: string[]): VisibleRow[] {
  const expandedSet = new Set(expandedNodeIds);
  const rows: VisibleRow[] = [];
  const stack: Array<{ nodeId: string; parentId?: string; depthFromRoot: number }> = [
    { nodeId: fixture.rootId, depthFromRoot: 0 },
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      break;
    }
    const node = fixture.nodesById[frame.nodeId];
    if (!node) {
      continue;
    }

    rows.push({
      node,
      parentId: frame.parentId,
      depthFromRoot: frame.depthFromRoot,
    });

    const childIds = fixture.childIdsByParentId[node.id] ?? [];
    if (node.kind === "parent" && expandedSet.has(node.id) && childIds.length > 0) {
      for (let index = childIds.length - 1; index >= 0; index -= 1) {
        stack.push({
          nodeId: childIds[index],
          parentId: node.id,
          depthFromRoot: frame.depthFromRoot + 1,
        });
      }
    }
  }

  return rows;
}

function buildKeyboardRows(rows: VisibleRow[], expandedNodeIds: string[]): TreeKeyboardRow[] {
  const expandedSet = new Set(expandedNodeIds);
  return rows.map((row) => ({
    nodeId: row.node.id,
    parentId: row.parentId,
    kind: row.node.kind,
    isExpanded: row.node.kind === "parent" && expandedSet.has(row.node.id),
  }));
}

function updateExpandedNodeIds(expandedNodeIds: string[], nodeId: string): string[] {
  if (expandedNodeIds.includes(nodeId)) {
    return expandedNodeIds.filter((value) => value !== nodeId);
  }
  return [...expandedNodeIds, nodeId].sort((left, right) => left.localeCompare(right));
}

function summarizeSteps(steps: TreeA11yEvaluationStep[]): TreeA11yEvaluationReport["summary"] {
  return {
    totalSteps: steps.length,
    expandActionCount: steps.filter((step) => step.intentKind === "expand").length,
    collapseActionCount: steps.filter((step) => step.intentKind === "collapse").length,
    activeAnnouncementCount: steps.filter((step) => step.announcement.startsWith("Active ")).length,
    virtualizedStepCount: steps.filter((step) => step.renderMode === "virtualized").length,
    windowedStepCount: steps.filter((step) => step.renderMode === "windowed").length,
  };
}

function computeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, stableReplacer)).digest("hex");
}

function stableReplacer(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return Object.keys(value as Record<string, unknown>)
    .sort((left, right) => left.localeCompare(right))
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = (value as Record<string, unknown>)[key];
      return result;
    }, {});
}
