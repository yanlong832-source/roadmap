import { Handle, NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

import { Phase } from "../types/roadmap";

/**
 * A phase rendered as a directory "block" card.
 *
 * The block sits to the left of its topic column; every topic in the
 * phase fans out from its right handle with a *dashed* edge, giving
 * the "目录 + 细项" (directory + details) look the user asked for.
 * Fixed size so hover/selection never shifts the layout.
 */
export const PHASE_CARD_WIDTH = 200;
export const PHASE_CARD_HEIGHT = 96;

export const PhaseCardNode = memo(function PhaseCardNode(props: NodeProps) {
  const phase = (props.data as { phase: Phase; topicCount?: number }).phase;
  const count = (props.data as { topicCount?: number }).topicCount ?? 0;
  const selected = props.selected;
  if (!phase) return null;

  return (
    <div
      data-testid={`phase-card-${phase.id}`}
      data-phase-id={phase.id}
      style={{
        width: PHASE_CARD_WIDTH,
        height: PHASE_CARD_HEIGHT,
        boxSizing: "border-box",
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${selected ? "#4f46e5" : "#c7d2fe"}`,
        background: selected ? "#eef2ff" : "#f8faff",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div style={{ fontSize: 11, color: "#6b7280", fontWeight: 600 }}>
        阶段 {phase.order}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "#1f2937",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {phase.name}
      </div>
      <div style={{ fontSize: 11, color: "#6b7280" }}>{count} 个主题</div>
      {/* One source handle per topic row so each dashed fan-out edge
          lands on its own vertical slot. */}
      {Array.from({ length: Math.max(count, 1) }).map((_, i) => (
        <Handle
          key={i}
          id={`t${i}`}
          type="source"
          position={Position.Right}
          style={{
            top: `${12 + i * (100 / Math.max(count, 1))}%`,
            width: 6,
            height: 6,
            background: "#4f46e5",
            border: "none",
          }}
        />
      ))}
    </div>
  );
});
