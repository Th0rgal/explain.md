"use client";

import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import type { SceneTransformOutput } from "../lib/tree-scene";

interface ProofTree3DProps {
  scene: SceneTransformOutput;
  onSelectNode: (nodeId: string, kind: "leaf" | "parent") => void;
  isHydrating: boolean;
}

interface ScenePalette {
  background: string;
  edge: string;
  root: string;
  parentOk: string;
  unsupportedParent: string;
  prerequisiteViolation: string;
  policyViolation: string;
  leaf: string;
  selected: string;
  path: string;
}

const DEFAULT_PALETTE: ScenePalette = {
  background: "#0b1018",
  edge: "#465066",
  root: "#40d6be",
  parentOk: "#7ddaf5",
  unsupportedParent: "#ff9a7d",
  prerequisiteViolation: "#ffcf72",
  policyViolation: "#f9778f",
  leaf: "#c8d0e4",
  selected: "#ffffff",
  path: "#72f2d8",
};

export function ProofTree3D(props: ProofTree3DProps) {
  const [palette, setPalette] = useState<ScenePalette>(DEFAULT_PALETTE);
  const denseMode = props.scene.nodeCount >= 500;

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    setPalette({
      background: readColor(styles, "--color-canvas", DEFAULT_PALETTE.background),
      edge: readColor(styles, "--color-scene-edge", DEFAULT_PALETTE.edge),
      root: readColor(styles, "--color-scene-root", DEFAULT_PALETTE.root),
      parentOk: readColor(styles, "--color-scene-parent", DEFAULT_PALETTE.parentOk),
      unsupportedParent: readColor(styles, "--color-scene-unsupported", DEFAULT_PALETTE.unsupportedParent),
      prerequisiteViolation: readColor(styles, "--color-scene-prereq", DEFAULT_PALETTE.prerequisiteViolation),
      policyViolation: readColor(styles, "--color-scene-policy", DEFAULT_PALETTE.policyViolation),
      leaf: readColor(styles, "--color-scene-leaf", DEFAULT_PALETTE.leaf),
      selected: readColor(styles, "--color-scene-selected", DEFAULT_PALETTE.selected),
      path: readColor(styles, "--color-scene-path", DEFAULT_PALETTE.path),
    });
  }, []);

  const nodeById = useMemo(() => new Map(props.scene.nodes.map((node) => [node.id, node])), [props.scene.nodes]);

  if (props.scene.nodes.length === 0) {
    return <p className="meta">3D tree unavailable until at least one node is loaded.</p>;
  }

  return (
    <div className="tree-3d-shell">
      <div className="tree-3d-meta">
        <p className="meta">
          Scene hash: <code>{props.scene.sceneHash}</code>
        </p>
        <p className="meta">
          Nodes: {props.scene.nodeCount} | Edges: {props.scene.edgeCount} | Max depth: {props.scene.maxDepth}
        </p>
        <p className="meta">{denseMode ? "Dense mode enabled (labels reduced for performance)." : "Interactive labels enabled."}</p>
        {props.isHydrating ? <p className="meta">Loading remaining tree nodes for whole-tree mode…</p> : null}
      </div>
      <div className="tree-3d-canvas" aria-label="3D explanation tree">
        <Canvas camera={{ position: [0, 8, 46], fov: 55 }}>
          <color attach="background" args={[palette.background]} />
          <ambientLight intensity={0.6} />
          <pointLight position={[28, 22, 28]} intensity={0.8} />
          <pointLight position={[-28, -8, -20]} intensity={0.3} />

          {props.scene.edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) {
              return null;
            }
            return (
              <Line
                key={edge.id}
                points={[
                  [from.position.x, from.position.y, from.position.z],
                  [to.position.x, to.position.y, to.position.z],
                ]}
                color={edgeColor(edge.status, palette)}
                lineWidth={edge.status === "normal" ? 1 : 1.8}
                transparent
                opacity={edge.status === "normal" ? 0.55 : 0.9}
              />
            );
          })}

          {props.scene.nodes.map((node) => {
            const radius = node.kind === "parent" ? 0.85 : 0.55;
            return (
              <group key={node.id} position={[node.position.x, node.position.y, node.position.z]}>
                <mesh onClick={() => props.onSelectNode(node.id, node.kind)}>
                  <sphereGeometry args={[radius, denseMode ? 8 : 16, denseMode ? 8 : 16]} />
                  <meshStandardMaterial color={nodeColor(node.status, palette)} metalness={0.2} roughness={0.35} />
                </mesh>
                {!denseMode ? (
                  <Html distanceFactor={14} position={[0, radius + 0.4, 0]} center>
                    <button type="button" className="tree-3d-label" onClick={() => props.onSelectNode(node.id, node.kind)}>
                      {compactStatement(node.label)}
                    </button>
                  </Html>
                ) : null}
              </group>
            );
          })}

          <OrbitControls makeDefault enablePan enableRotate enableZoom />
        </Canvas>
      </div>
      <div className="tree-3d-legend" aria-label="3D legend">
        <LegendDot color={palette.root} label="Root" />
        <LegendDot color={palette.parentOk} label="Parent (ok)" />
        <LegendDot color={palette.unsupportedParent} label="Unsupported parent" />
        <LegendDot color={palette.prerequisiteViolation} label="Prerequisite violation" />
        <LegendDot color={palette.policyViolation} label="Policy violation" />
        <LegendDot color={palette.leaf} label="Leaf" />
        <LegendDot color={palette.path} label="Selected path" />
        <LegendDot color={palette.selected} label="Selected node" />
      </div>
    </div>
  );
}

function LegendDot(props: { color: string; label: string }) {
  return (
    <span className="legend-dot">
      <span className="legend-swatch" style={{ background: props.color }} />
      {props.label}
    </span>
  );
}

function edgeColor(status: "normal" | "policy_violation" | "prerequisite_violation" | "unsupported_parent", palette: ScenePalette): string {
  if (status === "unsupported_parent") {
    return palette.unsupportedParent;
  }
  if (status === "prerequisite_violation") {
    return palette.prerequisiteViolation;
  }
  if (status === "policy_violation") {
    return palette.policyViolation;
  }
  return palette.edge;
}

function nodeColor(status: string, palette: ScenePalette): string {
  if (status === "selected") {
    return palette.selected;
  }
  if (status === "path") {
    return palette.path;
  }
  if (status === "root") {
    return palette.root;
  }
  if (status === "parent_ok") {
    return palette.parentOk;
  }
  if (status === "unsupported_parent") {
    return palette.unsupportedParent;
  }
  if (status === "prerequisite_violation") {
    return palette.prerequisiteViolation;
  }
  if (status === "policy_violation") {
    return palette.policyViolation;
  }
  return palette.leaf;
}

function compactStatement(statement: string): string {
  const compact = statement.trim();
  if (compact.length <= 34) {
    return compact;
  }
  return `${compact.slice(0, 34)}…`;
}

function readColor(styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const value = styles.getPropertyValue(token).trim();
  return value.length > 0 ? value : fallback;
}
