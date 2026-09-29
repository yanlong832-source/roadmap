import { Handle, NodeProps, Position } from "@xyflow/react";
import { memo } from "react";

import { Topic } from "../types/roadmap";
import {
  LearningStatus,
  NEXT_STATUS,
  STATUS_LABELS,
} from "../layout/roadmapLayout";

/**
 * Fixed-size card so hover states never shift the layout.
 * Exports the stable dimensions so RoadmapFlow can position nodes.
 */
export const TOPIC_NODE_WIDTH = 220;
export const TOPIC_NODE_HEIGHT = 116;

const STATUS_COLORS: Record<LearningStatus, string> = {
  not_started: "#d1d5db",
  in_progress: "#f59e0b",
  done: "#10b981",
};

/**
 * Custom node card: title + one-line description + resource-count badge.
 * Clicking the card hands the full Topic (with resources) to onTopicClick.
 * The status pill cycles the learning state without opening the drawer.
 */
export const TopicNode = memo(function TopicNode(props: NodeProps) {
  const data = props.data as {
    topic?: Topic;
    onTopicClick?: (t: Topic) => void;
    status?: LearningStatus;
    onCycleStatus?: (topic: Topic) => void;
  };
  const topic = data.topic;
  const onTopicClick = data.onTopicClick;
  const status: LearningStatus = data.status ?? "not_started";
  const onCycleStatus = data.onCycleStatus;
  const selected = props.selected;

  // Data is optional in the v12 contract; guard instead of throwing.
  if (!topic) return null;
  const count = topic.resources.length;

  return (
    <div
      data-testid={`topic-node-${topic.id}`}
      data-topic-id={topic.id}
      style={{
        width: TOPIC_NODE_WIDTH,
        height: TOPIC_NODE_HEIGHT,
        boxSizing: "border-box",
        padding: "12px 14px",
        borderRadius: 8,
        border: `1px solid ${selected ? "#4f46e5" : "#d1d5db"}`,
        borderLeft: `4px solid ${STATUS_COLORS[status]}`,
        background: "#ffffff",
        boxShadow: selected ? "0 0 0 2px rgba(79,70,229,0.25)" : "0 1px 2px rgba(0,0,0,0.08)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        overflow: "hidden",
      }}
      onClick={() => onTopicClick?.(topic)}
    >
      <Handle type="target" position={Position.Top} />
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontWeight: 600,
            fontSize: 14,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {topic.title}
        </div>
        {status === "done" ? (
          <span
            aria-label="已完成"
            style={{
              color: "#10b981",
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            ✓
          </span>
        ) : null}
      </div>

      {onCycleStatus ? (
        <button
          data-testid={`topic-status-${topic.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onCycleStatus(topic);
          }}
          style={{
            alignSelf: "flex-start",
            border: "1px solid " + STATUS_COLORS[status],
            borderRadius: 999,
            padding: "1px 8px",
            fontSize: 11,
            fontWeight: 600,
            cursor: "pointer",
            background: status === "in_progress" ? "#fffbeb" : "#f9fafb",
            color:
              status === "done"
                ? "#059669"
                : status === "in_progress"
                  ? "#b45309"
                  : "#6b7280",
          }}
          title={`点击切换为「${STATUS_LABELS[NEXT_STATUS[status]]}」`}
          aria-label={`状态：${STATUS_LABELS[status]}`}
        >
          {STATUS_LABELS[status]}
        </button>
      ) : null}
      <div
        style={{
          fontSize: 12,
          color: "#4b5563",
          lineHeight: 1.3,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {topic.description}
      </div>
      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            background: "#eef2ff",
            color: "#4f46e5",
            borderRadius: 999,
            padding: "1px 8px",
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {count} 个资源
        </span>
        <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>
          {topic.duration_hint}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
});

/**
 * Tail placeholder shown while a phase is still streaming in.
 * Fixed size matches TopicNode to prevent hover layout shift.
 */
export const LoadingNode = memo(function LoadingNode() {
  return (
    <div
      data-testid="roadmap-loading-node"
      style={{
        width: TOPIC_NODE_WIDTH,
        height: TOPIC_NODE_HEIGHT,
        boxSizing: "border-box",
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px dashed #c7d2fe",
        background: "#f9fafb",
        color: "#6b7280",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        fontSize: 13,
      }}
    >
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: "50%",
          border: "2px solid #c7d2fe",
          borderTopColor: "#4f46e5",
          animation: "roadmap-spin 0.8s linear infinite",
          display: "inline-block",
        }}
      />
      生成中…
    </div>
  );
});

// Spinner keyframe — injected once so it works without a global CSS file.
const styleTag = document?.createElement?.("style");
if (styleTag) {
  styleTag.textContent =
    "@keyframes roadmap-spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(styleTag);
}



export const TOPIC_GAP = 56; // vertical gap between sibling topic rows (matches layout module)
