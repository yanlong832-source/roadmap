import { Handle, NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

import { Phase } from "../types/roadmap";
import { LearningStatus } from "../layout/roadmapLayout";

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

export interface PhaseCardProps {
  phase: Phase;
  /** Topic count in the phase (drives fan-out handle count). */
  topicCount?: number;
  /** When set, render the collapse toggle button in the top-right. */
  collapsed?: boolean;
  onToggleCollapse?: (phaseId: string) => void;
  /** Progress record for the phase's topics; drives the progress pill. */
  statuses?: Record<string, LearningStatus>;
}

export const PhaseCardNode = memo(function PhaseCardNode(props: NodeProps) {
  const { phase, topicCount, collapsed, onToggleCollapse, statuses } =
    props.data as unknown as PhaseCardProps;
  const selected = props.selected;
  if (!phase) return null;
  const count = topicCount ?? 0;

  const doneCount = statuses
    ? Object.values(statuses).filter((s) => s === "done").length
    : 0;
  const progressPct = count > 0 ? Math.round((doneCount / count) * 100) : 0;

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
        position: "relative",
      }}
    >
      {/* Chain handles: bottom-center (source) + top-center (target),
          one each so the block->block link is solid and centered. */}
      <Handle
        id="top-center"
        type="target"
        position={Position.Top}
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          width: 8,
          height: 8,
          background: "#4f46e5",
          border: "none",
        }}
      />
      <Handle
        id="bottom-center"
        type="source"
        position={Position.Bottom}
        style={{
          left: "50%",
          transform: "translateX(-50%)",
          width: 8,
          height: 8,
          background: "#4f46e5",
          border: "none",
        }}
      />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              color: "#6b7280",
              fontWeight: 600,
              marginBottom: 2,
            }}
          >
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
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            {count} 个主题
            {statuses && count > 0
              ? ` · 完成 ${doneCount}/${count}`
              : ""}
          </div>
        </div>

        {onToggleCollapse ? (
          <button
            data-testid={`phase-collapse-${phase.id}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(phase.id);
            }}
            style={{
              width: 22,
              height: 22,
              border: "1px solid #c7d2fe",
              borderRadius: 4,
              background: "#fff",
              cursor: "pointer",
              fontSize: 11,
              color: "#4f46e5",
              lineHeight: "16px",
              flexShrink: 0,
            }}
            title={collapsed ? "展开" : "折叠"}
            aria-label={collapsed ? "展开阶段" : "折叠阶段"}
          >
            {collapsed ? "+" : "−"}
          </button>
        ) : null}
      </div>

      {/* Fan-out handles hidden when collapsed (no topic nodes shown). */}
      {!collapsed &&
        Array.from({ length: Math.max(count, 1) }).map((_, i) => (
          <Handle
            key={`t${i}`}
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

      {statuses ? (
        <div
          data-testid={`phase-progress-${phase.id}`}
          style={{
            height: 3,
            background: "#e0e7ff",
            borderRadius: 999,
            marginTop: 4,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: "100%",
              background: progressPct === 100 ? "#10b981" : "#4f46e5",
            }}
          />
        </div>
      ) : null}
    </div>
  );
});
